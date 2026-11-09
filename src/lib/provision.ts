import { prisma } from "@/lib/prisma";

export class PlansNotSeededError extends Error {
  constructor() {
    super("Plans are not provisioned yet. Run the database seed.");
  }
}

/**
 * Creates a user on the Free plan with a wallet, default guardrail policy and a workspace.
 * Shared by password sign-up and OAuth first sign-in so both get identical accounts.
 */
export async function createUserOnFreePlan(input: { email: string; name: string; passwordHash: string }) {
  const freePlan = await prisma.pricingPlan.findUnique({ where: { plan_id: "plan_free" } });
  if (!freePlan) throw new PlansNotSeededError();

  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      password_hash: input.passwordHash,
      role: "USER",
      status: "ACTIVE",
      subscription: {
        create: {
          plan_id: freePlan.plan_id,
          free_tokens: freePlan.included_tokens,
          paid_tokens: 0,
          max_agents: freePlan.agent_limit,
          purchase_status: "NONE",
        },
      },
      policy: { create: {} },
      clusters: {
        create: {
          name: `${input.name}'s Workspace`,
          environment: "LOCAL_PC",
          active_agents: 0,
          hibernated_agents: 0,
          zero_trust_local: true,
        },
      },
    },
    include: { subscription: true },
  });
}
