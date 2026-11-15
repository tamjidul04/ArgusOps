import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanChanges, summarizeFindings, worstSeverity, type Finding, type ScanOptions, type Severity } from "./findings";
import { consentState, detectGates, runGates, type ConsentState, type Gate, type GateResult } from "./gates";
import type { NotificationRow, Store } from "./store";
import { changesSince, diffSnapshots, takeSnapshot, type ChangeSet, type Snapshot } from "./workspace";

/**
 * Looks at one stretch of an agent's work: what changed, whether it shows signs of sloppiness, and (if you allowed it)
 * whether the project's own checks still pass. This is the same for every agent and every editor.
 */

export interface GateReport {
  state: ConsentState;
  /** What was found for this project, whether or not it may be run. */
  commands: Gate[];
  /** null when not run (no permission, none found, or turned off). */
  results: GateResult[] | null;
}

export interface CheckReport {
  root: string;
  at: number;
  changes: ChangeSet;
  findings: Finding[];
  gates: GateReport;
  /** The worst thing found, counting a failing check as serious. null when everything is fine. */
  worst: Severity | null;
}

export interface InspectOptions extends ScanOptions {
  runGates?: boolean;
  gateTimeoutMs?: number;
  now?: () => number;
}

/** Findings from a gate result: a failing check is a serious finding even if the agent said it was done. */
export function gateFindings(results: GateResult[]): Finding[] {
  return results
    .filter((r) => !r.ok)
    .map<Finding>((r) => ({
      code: `gate-${r.name}`,
      severity: r.name === "test" || r.name === "build" || r.name === "typecheck" ? "CRITICAL" : "WARN",
      title: r.timedOut ? `The ${r.name} check did not finish` : `The ${r.name} check fails`,
      detail: `\`${r.command}\` ${r.timedOut ? "ran out of time" : `exited with ${r.exitCode ?? "an error"}`}.`,
      evidence: r.outputTail ? r.outputTail.split("\n").slice(-6).map((l) => l.trim().slice(0, 160)).filter(Boolean) : [],
      files: [],
    }));
}

export async function inspectChanges(store: Store, root: string, changes: ChangeSet, opts: InspectOptions = {}): Promise<CheckReport> {
  const now = opts.now ?? Date.now;
  const findings = scanChanges(changes, opts);
  const commands = detectGates(root);
  const state: ConsentState = commands.length === 0 ? "unknown" : consentState(store, root, commands);
  let results: GateResult[] | null = null;
  if (opts.runGates !== false && state === "allowed") {
    results = await runGates(commands, root, { timeoutMs: opts.gateTimeoutMs });
    findings.push(...gateFindings(results));
  }
  const ranked = findings.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  return { root, at: now(), changes, findings: ranked, gates: { state, commands, results }, worst: worstSeverity(ranked) };
}

/** Inspects everything that changed since `before`. */
export async function inspectSince(store: Store, before: Snapshot, opts: InspectOptions = {}): Promise<CheckReport> {
  return inspectChanges(store, before.root, await changesSince(before), opts);
}

const RANK: Record<Severity, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/** Writes a report to the local history, and raises an alert when something needs attention. Returns the alert, if any. */
export function recordReport(store: Store, report: CheckReport, onNotification?: (n: NotificationRow) => void): NotificationRow | null {
  const worthy = report.findings.filter((f) => f.severity !== "INFO");
  if (worthy.length === 0) return null;
  const name = `Workspace ${path.basename(report.root) || report.root}`;
  const id = "ws_" + crypto.createHash("sha1").update(report.root).digest("hex").slice(0, 10);
  store.appendIncident({
    id: crypto.randomUUID(),
    ts: report.at,
    agentId: id,
    agentName: name,
    kind: "FINDING",
    action: "NONE",
    severity: report.worst === "CRITICAL" ? "CRITICAL" : "WARN",
    score: 0,
    detail: worthy.map((f) => f.title).join("; ").slice(0, 300),
    findings: report.findings,
  });
  const note = store.appendNotification({
    title: `${name}: ${worthy.length} problem${worthy.length === 1 ? "" : "s"} in the latest changes`,
    body: worthy.slice(0, 3).map((f) => f.title).join("; "),
    level: report.worst === "CRITICAL" ? "CRITICAL" : "WARN",
  });
  onNotification?.(note);
  return note;
}

