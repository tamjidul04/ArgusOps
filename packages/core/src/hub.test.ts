import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Controls } from "./control";
import { agentIdFor, LocalHub } from "./hub";
import { DEFAULT_PRICES } from "./prices";
import { Store } from "./store";
import type { SyncPayload } from "./hub";

const dirs: string[] = [];
function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-hub-"));
  dirs.push(d);
  const store = new Store(d);
  const notes: string[] = [];
  const hub = new LocalHub(store, DEFAULT_PRICES, { onNotification: (n) => notes.push(n.title) });
  return { store, hub, controls: new Controls(store), notes };
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const payload = (flags: { start?: boolean; end?: boolean } = {}, events: unknown[] = [], runId = "run1"): SyncPayload => ({
  run: { id: runId, ...flags, agent: { name: "Claude Code · demo", type: "CLAUDE" } },
  events,
});
const usage = (input = 1000, output = 100) => ({ type: "usage", provider: "anthropic", model: "claude-sonnet-x", input_tokens: input, output_tokens: output, cache_read_tokens: 0, latency_ms: 50 });
const loop = {
  type: "incident",
  action: "PAUSED",
  loop_type: "EXACT_TOOL_LOOP",
  score: 0.94,
  detail: "Repeated 3 times: Bash(npm test)",
  evidence: { unit: ['Bash({"command":"npm test"})', "error: Exit code 1 FAIL src/a.test.ts"], repeats: 3 },
};

