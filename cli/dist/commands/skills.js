import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import ora from "ora";
import { createClient, handleError, parseList } from "../helpers.js";
import { printTable, printDetail, printSuccess, relativeDate, truncate, } from "../output.js";
function parseCredentials(values) {
    const credentials = {};
    for (const value of values || []) {
        const idx = value.indexOf("=");
        if (idx <= 0)
            continue;
        credentials[value.slice(0, idx)] = value.slice(idx + 1);
    }
    return credentials;
}
function printPublishEverywhereResults(results) {
    for (const item of results) {
        const slug = String(item.slug || "");
        const title = String(item.title || slug || "skill");
        console.log(`\n${title}${slug ? ` (${slug})` : ""}`);
        const rows = (Array.isArray(item.results) ? item.results : []);
        for (const row of rows) {
            console.log(`  ${row.name || row.marketplace}: ${row.status || "unknown"}`);
            if (row.url)
                console.log(`    URL: ${row.url}`);
            if (row.command)
                console.log(`    Command: ${row.command}`);
            if (row.note)
                console.log(`    Note: ${row.note}`);
        }
    }
}
function listingToSh1ptManifest(listing) {
    const slug = String(listing.slug || listing.title || "skill")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "skill";
    const tags = Array.isArray(listing.tags)
        ? listing.tags.map(String)
        : typeof listing.tags === "string"
            ? listing.tags.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
    const sourceUrl = listing.skill_file_url || listing.source_url || listing.website_url || undefined;
    return {
        name: slug,
        title: String(listing.title || slug),
        description: String(listing.description || listing.tagline || `uGig skill: ${slug}`),
        tagline: listing.tagline || undefined,
        category: listing.category || "Automation",
        tags: tags.length ? tags.slice(0, 10) : ["skills", "automation"],
        price: Number(listing.price_sats || 0) || 0,
        skillFile: sourceUrl || "SKILL.md",
        sourceUrl,
        marketplaces: {},
    };
}
function runSh1ptSkillsPublish(listing, opts) {
    const dir = mkdtempSync(join(tmpdir(), "ugig-sh1pt-publish-"));
    const manifestPath = join(dir, "sh1pt.skill.json");
    const manifest = listingToSh1ptManifest(listing);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const args = ["skills", "publish", "--manifest", manifestPath];
    if (opts.all || !opts.marketplaces?.length)
        args.push("--all");
    for (const marketplace of opts.marketplaces || [])
        args.push("--marketplace", marketplace);
    if (opts.dryRun)
        args.push("--dry-run");
    const sh1ptBin = process.env.SH1PT_BIN || "sh1pt";
    const result = sh1ptBin.includes(" ")
        ? spawnSync(`${sh1ptBin} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`, { encoding: "utf8", shell: true })
        : spawnSync(sh1ptBin, args, { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    return {
        slug: String(manifest.name),
        exitCode: result.status,
        stdout: result.stdout || "",
        stderr: result.stderr || result.error?.message || "",
        command: `${sh1ptBin} ${args.join(" ")}`,
    };
}
export function registerSkillsCommands(program) {
    const skills = program.command("skills").description("Manage skill marketplace listings");
    // ── List skills ────────────────────────────────────────────────
    skills
        .command("list")
        .description("List active skill listings")
        .option("--search <query>", "Search by title/description")
        .option("--category <cat>", "Filter by category")
        .option("--tag <tag>", "Filter by tag")
        .option("--sort <sort>", "Sort: newest|popular|rating|price_low|price_high")
        .option("--page <n>", "Page number", "1")
        .action(async (cmdOpts) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Fetching skills...").start();
        try {
            const client = createClient(opts);
            const result = await client.get("/api/skills", {
                search: cmdOpts.search,
                category: cmdOpts.category,
                tag: cmdOpts.tag,
                sort: cmdOpts.sort,
                page: cmdOpts.page,
            });
            spinner?.stop();
            printTable([
                { header: "Slug", key: "slug", width: 25, transform: truncate(23) },
                { header: "Title", key: "title", width: 30, transform: truncate(28) },
                { header: "Price", key: "price_sats", width: 10, transform: (v) => `${v} sats` },
                { header: "Rating", key: "rating_avg", width: 8 },
                { header: "Downloads", key: "downloads_count", width: 10 },
                { header: "Scan", key: "scan_status", width: 10, transform: (v) => String(v || "—") },
                { header: "Created", key: "created_at", transform: relativeDate },
            ], result.listings, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Get skill detail ───────────────────────────────────────────
    skills
        .command("get <slug>")
        .description("Get details of a skill listing")
        .action(async (slug) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Fetching skill...").start();
        try {
            const client = createClient(opts);
            const result = await client.get(`/api/skills/${slug}`);
            spinner?.stop();
            printDetail(result.listing, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Create skill listing ───────────────────────────────────────
    skills
        .command("create")
        .alias("new")
        .description("Create a new skill listing")
        .requiredOption("--title <title>", "Skill title")
        .requiredOption("--description <text>", "Skill description")
        .option("--price <sats>", "Price in sats (0 = free)", "0")
        .option("--category <cat>", "Category")
        .option("--tags <tags>", "Comma-separated tags")
        .option("--tagline <text>", "Short tagline")
        .option("--status <status>", "Status: active|archived", "active")
        .option("--source-url <url>", "Source URL for metadata autofill")
        .action(async (cmdOpts) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Creating skill listing...").start();
        try {
            const client = createClient(opts);
            // If source URL provided and no description given beyond the required, fetch metadata
            let autofilled = {};
            if (cmdOpts.sourceUrl) {
                try {
                    const meta = await client.post("/api/skills/metadata", { url: cmdOpts.sourceUrl });
                    autofilled = meta.metadata;
                    if (!opts.json) {
                        spinner?.info("Autofilled metadata from source URL");
                        spinner?.start("Creating skill listing...");
                    }
                }
                catch {
                    if (!opts.json) {
                        spinner?.warn("Could not fetch metadata from source URL, continuing...");
                        spinner?.start("Creating skill listing...");
                    }
                }
            }
            const body = {
                title: cmdOpts.title || autofilled.title,
                description: cmdOpts.description || autofilled.description,
                price_sats: parseInt(cmdOpts.price || "0", 10),
                status: cmdOpts.status || "active",
            };
            if (cmdOpts.category)
                body.category = cmdOpts.category;
            if (cmdOpts.tagline)
                body.tagline = cmdOpts.tagline;
            if (cmdOpts.tags) {
                body.tags = cmdOpts.tags.split(",").map((t) => t.trim());
            }
            else if (autofilled.tags && Array.isArray(autofilled.tags)) {
                body.tags = autofilled.tags;
            }
            if (cmdOpts.sourceUrl)
                body.source_url = cmdOpts.sourceUrl;
            const result = await client.post("/api/skills", body);
            spinner?.stop();
            printSuccess(`Skill listing created: ${result.listing.slug}`, opts);
            printDetail(result.listing, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Update skill listing ───────────────────────────────────────
    skills
        .command("update <slug>")
        .description("Update a skill listing")
        .option("--title <title>", "Skill title")
        .option("--description <text>", "Skill description")
        .option("--price <sats>", "Price in sats")
        .option("--category <cat>", "Category")
        .option("--tags <tags>", "Comma-separated tags")
        .option("--tagline <text>", "Short tagline")
        .option("--status <status>", "Status: active|archived")
        .option("--source-url <url>", "Source URL for metadata")
        .action(async (slug, cmdOpts) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Updating skill listing...").start();
        try {
            const client = createClient(opts);
            const body = {};
            if (cmdOpts.title)
                body.title = cmdOpts.title;
            if (cmdOpts.description)
                body.description = cmdOpts.description;
            if (cmdOpts.price)
                body.price_sats = parseInt(cmdOpts.price, 10);
            if (cmdOpts.category)
                body.category = cmdOpts.category;
            if (cmdOpts.tagline)
                body.tagline = cmdOpts.tagline;
            if (cmdOpts.tags)
                body.tags = cmdOpts.tags.split(",").map((t) => t.trim());
            if (cmdOpts.status)
                body.status = cmdOpts.status;
            if (cmdOpts.sourceUrl)
                body.source_url = cmdOpts.sourceUrl;
            const result = await client.patch(`/api/skills/${slug}`, body);
            spinner?.stop();
            printSuccess(`Skill listing updated: ${slug}`, opts);
            printDetail(result.listing, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Upload skill file ──────────────────────────────────────────
    skills
        .command("upload <listing-id> <file-path>")
        .description("Upload a skill file (runs security scan before accepting)")
        .action(async (listingId, filePath) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Uploading and scanning skill file...").start();
        try {
            const client = createClient(opts);
            const fileBuffer = readFileSync(filePath);
            const fileName = basename(filePath);
            // Determine MIME type from extension
            const ext = fileName.split(".").pop()?.toLowerCase() || "";
            const mimeTypes = {
                ts: "text/typescript",
                js: "application/javascript",
                json: "application/json",
                yaml: "text/yaml",
                yml: "text/yaml",
                md: "text/markdown",
                txt: "text/plain",
                zip: "application/zip",
                tar: "application/x-tar",
                gz: "application/gzip",
                tgz: "application/gzip",
            };
            const mimeType = mimeTypes[ext] || "application/octet-stream";
            // Use the uploadFile method which handles FormData
            // We need to add listing_id to the upload
            const url = `/api/skills/upload`;
            const formData = new FormData();
            const uint8Array = new Uint8Array(fileBuffer);
            const blob = new Blob([uint8Array], { type: mimeType });
            formData.append("file", blob, fileName);
            formData.append("listing_id", listingId);
            // Make the request directly since client.uploadFile doesn't support extra fields
            const result = await client.post(url, undefined);
            // Actually we need to use raw fetch for FormData
            // The client.uploadFile only supports file upload
            // For now, use uploadFile and add listing_id as query param
            // Actually, let's extend the approach:
            spinner?.stop();
            // Re-implement with raw fetch
            const baseUrl = client.baseUrl || process.env.UGIG_BASE_URL || "https://ugig.net";
            const apiKey = client.apiKey || process.env.UGIG_API_KEY;
            const headers = { "User-Agent": "ugig-cli/0.1.0" };
            if (apiKey)
                headers["Authorization"] = `Bearer ${apiKey}`;
            const fd = new FormData();
            fd.append("file", blob, fileName);
            fd.append("listing_id", listingId);
            const response = await fetch(`${baseUrl}/api/skills/upload`, {
                method: "POST",
                headers,
                body: fd,
            });
            const data = await response.json();
            if (!response.ok) {
                if (data.scan) {
                    if (!opts.json) {
                        console.error(`\n❌ Security scan failed: ${data.scan.status}`);
                        if (data.scan.findings?.length) {
                            console.error("\nFindings:");
                            for (const f of data.scan.findings) {
                                console.error(`  • [${f.severity}] ${f.detail}`);
                            }
                        }
                    }
                }
                throw new Error(data.error || `Upload failed (${response.status})`);
            }
            if (opts.json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(`\n✅ File uploaded and scan passed`);
                console.log(`   Path: ${data.file_path}`);
                console.log(`   Hash: ${data.scan?.file_hash}`);
                console.log(`   Scan: ${data.scan?.status}`);
            }
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Fetch metadata preview ─────────────────────────────────────
    skills
        .command("metadata <url>")
        .description("Preview metadata extracted from a URL")
        .action(async (url) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Fetching metadata...").start();
        try {
            const client = createClient(opts);
            const result = await client.post("/api/skills/metadata", { url });
            spinner?.stop();
            printDetail(result.metadata, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── My listings ────────────────────────────────────────────────
    skills
        .command("my")
        .description("List your own skill listings")
        .action(async () => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Fetching your skills...").start();
        try {
            const client = createClient(opts);
            const result = await client.get("/api/skills/my");
            spinner?.stop();
            printTable([
                { header: "Slug", key: "slug", width: 25, transform: truncate(23) },
                { header: "Title", key: "title", width: 30, transform: truncate(28) },
                { header: "Status", key: "status", width: 10 },
                { header: "Scan", key: "scan_status", width: 10, transform: (v) => String(v || "—") },
                { header: "Price", key: "price_sats", width: 10, transform: (v) => `${v} sats` },
                { header: "Downloads", key: "downloads_count", width: 10 },
            ], result.listings, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Publish / publish everywhere ────────────────────────────────
    skills
        .command("publish [slug]")
        .description("Publish a skill listing, or promote skills across external marketplaces")
        .option("--everywhere", "Promote one skill across known marketplaces")
        .option("--all", "Promote all of your skill listings across known marketplaces")
        .option("--marketplace <ids>", "Comma-separated marketplace IDs to target")
        .option("--dry-run", "Return commands/checklist without attempting live marketplace actions", true)
        .option("--no-dry-run", "Allow server-side live publish attempts when a marketplace integration supports it")
        .option("--credential <key=value...>", "Per-request marketplace credential hints; never stored")
        .action(async (slug, cmdOpts) => {
        const opts = program.opts();
        const client = createClient(opts);
        const credentials = parseCredentials(cmdOpts.credential);
        const marketplaces = parseList(cmdOpts.marketplace);
        if (cmdOpts.all || cmdOpts.everywhere) {
            const spinner = opts.json ? null : ora("Delegating publish plan to sh1pt skills publish...").start();
            try {
                if (Object.keys(credentials).length && !opts.json) {
                    spinner?.warn("Credential hints are ignored here; pass credentials to sh1pt via environment variables.");
                }
                const listings = cmdOpts.all || !slug
                    ? (await client.get("/api/skills/my")).listings
                    : [(await client.get(`/api/skills/${slug}`)).listing];
                const results = listings.map((listing) => runSh1ptSkillsPublish(listing, {
                    all: Boolean(cmdOpts.all || !marketplaces?.length),
                    dryRun: cmdOpts.dryRun !== false,
                    marketplaces,
                }));
                spinner?.stop();
                if (opts.json) {
                    console.log(JSON.stringify({ dry_run: cmdOpts.dryRun !== false, results }, null, 2));
                }
                else {
                    for (const result of results) {
                        console.log(`\n${result.slug}`);
                        console.log(`  sh1pt: ${result.exitCode === 0 ? "ok" : "failed"}`);
                        console.log(`  Command: ${result.command}`);
                        if (result.stdout.trim())
                            console.log(result.stdout.trim());
                        if (result.stderr.trim())
                            console.error(result.stderr.trim());
                    }
                }
            }
            catch (err) {
                spinner?.fail("Failed");
                handleError(err, opts);
            }
            return;
        }
        if (!slug) {
            handleError(new Error("Missing skill slug. Use `ugig skills publish <slug>` or `ugig skills publish --all --dry-run`."), opts);
            return;
        }
        const spinner = opts.json ? null : ora(`Publishing ${slug}...`).start();
        try {
            const result = await client.patch(`/api/skills/${slug}`, { status: "active" });
            spinner?.stop();
            printSuccess(`Skill published: ${slug}`, opts);
            printDetail(result.listing, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
    // ── Delete listing ─────────────────────────────────────────────
    skills
        .command("delete <slug>")
        .description("Archive (soft-delete) a skill listing")
        .action(async (slug) => {
        const opts = program.opts();
        const spinner = opts.json ? null : ora("Deleting skill listing...").start();
        try {
            const client = createClient(opts);
            await client.delete(`/api/skills/${slug}`);
            spinner?.stop();
            printSuccess(`Skill listing archived: ${slug}`, opts);
        }
        catch (err) {
            spinner?.fail("Failed");
            handleError(err, opts);
        }
    });
}
//# sourceMappingURL=skills.js.map