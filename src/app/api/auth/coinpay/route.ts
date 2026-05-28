/**
 * CoinPay OAuth — Initiate login
 * GET /api/auth/coinpay → redirect to CoinPay authorization endpoint
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getAppUrl } from "@/lib/app-url";
import { getAuthContext } from "@/lib/auth/get-user";

const COINPAY_AUTH_URL = "https://coinpayportal.com/api/oauth/authorize";

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export async function GET(request: NextRequest) {
  const clientId = process.env.COINPAY_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "CoinPay OAuth not configured" }, { status: 500 });
  }

  const appUrl = getAppUrl(request, { trustedOnly: true });
  const redirectUri = `${appUrl}/api/callback/oauth`;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "connect" ? "connect" : "login";
  const requestedRedirect = searchParams.get("redirect");
  const returnTo =
    requestedRedirect && requestedRedirect.startsWith("/") ? requestedRedirect : "/settings/connections";
  let userId: string | null = null;

  if (mode === "connect") {
    const auth = await getAuthContext(request);
    if (!auth) {
      return NextResponse.redirect(`${appUrl}/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    userId = auth.user.id;
  }

  // Generate state and PKCE
  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: process.env.COINPAY_OAUTH_SCOPE || "openid profile email wallet:read",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${COINPAY_AUTH_URL}?${params}`;

  // Store state + verifier in cookie
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("coinpay_oauth_state", JSON.stringify({ state, codeVerifier, mode, userId, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return response;
}
