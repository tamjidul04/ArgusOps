import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * The signed-in user's agents in one small payload, for the VS Code extension and other light clients:
 * status, tokens, what the agent is doing, and (for paused agents) the open suggested instruction.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  const [agents, openRewrites, unread, sub] = await Promise.all([
    prisma.agent.findMany({
      where: { cluster: { user_id: userId }, status: { not: "HIBERNATED" } },
      orderBy: [{ last_heartbeat_at: "desc" }],
      take: 50,
    }),
    prisma.promptRewrite.findMany({
      where: { user_id: userId, status: "PROPOSED" },
      orderBy: { created_at: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { user_id: userId, read_at: null } }),
    prisma.subscriptionAndWallet.findUnique({ where: { user_id: userId }, include: { plan: true } }),
  ]);

  const suggestionFor = new Map<string, (typeof openRewrites)[number]>();
  for (const r of openRewrites) if (r.agent_id && !suggestionFor.has(r.agent_id)) suggestionFor.set(r.agent_id, r);

  return NextResponse.json({
    user: { name: auth.user.name, email: auth.user.email },
    plan: sub ? { name: sub.plan.name, maxAgents: sub.max_agents, tokensRemaining: sub.free_tokens + sub.paid_tokens } : null,
    unreadNotifications: unread,
    agents: agents.map((a) => {
      const s = suggestionFor.get(a.agent_id);
      return {
        id: a.agent_id,
        name: a.name,
        type: a.agent_type,
        status: a.status,
        tokensUsed: a.tokens_used,
        currentTask: a.current_task,
        lastSeen: a.last_heartbeat_at.toISOString(),
        suggestion: s
          ? { id: s.id, text: s.rewritten_prompt, observed: s.rationale, tokensBefore: s.tokens_before, source: s.source }
          : null,
      };
    }),
  });
}
