import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import {
  appBaseUrl,
  fetchOAuthProfile,
  isProvider,
  OAUTH_COOKIE,
  redirectUri,
  safeNextPath,
  statesMatch,
} from "@/lib/oauth";
import { signInWithOAuth } from "@/lib/oauth-login";
import { PlansNotSeededError } from "@/lib/provision";
import { clientIp, rateLimit } from "@/lib/rate-limit";

interface OAuthCookie {
  provider: string;
  state: string;
  verifier?: string;
  next?: string;
}

function readCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return typeof parsed?.state === "string" && typeof parsed?.provider === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Step 2: the provider sends the browser back here with ?code and ?state. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const base = appBaseUrl(req);

  // Always clear the one-time cookie, whatever the outcome.
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, base));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/oauth" });
    return res;
  };

  if (!isProvider(provider)) return fail("oauth_failed");

  const limited = rateLimit(`oauth-callback:${clientIp(req)}`, 30, 10 * 60_000);
  if (!limited.allowed) return fail("too_many_requests");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("oauth_denied");

  const saved = readCookie(req.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (!saved || saved.provider !== provider || !code || !statesMatch(saved.state, params.get("state"))) {
    return fail("invalid_state");
  }

  try {
    const profile = await fetchOAuthProfile(provider, {
      code,
      redirectUri: redirectUri(base, provider),
      verifier: saved.verifier,
    });

    const result = await signInWithOAuth(provider, profile);
    if (!result.ok) return fail(result.reason);

    await createSession(result.userId, req.headers.get("user-agent"));

    const res = NextResponse.redirect(new URL(safeNextPath(saved.next), base));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/oauth" });
    return res;
  } catch (error) {
    if (error instanceof PlansNotSeededError) return fail("not_provisioned");
    console.error(`OAuth ${provider} callback failed:`, error instanceof Error ? error.message : error);
    return fail("oauth_failed");
  }
}
