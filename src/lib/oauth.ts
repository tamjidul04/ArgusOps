import crypto from "crypto";

/**
 * OAuth 2.0 authorization-code flow for Google and GitHub (no third-party auth library).
 * Pure helpers + the two network calls (token exchange, profile fetch).
 * Account linking and session creation live in oauth-login.ts / the route handlers.
 */

export type ProviderId = "google" | "github";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Google supports (and we use) PKCE; GitHub relies on `state`. */
  pkce: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  google: {
    id: "google",
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    pkce: true,
  },
  github: {
    id: "github",
    name: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    pkce: false,
  },
};

export function isProvider(value: string): value is ProviderId {
  return value === "google" || value === "github";
}

export function getCredentials(provider: ProviderId): { clientId: string; clientSecret: string } | null {
  const cfg = PROVIDERS[provider];
  const clientId = process.env[cfg.clientIdEnv]?.trim();
  const clientSecret = process.env[cfg.clientSecretEnv]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/* ------------------------------ pure helpers ------------------------------ */

export const OAUTH_COOKIE = "argus_oauth";

/** Public site origin used to build callback URLs. Set APP_URL in production. */
export function appBaseUrl(req: { nextUrl: { origin: string } }): string {
  return (process.env.APP_URL?.trim() || req.nextUrl.origin).replace(/\/+$/, "");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Only same-site relative paths may be used as a post-login destination (blocks open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(next)) return fallback;
  return next;
}

export function redirectUri(baseUrl: string, provider: ProviderId): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
}

export function buildAuthUrl(
  provider: ProviderId,
  p: { clientId: string; redirectUri: string; state: string; challenge?: string }
): string {
  const cfg = PROVIDERS[provider];
  const url = new URL(cfg.authUrl);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", p.state);
  if (cfg.pkce && p.challenge) {
    url.searchParams.set("code_challenge", p.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (provider === "google") url.searchParams.set("prompt", "select_account");
  if (provider === "github") url.searchParams.set("allow_signup", "true");
  return url.toString();
}

export function statesMatch(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ------------------------------ network calls ----------------------------- */

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "ArgusOps",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res.json() as Promise<unknown>;
}

/** Exchanges the code and returns the provider's verified identity. Throws on any failure. */
export async function fetchOAuthProfile(
  provider: ProviderId,
  args: { code: string; redirectUri: string; verifier?: string }
): Promise<OAuthProfile> {
  const creds = getCredentials(provider);
  if (!creds) throw new Error("provider not configured");
  const cfg = PROVIDERS[provider];

  const tokenBody: Record<string, string> = {
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  };
  if (cfg.pkce && args.verifier) tokenBody.code_verifier = args.verifier;

  const token = await postForm(cfg.tokenUrl, tokenBody);
  const accessToken = typeof token.access_token === "string" ? token.access_token : null;
  if (!accessToken) throw new Error("no access token in response");

  if (provider === "google") {
    const info = (await getJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!info.sub) throw new Error("google userinfo missing sub");
    return {
      providerAccountId: info.sub,
      email: info.email?.toLowerCase() ?? null,
      emailVerified: info.email_verified === true,
      name: info.name || info.email?.split("@")[0] || "Google user",
    };
  }

  const user = (await getJson("https://api.github.com/user", accessToken)) as {
    id?: number;
    login?: string;
    name?: string | null;
  };
  if (user.id === undefined) throw new Error("github user missing id");
  const emails = (await getJson("https://api.github.com/user/emails", accessToken)) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  return {
    providerAccountId: String(user.id),
    email: primary?.email.toLowerCase() ?? null,
    emailVerified: Boolean(primary),
    name: user.name || user.login || "GitHub user",
  };
}