/* -------------------------------- formatting -------------------------------- */

export function formatReport(r: CheckReport): string {
  const lines: string[] = [];
  const { changes } = r;
  lines.push(changes.files.length === 0 ? "No changes." : `${changes.files.length} file${changes.files.length === 1 ? "" : "s"} changed, +${changes.totalAdded} -${changes.totalRemoved}${changes.truncated ? " (at least)" : ""}.`);

  if (r.findings.length === 0) lines.push("", "No problems found in these changes.");
  else {
    lines.push("");
    for (const f of r.findings) {
      lines.push(`${f.severity === "CRITICAL" ? "!!" : f.severity === "WARN" ? "! " : "· "} ${f.title}`);
      lines.push(`   ${f.detail}`);
      for (const e of f.evidence) lines.push(`     ${e}`);
    }
  }

  lines.push("");
  const g = r.gates;
  if (g.results) {
    for (const x of g.results) lines.push(`${x.ok ? "ok    " : "FAILED"} ${x.name.padEnd(9)} ${x.command}  (${(x.durationMs / 1000).toFixed(1)}s)`);
  } else if (g.commands.length === 0) {
    lines.push("Checks: none found (no test, lint or build commands detected). Add them in .argusops.json if you want them run.");
  } else if (g.state === "denied") {
    lines.push("Checks were not run: you chose not to allow this project. Change that with: argus project allow");
  } else {
    lines.push(g.state === "changed" ? "Checks were not run: this project's commands changed since you allowed them." : "Checks were not run: ArgusOps has not been allowed to run this project's commands.");
    for (const c of g.commands) lines.push(`   ${c.name}: ${c.command}${c.body !== c.command ? `   (runs: ${c.body})` : ""}`);
    lines.push("   Review them, then allow with: argus project allow");
  }
  return lines.join("\n");
}

/* ----------------------------------- watch ----------------------------------- */

export interface WatchOptions extends InspectOptions {
  store: Store;
  root: string;
  /** Quiet time after the last file change before checking (the agent may still be writing). */
  debounceMs?: number;
  onReport: (report: CheckReport) => void;
  onNotification?: (n: NotificationRow) => void;
}

const IGNORED = /(^|[\\/])(\.git|node_modules|dist|build|out|\.next|coverage|target|venv|\.venv|__pycache__)([\\/]|$)/;

/**
 * Checks a folder whenever it settles after a burst of file changes, for any agent, including ones ArgusOps cannot
 * control. Each check covers only what changed since the previous one.
 */
export async function watchWorkspace(opts: WatchOptions): Promise<{ stop(): void }> {
  const debounce = opts.debounceMs ?? 5000;
  let baseline = await takeSnapshot(opts.root);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let again = false;
  let stopped = false;

  const check = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const after = await takeSnapshot(opts.root);
      const changes = await diffSnapshots(baseline, after);
      if (changes.files.length === 0) return;
      baseline = after; // the next check starts from here
      const report = await inspectChanges(opts.store, opts.root, changes, opts);
      recordReport(opts.store, report, opts.onNotification);
      if (!stopped) opts.onReport(report);
    } catch {
      // a check that fails (git busy, folder briefly locked) is simply tried again at the next change
    } finally {
      busy = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), debounce);
  };

  const watcher = fs.watch(opts.root, { recursive: true }, (_event, name) => {
    if (stopped || (name && IGNORED.test(name.toString()))) return;
    schedule();
  });
  watcher.on("error", () => undefined);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}

export { summarizeFindings };
