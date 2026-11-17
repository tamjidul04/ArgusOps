import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AutopilotRun } from "../../core/src/autopilot";
import { Store } from "../../core/src/store";
import { autopilotCommand } from "./autopilot-cmd";

const FAKE = path.resolve(__dirname, "..", "..", "core", "src", "fixtures", "fake-claude.mjs");
const dirs: string[] = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 300));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-apc-"));
  dirs.push(d);
  return d;
};

function setup(plan: unknown, questions: string[] = []) {
  const root = tmp();
  execFileSync("git", ["init", "-q"], { cwd: root });
  const store = new Store(tmp());
  const lines: string[] = [];
  const errs: string[] = [];
  const env = { ...process.env, ARGUSOPS_CLAUDE: process.execPath, ARGUSOPS_CLAUDE_ARGS: JSON.stringify([FAKE]), FAKE_CLAUDE_REPLIES: `${JSON.stringify({ questions })}|||${JSON.stringify(plan)}` };
  return { root, store, lines, errs, env, io: { out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) } };
}

const plan = {
  summary: "Say hello",
  steps: [{ title: "Write hello.txt", instructions: "WRITE hello.txt hi there\nSAY wrote it", acceptance: [{ type: "file-contains", path: "hello.txt", text: "hi there" }, { type: "command", command: 'node -e "process.exit(0)"' }] }],
};

describe("argus autopilot", () => {
  it("plans, shows every command it may run, and with --yes builds it step by step", async () => {
    const s = setup(plan);
    const code = await autopilotCommand(["write", "a", "greeting", "--yes"], s.store, s.io, s.env, s.root);
    const text = s.lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("Plan: Say hello");
    expect(text).toContain("Approving this plan lets ArgusOps run these commands");
    expect(text).toContain('node -e "process.exit(0)"');
    expect(text).toContain("Step 1 passed");
    expect(fs.readFileSync(path.join(s.root, "hello.txt"), "utf8")).toContain("hi there");
    const run = s.store.autopilotRuns<AutopilotRun>()[0];
    expect(run).toMatchObject({ status: "done", goal: "write a greeting" });
  }, 60_000);

  it("never starts without approval when there is nobody to ask, and can be started later", async () => {
    const s = setup(plan);
    expect(await autopilotCommand(["write", "a", "greeting"], s.store, s.io, s.env, s.root)).toBe(1);
    expect(fs.existsSync(path.join(s.root, "hello.txt"))).toBe(false);
    const run = s.store.autopilotRuns<AutopilotRun>()[0];
    expect(run.status).toBe("awaiting-approval");
    expect(s.lines.join("\n")).toContain(`argus autopilot resume ${run.id} --yes`);
    // options that take a value must keep it on resume (found in a real run)
    expect(await autopilotCommand(["resume", run.id, "--yes", "--model", "claude-haiku-5-5", "--max-attempts", "2"], s.store, s.io, s.env, s.root)).toBe(0);
    expect(fs.readFileSync(path.join(s.root, "fake-claude.log"), "utf8").length).toBeGreaterThan(0);
    expect(s.store.autopilotRun<AutopilotRun>(run.id)?.status).toBe("done");
  }, 60_000);

  it("asks the planner's questions and uses the answers, and asks before starting", async () => {
    const s = setup(plan, ["Which language?"]);
    const asked: string[] = [];
    const answers = ["JavaScript", "n"];
    const code = await autopilotCommand(["make", "it"], s.store, { ...s.io, ask: async (q) => (asked.push(q), answers.shift() ?? "") }, s.env, s.root);
    expect(code).toBe(1); // the user said no
    expect(asked[0]).toContain("Which language?");
    expect(asked[1]).toContain("Approve this plan");
    const run = s.store.autopilotRuns<AutopilotRun>()[0];
    expect(run.answers).toEqual([{ question: "Which language?", answer: "JavaScript" }]);
    const log = fs.readFileSync(path.join(s.root, "fake-claude-oneshot.log"), "utf8");
    expect(log).toContain("JavaScript"); // the answer went into the planning prompt
  }, 60_000);

  it("list, status, pause and stop", async () => {
    const s = setup(plan);
    await autopilotCommand(["write", "a", "greeting"], s.store, s.io, s.env, s.root); // saved, not started
    const run = s.store.autopilotRuns<AutopilotRun>()[0];
    s.lines.length = 0;
    await autopilotCommand(["list"], s.store, s.io, s.env, s.root);
    expect(s.lines.join("\n")).toContain(run.id);
    s.lines.length = 0;
    await autopilotCommand(["status"], s.store, s.io, s.env, s.root);
    expect(s.lines.join("\n")).toContain("awaiting-approval");
    expect(await autopilotCommand(["pause", run.id], s.store, s.io, s.env, s.root)).toBe(0);
    expect(s.store.autopilotRun<AutopilotRun>(run.id)?.control).toBe("pause");
    expect(await autopilotCommand(["stop"], s.store, s.io, s.env, s.root)).toBe(0);
    expect(s.store.autopilotRun<AutopilotRun>(run.id)?.control).toBe("stop");
    expect(await autopilotCommand(["status", "ap_nope"], s.store, s.io, s.env, s.root)).toBe(1);
  }, 60_000);

  it("explains a missing goal and bad options", async () => {
    const s = setup(plan);
    expect(await autopilotCommand([], s.store, s.io, s.env, s.root)).toBe(1);
    expect(s.errs[0]).toContain("Say what you want built");
    expect(await autopilotCommand(["x", "--max-attempts", "50"], s.store, s.io, s.env, s.root)).toBe(1);
    expect(await autopilotCommand(["x", "--bogus"], s.store, s.io, s.env, s.root)).toBe(1);
  });

  it("reports a planner that cannot produce a plan", async () => {
    const s = setup({ steps: [] });
    expect(await autopilotCommand(["x", "--yes"], s.store, s.io, s.env, s.root)).toBe(2);
    expect(s.errs.join("\n")).toContain("usable plan");
  }, 60_000);
});
