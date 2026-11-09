import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic route guard (Next.js 16 "proxy", formerly middleware).
 *
 * This only checks that *some* credential is present so anonymous traffic is rejected
 * early. It is NOT authorization: every route handler and server page verifies the
 * session / API key against the database itself (see src/lib/auth.ts).
 */

const SESSION_COOKIE = "argus_session";

/** API routes that are intentionally reachable without a credential. */
const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/oauth", // Google/GitHub sign-in start and callback
  "/api/device/code", // CLI starts the device flow anonymously
  "/api/device/token", // CLI polls with its secret device_code
  "/api/v1/proxy", // authenticates with its own API key
  "/api/health",
];

function hasCredential(req: NextRequest): boolean {
  if (req.cookies.get(SESSION_COOKIE)?.value) return true;
  if (req.headers.get("x-argus-key")) return true;
  if (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) return true;
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    if (!hasCredential(req)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.next();
  }

  // /dashboard/** and /admin/**
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/device/:path*", "/device", "/api/:path*"],
};
