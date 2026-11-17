import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadRegistry, type AgentEntry } from "./registry";

/**
 * Finds the AI coding agents on this machine: which editors are installed, which agent extensions are in them, which
 * agent programs are running (and in which editor), and which editor panels are already routed through ArgusOps.
 * Read-only: it never changes a setting.
 */

export interface EditorDef {
  id: string;
  name: string;
  extensionsDirs: string[];
  /** Folders (each holding settings.json) of this editor's user settings. */
  settingsDirs: string[];
  /** Process names (lower case, no .exe) of the editor itself. */
  processNames: string[];
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
}

export interface Env {
  home: string;
  appdata: string;
  platform: NodeJS.Platform;
  path: string;
  pathext: string;
  listProcesses: () => Promise<ProcessInfo[]>;
  probePort: (port: number) => Promise<boolean>;
}

export function realEnv(): Env {
  return {
    home: os.homedir(),
    appdata: process.env.APPDATA ?? "",
    platform: process.platform,
    path: process.env.PATH ?? process.env.Path ?? "",
    pathext: process.env.PATHEXT ?? ".EXE;.CMD;.BAT",
    listProcesses,
    probePort,
  };
}

/* --------------------------------- editors ---------------------------------- */

export function knownEditors(env: Pick<Env, "home" | "appdata" | "platform">): EditorDef[] {
  const settingsRoot = (folder: string) => (env.platform === "win32" ? path.join(env.appdata, folder, "User") : env.platform === "darwin" ? path.join(env.home, "Library", "Application Support", folder, "User") : path.join(env.home, ".config", folder, "User"));
  const ext = (dir: string) => path.join(env.home, dir, "extensions");
  return [
    { id: "vscode", name: "VS Code", extensionsDirs: [ext(".vscode")], settingsDirs: [settingsRoot("Code")], processNames: ["code"] },
    { id: "vscode-insiders", name: "VS Code Insiders", extensionsDirs: [ext(".vscode-insiders")], settingsDirs: [settingsRoot("Code - Insiders")], processNames: ["code - insiders"] },
    { id: "vscodium", name: "VSCodium", extensionsDirs: [ext(".vscode-oss")], settingsDirs: [settingsRoot("VSCodium")], processNames: ["vscodium"] },
    { id: "cursor", name: "Cursor", extensionsDirs: [ext(".cursor")], settingsDirs: [settingsRoot("Cursor")], processNames: ["cursor"] },
    { id: "windsurf", name: "Windsurf", extensionsDirs: [ext(".windsurf")], settingsDirs: [settingsRoot("Windsurf")], processNames: ["windsurf"] },
    {
      id: "antigravity",
      name: "Antigravity",
      extensionsDirs: [ext(".antigravity-ide"), ext(".antigravity")],
      settingsDirs: [settingsRoot("Antigravity IDE"), settingsRoot("Antigravity")],
      processNames: ["antigravity ide", "antigravity"],
    },
  ];
}

/** Extension ids and versions installed in one extensions folder, honouring the editor's own "installed" list and removal marks. */
export function installedExtensions(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return found;
  }
  let obsolete = new Set<string>();
  try {
    obsolete = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, ".obsolete"), "utf8"))));
  } catch {
    // none marked
  }
  let registered: Set<string> | null = null;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, "extensions.json"), "utf8")) as Array<{ identifier?: { id?: string }; relativeLocation?: string }>;
    registered = new Set(list.map((e) => (e.relativeLocation ?? "").toLowerCase()).filter(Boolean));
  } catch {
    // no list: fall back to the folders themselves
  }
  for (const name of names) {
    if (name.startsWith(".") || name === "extensions.json" || obsolete.has(name)) continue;
    if (registered && !registered.has(name.toLowerCase())) continue; // a leftover folder the editor no longer counts as installed
    const m = /^([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*?)-(\d+\.\d+\.\d+[^-]*)(?:-[a-z0-9_-]+)?$/i.exec(name);
    if (!m) continue;
    const id = m[1].toLowerCase();
    const prev = found.get(id);
    if (!prev || compareVersions(m[2], prev) > 0) found.set(id, m[2]);
  }
  return found;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/* ------------------------------ settings reading ----------------------------- */

/** Parses settings.json, which editors allow to contain comments and trailing commas. Returns null if it cannot be read. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

export interface Connection {
  /** Where the editor's agent has been pointed (the value of its base-URL variable). */
  url: string;
  /** Set when the URL is a port on this machine. */
  port: number | null;
  /** Is something listening there right now? false means the setting is stale and the agent cannot connect. */
  live: boolean | null;
}

