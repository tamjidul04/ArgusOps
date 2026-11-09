import { NextRequest, NextResponse } from "next/server";
import {
  appBaseUrl,
  buildAuthUrl,
  getCredentials,
  isProvider,
  OAUTH_COOKIE,
  pkceChallenge,
  PROVIDERS,
  randomToken,
  redirectUri,
  safeNextPath,
} from "@/lib/oauth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

function toLogin(req: NextRequest, error: string) {
  return NextResponse.redirect(new URL(`/login?error=${error}`, appBaseUrl(req)));
}

/** Step 1: send the browser to Google/GitHub. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "Unknown sign-in provider." }, { status: 404 });
  }

  const limited = rateLimit(`oauth-start:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limited.allowed) return toLogin(req, "too_many_requests");

  const creds = getCredentials(provider);
  if (!creds) return toLogin(req, "oauth_not_configured");

  const state = randomToken();
  const verifier = PROVIDERS[provider].pkce ? randomToken(48) : undefined;
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));

  const authUrl = buildAuthUrl(provider, {
    clientId: creds.clientId,
    redirectUri: redirectUri(appBaseUrl(req), provider),
    state,
    challenge: verifier ? pkceChallenge(verifier) : undefined,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(
    OAUTH_COOKIE,
    Buffer.from(JSON.stringify({ provider, state, verifier, next })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax", // must accompany the top-level redirect back from the provider
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/oauth",
      maxAge: 600,
    }
  );
  return res;
}
