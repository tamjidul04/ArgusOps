import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attributeProcesses, discover, formatDiscovery, installedExtensions, knownEditors, parseJsonc, readConnection, type Env, type ProcessInfo } from "./discover";
import { BUILT_IN_AGENTS, loadRegistry } from "./registry";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-disc-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mk = (p: string, text = "") => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

/** A pretend machine: Windows, VS Code with Claude Code and a leftover, Antigravity with Roo Code. */
function machine() {
  const home = tmp();
  const appdata = path.join(home, "AppData", "Roaming");
  const vsx = path.join(home, ".vscode", "extensions");
  fs.mkdirSync(path.join(vsx, "anthropic.claude-code-2.1.319-win32-x64"), { recursive: true });
  fs.mkdirSync(path.join(vsx, "anthropic.claude-code-2.1.325-win32-x64"), { recursive: true });
  fs.mkdirSync(path.join(vsx, "tamjidul04.leftover-0.4.0"), { recursive: true });
  mk(path.join(vsx, "extensions.json"), JSON.stringify([{ relativeLocation: "anthropic.claude-code-2.1.325-win32-x64" }]));
  mk(path.join(vsx, ".obsolete"), JSON.stringify({ "anthropic.claude-code-2.1.319-win32-x64": true }));
  const agx = path.join(home, ".antigravity-ide", "extensions");
  fs.mkdirSync(path.join(agx, "rooveterinaryinc.roo-cline-3.54.0-universal"), { recursive: true });
  fs.mkdirSync(path.join(agx, "ms-python.python-2025.1.0-win32-x64"), { recursive: true });
  const env = (over: Partial<Env> = {}): Env => ({ home, appdata, platform: "win32", path: "", pathext: ".EXE", listProcesses: async () => [], probePort: async () => false, ...over });
  return { home, appdata, env };
}

describe("parseJsonc", () => {
  it("reads settings with comments, trailing commas and slashes inside strings", () => {
    const v = parseJsonc('{\n // a comment\n "url": "http://127.0.0.1:47821", /* x */ "list": [1, 2,],\n}') as Record<string, unknown>;
    expect(v.url).toBe("http://127.0.0.1:47821");
    expect(v.list).toEqual([1, 2]);
  });
  it("returns null for garbage", () => {
    expect(parseJsonc("{ nope")).toBeNull();
  });
});

describe("installedExtensions", () => {
  it("trusts the editor's own list: leftovers and removed versions do not count, newest version wins", () => {
    const { home } = machine();
    const found = installedExtensions(path.join(home, ".vscode", "extensions"));
    expect([...found.entries()]).toEqual([["anthropic.claude-code", "2.1.325"]]);
  });
  it("without a list, uses the folders and picks the newest", () => {
    const { home } = machine();
    const found = installedExtensions(path.join(home, ".antigravity-ide", "extensions"));
    expect(found.get("rooveterinaryinc.roo-cline")).toBe("3.54.0");
    expect(found.get("ms-python.python")).toBe("2025.1.0");
  });
  it("handles a missing folder", () => {
    expect(installedExtensions(path.join(tmp(), "nope")).size).toBe(0);
  });
});

describe("registry", () => {
  it("only claims 'supported' for what has been proven", () => {
    expect(BUILT_IN_AGENTS.filter((a) => a.support === "supported").map((a) => a.id)).toEqual(["claude-code"]);
  });
  it("lets users add agents but never grants 'supported' or a settings-writing recipe", () => {
    const home = tmp();
    mk(
      path.join(home, "agents.json"),
      JSON.stringify([
        { id: "my-agent", name: "My Agent", extensionIds: ["me.agent"], binaries: ["myagent"], support: "supported", note: "x", connect: { kind: "vscode-env", setting: "evil", envVar: "X" } },
        { id: "bad id!", name: "Bad", extensionIds: [], binaries: [], support: "possible", note: "x" },
        { id: "codex", name: "Codex (mine)", extensionIds: [], binaries: ["codex"], support: "observe", note: "mine" },
      ])
    );
    const reg = loadRegistry(home);
    const mine = reg.find((a) => a.id === "my-agent")!;
    expect(mine.support).toBe("possible");
    expect(mine.connect).toBeUndefined();
    expect(reg.some((a) => a.id === "bad id!")).toBe(false);
    expect(reg.find((a) => a.id === "codex")?.name).toBe("Codex (mine)"); // a matching id replaces the built-in
    expect(reg.filter((a) => a.id === "codex")).toHaveLength(1);
  });
});

