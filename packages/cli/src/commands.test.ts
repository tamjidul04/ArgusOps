import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store, type AgentRecord } from "../../core/src/store";
import { alerts, formatTokens, pause, pickAgent, resume, status, stop, timeAgo, usage } from "./commands";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;
function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-cmd-"));
  dirs.push(d);
  const lines: string[] = [];
  const errs: string[] = [];
  return { store: new Store(d), io: { out: (t: string) => lines.push(t), err: (t: string) => errs.push(t), now: () => NOW }, lines, errs };
}
const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "ag_one",
  name: "Claude Code · shop",
  type: "CLAUDE",
  status: "ACTIVE",
  runId: "r",
  startedAt: NOW - 1000,
  lastSeen: NOW - 2000,
  tokensUsed: 12_345,
  desired: "RUN",
  reason: "",
  suggestion: null,
  ...over,
});
const paused = (over: Partial<AgentRecord> = {}) =>
  agent({
    status: "PAUSED",
    desired: "PAUSE",
    reason: "Repeated 3 times: Bash(npm test)",
    suggestion: { id: "s1", text: "Stop re-running npm test.", observed: "o", tokensBefore: 100, source: "rule", createdAt: NOW, status: "PENDING" },
    ...over,
  });

describe("formatting", () => {
  it("shortens token counts and times", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(timeAgo(NOW - 3000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 90_000, NOW)).toBe("1m ago");
    expect(timeAgo(NOW - 3 * 3600_000, NOW)).toBe("3h ago");
  });
});

describe("status", () => {
  it("says what to do when there are no agents", () => {
    const { store, io, lines } = setup();
    expect(status(store, io)).toBe(0);
    expect(lines.join("\n")).toContain("argus run claude");
  });

  it("shows a paused agent with why, the suggestion and how to approve it", async () => {
    const { store, io, lines } = setup();
    await store.updateAgent("ag_one", () => paused());
    status(store, io);
    const text = lines.join("\n");
    expect(text).toContain("PAUSED");
    expect(text).toContain("Repeated 3 times");
    expect(text).toContain("Suggested instruction: Stop re-running npm test.");
    expect(text).toContain("argus resume ag_one --approve");
  });

  it("marks an agent that stopped checking in as not running", async () => {
    const { store, io, lines } = setup();
    await store.updateAgent("ag_one", () => agent({ lastSeen: NOW - 5 * 60_000 }));
    status(store, io);
    expect(lines.join("\n")).toContain("not running");
  });

  it("prints JSON on request", async () => {
    const { store, io, lines } = setup();
    await store.updateAgent("ag_one", () => agent());
    status(store, io, true);
    expect(JSON.parse(lines.join("\n")).agents[0].id).toBe("ag_one");
  });
});

describe("pickAgent", () => {
  const a = agent({ id: "ag_aaa", name: "Claude Code · shop" });
  const b = agent({ id: "ag_bbb", name: "Claude Code · docs", status: "PAUSED" });
  it("matches by id prefix or name part", () => {
    expect(pickAgent([a, b], "ag_a", () => true)).toMatchObject({ ok: true, agent: { id: "ag_aaa" } });
    expect(pickAgent([a, b], "docs", () => true)).toMatchObject({ ok: true, agent: { id: "ag_bbb" } });
  });
  it("explains ambiguity and misses", () => {
    expect(pickAgent([a, b], "claude", () => true)).toMatchObject({ ok: false });
    expect(pickAgent([a, b], "nothing", () => true)).toMatchObject({ ok: false });
    expect(pickAgent([], undefined, () => true)).toMatchObject({ ok: false });
  });
  it("without a name, uses the only agent in the right state", () => {
    expect(pickAgent([a, b], undefined, (x) => x.status === "PAUSED")).toMatchObject({ ok: true, agent: { id: "ag_bbb" } });
    expect(pickAgent([a, b], undefined, () => true)).toMatchObject({ ok: false });
  });
});

