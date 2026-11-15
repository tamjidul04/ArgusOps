import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store, type AgentRecord } from "./store";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-store-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  name: "Claude Code",
  type: "CLAUDE",
  status: "ACTIVE",
  runId: "r1",
  startedAt: 1,
  lastSeen: Date.now(),
  tokensUsed: 0,
  desired: "RUN",
  reason: "",
  suggestion: null,
  ...over,
});

describe("Store: config and token", () => {
  it("returns defaults for a new folder and merges saved changes", async () => {
    const s = new Store(tmp());
    expect(s.config().policy.exactRepeatLimit).toBe(2);
    await s.saveConfig({ webhooks: ["https://example.com/hook"], policy: { loopScoreThreshold: 0.9, exactRepeatLimit: 2 } });
    const c = new Store(s.root).config();
    expect(c.webhooks).toEqual(["https://example.com/hook"]);
    expect(c.policy).toEqual({ loopScoreThreshold: 0.9, exactRepeatLimit: 2 });
    expect(c.proxyPort).toBe(47821);
  });

  it("creates the control token once and keeps it", () => {
    const root = tmp();
    const t1 = new Store(root).token();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(new Store(root).token()).toBe(t1);
  });

  it("survives a corrupt config file", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "config.json"), "{ not json");
    expect(new Store(root).config().apiPort).toBe(47822);
  });
});

describe("Store: agents", () => {
  it("creates, reads and changes an agent", async () => {
    const s = new Store(tmp());
    await s.updateAgent("a1", () => agent());
    expect(s.agent("a1")?.name).toBe("Claude Code");
    await s.updateAgent("a1", (c) => (c ? { ...c, tokensUsed: 50 } : c));
    expect(s.agents()).toHaveLength(1);
    expect(s.agent("a1")?.tokensUsed).toBe(50);
  });

  it("does not lose updates when two processes change the same agent at once", async () => {
    const root = tmp();
    const a = new Store(root);
    const b = new Store(root); // stands in for a second process
    await a.updateAgent("a1", () => agent());
    const bump = (s: Store) => s.updateAgent("a1", (c) => (c ? { ...c, tokensUsed: c.tokensUsed + 1 } : c));
    await Promise.all(Array.from({ length: 40 }, (_, i) => bump(i % 2 ? a : b)));
    expect(a.agent("a1")?.tokensUsed).toBe(40);
  });

  it("recovers from a lock left behind by a crashed process", async () => {
    const root = tmp();
    const s = new Store(root);
    const lock = path.join(root, "agents.lock");
    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    await s.updateAgent("a1", () => agent());
    expect(s.agent("a1")).not.toBeNull();
  });

  it("setControl pauses, resumes with a hint, and stops", async () => {
    const s = new Store(tmp());
    await s.updateAgent("a1", () => agent());
    expect((await s.setControl("a1", { desired: "PAUSE", reason: "loop" }))?.status).toBe("PAUSED");
    const resumed = await s.setControl("a1", { desired: "RUN", hint: "try a different approach" });
    expect(resumed?.status).toBe("ACTIVE");
    expect(resumed?.hint).toBe("try a different approach");
    expect((await s.setControl("a1", { desired: "KILL" }))?.status).toBe("STOPPED");
    expect(await s.setControl("nope", { desired: "KILL" })).toBeNull();
  });

  it("treats a half-written agents file as empty instead of crashing", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "agents.json"), '{"a1": {');
    expect(new Store(root).agents()).toEqual([]);
  });
});

describe("Store: usage, incidents, notifications", () => {
  const usage = (ts: number) => ({ ts, agentId: "a1", provider: "anthropic", model: "m", input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, latency_ms: 100, cost_usd: 0.01 });

  it("appends usage and filters by time", () => {
    const s = new Store(tmp());
    s.appendUsage(usage(1000));
    s.appendUsage(usage(5000));
    expect(s.usage()).toHaveLength(2);
    expect(s.usage(2000)).toHaveLength(1);
  });

  it("skips a line cut short by a crash", () => {
    const root = tmp();
    const s = new Store(root);
    s.appendUsage(usage(1000));
    fs.appendFileSync(path.join(root, "usage.jsonl"), '{"ts": 20');
    expect(s.usage()).toHaveLength(1);
  });

  it("lists notifications newest first and remembers which are read", async () => {
    const s = new Store(tmp());
    const first = s.appendNotification({ title: "one", body: "", level: "INFO" });
    s.appendNotification({ title: "two", body: "", level: "WARN" });
    expect(s.notifications().map((n) => n.title)).toEqual(["two", "one"]);
    await s.markNotificationsRead([first.id]);
    const after = s.notifications();
    expect(after.find((n) => n.title === "one")?.read).toBe(true);
    expect(after.find((n) => n.title === "two")?.read).toBe(false);
  });

  it("prunes rows and agents older than the limit", async () => {
    const s = new Store(tmp());
    const now = Date.now();
    const day = 86_400_000;
    s.appendUsage(usage(now - 40 * day));
    s.appendUsage(usage(now - 1 * day));
    await s.updateAgent("old", () => agent({ id: "old", lastSeen: now - 40 * day }));
    await s.updateAgent("new", () => agent({ id: "new", lastSeen: now }));
    await s.prune(30, now);
    expect(s.usage()).toHaveLength(1);
    expect(s.agents().map((a) => a.id)).toEqual(["new"]);
  });
});
