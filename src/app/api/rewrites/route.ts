import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { applyRewrite, dismissRewrite } from "@/lib/rewriter";

type RewriteRow = Awaited<ReturnType<typeof prisma.promptRewrite.findFirst>>;

function view(r: NonNullable<RewriteRow>) {
  return {
    id: r.id,
    agentId: r.agent_id,
    text: r.rewritten_prompt,
    observed: r.rationale,
    repeated: r.original_prompt,
    repeats: r.repeats,
    tokensBefore: r.tokens_before,
    tokensAfter: r.tokens_after,
    source: r.source,
    status: r.status,
    autoApplied: r.auto_applied,
    createdAt: r.created_at.toISOString(),
  };
}

/** The open suggestion for an agent (if any) and the user's recent suggestions. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const agentId = req.nextUrl.searchParams.get("agentId");

  const [open, recent] = await Promise.all([
    agentId
      ? prisma.promptRewrite.findFirst({
          where: { user_id: auth.user.id, agent_id: agentId, status: "PROPOSED" },
          orderBy: { created_at: "desc" },
        })
      : Promise.resolve(null),
    prisma.promptRewrite.findMany({ where: { user_id: auth.user.id }, orderBy: { created_at: "desc" }, take: 10 }),
  ]);

  return NextResponse.json({ suggestion: open ? view(open) : null, recent: recent.map(view) });
}

/** Approve (optionally edited) or dismiss a suggestion. Approving resumes the agent with it. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  if (body.action === "apply") {
    const r = await applyRewrite(auth.user.id, id, typeof body.text === "string" ? body.text : undefined);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({
      success: true,
      message: `${r.value.agent.name} will resume with this instruction on its next sync.`,
      agent: r.value.agent,
    });
  }
  if (body.action === "dismiss") {
    const ok = await dismissRewrite(auth.user.id, id);
    if (!ok) return NextResponse.json({ error: "Suggestion not found or already handled." }, { status: 404 });
    return NextResponse.json({ success: true, message: "Suggestion dismissed. The agent stays paused." });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
