import { buildRssXml } from "@profullstack/autoblog/feeds";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://ugig.net";

type Row = {
  slug: string;
  title: string;
  meta_description: string | null;
  published_at: string;
  image_url: string | null;
  tags: string[] | null;
};

export async function GET() {
  let posts: Row[] = [];
  try {
    const sb = createServiceClient();
    const { data } = await (sb as any)
      .from("blog_posts")
      .select("slug, title, meta_description, published_at, image_url, tags")
      .order("published_at", { ascending: false })
      .limit(50);
    posts = (data ?? []) as Row[];
  } catch {
    // Env may be absent during build — return an empty feed rather than 500.
  }

  const xml = buildRssXml({
    title: "ugig blog",
    description: "Latest from the ugig team and partners.",
    siteUrl: SITE_URL,
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      publishedAt: p.published_at,
      excerpt: p.meta_description,
      imageUrl: p.image_url,
      categories: p.tags ?? [],
    })),
  });

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}
