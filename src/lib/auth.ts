import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { API_KEY_PREFIX, extractApiKey, sha256 } from "@/lib/auth-core";
import type { User } from "@prisma/client";

export * from "@/lib/auth-core";

export const SESSION_COOKIE = "argus_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/* -------------------------------------------------------------------------- */
/*  Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export async function createSession(userId: string, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      user_id: userId,
      token_hash: sha256(token),
      user_agent: userAgent?.slice(0, 200) ?? null,
      expires_at: expires,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token_hash: sha256(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

async function userFromSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token_hash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;
  return session.user;
}

/** Current user for server components / route handlers (cookie session only). */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
}

/* -------------------------------------------------------------------------- */
/*  API keys                                                                   */
/* -------------------------------------------------------------------------- */

/** Hash-only lookup. A key is never matched by id, prefix or stored hash. */
export async function userFromApiKey(rawKey: string | null) {
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) return null;
  const key = await prisma.apiKey.findUnique({
    where: { key_hash: sha256(rawKey) },
    include: { user: true },
  });
  if (!key || key.revoked_at || key.user.status !== "ACTIVE") return null;
  // fire-and-forget; usage stamping must never block a request
  prisma.apiKey
    .update({ where: { id: key.id }, data: { last_used_at: new Date() } })
    .catch(() => undefined);
  return { user: key.user, apiKeyId: key.id };
}

/* -------------------------------------------------------------------------- */
/*  Route-handler guards                                                       */
/* -------------------------------------------------------------------------- */

export interface AuthContext {
  user: User;
  via: "session" | "api_key";
  apiKeyId?: string;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (CLI, curl) send no Origin
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Resolve the caller from an API key header or the session cookie.
 * Cookie-authenticated mutating requests must be same-origin (CSRF defence).
 */
export async function getAuth(req: NextRequest): Promise<AuthContext | null> {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    const hit = await userFromApiKey(apiKey);
    return hit ? { user: hit.user, via: "api_key", apiKeyId: hit.apiKeyId } : null;
  }
  const user = await userFromSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return null;
  if (!SAFE_METHODS.has(req.method) && !sameOrigin(req)) return null;
  return { user, via: "session" };
}

export function unauthorized(message = "Authentication required.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "You do not have access to this resource.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** Usage: `const a = await requireAuth(req); if (a instanceof NextResponse) return a;` */
export async function requireAuth(req: NextRequest): Promise<AuthContext | NextResponse> {
  const ctx = await getAuth(req);
  return ctx ?? unauthorized();
}

export async function requireAdmin(req: NextRequest): Promise<AuthContext | NextResponse> {
  const ctx = await getAuth(req);
  if (!ctx) return unauthorized();
  if (ctx.via !== "session" || ctx.user.role !== "ADMIN") {
    return forbidden("Administrator access required.");
  }
  return ctx;
}
