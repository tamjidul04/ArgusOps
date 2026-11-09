import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getUsageSummary } from "@/lib/usage";
import { parseRange } from "@/lib/usage-core";

/** The signed-in user's real usage for 24h, 7d or 30d. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const summary = await getUsageSummary(auth.user.id, parseRange(req.nextUrl.searchParams.get("range")));
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Usage summary error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't load usage." }, { status: 500 });
  }
}