describe("attributeProcesses", () => {
  const editors = knownEditors({ home: "C:/h", appdata: "C:/a", platform: "win32" });
  const registry = loadRegistry();
  const procs: ProcessInfo[] = [
    { pid: 1, ppid: 0, name: "explorer.exe", cmd: "" },
    { pid: 10, ppid: 1, name: "Antigravity IDE.exe", cmd: "" },
    { pid: 11, ppid: 10, name: "Antigravity IDE.exe", cmd: "--type=renderer" },
    { pid: 12, ppid: 11, name: "claude.exe", cmd: "C:\\Users\\x\\.antigravity-ide\\extensions\\anthropic.claude-code-2.1.325-win32-x64\\resources\\native-binary\\claude.exe --output-format stream-json" },
    { pid: 20, ppid: 1, name: "WindowsTerminal.exe", cmd: "" },
    { pid: 21, ppid: 20, name: "claude.exe", cmd: "claude" },
    { pid: 30, ppid: 1, name: "notepad.exe", cmd: "" },
  ];
  it("finds agent programs and names the editor that started each", () => {
    const r = attributeProcesses(procs, registry, editors);
    expect(r.map((x) => [x.agentId, x.pid, x.editorId])).toEqual([
      ["claude-code", 12, "antigravity"],
      ["claude-code", 21, null],
    ]);
  });
  it("copes with a process loop in the data", () => {
    const loop: ProcessInfo[] = [{ pid: 5, ppid: 6, name: "claude.exe", cmd: "" }, { pid: 6, ppid: 5, name: "x.exe", cmd: "" }];
    expect(attributeProcesses(loop, registry, editors)).toEqual([{ agentId: "claude-code", name: "Claude Code", pid: 5, editorId: null }]);
  });
});

describe("readConnection", () => {
  const claude = BUILT_IN_AGENTS[0];
  const settings = (dir: string, text: string) => mk(path.join(dir, "settings.json"), text);

  it("reports a live connection, and a stale one whose proxy is gone", async () => {
    const dir = tmp();
    settings(dir, '{ // mine\n "claudeCode.environmentVariables": [{"name":"ANTHROPIC_BASE_URL","value":"http://127.0.0.1:47821"}] }');
    expect(await readConnection(claude, [dir], async () => true)).toEqual({ url: "http://127.0.0.1:47821", port: 47821, live: true });
    expect((await readConnection(claude, [dir], async () => false))?.live).toBe(false);
  });
  it("is null when nothing is set, the file is missing, or the URL points elsewhere on purpose", async () => {
    const dir = tmp();
    expect(await readConnection(claude, [dir], async () => true)).toBeNull();
    settings(dir, '{ "claudeCode.environmentVariables": [{"name":"FOO","value":"1"}] }');
    expect(await readConnection(claude, [dir], async () => true)).toBeNull();
    settings(dir, '{ "claudeCode.environmentVariables": [{"name":"ANTHROPIC_BASE_URL","value":"https://gateway.example.com"}] }');
    expect(await readConnection(claude, [dir], async () => true)).toEqual({ url: "https://gateway.example.com", port: null, live: null });
  });
});

describe("discover", () => {
  it("lists editors with their agent extensions, ignoring other extensions and leftovers", async () => {
    const m = machine();
    const r = await discover(m.env());
    expect(r.editors.map((e) => [e.name, e.extensions.map((x) => `${x.entry.id}@${x.version}`)])).toEqual([
      ["VS Code", ["claude-code@2.1.325"]],
      ["Antigravity", ["roo-code@3.54.0"]],
    ]);
  });

  it("shows a stale connection and says how to fix it", async () => {
    const m = machine();
    mk(path.join(m.appdata, "Code", "User", "settings.json"), '{ "claudeCode.environmentVariables": [{"name":"ANTHROPIC_BASE_URL","value":"http://127.0.0.1:47821"}] }');
    const r = await discover(m.env({ probePort: async () => false }));
    expect(r.editors[0].extensions[0].connection?.live).toBe(false);
    expect(formatDiscovery(r)).toContain("nothing is listening there");
    expect(formatDiscovery(r)).toContain("argus disconnect");
    const live = await discover(m.env({ probePort: async () => true }));
    expect(formatDiscovery(live)).toContain("Routed through ArgusOps");
  });

  it("finds command-line agents on PATH and running agents", async () => {
    const m = machine();
    const bin = path.join(m.home, "bin");
    mk(path.join(bin, "claude.exe"), "x");
    const r = await discover(m.env({ path: bin, listProcesses: async () => [{ pid: 9, ppid: 0, name: "claude.exe", cmd: "claude" }] }));
    expect(r.cli.map((c) => c.entry.id)).toEqual(["claude-code"]);
    expect(r.running).toHaveLength(1);
    const text = formatDiscovery(r);
    expect(text).toContain("Command-line agents");
    expect(text).toContain("Running now");
  });

  it("explains each agent's support level honestly in the report", async () => {
    const m = machine();
    const text = formatDiscovery(await discover(m.env()), { vscode: "VS Code" });
    expect(text).toContain("full supervision (proven)");
    expect(text).toContain("should be routable; not proven yet");
    expect(text).toContain("Connect with: argus ide");
  });

  it("says so when nothing is found", async () => {
    const empty = tmp();
    const r = await discover({ home: empty, appdata: empty, platform: "win32", path: "", pathext: "", listProcesses: async () => [], probePort: async () => false });
    expect(formatDiscovery(r)).toContain("No known AI coding agents");
  });
});
