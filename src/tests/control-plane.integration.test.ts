/**
 * Integration tests against the real database (DATABASE_URL). Run with `npm run test:integration`.
 * Every row is created under a unique email prefix and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/auth-core";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";
import {
  acquireLock,
  applyHeartbeat,
  killAgent,
  listLocks,
  releaseLockById,
  resumeAgent,
  updatePolicy,
} from "@/lib/control-plane";
import { POST as proxyPOST, GET as proxyGET } from "@/app/api/v1/proxy/route";
import { POST as guardrailsPOST, GET as guardrailsGET } from "@/app/api/guardrails/route";
import { GET as bridgeGET, POST as bridgePOST } from "@/app/api/local-bridge/route";
import { POST as brainPOST } from "@/app/api/brain/route";

const kit = createTestKit("itest");
const { tag, url, makeUser, withKey, withSession } = kit;

let alice: TestUser;
let bob: TestUser;

async function newAgent(u: TestUser, name: string, status = "ACTIVE") {
  return prisma.agent.create({
    data: { cluster_id: u.clusterId, name, agent_type: "CLAUDE", status },
  });
}

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("proxy authentication", () => {
  const post = async (headers: Record<string, string>, query = "") =>
    (
      await proxyPOST(
        new NextRequest(url(`/api/v1/proxy${query}`), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ prompt: "hi" }),
        })
      )
    ).status;

  it("rejects missing, invalid, id-style, hash-style and prefix-only keys", async () => {
    expect(await post({})).toBe(401);
    expect(await post({ "x-argus-key": "argus_live_does_not_exist" })).toBe(401);
    expect(await post({ "x-argus-key": "argus_live_" })).toBe(401);
    expect(await post({ "x-argus-key": "argus_live_demo_key" })).toBe(401);
    const keyRow = await prisma.apiKey.findFirstOrThrow({ where: { user_id: alice.id } });
    expect(await post({ "x-argus-key": keyRow.id })).toBe(401);
    expect(await post({ "x-argus-key": keyRow.key_hash })).toBe(401);
    expect(await post({ authorization: "Bearer " + keyRow.key_hash })).toBe(401);
  });

  it("accepts a valid key via header or Bearer, and rejects it once revoked", async () => {
    const k = generateApiKey();
    const row = await prisma.apiKey.create({ data: { user_id: alice.id, label: "r", key_prefix: k.prefix, key_hash: k.hash } });
    expect(await post({ "x-argus-key": k.raw })).toBe(200);
    expect(await post({ authorization: `Bearer ${k.raw}` })).toBe(200);
    await prisma.apiKey.update({ where: { id: row.id }, data: { revoked_at: new Date() } });
    expect(await post({ "x-argus-key": k.raw })).toBe(401);
  });

  it("does not accept the key from the query string", async () => {
    expect(await post({}, `?apiKey=${alice.key}`)).toBe(401);
    expect(await post({}, `?key=${alice.key}`)).toBe(401);
  });

  it("the public health probe never reveals a user for a bad or revoked key", async () => {
    const probe = async (headers: Record<string, string>) =>
      (await (await proxyGET(new NextRequest(url("/api/v1/proxy"), { headers }))).json()).authenticatedUser;
    expect(await probe({})).toBeNull();
    expect(await probe({ "x-argus-key": "argus_live_nope" })).toBeNull();
    expect((await probe({ "x-argus-key": alice.key })).id).toBe(alice.id);
  });
});

describe("proxy metering and wallet", () => {
  it("serves a request and deducts tokens", async () => {
    const before = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: alice.id } });
    const res = await proxyPOST(withKey(alice, "/api/v1/proxy", { prompt: "Write a function that adds two numbers", model: "claude-sonnet-4" }));
    expect(res.status).toBe(200);
    const after = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: alice.id } });
    expect(after.free_tokens + after.paid_tokens).toBeLessThan(before.free_tokens + before.paid_tokens);
  });

  it("returns 402 when the wallet is empty", async () => {
    await prisma.subscriptionAndWallet.update({ where: { user_id: bob.id }, data: { free_tokens: 0, paid_tokens: 0 } });
    const res = await proxyPOST(withKey(bob, "/api/v1/proxy", { prompt: "hello" }));
    expect(res.status).toBe(402);
    await prisma.subscriptionAndWallet.update({ where: { user_id: bob.id }, data: { free_tokens: 250_000 } });
  });
});

describe("loop breaker via the proxy", () => {
  const same = Array.from({ length: 4 }, () => "run_tests(): FAIL expected 200 got 500");

  it("kills an early-stage loop, records an incident and refuses further work", async () => {
    const agent = await newAgent(alice, "loopy");
    const res = await proxyPOST(withKey(alice, "/api/v1/proxy", { prompt: "fix it", agentId: agent.agent_id, recentLogs: same, taskProgressPct: 30 }));
    expect(res.status).toBe(429);
    expect((await res.json()).status).toBe("KILLED_LOOP");
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: agent.agent_id } })).status).toBe("KILLED_LOOP");
    const incident = await prisma.incident.findFirst({ where: { user_id: alice.id, agent_id: agent.agent_id } });
    expect(incident).toMatchObject({ kind: "LOOP", action: "KILLED", loop_type: "EXACT_TOOL_LOOP" });
    expect(incident!.interception_ms).toBeLessThan(100);
  });

  it("pauses a nearly finished agent instead of killing it (HTTP 423)", async () => {
    const agent = await newAgent(alice, "almost-done");
    const res = await proxyPOST(withKey(alice, "/api/v1/proxy", { prompt: "finish", agentId: agent.agent_id, recentLogs: same, taskProgressPct: 92 }));
    expect(res.status).toBe(423);
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: agent.agent_id } })).status).toBe("PAUSED_NUDGE");
  });

  it("honours the user's policy: a stricter repeat limit lets two repeats through", async () => {
    const carol = await makeUser("carol");
    await updatePolicy(carol.id, { maxConsecutiveRetries: 5, semanticSimilarityThreshold: 0.95 });
    const agent = await newAgent(carol, "patient");
    const twice = ["read file", "run_tests(): FAIL", "run_tests(): FAIL"];
    const res = await proxyPOST(withKey(carol, "/api/v1/proxy", { prompt: "keep going", agentId: agent.agent_id, recentLogs: twice, taskProgressPct: 20 }));
    expect(res.status).toBe(200);
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: agent.agent_id } })).status).toBe("ACTIVE");
  });
});

describe("tenant isolation", () => {
  it("one user's key cannot act on another user's agent through the proxy", async () => {
    const victim = await newAgent(alice, "victim");
    const same = Array.from({ length: 4 }, () => "boom");
    await proxyPOST(withKey(bob, "/api/v1/proxy", { prompt: "x", agentId: victim.agent_id, recentLogs: same, taskProgressPct: 10 }));
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: victim.agent_id } })).status).toBe("ACTIVE");
  });

  it("guardrail actions on someone else's agent return 404 and change nothing", async () => {
    const victim = await newAgent(alice, "victim-2");
    for (const action of ["TRIGGER_KILL_SWITCH", "THROTTLE_DOWNGRADE", "SEND_NUDGE"]) {
      const res = await guardrailsPOST(withSession(bob, "/api/guardrails", { action, agentId: victim.agent_id }));
      expect(res.status, action).toBe(404);
    }
    const after = await prisma.agent.findUniqueOrThrow({ where: { agent_id: victim.agent_id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.model_tier).toBe("FRONTIER");
  });

  it("the guardrails feed only lists the caller's agents and incidents", async () => {
    const data = await (await guardrailsGET(withSession(bob, "/api/guardrails"))).json();
    const names = [...data.flaggedAgents, ...data.activeAgents].map((a: { name: string }) => a.name);
    expect(names).not.toContain("loopy");
    expect(names).not.toContain("victim");
    expect(data.streamEvents.every((e: { agentName: string }) => e.agentName !== "loopy")).toBe(true);
  });

  it("the library helpers refuse a foreign agent", async () => {
    const victim = await newAgent(alice, "victim-3");
    expect((await killAgent(bob.id, victim.agent_id)).ok).toBe(false);
    expect((await resumeAgent(bob.id, victim.agent_id)).ok).toBe(false);
  });

  it("brain mutex actions reject another user's agent", async () => {
    const victim = await newAgent(alice, "victim-4");
    const res = await brainPOST(withSession(bob, "/api/brain", { action: "ACQUIRE_FILE_MUTEX", agentId: victim.agent_id, targetFilePath: "a.ts" }));
    expect(res.status).toBe(404);
  });

  it("removed simulation actions answer 410 and API keys cannot change guardrails", async () => {
    const gone = await brainPOST(withSession(alice, "/api/brain", { action: "TRIGGER_ROGUE_LOOP" }));
    expect(gone.status).toBe(410);
    const viaKey = await guardrailsPOST(withKey(alice, "/api/guardrails", { action: "UPDATE_POLICY", policy: { maxRamPerAgentMb: 100 } }));
    expect(viaKey.status).toBe(403);
  });
});

describe("policy persistence", () => {
  it("saves, clamps and returns the policy", async () => {
    const res = await guardrailsPOST(
      withSession(alice, "/api/guardrails", {
        action: "UPDATE_POLICY",
        policy: { maxConsecutiveRetries: 4, semanticSimilarityThreshold: 7, maxRamPerAgentMb: "300", evil: true },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).policy).toMatchObject({ maxConsecutiveRetries: 4, semanticSimilarityThreshold: 0.99, maxRamPerAgentMb: 300 });
    const again = await (await guardrailsGET(withSession(alice, "/api/guardrails"))).json();
    expect(again.policy.maxConsecutiveRetries).toBe(4);
    const bobPolicy = await (await guardrailsGET(withSession(bob, "/api/guardrails"))).json();
    expect(bobPolicy.policy.maxConsecutiveRetries).not.toBe(4);
  });

  it("persists local-bridge permissions per user", async () => {
    const res = await bridgePOST(withSession(alice, "/api/local-bridge", { action: "UPDATE_PERMISSIONS", permissions: { enforceMutex: false, admin: true } }));
    expect(res.status).toBe(200);
    expect((await (await bridgeGET(withSession(alice, "/api/local-bridge"))).json()).permissions.enforceMutex).toBe(false);
    expect((await (await bridgeGET(withSession(bob, "/api/local-bridge"))).json()).permissions.enforceMutex).toBe(true);
  });
});

describe("file locks", () => {
  it("grants the first holder, denies the second, and lets the owner refresh", async () => {
    const first = await acquireLock(alice.id, "./src\\app/page.tsx", "Claude");
    expect(first).toMatchObject({ allowed: true, lockedFilePath: "src/app/page.tsx" });
    const second = await acquireLock(alice.id, "src/app/page.tsx", "Antigravity");
    expect(second).toMatchObject({ allowed: false, heldBy: "Claude" });
    if (!second.allowed) expect(second.fallbackFilePath).toBe("src/app/page.tsx.conflict-antigravity");
    expect((await acquireLock(alice.id, "src/app/page.tsx", "Claude")).allowed).toBe(true);
    const locks = await listLocks(alice.id);
    expect(locks.find((l) => l.filePath === "src/app/page.tsx")).toMatchObject({ holderAgent: "Claude", queuedAgent: "Antigravity", status: "CONFLICT_QUEUED" });
  });

  it("two simultaneous requests cannot both win", async () => {
    const results = await Promise.all(["A", "B", "C", "D"].map((h) => acquireLock(alice.id, "race.ts", `Agent-${h}`)));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });

  it("locks are per user and expire", async () => {
    expect((await acquireLock(bob.id, "src/app/page.tsx", "Claude")).allowed).toBe(true); // alice's lock doesn't affect bob
    await acquireLock(alice.id, "short.ts", "Claude", { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 25));
    expect((await listLocks(alice.id)).some((l) => l.filePath === "short.ts")).toBe(false);
    expect((await acquireLock(alice.id, "short.ts", "Other")).allowed).toBe(true);
  });

  it("only the owner can release a lock", async () => {
    const lock = (await listLocks(alice.id))[0];
    expect(await releaseLockById(bob.id, lock.id)).toBeNull();
    expect(await releaseLockById(alice.id, lock.id)).not.toBeNull();
  });
});

describe("agent limits (Free = 2, Pro = 10)", () => {
  it("registers two agents on Free and refuses the third", async () => {
    const dana = await makeUser("dana");
    const result = await applyHeartbeat(dana.id, "Dana", [
      { name: "Claude", type: "claude" },
      { name: "Codex", type: "codex" },
      { name: "Gemini", type: "gemini" },
    ]);
    expect(result.created).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].name).toBe("Gemini");
    expect(result.rejected[0].reason).toContain("allows 2 concurrent agents");
    expect(await prisma.agent.count({ where: { cluster: { user_id: dana.id }, status: "ACTIVE" } })).toBe(2);
  });

  it("lets a hibernated third agent register, but not wake without a free slot", async () => {
    const erin = await makeUser("erin");
    await applyHeartbeat(erin.id, "Erin", [{ name: "A" }, { name: "B" }, { name: "C", status: "HIBERNATED" }]);
    const wake = await applyHeartbeat(erin.id, "Erin", [{ name: "C" }]);
    expect(wake.rejected).toHaveLength(1);
    expect((await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: erin.id }, name: "C" } })).status).toBe("HIBERNATED");
  });

  it("allows ten on Pro and refuses the eleventh", async () => {
    const frank = await makeUser("frank", "plan_pro");
    const agents = Array.from({ length: 11 }, (_, i) => ({ name: `Agent-${i}`, type: "claude" }));
    const result = await applyHeartbeat(frank.id, "Frank", agents);
    expect(result.created).toBe(10);
    expect(result.rejected).toHaveLength(1);
  });

  it("a daemon cannot un-kill or un-pause an agent", async () => {
    const gina = await makeUser("gina");
    await applyHeartbeat(gina.id, "Gina", [{ name: "Solo" }]);
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: gina.id }, name: "Solo" } });
    await killAgent(gina.id, agent.agent_id);
    await applyHeartbeat(gina.id, "Gina", [{ name: "Solo", status: "ACTIVE", ram_usage: 500 }]);
    const after = await prisma.agent.findUniqueOrThrow({ where: { agent_id: agent.agent_id } });
    expect(after.status).toBe("KILLED_LOOP");
    expect(after.ram_usage).toBe(0);
  });

  it("resuming a paused agent needs a free slot", async () => {
    const hank = await makeUser("hank");
    const paused = await newAgent(hank, "paused", "PAUSED_NUDGE");
    await newAgent(hank, "one");
    await newAgent(hank, "two");
    const refused = await resumeAgent(hank.id, paused.agent_id, "go");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(403);
    await prisma.agent.updateMany({ where: { cluster: { user_id: hank.id }, name: "two" }, data: { status: "HIBERNATED" } });
    expect((await resumeAgent(hank.id, paused.agent_id, "go")).ok).toBe(true);
  });

  it("sanitises hostile heartbeat input", async () => {
    const ivy = await makeUser("ivy");
    const result = await applyHeartbeat(ivy.id, "Ivy", [
      { name: "x".repeat(500), type: "claude", ram_usage: "NaN", cpu_usage: -50, tokens_used: 1e30 },
      { name: "bad", type: "<script>alert(1)</script>" },
      null,
      "string",
    ]);
    expect(result.created + result.rejected.length).toBeGreaterThanOrEqual(1);
    const a = await prisma.agent.findFirst({ where: { cluster: { user_id: ivy.id } } });
    expect(a?.name.length).toBeLessThanOrEqual(120);
    expect(a?.cpu_usage).toBeGreaterThanOrEqual(0);
    expect(a?.tokens_used).toBeLessThanOrEqual(2_000_000_000);
  });
});
