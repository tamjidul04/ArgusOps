import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { processSync } from "@/lib/cli-sync";
import { rateLimit } from "@/lib/rate-limit";

const MAX_BODY_BYTES = 1_000_000;

/** The `argus` CLI reports what happened locally and learns what to do next. API-key authenticated. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const limited = rateLimit(`cli-sync:${auth.user.id}`, 600, 60_000); // ~10/s per account
  if (!limited.allowed) {
    return NextResponse.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await processSync({ userId: auth.user.id, userName: auth.user.name, apiKeyId: auth.apiKeyId }, json);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("CLI sync error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
