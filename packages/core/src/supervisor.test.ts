import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowProject, detectGates, type GateResult } from "./gates";
import { Store, type AgentRecord } from "./store";
import { assessClaims, redirectFor, TurnSupervisor } from "./supervisor";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sup-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

const gate = (name: GateResult["name"], ok: boolean, tail = ""): GateResult => ({ name, command: `npm run ${name}`, ok, exitCode: ok ? 0 : 1, timedOut: false, durationMs: 10, outputTail: tail });

describe("assessClaims", () => {
  it("catches 'tests pass' when the test check fails", () => {
    const f = assessClaims("I fixed the bug. All tests pass now.", [gate("test", false, "FAIL src/a.test.ts")], []);
    expect(f[0]).toMatchObject({ code: "claim-contradicted", severity: "CRITICAL" });
    expect(f[0].evidence.join(" ")).toContain("FAIL src/a.test.ts");
  });
  it("flags a test claim with no check and no test run as unverified", () => {
    expect(assessClaims("Done. The tests are passing.", null, ['Edit({"file":"a.ts"})'])[0]).toMatchObject({ code: "claim-unverified", severity: "WARN" });
  });
  it("accepts a test claim when the agent ran tests itself, or the check passes", () => {
    expect(assessClaims("All tests pass.", null, ['Bash({"command":"npm test"})'])).toEqual([]);
    expect(assessClaims("All 12 tests pass.", [gate("test", true)], [])).toEqual([]);
  });
  it("ignores negated or uncertain statements", () => {
    expect(assessClaims("The tests don't pass yet; two still fail.", [gate("test", false)], [])).toEqual([]);
    expect(assessClaims("I could not make the tests pass.", [gate("test", false)], [])).toEqual([]);
  });
  it("catches a build or type-check claim that the check contradicts", () => {
    expect(assessClaims("The build now succeeds.", [gate("build", false)], [])[0].title).toContain("build");
    expect(assessClaims("Type-check is clean.", [gate("typecheck", false)], [])[0].title).toContain("typecheck");
    expect(assessClaims("The build now succeeds.", [gate("build", true)], [])).toEqual([]);
  });
  it("says nothing without a claim", () => {
    expect(assessClaims("I changed the button colour.", [gate("test", false)], [])).toEqual([]);
    expect(assessClaims("", null, [])).toEqual([]);
  });
});

describe("redirectFor", () => {
  it("lists the problems with evidence and forbids the usual shortcuts", () => {
    const text = redirectFor([
      { code: "tests-skipped", severity: "CRITICAL", title: "Tests were switched off", detail: "1 test was skipped.", evidence: ["a.test.ts: it.skip('x')"], files: [] },
      { code: "todos", severity: "INFO", title: "3 TODO notes", detail: "", evidence: [], files: [] },
    ]);
    expect(text).toContain("1. Tests were switched off");
    expect(text).toContain("it.skip('x')");
    expect(text).not.toContain("TODO notes"); // informational findings are not sent
    expect(text).toMatch(/Do not delete, skip or weaken tests/);
  });
  it("stays within a size limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ code: "x", severity: "WARN" as const, title: `T${i}`, detail: "d".repeat(900), evidence: [], files: [] }));
    expect(redirectFor(many).length).toBeLessThanOrEqual(1800);
  });
});

/* --------------------------- the supervisor in action --------------------------- */

