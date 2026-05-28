import { createServiceClient } from "@/lib/supabase/service";

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const REQUIRED_COINPAY_SCOPE = "wallet:read";

export async function getConnectedCoinpayAccessToken(userId: string): Promise<string | null> {
  const serviceSupabase = createServiceClient();
  const { data } = await (serviceSupabase as any)
    .from("oauth_identities")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", "coinpay")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metadata = metadataObject(data?.metadata);
  const accessToken =
    typeof metadata.access_token === "string" ? metadata.access_token.trim() : "";
  if (!accessToken) return null;

  // Tokens issued before wallet:read was added to the OAuth scope can't read
  // the user's global wallets via /api/oauth/userinfo. Treat them as
  // disconnected so the UI prompts the user to reconnect CoinPay.
  const scope = typeof metadata.scope === "string" ? metadata.scope : "";
  const scopes = scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes(REQUIRED_COINPAY_SCOPE)) return null;

  return accessToken;
}