describe("LocalHub", () => {
  it("registers an agent on start and answers RUN", async () => {
    const { hub, store } = setup();
    const r = await hub.sync(payload({ start: true }));
    expect(r).toMatchObject({ ok: true, desired: "RUN", agentId: agentIdFor("Claude Code · demo") });
    expect(store.agents()).toHaveLength(1);
    expect(store.agents()[0]).toMatchObject({ status: "ACTIVE", type: "CLAUDE", tokensUsed: 0 });
  });

  it("records usage with a cost and adds up tokens", async () => {
    const { hub, store } = setup();
    await hub.sync(payload({ start: true }));
    await hub.sync(payload({}, [usage(1_000_000, 0), usage(0, 1_000_000)]));
    expect(store.usage()).toHaveLength(2);
    expect(store.usage()[0].cost_usd).toBeCloseTo(3, 4); // 1M input tokens at $3
    expect(store.usage()[1].cost_usd).toBeCloseTo(15, 4); // 1M output tokens at $15
    expect(store.agents()[0].tokensUsed).toBe(2_000_000);
  });

  it("turns a loop into a pause, a suggestion, an incident and a notification", async () => {
    const { hub, store, notes } = setup();
    await hub.sync(payload({ start: true }, [usage()]));
    const r = await hub.sync(payload({}, [loop]));
    expect(r.desired).toBe("PAUSE");
    expect(r.reason).toContain("Repeated 3 times");
    const a = store.agents()[0];
    expect(a.status).toBe("PAUSED");
    expect(a.suggestion?.status).toBe("PENDING");
    expect(a.suggestion?.text).toMatch(/npm test/);
    expect(store.incidents()).toHaveLength(1);
    expect(store.incidents()[0]).toMatchObject({ kind: "LOOP", action: "PAUSED", severity: "WARN" });
    expect(notes).toEqual(["Claude Code · demo was paused"]);
    expect(store.notifications()[0].level).toBe("WARN");
  });

  it("keeps the agent paused on later syncs until someone resumes it", async () => {
    const { hub } = setup();
    await hub.sync(payload({ start: true }, [loop]));
    expect((await hub.sync(payload())).desired).toBe("PAUSE");
    expect((await hub.sync(payload())).desired).toBe("PAUSE");
  });

  it("resume with a hint delivers the hint exactly once", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }, [loop]));
    const id = store.agents()[0].id;
    expect((await controls.resume(id, "use the other config file")).ok).toBe(true);
    const first = await hub.sync(payload());
    expect(first).toMatchObject({ desired: "RUN", hint: "use the other config file" });
    const second = await hub.sync(payload());
    expect(second.desired).toBe("RUN");
    expect(second.hint).toBeUndefined();
  });

  it("keeps an instruction for later instead of handing it to a run that is ending", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }));
    const id = store.agents()[0].id;
    await store.setControl(id, { hint: "fix the failing test" });
    expect((await hub.sync(payload({ end: true }))).hint).toBeUndefined();
    expect(store.agent(id)?.hint).toBe("fix the failing test");
    void controls;
  });

  it("approving the suggestion resumes with its text and marks it applied", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }, [loop]));
    const id = store.agents()[0].id;
    const text = store.agents()[0].suggestion!.text;
    expect((await controls.applySuggestion(id)).ok).toBe(true);
    const r = await hub.sync(payload());
    expect(r.hint).toBe(text);
    expect(store.agent(id)?.suggestion?.status).toBe("APPLIED");
    expect((await controls.applySuggestion(id)).ok).toBe(false); // nothing pending any more
  });

  it("an edited suggestion is what the agent receives", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }, [loop]));
    await controls.applySuggestion(store.agents()[0].id, "  my own words  ");
    expect((await hub.sync(payload())).hint).toBe("my own words");
  });

  it("dismissing keeps it paused", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }, [loop]));
    const id = store.agents()[0].id;
    expect((await controls.dismissSuggestion(id)).ok).toBe(true);
    expect(store.agent(id)?.suggestion?.status).toBe("DISMISSED");
    expect((await hub.sync(payload())).desired).toBe("PAUSE");
  });

  it("stop answers KILL, records a critical incident and survives the run ending", async () => {
    const { hub, controls, store, notes } = setup();
    await hub.sync(payload({ start: true }));
    const id = store.agents()[0].id;
    await controls.stop(id);
    expect((await hub.sync(payload())).desired).toBe("KILL");
    expect(store.incidents().at(-1)).toMatchObject({ action: "KILLED", severity: "CRITICAL" });
    expect(notes).toEqual([]); // Controls was built without a callback here
    expect(store.notifications()[0].level).toBe("CRITICAL");
    await hub.sync(payload({ end: true }));
    expect(store.agent(id)?.status).toBe("STOPPED");
  });

  it("marks the agent ended when a run finishes normally, without any pause message", async () => {
    const { hub, store } = setup();
    await hub.sync(payload({ start: true }));
    await hub.sync(payload({ end: true }));
    expect(store.agents()[0].status).toBe("ENDED");
    expect(store.incidents()).toHaveLength(0);
    expect(store.notifications()).toHaveLength(0);
  });

  it("a new run of the same agent starts clean after an old stop", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }, [], "old"));
    await controls.stop(store.agents()[0].id);
    await hub.sync(payload({ end: true }, [], "old"));
    const r = await hub.sync(payload({ start: true }, [], "new"));
    expect(r.desired).toBe("RUN");
    expect(store.agents()[0]).toMatchObject({ status: "ACTIVE", runId: "new" });
  });

  it("does not turn a stop into a pause when a loop arrives afterwards", async () => {
    const { hub, controls, store } = setup();
    await hub.sync(payload({ start: true }));
    await controls.stop(store.agents()[0].id);
    expect((await hub.sync(payload({}, [loop]))).desired).toBe("KILL");
  });

  it("answers with the policy from the config", async () => {
    const { hub, store } = setup();
    await store.saveConfig({ policy: { loopScoreThreshold: 0.95, exactRepeatLimit: 4 } });
    expect((await hub.sync(payload({ start: true }))).policy).toEqual({ loopScoreThreshold: 0.95, exactRepeatLimit: 4 });
  });
});

describe("Controls", () => {
  it("reports unknown agents and over-long instructions", async () => {
    const { controls, hub, store } = setup();
    expect(await controls.stop("nope")).toEqual({ ok: false, error: 'No agent with id "nope".' });
    await hub.sync(payload({ start: true }));
    const r = await controls.resume(store.agents()[0].id, "x".repeat(3000));
    expect(r.ok).toBe(false);
  });
});
