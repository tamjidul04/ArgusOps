/** Shared helpers for the real-database integration tests. Every row is created under a unique email prefix. */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey, hashPassword, sha256 } from "@/lib/auth-core";
import { createUserOnFreePlan } from "@/lib/provision";

export interface TestUser {
  id: string;
  email: string;
  key: string;
  cookie: string;
  clusterId: string;
}

export function createTestKit(prefix: string) {
  const tag = `${prefix}${Date.now()}`;
  const url = (path: string) => `http://localhost:3000${path}`;

  async function makeUser(label: string, planId = "plan_free"): Promise<TestUser> {
    const email = `${tag}.${label}@example.test`;
    const u = await createUserOnFreePlan({ email, name: label, passwordHash: hashPassword("integration-pass-1") });
    if (planId !== "plan_free") {
      const plan = await prisma.pricingPlan.findUniqueOrThrow({ where: { plan_id: planId } });
      await prisma.subscriptionAndWallet.update({
        where: { user_id: u.id },
        data: { plan_id: plan.plan_id, max_agents: plan.agent_limit },
      });
    }
    const k = generateApiKey();
    await prisma.apiKey.create({ data: { user_id: u.id, label: "t", key_prefix: k.prefix, key_hash: k.hash } });
    const token = `tok-${tag}-${label}`;
    await prisma.session.create({
      data: { user_id: u.id, token_hash: sha256(token), expires_at: new Date(Date.now() + 3_600_000) },
    });
    const cluster = await prisma.clusterAndWorkspace.findFirstOrThrow({ where: { user_id: u.id } });
    return { id: u.id, email, key: k.raw, cookie: `argus_session=${token}`, clusterId: cluster.cluster_id };
  }

  const request = (path: string, headers: Record<string, string>, body?: unknown) =>
    new NextRequest(url(path), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const withKey = (u: TestUser, path: string, body?: unknown) => request(path, { "x-argus-key": u.key }, body);
  const withSession = (u: TestUser, path: string, body?: unknown) => request(path, { cookie: u.cookie }, body);
  const anonymous = (path: string, body?: unknown) => request(path, {}, body);

  async function cleanup() {
    await prisma.cliDevice.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  }

  return { tag, url, makeUser, withKey, withSession, anonymous, request, cleanup };
}

export async function requirePlansSeeded() {
  const free = await prisma.pricingPlan.findUnique({ where: { plan_id: "plan_free" } });
  if (!free) throw new Error("Run `npm run seed` first: plans are missing.");
}
