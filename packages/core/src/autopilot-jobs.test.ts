import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AutopilotRun } from "./autopilot";
import { AutopilotJobs, JobError } from "./autopilot-jobs";
import { checkProjectFolder, planHash, type ExecuteOptions } from "./autopilot-runner";
import { startControlApi } from "./control-api";
import { EditorConnections } from "./editor-connections";
import type { RunOptions } from "./run";
import { Store } from "./store";

const FAKE = path.resolve(__dirname, "fixtures", "fake-claude.mjs");
const dirs: string[] = [];
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  await new Promise((r) => setTimeout(r, 200));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "argus-jobs-")));
  dirs.push(d);
  return d;
};
const until = async (fn: () => boolean, ms = 10_000) => {
  for (let t = 0; t < ms / 25; t++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting");
};
const plan = { summary: "Say hello", steps: [{ title: "Write hello.txt", instructions: "WRITE hello.txt hi there\nSAY wrote it", acceptance: [{ type: "file-contains", path: "hello.txt", text: "hi there" }, { type: "command", command: 'node -e "process.exit(0)"' }] }] };

/** A planner that answers like Claude would: the questions prompt first, then the plan prompt. */
function fakePlanner(questions: string[], seen: string[] = []) {
  return () => async (prompt: string) => {
    seen.push(prompt);
    return prompt.includes('{"questions"') ? JSON.stringify({ questions }) : JSON.stringify(plan);
  };
}

function setup(o: { questions?: string[]; execute?: ConstructorParameters<typeof AutopilotJobs>[0]["execute"] } = {}) {
  const store = new Store(tmp());
  const root = tmp();
  const seen: string[] = [];
  const jobs = new AutopilotJobs({ store, planner: fakePlanner(o.questions ?? [], seen), execute: o.execute });
  closers.push(() => jobs.close());
  return { store, root, jobs, seen, run: (id: string) => store.autopilotRun<AutopilotRun>(id)! };
}

describe("project folders", () => {
  it("accepts a real folder and refuses everything that is not a project folder", () => {
    const store = tmp();
    const ok = tmp();
    fs.writeFileSync(path.join(ok, "f.txt"), "x");
    expect(checkProjectFolder(ok, store)).toEqual({ ok: true, root: ok });
    expect(checkProjectFolder("relative/path", store).ok).toBe(false);
    expect(checkProjectFolder(path.join(ok, "missing"), store).ok).toBe(false);
    expect(checkProjectFolder(path.join(ok, "f.txt"), store).ok).toBe(false);
    expect(checkProjectFolder(path.parse(ok).root, store).ok).toBe(false);
    expect(checkProjectFolder(os.homedir(), store).ok).toBe(false);
    expect(checkProjectFolder(store, store).ok).toBe(false);
    fs.mkdirSync(path.join(store, "autopilot"));
    expect(checkProjectFolder(path.join(store, "autopilot"), store).ok).toBe(false);
    expect(checkProjectFolder(42, store).ok).toBe(false);
  });
});

describe("Autopilot started from the app", () => {
  it("asks its questions, plans with your answers, and builds only after you approve the plan you saw", async () => {
    const calls: Array<{ run: AutopilotRun; o: ExecuteOptions }> = [];
    const s = setup({
      questions: ["Which language?"],
      execute: async (run, o) => {
        calls.push({ run, o });
        run.status = "done";
        return run;
      },
    });
    const started = s.jobs.start({ goal: "a greeting", root: s.root });
    expect(started.status).toBe("planning");
    await until(() => s.run(started.id).status === "awaiting-answers");
    expect(s.run(started.id).questions).toEqual(["Which language?"]);
    expect(() => s.jobs.answer(started.id, [])).toThrow(JobError); // one answer per question
    s.jobs.answer(started.id, ["JavaScript"]);
    await until(() => s.run(started.id).status === "awaiting-approval");
    const ready = s.run(started.id);
    expect(ready.plan.summary).toBe("Say hello");
    expect(ready.answers).toEqual([{ question: "Which language?", answer: "JavaScript" }]);
    expect(s.seen.some((p) => p.includes("JavaScript"))).toBe(true);

    expect(() => s.jobs.approve(started.id, "not-the-plan")).toThrow(/plan changed/);
    expect(calls).toHaveLength(0); // nothing ran
    s.jobs.approve(started.id, planHash(ready.plan));
    await until(() => calls.length === 1);
    expect(calls[0].o.allowBash).toBe(false); // the app can never allow any command
    expect(() => s.jobs.approve(started.id, planHash(ready.plan))).toThrow(JobError); // not twice
  });

  it("refuses bad goals and folders, and stopping during planning throws the plan away", async () => {
    const s = setup();
    expect(() => s.jobs.start({ goal: "", root: s.root })).toThrow(/what you want/);
    expect(() => s.jobs.start({ goal: "x", root: os.homedir() })).toThrow(/home folder/);
    const r = s.jobs.start({ goal: "x", root: s.root, questions: false });
    s.jobs.cancel(r.id);
    await new Promise((res) => setTimeout(res, 100));
    expect(s.run(r.id).status).toBe("stopped");
  });

  it("a step that keeps failing waits for you: retry with your words, skip, or stop", async () => {
    let decision: unknown = null;
    const s = setup({
      execute: async (run, o) => {
        run.status = "needs-you";
        decision = await o.decide!(run, run.plan.steps[0]);
        run.status = "done";
        return run;
      },
    });
    const r = s.jobs.start({ goal: "x", root: s.root, questions: false });
    await until(() => s.run(r.id).status === "awaiting-approval");
    s.jobs.approve(r.id, planHash(s.run(r.id).plan));
    await until(() => s.jobs.isLive(r.id) && s.store.autopilotRun<AutopilotRun>(r.id)!.status === "running");
    // the fake executor does not save; mark it as executePlan would
    s.store.saveAutopilotRun({ ...s.run(r.id), status: "needs-you" });
    await until(() => (s.jobs as unknown as { waiting: Map<string, unknown> }).waiting.has(r.id));
    expect(() => s.jobs.decide(r.id, { action: "later" })).toThrow(JobError);
    s.jobs.decide(r.id, { action: "retry", instruction: "read the error first" });
    await until(() => decision !== null);
    expect(decision).toEqual({ action: "retry", instruction: "read the error first" });
  });

  it("after a restart, a waiting step can still be skipped: the run carries on from the next step", async () => {
    const launched: AutopilotRun[] = [];
    const s = setup({ execute: async (run) => (launched.push(structuredClone(run)), run) });
    const r = s.jobs.start({ goal: "x", root: s.root, questions: false });
    await until(() => s.run(r.id).status === "awaiting-approval");
    const saved = s.run(r.id);
    s.store.saveAutopilotRun({ ...saved, status: "needs-you", needsYou: "Step 1 still fails.", steps: saved.steps.map((st) => ({ ...st, status: "failed" })) });
    const fresh = new AutopilotJobs({ store: s.store, planner: fakePlanner([]), execute: async (run) => (launched.push(structuredClone(run)), run) });
    closers.push(() => fresh.close());
    fresh.decide(r.id, { action: "skip" });
    await until(() => launched.length === 1);
    expect(launched[0].steps[0].status).toBe("skipped");
  });

  it("closing ArgusOps leaves a building run paused, ready to continue", async () => {
    const s = setup({ execute: (run, o) => new Promise((resolve) => o.abort!.addEventListener("abort", () => resolve(run))) });
    const r = s.jobs.start({ goal: "x", root: s.root, questions: false });
    await until(() => s.run(r.id).status === "awaiting-approval");
    s.jobs.approve(r.id, planHash(s.run(r.id).plan));
    await until(() => s.jobs.isLive(r.id));
    expect(() => s.jobs.start({ goal: "y", root: s.root, questions: false })).not.toThrow(); // planning in the same folder is fine
    await s.jobs.close();
    expect(s.run(r.id).status).toBe("paused");
    expect(s.run(r.id).log.at(-1)?.message).toContain("closed");
  });

  it("builds for real with Claude Code (a stand-in): plan, approve, the file is written, the run is done", async () => {
    const store = new Store(tmp());
    const root = tmp();
    execFileSync("git", ["init", "-q"], { cwd: root });
    const env = { ...process.env, ARGUSOPS_CLAUDE: process.execPath, ARGUSOPS_CLAUDE_ARGS: JSON.stringify([FAKE]), FAKE_CLAUDE_REPLIES: JSON.stringify(plan) };
    const jobs = new AutopilotJobs({ store, env });
    closers.push(() => jobs.close());
    const r = jobs.start({ goal: "write a greeting", root, questions: false });
    await until(() => store.autopilotRun<AutopilotRun>(r.id)!.status === "awaiting-approval", 30_000);
    jobs.approve(r.id, planHash(store.autopilotRun<AutopilotRun>(r.id)!.plan));
    await until(() => store.autopilotRun<AutopilotRun>(r.id)!.status === "done", 45_000);
    expect(fs.readFileSync(path.join(root, "hello.txt"), "utf8")).toContain("hi there");
  }, 90_000);
});

describe("the control API with Autopilot and editors", () => {
  async function api(o: { jobs?: AutopilotJobs; editors?: EditorConnections; store: Store }) {
    const server = await startControlApi({ store: o.store, port: 0, version: "t", autopilot: o.jobs, editors: o.editors });
    closers.push(() => server.close());
    const call = (p: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(server.url + p, { method: body === undefined ? "GET" : "POST", headers: { "x-argus-token": o.store.token(), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return call;
  }

  it("an engine without Autopilot says how to start one instead", async () => {
    const store = new Store(tmp());
    const call = await api({ store });
    expect((await call("/api/autopilot", { goal: "x", root: tmp() })).status).toBe(501);
    expect((await (await call("/api/autopilot")).json()).canStart).toBe(false);
    expect((await (await call("/api/editors")).json()).available).toBe(false);
  });

  it("start, review (every command and the plan's fingerprint), approve; web pages and missing tokens are refused", async () => {
    const s = setup({ execute: async (run) => run });
    const call = await api({ store: s.store, jobs: s.jobs });
    expect((await call("/api/autopilot", { goal: "x", root: s.root }, { "x-argus-token": "wrong" })).status).toBe(401);
    expect((await call("/api/autopilot", { goal: "x", root: s.root }, { origin: "https://evil.example" })).status).toBe(403);
    const made = await call("/api/autopilot", { goal: "a greeting", root: s.root, questions: false });
    expect(made.status).toBe(201);
    const { id } = await made.json();
    await until(() => s.run(id).status === "awaiting-approval");
    const listed = (await (await call("/api/autopilot")).json()).runs.find((r: { id: string }) => r.id === id);
    expect(listed.review.commands).toEqual(['node -e "process.exit(0)"']);
    expect(listed.review.steps[0].checks.length).toBe(2);
    expect((await call(`/api/autopilot/${id}/approve`, { planHash: "nope" })).status).toBe(409);
    expect((await call(`/api/autopilot/${id}/approve`, { planHash: listed.review.planHash })).status).toBe(200);
  });

  it("connects an editor folder (writes the setting), lists it, and disconnecting puts the file back", async () => {
    const store = new Store(tmp());
    const folder = tmp();
    const fakeRun = (o: RunOptions) =>
      new Promise<number>((resolve) => {
        o.onReady?.("http://127.0.0.1:59999");
        o.stopSignal?.addEventListener("abort", () => resolve(0));
      });
    const editors = new EditorConnections({ store, run: fakeRun });
    closers.push(() => editors.close());
    const call = await api({ store, editors });
    const res = await call("/api/editors/connect", { folder });
    expect(res.status).toBe(200);
    const settings = path.join(folder, ".vscode", "settings.json");
    expect(fs.readFileSync(settings, "utf8")).toContain("http://127.0.0.1:59999");
    expect((await (await call("/api/editors")).json()).connections).toHaveLength(1);
    expect((await call("/api/editors/disconnect", { folder })).status).toBe(200);
    expect(fs.existsSync(settings)).toBe(false); // there was no settings file before
    expect((await call("/api/editors/disconnect", { folder })).status).toBe(404);
  });

  it("a setting left behind by a crash is removed on the next start", async () => {
    const store = new Store(tmp());
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".vscode"));
    fs.writeFileSync(path.join(folder, ".vscode", "settings.json"), JSON.stringify({ "claudeCode.environmentVariables": [{ name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:1" }], "editor.tabSize": 2 }));
    fs.writeFileSync(path.join(store.root, "editor-connections.json"), JSON.stringify([folder]));
    const editors = new EditorConnections({ store });
    expect(await editors.cleanupStale()).toEqual([folder]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".vscode", "settings.json"), "utf8"))).toEqual({ "editor.tabSize": 2 });
  });

  it("refuses a settings file with comments rather than rewriting it", async () => {
    const store = new Store(tmp());
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".vscode"));
    fs.writeFileSync(path.join(folder, ".vscode", "settings.json"), '{ // mine\n "a": 1 }');
    const editors = new EditorConnections({ store, run: (o) => new Promise((r) => (o.onReady?.("http://127.0.0.1:59998"), o.stopSignal?.addEventListener("abort", () => r(0)))) });
    closers.push(() => editors.close());
    await expect(editors.connect(folder)).rejects.toThrow(/comments/);
    expect(editors.list()).toHaveLength(0);
  });
});
