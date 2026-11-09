/** Integration tests: the agents endpoint and what a device key may (and may not) do. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as agentsGET } from "@/app/api/agents/route";
import { POST as guardPOST } from "@/app/api/guardrails/route";
import { POST as rwPOST } from "@/app/api/rewrites/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { POST as chPOST } from "@/app/api/notifications/channels/route";
import { POST as billingPOST } from "@/app/api/billing/upgrade/route";
import { POST as syncPOST } from "@/app/api/cli/sync/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("agt");
const { makeUser, withKey, withSession, anonymous } = kit;

let alice: TestUser;
let bob: TestUser;

const run = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ run: { id, agent: { name, type: "claude" }, ...extra } });
const loop = { type: "incident", kind: "LOOP", loop_type: "EXACT_TOOL_LOOP", action: "PAUSED", score: 0.94, detail: "Repeated 3 times: Bash(npm test)", interception_ms: 1, evidence: { unit: ['Bash({"command":"npm test"})', "error: FAIL"], repeats: 3 } };

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("GET /api/agents", () => {
  it("requires sign-in", async () => {
    expect((await agentsGET(anonymous("/api/agents"))).status).toBe(401);
  });

  it("lists only the caller's agents, with the open suggestion on paused ones", async () => {
    await syncPOST(withKey(alice, "/api/cli/sync", run("a1", "Runner", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", run("a2", "Looper", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", { ...run("a2", "Looper"), events: [loop] }));
    await syncPOST(withKey(bob, "/api/cli/sync", run("b1", "Bobs Agent", { start: true })));

    const res = await (await agentsGET(withKey(alice, "/api/agents"))).json();
    const names = res.agents.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["Looper", "Runner"]);
    expect(res.user.email).toBe(alice.email);
    expect(res.plan).toMatchObject({ name: "Free", maxAgents: 2 });
    expect(res.plan.tokensRemaining).toBeGreaterThan(0);
    expect(res.unreadNotifications).toBeGreaterThanOrEqual(1);

    const looper = res.agents.find((a: { name: string }) => a.name === "Looper");
    expect(looper).toMatchObject({ status: "PAUSED_NUDGE", type: "CLAUDE" });
    expect(looper.suggestion.text).toContain("npm test");
    expect(looper.suggestion.tokensBefore).toBeGreaterThanOrEqual(0);
    expect(res.agents.find((a: { name: string }) => a.name === "Runner").suggestion).toBeNull();
  });

  it("hides hibernated agents", async () => {
    await syncPOST(withKey(alice, "/api/cli/sync", run("a1", "Runner", { end: true })));
    const res = await (await agentsGET(withKey(alice, "/api/agents"))).json();
    expect(res.agents.map((a: { name: string }) => a.name)).toEqual(["Looper"]);
  });
});

describe("what a device key may do", () => {
  it("can resume a paused agent with an instruction (needed by the extension)", async () => {
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Looper" } });
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id, status: "PROPOSED" } });
    const res = await rwPOST(withKey(alice, "/api/rewrites", { action: "apply", id: rw.id, text: "Skip the flaky test." }));
    expect(res.status).toBe(200);
    const sync = await (await syncPOST(withKey(alice, "/api/cli/sync", run("a2", "Looper")))).json();
    expect(sync).toMatchObject({ desired: "RUN", hint: "Skip the flaky test." });
  });

  it("can stop an agent, and only its own", async () => {
    const mine = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Looper" } });
    const theirs = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: bob.id } } });

    const foreign = await guardPOST(withKey(alice, "/api/guardrails", { action: "TRIGGER_KILL_SWITCH", agentId: theirs.agent_id }));
    expect(foreign.status).toBe(404);
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: theirs.agent_id } })).status).toBe("ACTIVE");

    const own = await guardPOST(withKey(alice, "/api/guardrails", { action: "TRIGGER_KILL_SWITCH", agentId: mine.agent_id }));
    expect(own.status).toBe(200);
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: mine.agent_id } })).status).toBe("KILLED_LOOP");
    expect(await (await syncPOST(withKey(alice, "/api/cli/sync", run("a2", "Looper")))).json()).toMatchObject({ desired: "KILL" });
  });

  it("can resume with a plain hint too", async () => {
    await syncPOST(withKey(alice, "/api/cli/sync", run("a3", "Plain", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", { ...run("a3", "Plain"), events: [loop] }));
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Plain" } });
    const res = await guardPOST(withKey(alice, "/api/guardrails", { action: "SEND_NUDGE", agentId: agent.agent_id, hintText: "Use pnpm." }));
    expect(res.status).toBe(200);
    expect(await (await syncPOST(withKey(alice, "/api/cli/sync", run("a3", "Plain")))).json()).toMatchObject({ desired: "RUN", hint: "Use pnpm." });
  });

  it("still cannot change settings, mint keys, add webhooks or touch billing", async () => {
    expect((await guardPOST(withKey(alice, "/api/guardrails", { action: "UPDATE_POLICY", policy: { maxRamPerAgentMb: 100 } }))).status).toBe(403);
    expect((await guardPOST(withKey(alice, "/api/guardrails", { action: "THROTTLE_DOWNGRADE", agentId: "x" }))).status).toBe(403);
    expect((await guardPOST(withKey(alice, "/api/guardrails", { action: "EVALUATE_STREAM", logs: [] }))).status).toBe(403);
    expect((await keysPOST(withKey(alice, "/api/keys", { label: "evil" }))).status).toBe(403);
    expect((await chPOST(withKey(alice, "/api/notifications/channels", { action: "create", target: "https://example.com/h" }))).status).toBe(403);
    expect((await billingPOST(withKey(alice, "/api/billing/upgrade", { action: "request_upgrade", planId: "plan_pro" }))).status).toBe(403);
  });

  it("a user without a key or session can do none of it", async () => {
    expect((await guardPOST(anonymous("/api/guardrails", { action: "TRIGGER_KILL_SWITCH", agentId: "x" }))).status).toBe(401);
    expect((await rwPOST(anonymous("/api/rewrites", { action: "apply", id: "x" }))).status).toBe(401);
  });

  it("browser sessions keep full access", async () => {
    const res = await guardPOST(withSession(alice, "/api/guardrails", { action: "UPDATE_POLICY", policy: { maxRamPerAgentMb: 300 } }));
    expect(res.status).toBe(200);
  });
});
