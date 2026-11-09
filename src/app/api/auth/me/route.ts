import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const sub = await prisma.subscriptionAndWallet.findUnique({
    where: { user_id: auth.user.id },
    include: { plan: true },
  });
  const activeAgents = await prisma.agent.count({
    where: { cluster: { user_id: auth.user.id }, status: "ACTIVE" },
  });

  return NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      role: auth.user.role,
      two_factor_enabled: auth.user.two_factor_enabled,
    },
    subscription: sub
      ? {
          plan_id: sub.plan_id,
          plan_name: sub.plan.name,
          max_agents: sub.max_agents,
          free_tokens: sub.free_tokens,
          paid_tokens: sub.paid_tokens,
          purchase_status: sub.purchase_status,
        }
      : null,
    active_agents: activeAgents,
  });
}
