/** Integration tests: device pairing and the CLI sync protocol, against the real database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/auth-core";
import { killAgent, resumeAgent } from "@/lib/control-plane";
import { POST as codePOST } from "@/app/api/device/code/route";
import { POST as tokenPOST } from "@/app/api/device/token/route";
import { POST as approvePOST } from "@/app/api/device/approve/route";
import { POST as syncPOST } from "@/app/api/cli/sync/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("cli");
const { makeUser, withKey, withSession, anonymous } = kit;

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

async function startDevice() {
  const res = await codePOST(anonymous("/api/device/code", { name: `${kit.tag} laptop` }));
  expect(res.status).toBe(200);
  return (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number };
}
const poll = async (device_code: string) => {
  const res = await tokenPOST(anonymous("/api/device/token", { device_code }));
  return { status: res.status, body: await res.json() };
};

describe("device pairing", () => {
  it("pairs a CLI end to end and returns the API key exactly once", async () => {
    const d = await startDevice();
    expect(d.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(d.verification_uri).toContain("/device");

    // not approved yet
    expect(await poll(d.device_code)).toMatchObject({ status: 400, body: { error: "authorization_pending" } });

    // the user approves in the browser (typed in lower case, with a space)
    const approve = await approvePOST(withSession(alice, "/api/device/approve", { user_code: d.user_code.toLowerCase().replace("-", " ") }));
    expect(approve.status).toBe(200);

    const done = await poll(d.device_code);
    expect(done.status).toBe(200);
    expect(done.body.access_token).toMatch(/^argus_live_[0-9a-f]{48}$/);
    expect(done.body.user.email).toBe(alice.email);

    // only the hash is stored, and the key works
    expect(await prisma.apiKey.count({ where: { key_hash: sha256(done.body.access_token) } })).toBe(1);
    expect(await prisma.apiKey.count({ where: { key_hash: done.body.access_token } })).toBe(0);
    const sync = await syncPOST(
      kit.request("/api/cli/sync", { "x-argus-key": done.body.access_token }, { run: { id: "r-pair", start: true, agent: { name: "Pair Test", type: "claude" } } })
    );
    expect(sync.status).toBe(200);

    // a second poll cannot fetch the key again
    expect(await poll(d.device_code)).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
  });

  it("delivers the key to only one of two simultaneous polls", async () => {
    const d = await startDevice();
    await approvePOST(withSession(alice, "/api/device/approve", { user_code: d.user_code }));
    const results = await Promise.all([poll(d.device_code), poll(d.device_code), poll(d.device_code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("supports denial and rejects unknown, expired and malformed requests", async () => {
    const denied = await startDevice();
    expect((await approvePOST(withSession(alice, "/api/device/approve", { user_code: denied.user_code, approve: false }))).status).toBe(200);
    expect(await poll(denied.device_code)).toMatchObject({ status: 400, body: { error: "access_denied" } });

    const expired = await startDevice();
    await prisma.cliDevice.update({ where: { device_code: expired.device_code }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect(await poll(expired.device_code)).toMatchObject({ status: 400, body: { error: "expired_token" } });
    expect((await approvePOST(withSession(alice, "/api/device/approve", { user_code: expired.user_code }))).status).toBe(404);

    expect(await poll("not-a-real-device-code")).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    expect((await tokenPOST(anonymous("/api/device/token", {}))).status).toBe(400);
    expect((await approvePOST(withSession(alice, "/api/device/approve", { user_code: "AEIO-0000" }))).status).toBe(400);
  });

  it("only a browser session can approve; an API key or no login cannot", async () => {
    const d = await startDevice();
    expect((await approvePOST(withKey(alice, "/api/device/approve", { user_code: d.user_code }))).status).toBe(403);
    expect((await approvePOST(anonymous("/api/device/approve", { user_code: d.user_code }))).status).toBe(401);
    expect(await poll(d.device_code)).toMatchObject({ body: { error: "authorization_pending" } });
  });

  it("an approved code can't be approved again or by someone else", async () => {
    const d = await startDevice();
    expect((await approvePOST(withSession(alice, "/api/device/approve", { user_code: d.user_code }))).status).toBe(200);
    expect((await approvePOST(withSession(bob, "/api/device/approve", { user_code: d.user_code }))).status).toBe(404);
    const done = await poll(d.device_code);
    expect(done.body.user.email).toBe(alice.email);
  });
});

const run = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  run: { id, agent: { name, type: "claude" }, ...extra },
});

describe("CLI sync: registration and limits", () => {
  it("requires an API key", async () => {
    expect((await syncPOST(anonymous("/api/cli/sync", run("r", "x")))).status).toBe(401);
  });

  it("validates the payload", async () => {
    expect((await syncPOST(withKey(alice, "/api/cli/sync", {}))).status).toBe(400);
    expect((await syncPOST(withKey(alice, "/api/cli/sync", { run: { id: "r", agent: { name: "x", type: "<script>" } } }))).status).toBe(400);
  });

  it("registers an agent, refuses a third on Free, and reuses an existing one", async () => {
    const carol = await makeUser("carol");
    const first = await syncPOST(withKey(carol, "/api/cli/sync", run("r1", "Claude Code · app", { start: true })));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, desired: "RUN", limits: { maxAgents: 2 } });
    expect((await syncPOST(withKey(carol, "/api/cli/sync", run("r2", "Claude Code · api", { start: true })))).status).toBe(200);

    const third = await syncPOST(withKey(carol, "/api/cli/sync", run("r3", "Claude Code · web", { start: true })));
    expect(third.status).toBe(403);
    const body = await third.json();
    expect(body.error).toBe("agent_limit");
    expect(body.message).toContain("allows 2 concurrent agents");

    // the same agent starting again is not a new agent
    expect((await syncPOST(withKey(carol, "/api/cli/sync", run("r4", "Claude Code · app", { start: true })))).status).toBe(200);
    expect(await prisma.agent.count({ where: { cluster: { user_id: carol.id } } })).toBe(2);
  });

  it("frees the slot when a run ends and ignores crashed agents", async () => {
    const dana = await makeUser("dana");
    await syncPOST(withKey(dana, "/api/cli/sync", run("a", "A", { start: true })));
    await syncPOST(withKey(dana, "/api/cli/sync", run("b", "B", { start: true })));
    expect((await syncPOST(withKey(dana, "/api/cli/sync", run("c", "C", { start: true })))).status).toBe(403);

    // A exits cleanly
    await syncPOST(withKey(dana, "/api/cli/sync", run("a", "A", { end: true })));
    expect((await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: dana.id }, name: "A" } })).status).toBe("HIBERNATED");
    expect((await syncPOST(withKey(dana, "/api/cli/sync", run("c", "C", { start: true })))).status).toBe(200);

    // B crashed: no check-in for 5 minutes, so it no longer holds a slot
    await prisma.agent.updateMany({ where: { cluster: { user_id: dana.id }, name: "B" }, data: { last_heartbeat_at: new Date(Date.now() - 5 * 60_000) } });
    expect((await syncPOST(withKey(dana, "/api/cli/sync", run("a", "A", { start: true })))).status).toBe(200);
  });

  it("Pro allows ten", async () => {
    const erin = await makeUser("erin", "plan_pro");
    for (let i = 0; i < 10; i++) {
      expect((await syncPOST(withKey(erin, "/api/cli/sync", run(`r${i}`, `Agent ${i}`, { start: true })))).status, `agent ${i}`).toBe(200);
    }
    expect((await syncPOST(withKey(erin, "/api/cli/sync", run("r11", "Agent 11", { start: true })))).status).toBe(403);
  });
});

describe("CLI sync: usage metering", () => {
  it("records real usage with cost and deducts the wallet", async () => {
    const frank = await makeUser("frank");
    const before = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: frank.id } });
    const res = await syncPOST(
      withKey(frank, "/api/cli/sync", {
        ...run("rm", "Meter", { start: true }),
        events: [
          { type: "usage", provider: "anthropic", model: "claude-sonnet-4-5-20250929", input_tokens: 10_000, output_tokens: 2_000, cache_read_tokens: 40_000, latency_ms: 1500 },
          { type: "usage", provider: "anthropic", model: "claude-haiku-4-5", input_tokens: 5_000, output_tokens: 500, latency_ms: 400 },
        ],
      })
    );
    const body = await res.json();
    expect(body.quota.remaining).toBe(before.free_tokens + before.paid_tokens - 17_500);

    const events = await prisma.usageEvent.findMany({ where: { user_id: frank.id }, orderBy: { created_at: "asc" } });
    expect(events).toHaveLength(2);
    // sonnet: 10k*$3/M + 2k*$15/M = $0.06
    expect(events[0]).toMatchObject({ provider: "anthropic", input_tokens: 10_000, output_tokens: 2_000, run_id: "rm" });
    expect(events[0].cost_usd).toBeCloseTo(0.06, 6);
    expect(events[0]).toMatchObject({ cache_hit: true, tokens_saved: 40_000 }); // cache reads are not charged to the wallet
    expect(events[1]).toMatchObject({ cache_hit: false, tokens_saved: 0 });
    expect(events[1].cost_usd).toBeCloseTo((5_000 * 0.8 + 500 * 4) / 1_000_000, 6);

    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: frank.id } } });
    expect(agent.tokens_used).toBe(17_500);
  });

  it("clamps hostile numbers and never lets the wallet go negative", async () => {
    const gina = await makeUser("gina");
    await prisma.subscriptionAndWallet.update({ where: { user_id: gina.id }, data: { free_tokens: 100, paid_tokens: 0 } });
    const res = await syncPOST(
      withKey(gina, "/api/cli/sync", {
        ...run("rh", "Hostile", { start: true }),
        events: [{ type: "usage", model: "x".repeat(500), input_tokens: 1e30, output_tokens: -50, latency_ms: "NaN" }, null, "x", { type: "weird" }],
      })
    );
    expect(res.status).toBe(200);
    const w = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: gina.id } });
    expect(w.free_tokens).toBeGreaterThanOrEqual(0);
    expect(w.paid_tokens).toBeGreaterThanOrEqual(0);
    const ev = await prisma.usageEvent.findFirstOrThrow({ where: { user_id: gina.id } });
    expect(ev.model.length).toBeLessThanOrEqual(120);
    expect(ev.input_tokens).toBeLessThanOrEqual(50_000_000);
    expect(ev.output_tokens).toBe(0);
  });

  it("tells the agent to pause once the token allowance is used up", async () => {
    const hank = await makeUser("hank");
    await prisma.subscriptionAndWallet.update({ where: { user_id: hank.id }, data: { free_tokens: 1_000, paid_tokens: 0 } });
    const res = await syncPOST(
      withKey(hank, "/api/cli/sync", { ...run("rq", "Quota", { start: true }), events: [{ type: "usage", model: "claude-sonnet-4", input_tokens: 900, output_tokens: 300 }] })
    );
    const body = await res.json();
    expect(body).toMatchObject({ desired: "PAUSE", quota: { remaining: 0 } });
    expect(body.reason).toContain("allowance");
  });
});

describe("CLI sync: control commands", () => {
  const loopIncident = {
    type: "incident",
    kind: "LOOP",
    loop_type: "EXACT_TOOL_LOOP",
    action: "PAUSED",
    score: 0.98,
    detail: "Bash(npm test) failed identically 4 times",
    interception_ms: 3.2,
  };

  it("a loop incident pauses the agent, and a dashboard resume delivers the hint once", async () => {
    const ivy = await makeUser("ivy");
    await syncPOST(withKey(ivy, "/api/cli/sync", run("rl", "Looper", { start: true })));

    const paused = await (await syncPOST(withKey(ivy, "/api/cli/sync", { ...run("rl", "Looper"), events: [loopIncident] }))).json();
    expect(paused.desired).toBe("PAUSE");
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: ivy.id } } });
    expect(agent.status).toBe("PAUSED_NUDGE");
    expect(await prisma.incident.findFirst({ where: { user_id: ivy.id } })).toMatchObject({ kind: "LOOP", action: "PAUSED", loop_type: "EXACT_TOOL_LOOP", agent_name: "Looper" });

    // still paused on the next sync
    expect((await (await syncPOST(withKey(ivy, "/api/cli/sync", run("rl", "Looper")))).json()).desired).toBe("PAUSE");

    // the operator resumes it from the dashboard with a hint
    const resumed = await resumeAgent(ivy.id, agent.agent_id, "Skip the flaky test and run the build instead");
    expect(resumed.ok).toBe(true);
    const next = await (await syncPOST(withKey(ivy, "/api/cli/sync", run("rl", "Looper")))).json();
    expect(next).toMatchObject({ desired: "RUN", hint: "Skip the flaky test and run the build instead" });
    const again = await (await syncPOST(withKey(ivy, "/api/cli/sync", run("rl", "Looper")))).json();
    expect(again.desired).toBe("RUN");
    expect(again.hint).toBeUndefined();
  });

  it("a dashboard kill tells the CLI to stop the process", async () => {
    const jack = await makeUser("jack");
    await syncPOST(withKey(jack, "/api/cli/sync", run("rk", "Doomed", { start: true })));
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: jack.id } } });
    expect((await killAgent(jack.id, agent.agent_id, "Stopped by operator.")).ok).toBe(true);
    expect(await (await syncPOST(withKey(jack, "/api/cli/sync", run("rk", "Doomed")))).json()).toMatchObject({ desired: "KILL" });

    // a brand-new `argus run` starts clean
    expect(await (await syncPOST(withKey(jack, "/api/cli/sync", run("rk2", "Doomed", { start: true })))).json()).toMatchObject({ desired: "RUN" });
  });

  it("returns the user's detection policy so the CLI can enforce it locally", async () => {
    const kim = await makeUser("kim");
    await prisma.policy.update({ where: { user_id: kim.id }, data: { loop_score_threshold: 0.93, exact_repeat_limit: 4 } });
    const body = await (await syncPOST(withKey(kim, "/api/cli/sync", run("rp", "Policy", { start: true })))).json();
    expect(body.policy).toMatchObject({ loopScoreThreshold: 0.93, exactRepeatLimit: 4 });
  });

  it("users cannot touch each other's agents even with the same agent name", async () => {
    await syncPOST(withKey(alice, "/api/cli/sync", run("rs1", "Shared Name", { start: true })));
    await syncPOST(withKey(bob, "/api/cli/sync", { ...run("rs2", "Shared Name", { start: true }), events: [loopIncident] }));
    const a = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Shared Name" } });
    const b = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: bob.id }, name: "Shared Name" } });
    expect(a.status).toBe("ACTIVE");
    expect(b.status).toBe("PAUSED_NUDGE");
    expect(a.agent_id).not.toBe(b.agent_id);
  });
});
