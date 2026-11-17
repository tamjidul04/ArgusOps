import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executePlan, formatRun, newRun, planCommands, routeHint, stepMessage, type AgentLike, type AutopilotRun } from "./autopilot";
import type { RouteHint } from "./routing";
import { ClaudeSession, SessionError, type TurnResult } from "./claude-session";
import type { Plan } from "./planner";
import { Store, type AgentRecord } from "./store";

const FAKE = path.join(__dirname, "fixtures", "fake-claude.mjs");
const dirs: string[] = [];
const sessions: ClaudeSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close(2000)));
  await new Promise((r) => setTimeout(r, 150));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-ap-"));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"] });
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

function project() {
  const root = tmp();
  git(root, "init", "-q");
  write(root, "README.md", "# demo\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const reply = (text = "Done.", over: Partial<TurnResult> = {}): TurnResult => ({ text, isError: false, subtype: "success", costUsd: 0.01, permissionDenials: [], sessionId: "s1", ...over });

/** An agent whose behaviour is a list of actions, one per instruction it receives. */
function scripted(root: string, actions: Array<(text: string) => TurnResult | Promise<TurnResult>>) {
  const received: string[] = [];
  const agent: AgentLike = {
    async send(text) {
      received.push(text);
      const act = actions.shift();
      if (!act) return reply("Nothing more to do.");
      return act(text);
    },
  };
  void root;
  return { agent, received };
}

const plan: Plan = {
  summary: "two files",
  steps: [
    { id: "step-1", title: "Create a.txt", instructions: "Create a.txt containing hello.", acceptance: [{ type: "file-contains", path: "a.txt", text: "hello" }] },
    { id: "step-2", title: "Create b.txt", instructions: "Create b.txt.", acceptance: [{ type: "file-exists", path: "b.txt" }] },
  ],
};

function setup(p: Plan = plan) {
  const store = new Store(tmp());
  const root = project();
  const run = newRun("make two files", root, p, []);
  return { store, root, run };
}

describe("executePlan", () => {
  it("runs every step, checks each, and finishes", async () => {
    const { store, root, run } = setup();
    const { agent, received } = scripted(root, [
      () => (write(root, "a.txt", "hello\n"), reply("Created a.txt.")),
      () => (write(root, "b.txt", "b\n"), reply("Created b.txt.")),
    ]);
    const out = await executePlan(run, { store, agent });
    expect(out.status).toBe("done");
    expect(out.steps.map((s) => s.status)).toEqual(["passed", "passed"]);
    expect(out.costUsd).toBeCloseTo(0.02, 6);
    expect(received[0]).toContain("Now do step 1: Create a.txt");
    expect(received[0]).toContain('a.txt contains "hello"');
    expect(store.autopilotRun<AutopilotRun>(run.id)?.status).toBe("done");
  });

  it("sends a correction written from the evidence and passes on a later attempt", async () => {
    const { store, root, run } = setup();
    const { agent, received } = scripted(root, [
      () => reply("Done, a.txt is there."), // it is not
      () => (write(root, "a.txt", "hello\n"), reply("Now it is.")),
      () => (write(root, "b.txt", "b\n"), reply("ok")),
    ]);
    const out = await executePlan(run, { store, agent });
    expect(out.status).toBe("done");
    expect(out.steps[0].attempts).toBe(2);
    expect(received[1]).toContain("ArgusOps checked step 1 (Create a.txt) and it is not done yet");
    expect(received[1]).toContain("a.txt does not exist");
    expect(received[1]).toContain("Attempt 2 of 3");
  });

  it("tells model routing each step's size, and climbs a tier for each failed attempt", async () => {
    const sized: Plan = { summary: "s", steps: [{ ...plan.steps[0], size: "small" }, { ...plan.steps[1], size: "large" }] };
    const { store, root, run } = setup(sized);
    const hints: RouteHint[] = [];
    const { agent } = scripted(root, [
      () => reply("Done."), // not done: attempt 2 climbs a tier
      () => (write(root, "a.txt", "hello\n"), reply("ok")),
      () => (write(root, "b.txt", "b\n"), reply("ok")),
    ]);
    await executePlan(run, { store, agent, route: (h) => hints.push(h) });
    expect(hints.map((h) => [h.difficulty, h.escalate])).toEqual([["simple", 0], ["simple", 1], ["hard", 0]]);
    expect(routeHint({ ...plan.steps[0] }, 1).difficulty).toBe("normal"); // unsized: stays on your model
  });

  it("stops and waits for you after the last attempt, saying how to continue", async () => {
    const { store, root, run } = setup();
    const { agent } = scripted(root, [() => reply("x"), () => reply("y"), () => reply("z")]);
    const out = await executePlan(run, { store, agent, maxAttempts: 3 });
    expect(out.status).toBe("needs-you");
    expect(out.steps[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(out.needsYou).toContain(`argus autopilot resume ${run.id}`);
    expect(out.steps[1].status).toBe("pending");
  });

  it("asks you when a step keeps failing: skip, stop, or retry with your own words", async () => {
    const a = setup();
    const skip = scripted(a.root, [() => reply("x"), () => (write(a.root, "b.txt", "b"), reply("b done"))]);
    const skipped = await executePlan(a.run, { store: a.store, agent: skip.agent, maxAttempts: 1, decide: async () => ({ action: "skip" }) });
    expect(skipped.status).toBe("done");
    expect(skipped.steps.map((s) => s.status)).toEqual(["skipped", "passed"]);

    const b = setup();
    const stopped = await executePlan(b.run, { store: b.store, agent: scripted(b.root, [() => reply("x")]).agent, maxAttempts: 1, decide: async () => ({ action: "stop" }) });
    expect(stopped.status).toBe("stopped");

    const c = setup();
    const retry = scripted(c.root, [() => reply("x"), () => (write(c.root, "a.txt", "hello"), reply("fixed")), () => (write(c.root, "b.txt", "b"), reply("ok"))]);
    const retried = await executePlan(c.run, { store: c.store, agent: retry.agent, maxAttempts: 1, decide: async () => ({ action: "retry", instruction: "the file must be at the project root" }) });
    expect(retried.status).toBe("done");
    expect(retry.received[1]).toContain("From the user: the file must be at the project root");
  });

  it("fails a step that 'passes' by switching tests off, even when its checks pass", async () => {
    const p: Plan = { summary: "", steps: [{ id: "step-1", title: "Fix the tests", instructions: "Make the tests pass.", acceptance: [{ type: "file-exists", path: "a.test.js" }] }] };
    const { store, root, run } = setup(p);
    write(root, "a.test.js", "it('works', () => {});\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "test");
    const { agent, received } = scripted(root, [() => (write(root, "a.test.js", "it.skip('works', () => {});\n"), reply("All tests pass."))]);
    const out = await executePlan(run, { store, agent, maxAttempts: 2 });
    expect(out.steps[0].status).toBe("failed");
    expect(received[1]).toContain("Tests were switched off");
  });

  it("a failing check plus 'all tests pass' is called out as a false claim", async () => {
    const p: Plan = { summary: "", steps: [{ id: "step-1", title: "Tests", instructions: "Make tests pass.", acceptance: [{ type: "command", command: "node run-tests.js" }] }] };
    const { store, root, run } = setup(p);
    write(root, "run-tests.js", "console.log('1 failed'); process.exit(1);");
    write(root, "x.js", "1");
    const { agent, received } = scripted(root, [() => (write(root, "x.js", "2"), reply("All tests pass."))]);
    await executePlan(run, { store, agent, maxAttempts: 2 });
    expect(received[1]).toContain("said the tests pass, but they fail");
  });

  it("does not fail a step only because a tool was refused, but tells the agent", async () => {
    const { store, root, run } = setup();
    const { agent } = scripted(root, [
      () => (write(root, "a.txt", "hello"), reply("done", { permissionDenials: [{ tool: "Bash", input: { command: "curl x" } }] })),
      () => (write(root, "b.txt", "b"), reply("ok")),
    ]);
    const out = await executePlan(run, { store, agent });
    expect(out.status).toBe("done");
  });

  it("treats a timed-out turn as a failed attempt, and a dead agent as a failed run", async () => {
    const a = setup();
    const timeoutAgent: AgentLike = { send: async () => { throw new SessionError("slow", "timeout"); } };
    expect((await executePlan(a.run, { store: a.store, agent: timeoutAgent, maxAttempts: 2 })).status).toBe("needs-you");
    const b = setup();
    const deadAgent: AgentLike = { send: async () => { throw new SessionError("gone", "exited"); } };
    const out = await executePlan(b.run, { store: b.store, agent: deadAgent });
    expect(out.status).toBe("failed");
    expect(out.needsYou).toBeNull();
    expect(out.log.at(-1)?.message).toContain("The agent stopped working");
  });

  it("obeys stop and pause written from another terminal", async () => {
    const a = setup();
    a.store.saveAutopilotRun({ ...a.run, control: "stop" });
    expect((await executePlan(a.run, { store: a.store, agent: scripted(a.root, []).agent })).status).toBe("stopped");

    const b = setup();
    b.store.saveAutopilotRun({ ...b.run, control: "pause" });
    const agent = scripted(b.root, [() => (write(b.root, "a.txt", "hello"), reply("a")), () => (write(b.root, "b.txt", "b"), reply("b"))]).agent;
    const running = executePlan(b.run, { store: b.store, agent, pollMs: 30 });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.store.autopilotRun<AutopilotRun>(b.run.id)?.status).toBe("paused");
    const saved = b.store.autopilotRun<AutopilotRun>(b.run.id)!;
    b.store.saveAutopilotRun({ ...saved, control: null });
    expect((await running).status).toBe("done");
  });

  it("answers a loop the proxy caught by approving ArgusOps' correction", async () => {
    const { store, root, run } = setup({ summary: "", steps: [plan.steps[0]] });
    const agentRec: AgentRecord = { id: "ag_auto", name: "Autopilot", type: "CLAUDE", status: "ACTIVE", runId: "r", startedAt: 1, lastSeen: Date.now(), tokensUsed: 0, desired: "RUN", reason: "", suggestion: null };
    await store.updateAgent("ag_auto", () => agentRec);
    const agent: AgentLike = {
      async send() {
        // the proxy pauses the agent mid-turn with a suggestion; Autopilot must release it
        await store.updateAgent("ag_auto", (a) => (a ? { ...a, status: "PAUSED", desired: "PAUSE", suggestion: { id: "s", text: "Stop repeating it.", observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" } } : a));
        for (let i = 0; i < 50 && store.agent("ag_auto")?.desired !== "RUN"; i++) await new Promise((r) => setTimeout(r, 20));
        write(root, "a.txt", "hello");
        return reply("done");
      },
    };
    const out = await executePlan(run, { store, agent, agentId: "ag_auto", pollMs: 20 });
    expect(out.status).toBe("done");
    expect(store.agent("ag_auto")?.suggestion?.status).toBe("APPLIED");
    expect(out.log.some((l) => l.message.includes("caught a loop"))).toBe(true);
  });

  it("works end to end with a real headless agent process (the protocol test double)", async () => {
    const p: Plan = { summary: "", steps: [{ id: "step-1", title: "Say hello", instructions: "WRITE hello.txt hi there\nSAY wrote hello.txt", acceptance: [{ type: "file-contains", path: "hello.txt", text: "hi there" }] }] };
    const { store, root, run } = setup(p);
    const session = ClaudeSession.start({ command: process.execPath, args: [FAKE], cwd: root });
    sessions.push(session);
    const out = await executePlan(run, { store, agent: session });
    expect(out.status).toBe("done");
    expect(out.sessionId).toBe("fake-session-1");
    expect(out.steps[0].lastReply).toBe("wrote hello.txt");
  });
});

describe("helpers", () => {
  it("lists every command an approved plan may run", () => {
    const p: Plan = { summary: "", steps: [{ id: "s1", title: "a", instructions: "i", acceptance: [{ type: "command", command: "npm test" }, { type: "file-exists", path: "x" }] }, { id: "s2", title: "b", instructions: "i", acceptance: [{ type: "command", command: "npm test" }, { type: "command", command: "node app.js" }] }] };
    expect(planCommands(p)).toEqual(["npm test", "node app.js"]);
  });
  it("tells the agent the whole plan, where it is, and the house rules", () => {
    const run = newRun("goal", "/tmp/x", plan, []);
    run.steps[0].status = "passed";
    const m = stepMessage(run, plan.steps[1]);
    expect(m).toContain("1. Create a.txt   (done)");
    expect(m).toContain("2. Create b.txt   <- this step");
    expect(m).toMatch(/Do not delete, skip or weaken tests/);
  });
  it("formats a run for the terminal", () => {
    const run = newRun("goal", "/tmp/x", plan, []);
    run.steps[0] = { ...run.steps[0], status: "failed", attempts: 3, problems: ["Check failed: a.txt exists."] };
    const t = formatRun(run);
    expect(t).toContain("!! 1. Create a.txt   (3 attempts)");
    expect(t).toContain("- Check failed: a.txt exists.");
  });
});