/** Is this agent in this editor pointed anywhere through the user's settings? */
export async function readConnection(entry: AgentEntry, settingsDirs: string[], probe: (port: number) => Promise<boolean>): Promise<Connection | null> {
  if (!entry.connect) return null;
  for (const dir of settingsDirs) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
    } catch {
      continue;
    }
    const parsed = parseJsonc(text) as Record<string, unknown> | null;
    const list = parsed?.[entry.connect.setting];
    if (!Array.isArray(list)) continue;
    const hit = (list as Array<{ name?: string; value?: string }>).find((e) => e?.name === entry.connect!.envVar && typeof e.value === "string");
    if (!hit?.value) continue;
    const m = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/.exec(hit.value);
    const port = m ? Number(m[1]) : null;
    return { url: hit.value, port, live: port === null ? null : await probe(port) };
  }
  return null;
}

/* ---------------------------------- processes -------------------------------- */

export function listProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
        { timeout: 20_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve([]);
          try {
            const rows = JSON.parse(stdout.toString()) as Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null }> | { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null };
            resolve((Array.isArray(rows) ? rows : [rows]).map((r) => ({ pid: r.ProcessId, ppid: r.ParentProcessId, name: r.Name ?? "", cmd: r.CommandLine ?? "" })));
          } catch {
            resolve([]);
          }
        }
      );
    } else {
      execFile("ps", ["-eo", "pid=,ppid=,comm=,args="], { timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .toString()
            .split("\n")
            .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(l))
            .filter((m): m is RegExpExecArray => !!m)
            .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: path.basename(m[3]), cmd: m[4] }))
        );
      });
    }
  });
}

export function probePort(port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const stripExe = (n: string) => n.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");

export interface RunningAgent {
  agentId: string;
  name: string;
  pid: number;
  /** The editor this process belongs to, found by following its parent processes. null = started from a terminal or elsewhere. */
  editorId: string | null;
}

/** Which of these processes are agents, and which editor started each. Pure. */
export function attributeProcesses(procs: ProcessInfo[], registry: AgentEntry[], editors: EditorDef[]): RunningAgent[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const editorOf = (p: ProcessInfo): string | null => {
    let cur: ProcessInfo | undefined = p;
    for (let i = 0; i < 12 && cur; i++) {
      const name = stripExe(cur.name);
      const ed = editors.find((e) => e.processNames.includes(name));
      if (ed && cur.pid !== p.pid) return ed.id;
      cur = byPid.get(cur.ppid);
    }
    return null;
  };
  const out: RunningAgent[] = [];
  for (const p of procs) {
    const name = stripExe(p.name);
    for (const a of registry) {
      const byBinary = a.binaries.includes(name);
      // an agent shipped inside its extension folder is recognised by that path too (e.g. ...\anthropic.claude-code-2.1.325\...\claude.exe)
      const byFolder = a.extensionIds.some((id) => p.cmd.toLowerCase().includes(`${id.toLowerCase()}-`)) && /native-binary|\bbin\b/i.test(p.cmd);
      if (byBinary || byFolder) {
        out.push({ agentId: a.id, name: a.name, pid: p.pid, editorId: editorOf(p) });
        break;
      }
    }
  }
  return out;
}

/* ----------------------------------- report ---------------------------------- */

export interface DiscoveredExtension {
  entry: AgentEntry;
  version: string;
  connection: Connection | null;
}

export interface DiscoveredEditor {
  id: string;
  name: string;
  extensions: DiscoveredExtension[];
}

export interface DiscoveryReport {
  editors: DiscoveredEditor[];
  /** Agent programs found on PATH (command-line agents). */
  cli: Array<{ entry: AgentEntry; path: string }>;
  running: RunningAgent[];
}

function findOnPath(name: string, env: Pick<Env, "path" | "pathext" | "platform">): string | null {
  const dirs = env.path.split(env.platform === "win32" ? ";" : ":").filter(Boolean);
  const exts = env.platform === "win32" ? ["", ...env.pathext.split(";").filter(Boolean)] : [""];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e.toLowerCase());
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}