function setup(mode: "off" | "alert" | "redirect" = "alert", allow = true) {
  const store = new Store(tmp());
  const root = tmp();
  git(root, "init", "-q");
  write(root, "package.json", JSON.stringify({ scripts: { test: 'node -e "process.exit(require(\'fs\').existsSync(\'BROKEN\') ? 1 : 0)"' } }));
  write(root, "src/a.ts", "export const a = 1;\n");
  write(root, "src/a.test.ts", "it('a', () => {});\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const said: string[] = [];
  const agent: AgentRecord = { id: "ag_x", name: "Claude Code · demo", type: "CLAUDE", status: "ACTIVE", runId: "r", startedAt: 1, lastSeen: Date.now(), tokensUsed: 0, desired: "RUN", reason: "", suggestion: null };
  return {
    store,
    root,
    said,
    async init() {
      await store.saveConfig({ supervisor: { mode, maxTurnTokens: 1000, redirectCooldownMs: 0, maxRedirectsInARow: 2 } });
      await store.updateAgent("ag_x", () => agent);
      if (allow) await allowProject(store, root, detectGates(root));
      return new TurnSupervisor({ store, root, agentId: "ag_x", agentName: "Claude Code · demo", say: (m) => said.push(m) });
    },
  };
}

describe("TurnSupervisor", () => {
  it("alert mode: records the problems and tells you, without touching the agent", async () => {
    const s = setup("alert");
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "fix it" });
    write(s.root, "src/a.test.ts", "it.skip('a', () => {});\n");
    const out = await sup.turnEnded({ key: "t1", text: "Done.", toolCalls: [] });
    expect(out?.action).toBe("alert");
    expect(out?.report.findings.map((f) => f.code)).toContain("tests-skipped");
    expect(s.store.incidents()[0]).toMatchObject({ agentId: "ag_x", agentName: "Claude Code · demo", kind: "FINDING" });
    expect(s.store.agent("ag_x")?.hint).toBeUndefined();
    expect(s.said[0]).toContain("Tests were switched off");
  }, 20_000);

  it("redirect mode: catches a false 'tests pass' claim and queues a corrective instruction for the agent", async () => {
    const s = setup("redirect");
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "fix it" });
    write(s.root, "BROKEN", "x");
    write(s.root, "src/a.ts", "export const a = 2;\n");
    const out = await sup.turnEnded({ key: "t1", text: "Fixed. All tests pass.", toolCalls: [] });
    expect(out?.action).toBe("redirect");
    const codes = out!.report.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["claim-contradicted", "gate-test"]));
    expect(s.store.agent("ag_x")?.hint).toContain("said the tests pass, but they fail");
  }, 20_000);

  it("reports a regression: a check that passed after the last turn and fails now", async () => {
    const s = setup("alert");
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "one" });
    write(s.root, "src/a.ts", "export const a = 2;\n");
    expect((await sup.turnEnded({ key: "t1", text: "ok", toolCalls: [] }))?.action).toBe("none");
    await sup.turnStarted({ key: "t2", humanText: "two" });
    write(s.root, "BROKEN", "x");
    const out = await sup.turnEnded({ key: "t2", text: "ok", toolCalls: [] });
    expect(out?.report.findings.map((f) => f.code)).toContain("regression");
  }, 30_000);

  it("does nothing for a turn that changed no files, a retried request, or a mismatched turn", async () => {
    const s = setup("redirect");
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "what does this do?" });
    await sup.turnStarted({ key: "t1", humanText: "what does this do?" }); // retry: same baseline
    expect(await sup.turnEnded({ key: "t1", text: "It adds numbers. All tests pass.", toolCalls: [] })).toBeNull();
    expect(await sup.turnEnded({ key: "other", text: "x", toolCalls: [] })).toBeNull();
    expect(s.store.incidents()).toHaveLength(0);
  }, 20_000);

  it("stops redirecting after too many in a row and asks for you instead", async () => {
    const s = setup("redirect");
    const sup = await s.init(); // maxRedirectsInARow: 2
    const actions: string[] = [];
    for (let i = 1; i <= 3; i++) {
      await sup.turnStarted({ key: `t${i}`, humanText: "again" });
      write(s.root, "src/a.ts", `export const a = ${i}; // ... rest of the code\n`);
      actions.push((await sup.turnEnded({ key: `t${i}`, text: "done", toolCalls: [] }))!.action);
    }
    expect(actions).toEqual(["redirect", "redirect", "held-back"]);
    expect(s.store.notifications().some((n) => n.title.includes("needs you"))).toBe(true);
  }, 40_000);

  it("respects the cooldown between redirects", async () => {
    const s = setup("redirect");
    const sup = await s.init();
    await s.store.saveConfig({ supervisor: { mode: "redirect", maxTurnTokens: 0, redirectCooldownMs: 60_000, maxRedirectsInARow: 5 } });
    const actions: string[] = [];
    for (let i = 1; i <= 2; i++) {
      await sup.turnStarted({ key: `t${i}`, humanText: "again" });
      write(s.root, "src/a.ts", `export const a = ${i}; // ... rest of the code\n`);
      actions.push((await sup.turnEnded({ key: `t${i}`, text: "done", toolCalls: [] }))!.action);
    }
    expect(actions).toEqual(["redirect", "held-back"]);
  }, 30_000);

  it("is silent when switched off", async () => {
    const s = setup("off");
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "x" });
    write(s.root, "src/a.test.ts", "it.skip('a', () => {});\n");
    expect(await sup.turnEnded({ key: "t1", text: "done", toolCalls: [] })).toBeNull();
    expect(s.store.incidents()).toHaveLength(0);
  }, 20_000);

  it("pauses once when a turn goes over the token budget", async () => {
    const s = setup("alert");
    const sup = await s.init(); // maxTurnTokens: 1000
    await sup.turnStarted({ key: "t1", humanText: "x" });
    expect(sup.usage(600)).toBeNull();
    expect(sup.usage(600)).toMatch(/1,200 tokens in one turn, over your limit of 1,000/);
    expect(sup.usage(600)).toBeNull(); // only once per turn
    await sup.turnStarted({ key: "t2", humanText: "y" });
    expect(sup.usage(600)).toBeNull(); // a new turn starts from zero
  }, 20_000);

  it("without permission it still checks the files and flags an unverifiable claim", async () => {
    const s = setup("alert", false);
    const sup = await s.init();
    await sup.turnStarted({ key: "t1", humanText: "x" });
    write(s.root, "src/a.ts", "export const a = 3;\n");
    const out = await sup.turnEnded({ key: "t1", text: "All tests pass.", toolCalls: [] });
    expect(out?.report.gates.results).toBeNull();
    expect(out?.report.findings.map((f) => f.code)).toContain("claim-unverified");
  }, 20_000);
});