describe("pause, resume, stop", () => {
  it("resume with a hint writes the instruction for the agent", async () => {
    const { store, io, lines } = setup();
    await store.updateAgent("ag_one", () => paused());
    expect(await resume(store, io, ["--hint", "use the other config"])).toBe(0);
    expect(store.agent("ag_one")).toMatchObject({ desired: "RUN", hint: "use the other config" });
    expect(lines.join("\n")).toContain("resumes with your instruction");
  });

  it("resume --approve uses the suggestion", async () => {
    const { store, io } = setup();
    await store.updateAgent("ag_one", () => paused());
    expect(await resume(store, io, ["--approve"])).toBe(0);
    expect(store.agent("ag_one")).toMatchObject({ desired: "RUN", hint: "Stop re-running npm test." });
    expect(store.agent("ag_one")?.suggestion?.status).toBe("APPLIED");
  });

  it("plain resume continues with no instruction", async () => {
    const { store, io } = setup();
    await store.updateAgent("ag_one", () => paused());
    expect(await resume(store, io, [])).toBe(0);
    expect(store.agent("ag_one")?.hint).toBeUndefined();
  });

  it("rejects bad option combinations and an unknown option", async () => {
    const { store, io, errs } = setup();
    await store.updateAgent("ag_one", () => paused());
    expect(await resume(store, io, ["--approve", "--hint", "x"])).toBe(1);
    expect(await resume(store, io, ["--bogus"])).toBe(1);
    expect(await resume(store, io, ["--hint"])).toBe(1);
    expect(errs.length).toBe(3);
  });

  it("pause and stop pick the running agent by default", async () => {
    const { store, io } = setup();
    await store.updateAgent("ag_one", () => agent());
    expect(await pause(store, io, [])).toBe(0);
    expect(store.agent("ag_one")?.desired).toBe("PAUSE");
    expect(await stop(store, io, [])).toBe(0);
    expect(store.agent("ag_one")).toMatchObject({ desired: "KILL", status: "STOPPED" });
  });

  it("says so when nothing needs resuming", async () => {
    const { store, io, errs } = setup();
    await store.updateAgent("ag_one", () => agent());
    expect(await resume(store, io, [])).toBe(1);
    expect(errs[0]).toMatch(/Nothing to do/);
  });
});

describe("usage and alerts", () => {
  it("summarises usage with the estimate disclaimer", () => {
    const { store, io, lines } = setup();
    store.appendUsage({ ts: NOW - 1000, agentId: "ag_one", provider: "anthropic", model: "claude-sonnet-x", input_tokens: 2000, output_tokens: 500, cache_read_tokens: 0, latency_ms: 1, cost_usd: 0.0135 });
    expect(usage(store, io, ["--range", "24h"])).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("1 model calls");
    expect(text).toContain("$0.01");
    expect(text).toContain("estimates");
    expect(usage(store, io, ["--range", "1y"])).toBe(1);
  });

  it("lists unread alerts once, then marks them read", async () => {
    const { store, io, lines } = setup();
    store.appendNotification({ ts: NOW - 5000, title: "Claude Code was paused", body: "loop", level: "WARN" });
    await alerts(store, io, []);
    expect(lines.join("\n")).toContain("Claude Code was paused");
    lines.length = 0;
    await alerts(store, io, []);
    expect(lines.join("\n")).toBe("No unread alerts.");
    lines.length = 0;
    await alerts(store, io, ["--all"]);
    expect(lines.join("\n")).toContain("Claude Code was paused");
  });
});

describe("webhook command", () => {
  it("adds, lists, rejects a bad URL, and removes", async () => {
    const { store, io, lines, errs } = setup();
    const { webhook } = await import("./commands");
    expect(await webhook(store, io, ["add", "https://hooks.example.com/x"])).toBe(0);
    expect(await webhook(store, io, ["list"])).toBe(0);
    expect(lines.join("\n")).toContain("https://hooks.example.com/x");
    expect(await webhook(store, io, ["add", "nonsense"])).toBe(1);
    expect(await webhook(store, io, ["remove", "https://hooks.example.com/x"])).toBe(0);
    expect(store.config().webhooks).toEqual([]);
    expect(await webhook(store, io, ["test"])).toBe(1);
    expect(errs.join("\n")).toContain("No webhooks yet");
  });
});

