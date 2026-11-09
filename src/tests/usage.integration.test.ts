/** Integration tests: the usage summary against the real database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordIncident } from "@/lib/control-plane";
import { getUsageSummary } from "@/lib/usage";
import { GET as usageGET } from "@/app/api/usage/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("usg");
const { makeUser, withKey, anonymous } = kit;
let alice: TestUser;
let bob: TestUser;

const now = new Date();
const daysAgo = (d: number, hour = 12) => {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d, hour));
  return t.getTime() > now.getTime() ? new Date(now.getTime() - 60_000) : t; // never in the future
};

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");

  const a1 = await prisma.agent.create({ data: { cluster_id: alice.clusterId, name: "Claude Code · app", agent_type: "CLAUDE", status: "ACTIVE" } });
  const a2 = await prisma.agent.create({ data: { cluster_id: alice.clusterId, name: "Claude Code · api", agent_type: "CLAUDE", status: "ACTIVE" } });
  const ev = (agentId: string, model: string, input: number, output: number, cost: number, cached: number, at: Date) =>
    ({ user_id: alice.id, agent_id: agentId, provider: "anthropic", model, input_tokens: input, output_tokens: output, cost_usd: cost, tokens_saved: cached, cache_hit: cached > 0, latency_ms: 900, created_at: at });

  await prisma.usageEvent.createMany({
    data: [
      ev(a1.agent_id, "claude-sonnet-4-5", 10_000, 2_000, 0.06, 40_000, daysAgo(0, 1)),
      ev(a1.agent_id, "claude-sonnet-4-5", 5_000, 1_000, 0.03, 0, daysAgo(2)),
      ev(a2.agent_id, "claude-haiku-4-5", 20_000, 4_000, 0.032, 0, daysAgo(2)),
      ev(a2.agent_id, "claude-haiku-4-5", 1_000, 100, 0.0012, 0, daysAgo(20)), // only in the 30-day view
      ev(a1.agent_id, "claude-sonnet-4-5", 999_999, 999_999, 99, 0, daysAgo(45)), // outside every range
    ],
  });
  await recordIncident({ userId: alice.id, agentId: a1.agent_id, agentName: a1.name, kind: "LOOP", action: "PAUSED", detail: "loop", interceptionMs: 1 });
  await recordIncident({ userId: alice.id, agentId: a1.agent_id, agentName: a1.name, kind: "WASTE", action: "THROTTLED", detail: "not a loop" });

  // bob has his own usage, which alice must never see
  await prisma.usageEvent.create({ data: { user_id: bob.id, provider: "anthropic", model: "claude-opus-4", input_tokens: 777_777, output_tokens: 1, cost_usd: 11.67 } });
}, 60_000);

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("usage summary", () => {
  it("totals the last 7 days from real events only", async () => {
    const s = await getUsageSummary(alice.id, "7d");
    expect(s.totals).toMatchObject({ inputTokens: 35_000, outputTokens: 7_000, calls: 3, cachedTokens: 40_000, loopsCaught: 1 });
    expect(s.totals.costUsd).toBeCloseTo(0.122, 6);
    // 40k cached sonnet tokens at $3/M input, 90% saved = $0.108 -> 0.11
    expect(s.totals.cacheSavingUsd).toBe(0.11);
  });

  it("buckets by day (database grouping matches the keys) and fills empty days", async () => {
    const s = await getUsageSummary(alice.id, "7d");
    expect(s.buckets).toHaveLength(7);
    const today = s.buckets[6];
    const twoDaysAgo = s.buckets[4];
    expect(today).toMatchObject({ inputTokens: 10_000, outputTokens: 2_000, calls: 1 });
    expect(twoDaysAgo).toMatchObject({ inputTokens: 25_000, outputTokens: 5_000, calls: 2 });
    expect(s.buckets.filter((b) => b.calls === 0)).toHaveLength(5);
    expect(s.buckets.reduce((n, b) => n + b.calls, 0)).toBe(3);
  });

  it("breaks usage down by agent (with names) and by model", async () => {
    const s = await getUsageSummary(alice.id, "7d");
    expect(s.byAgent.map((a) => a.name)).toEqual(["Claude Code · api", "Claude Code · app"]); // most tokens first
    expect(s.byAgent[0]).toMatchObject({ inputTokens: 20_000, outputTokens: 4_000, calls: 1 });
    expect(s.byModel.map((m) => m.model)).toEqual(["claude-sonnet-4-5", "claude-haiku-4-5"]); // highest spend first
  });

  it("the 30-day view includes older events, 24h only today's last hours", async () => {
    const month = await getUsageSummary(alice.id, "30d");
    expect(month.buckets).toHaveLength(30);
    expect(month.totals.calls).toBe(4);
    const day = await getUsageSummary(alice.id, "24h");
    expect(day.buckets).toHaveLength(24);
    expect(day.totals.calls).toBeLessThanOrEqual(1);
  });

  it("shows the plan allowance", async () => {
    const s = await getUsageSummary(alice.id, "7d");
    expect(s.allowance.planName).toBe("Free");
    expect(s.allowance.included).toBeGreaterThan(0);
  });

  it("never mixes users", async () => {
    const s = await getUsageSummary(alice.id, "30d");
    expect(s.byModel.some((m) => m.model === "claude-opus-4")).toBe(false);
    const b = await getUsageSummary(bob.id, "7d");
    expect(b.totals).toMatchObject({ inputTokens: 777_777, calls: 1, loopsCaught: 0 });
    expect(b.byAgent[0].name).toBe("Unassigned");
  });
});

describe("GET /api/usage", () => {
  it("returns the caller's summary for the requested range, defaulting to 7 days", async () => {
    const r = await (await usageGET(withKey(alice, "/api/usage?range=30d"))).json();
    expect(r.range).toBe("30d");
    expect(r.totals.calls).toBe(4);
    const d = await (await usageGET(withKey(alice, "/api/usage?range=bogus"))).json();
    expect(d.range).toBe("7d");
  });
  it("requires sign-in", async () => {
    expect((await usageGET(anonymous("/api/usage"))).status).toBe(401);
  });
});