export async function discover(env: Env = realEnv(), home?: string): Promise<DiscoveryReport> {
  const registry = loadRegistry(home);
  const editors = knownEditors(env);
  const found: DiscoveredEditor[] = [];

  for (const ed of editors) {
    const installed = new Map<string, string>();
    for (const dir of ed.extensionsDirs) for (const [id, v] of installedExtensions(dir)) installed.set(id, v);
    const exts: DiscoveredExtension[] = [];
    for (const entry of registry) {
      const id = entry.extensionIds.map((x) => x.toLowerCase()).find((x) => installed.has(x));
      if (!id) continue;
      exts.push({ entry, version: installed.get(id)!, connection: await readConnection(entry, ed.settingsDirs, env.probePort) });
    }
    if (exts.length) found.push({ id: ed.id, name: ed.name, extensions: exts });
  }

  const cli: DiscoveryReport["cli"] = [];
  for (const entry of registry) {
    for (const b of entry.binaries) {
      const p = findOnPath(b, env);
      if (p) {
        cli.push({ entry, path: p });
        break;
      }
    }
  }

  const running = attributeProcesses(await env.listProcesses(), registry, editors);
  return { editors: found, cli, running };
}

const SUPPORT_LABEL: Record<string, string> = { supported: "full supervision (proven)", possible: "should be routable; not proven yet", observe: "watch only (argus watch / check)" };

export function formatDiscovery(r: DiscoveryReport, editorNames: Record<string, string> = {}): string {
  const lines: string[] = [];
  const nameOf = (id: string | null) => (id ? editorNames[id] ?? id : "a terminal");
  if (r.editors.length === 0 && r.cli.length === 0) lines.push("No known AI coding agents found on this machine.");
  for (const ed of r.editors) {
    lines.push(`${ed.name}`);
    for (const x of ed.extensions) {
      lines.push(`  ${x.entry.name} ${x.version}   [${SUPPORT_LABEL[x.entry.support]}]`);
      if (x.connection) {
        lines.push(
          x.connection.live === false
            ? `    ! Pointed at ${x.connection.url}, but nothing is listening there. Its panel will fail to connect. Fix: argus disconnect`
            : `    Routed through ArgusOps (${x.connection.url})${x.connection.live ? "" : ""}`
        );
      } else if (x.entry.connect) lines.push("    Not routed through ArgusOps. Connect with: argus ide (in your project folder)");
      lines.push(`    ${x.entry.note}`);
    }
  }
  if (r.cli.length) {
    lines.push("", "Command-line agents");
    for (const c of r.cli) lines.push(`  ${c.entry.name}   ${c.path}   [${SUPPORT_LABEL[c.entry.support]}]`, `    ${c.entry.note}`);
  }
  if (r.running.length) {
    lines.push("", "Running now");
    for (const a of r.running) lines.push(`  ${a.name} (process ${a.pid}), started by ${nameOf(a.editorId)}`);
  }
  return lines.join("\n");
}