describe("project, check", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const gitIn = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
  function proj() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proj-"));
    dirs.push(d);
    gitIn(d, "init", "-q");
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    fs.writeFileSync(path.join(d, "a.test.ts"), "// t\n");
    gitIn(d, "add", "-A");
    gitIn(d, "commit", "-q", "-m", "init");
    return d;
  }

  it("project: shows the commands, asks first, then remembers the answer", async () => {
    const { store, io, lines } = setup();
    const { project } = await import("./commands");
    const d = proj();
    await project(store, io, ["status"], d);
    expect(lines.join("\n")).toContain("npm test");
    expect(lines.join("\n")).toContain("Not allowed yet");
    lines.length = 0;
    expect(await project(store, io, ["allow"], d)).toBe(0);
    await project(store, io, ["status"], d);
    expect(lines.join("\n")).toContain("Allowed: ArgusOps may run");
    expect(await project(store, io, ["deny"], d)).toBe(0);
    lines.length = 0;
    await project(store, io, [], d);
    expect(lines.join("\n")).toContain("chose not to allow");
    expect(await project(store, io, ["bogus"], d)).toBe(1);
  });

  it("project allow refuses when there is nothing to run", async () => {
    const { store, io, errs } = setup();
    const { project } = await import("./commands");
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proj-"));
    dirs.push(empty);
    expect(await project(store, io, ["allow"], empty)).toBe(1);
    expect(errs[0]).toMatch(/Nothing to allow/);
  });

  it("check: reports problems since the last commit and exits 1 on a critical one", async () => {
    const { store, io, lines } = setup();
    const { check } = await import("./commands");
    const d = proj();
    fs.rmSync(path.join(d, "a.test.ts"));
    expect(await check(store, io, [], d)).toBe(1);
    expect(lines.join("\n")).toContain("Test files were deleted");
    expect(store.incidents()).toHaveLength(0); // a manual check does not raise alerts by itself
    expect(await check(store, io, ["--alert"], d)).toBe(1);
    expect(store.incidents()[0]?.kind).toBe("FINDING");
  });

  it("check: exits 0 when the changes are clean, and prints JSON on request", async () => {
    const { store, io, lines } = setup();
    const { check } = await import("./commands");
    const d = proj();
    fs.writeFileSync(path.join(d, "b.ts"), "export const x = 1;\n");
    expect(await check(store, io, ["--no-checks"], d)).toBe(0);
    expect(lines.join("\n")).toContain("No problems found");
    lines.length = 0;
    expect(await check(store, io, ["--json", "--no-checks"], d)).toBe(0);
    expect(JSON.parse(lines.join("\n")).changes.files[0].path).toBe("b.ts");
  });

  it("check: explains when there is no git repository or the commit is unknown", async () => {
    const { store, io, errs } = setup();
    const { check } = await import("./commands");
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proj-"));
    dirs.push(plain);
    expect(await check(store, io, [], plain)).toBe(1);
    expect(errs[0]).toContain("argus watch");
    expect(await check(store, io, ["--since", "nope"], proj())).toBe(1);
    expect(await check(store, io, ["--bogus"], plain)).toBe(1);
  });
});

describe("agents and disconnect", () => {
  const entry = { name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:47821" };
  const env = (home: string, probe: boolean) => ({ home, appdata: path.join(home, "AppData"), platform: "win32" as const, path: "", pathext: "", listProcesses: async () => [], probePort: async () => probe });
  function machine() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-agents-"));
    dirs.push(home);
    const userSettings = path.join(home, "AppData", "Code", "User", "settings.json");
    fs.mkdirSync(path.dirname(userSettings), { recursive: true });
    fs.writeFileSync(userSettings, JSON.stringify({ "editor.fontSize": 14, "claudeCode.environmentVariables": [entry] }));
    return { home, userSettings };
  }

  it("agents: lists what is installed", async () => {
    const { home } = machine();
    fs.mkdirSync(path.join(home, ".vscode", "extensions", "anthropic.claude-code-2.1.325-win32-x64"), { recursive: true });
    const { io, lines } = setup();
    const { agents } = await import("./commands");
    expect(await agents(io, env(home, false))).toBe(0);
    expect(lines.join("\n")).toContain("VS Code");
    expect(lines.join("\n")).toContain("Claude Code 2.1.325");
  });

  it("disconnect: removes a leftover entry whose proxy is gone, and keeps the user's other settings", async () => {
    const { home, userSettings } = machine();
    const { io, lines } = setup();
    const { disconnect } = await import("./commands");
    expect(await disconnect(io, [], env(home, false), home)).toBe(0);
    expect(JSON.parse(fs.readFileSync(userSettings, "utf8"))).toEqual({ "editor.fontSize": 14 });
    expect(lines.join("\n")).toContain("Removed http://127.0.0.1:47821");
    expect(lines.join("\n")).toContain("Reload the editor window");
  });

  it("disconnect: leaves a running proxy's entry alone unless forced", async () => {
    const { home, userSettings } = machine();
    const { io, lines } = setup();
    const { disconnect } = await import("./commands");
    await disconnect(io, [], env(home, true), home);
    expect(fs.readFileSync(userSettings, "utf8")).toContain("47821");
    expect(lines.join("\n")).toContain("is running");
    await disconnect(io, ["--force"], env(home, true), home);
    expect(fs.readFileSync(userSettings, "utf8")).not.toContain("47821");
  });

  it("disconnect: says so when there is nothing to do, and rejects unknown options", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-agents-"));
    dirs.push(home);
    const { io, lines, errs } = setup();
    const { disconnect } = await import("./commands");
    expect(await disconnect(io, [], env(home, false), home)).toBe(0);
    expect(lines.join("\n")).toContain("Nothing to clean up");
    expect(await disconnect(io, ["--nope"], env(home, false), home)).toBe(1);
    expect(errs[0]).toContain("Unknown option");
  });
});
