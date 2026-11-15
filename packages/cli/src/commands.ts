import fs from "node:fs";
import { resolve as resolvePath } from "node:path";
import { Controls } from "../../core/src/control";
import { allowProject, consentState, denyProject, detectGates } from "../../core/src/gates";
import { formatReport, inspectSince, recordReport, watchWorkspace } from "../../core/src/inspect";
import path from "node:path";
import { discover, formatDiscovery, knownEditors, realEnv, type Env } from "../../core/src/discover";
import { removeStaleEntry } from "../../core/src/ide-settings";
import { snapshotFromRef } from "../../core/src/workspace";
import { loadPrices } from "../../core/src/prices";
import type { AgentRecord, Store } from "../../core/src/store";
import { summarizeUsage } from "../../core/src/usage";
import { addWebhook, postWebhook, removeWebhook, webhookNotifier } from "../../core/src/webhooks";
import { parseRange } from "../../core/src/usage-core";

/** The commands that talk to ArgusOps' local store: status, pause, resume, stop, usage, alerts. */

export interface Io {
  out(text: string): void;
  err(text: string): void;
  now?: () => number;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const LABEL: Record<AgentRecord["status"], string> = { ACTIVE: "running", PAUSED: "PAUSED", STOPPED: "stopped", ENDED: "finished" };
/** A run that has not checked in for this long is treated as gone, whatever its record says. */
const STALE_MS = 30_000;

function labelOf(a: AgentRecord, now: number): string {
  if ((a.status === "ACTIVE" || a.status === "PAUSED") && now - a.lastSeen > STALE_MS) return a.status === "PAUSED" ? "PAUSED (not running)" : "not running";
  return LABEL[a.status];
}

/** Which agent does the user mean? An id prefix or part of the name; with no argument, the only sensible one. */
export function pickAgent(agents: AgentRecord[], query: string | undefined, prefer: (a: AgentRecord) => boolean): { ok: true; agent: AgentRecord } | { ok: false; error: string } {
  if (agents.length === 0) return { ok: false, error: "No agents yet. Start one with: argus run claude" };
  if (query) {
    const q = query.toLowerCase();
    const hits = agents.filter((a) => a.id.toLowerCase().startsWith(q) || a.name.toLowerCase().includes(q));
    if (hits.length === 1) return { ok: true, agent: hits[0] };
    if (hits.length === 0) return { ok: false, error: `No agent matches "${query}". See: argus status` };
    return { ok: false, error: `"${query}" matches ${hits.length} agents (${hits.map((a) => a.name).join(", ")}). Be more specific, or use the id.` };
  }
  const likely = agents.filter(prefer);
  if (likely.length === 1) return { ok: true, agent: likely[0] };
  if (likely.length === 0) return { ok: false, error: "Nothing to do: no agent is in the right state. See: argus status" };
  return { ok: false, error: `Several agents could be meant (${likely.map((a) => a.name).join(", ")}). Name one, e.g. argus resume ${likely[0].id}` };
}

export function status(store: Store, io: Io, json = false): number {
  const now = io.now?.() ?? Date.now();
  const agents = store.agents().sort((a, b) => b.lastSeen - a.lastSeen);
  const unread = store.notifications(200).filter((n) => !n.read).length;
  if (json) {
    io.out(JSON.stringify({ agents, unreadAlerts: unread }, null, 2));
    return 0;
  }
  if (agents.length === 0) {
    io.out("No agents yet. Start one with: argus run claude");
    return 0;
  }
  for (const a of agents) {
    io.out(`${a.name}   [${a.id}]`);
    io.out(`  ${labelOf(a, now)}  ·  ${formatTokens(a.tokensUsed)} tokens  ·  seen ${timeAgo(a.lastSeen, now)}`);
    if (a.hint && a.status !== "PAUSED") io.out(`  Waiting to be passed to the agent with your next message: ${a.hint.split("\n")[0].slice(0, 160)}`);
    if (a.status === "PAUSED") {
      if (a.reason) io.out(`  Why: ${a.reason}`);
      if (a.suggestion?.status === "PENDING") {
        io.out(`  Suggested instruction: ${a.suggestion.text}`);
        io.out(`  Approve it with: argus resume ${a.id} --approve   (or write your own: --hint "...")`);
      } else {
        io.out(`  Resume with: argus resume ${a.id}   Stop with: argus stop ${a.id}`);
      }
    }
    io.out("");
  }
  if (unread > 0) io.out(`${unread} unread alert${unread === 1 ? "" : "s"}. See: argus alerts`);
  return 0;
}

export async function pause(store: Store, io: Io, argv: string[]): Promise<number> {
  const picked = pickAgent(store.agents(), argv.find((a) => !a.startsWith("--")), (a) => a.status === "ACTIVE");
  if (!picked.ok) return (io.err(picked.error), 1);
  const r = await new Controls(store, webhookNotifier(store)).pause(picked.agent.id);
  r.ok ? io.out(r.message) : io.err(r.error);
  return r.ok ? 0 : 1;
}

export async function resume(store: Store, io: Io, argv: string[]): Promise<number> {
  let hint: string | undefined;
  let approve = false;
  let query: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") approve = true;
    else if (a === "--hint") {
      hint = argv[++i];
      if (!hint) return (io.err("--hint needs the instruction in quotes."), 1);
    } else if (a.startsWith("--hint=")) hint = a.slice(7);
    else if (a.startsWith("--")) return (io.err(`Unknown option ${a}.`), 1);
    else if (query === undefined) query = a;
    else return (io.err(`Unexpected "${a}". Put the instruction after --hint, in quotes.`), 1);
  }
  if (approve && hint) return (io.err("Use either --approve or --hint, not both."), 1);

  const picked = pickAgent(store.agents(), query, (a) => a.status === "PAUSED");
  if (!picked.ok) return (io.err(picked.error), 1);
  const controls = new Controls(store, webhookNotifier(store));
  const r = approve ? await controls.applySuggestion(picked.agent.id) : await controls.resume(picked.agent.id, hint);
  r.ok ? io.out(r.message) : io.err(r.error);
  return r.ok ? 0 : 1;
}

export async function stop(store: Store, io: Io, argv: string[]): Promise<number> {
  const picked = pickAgent(store.agents(), argv.find((a) => !a.startsWith("--")), (a) => a.status === "ACTIVE" || a.status === "PAUSED");
  if (!picked.ok) return (io.err(picked.error), 1);
  const r = await new Controls(store, webhookNotifier(store)).stop(picked.agent.id);
  r.ok ? io.out(r.message) : io.err(r.error);
  return r.ok ? 0 : 1;
}

export function usage(store: Store, io: Io, argv: string[]): number {
  let range = "7d";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--range") range = argv[++i] ?? "";
    else if (argv[i].startsWith("--range=")) range = argv[i].slice(8);
    else return (io.err(`Unknown option ${argv[i]}.`), 1);
  }
  if (!["24h", "7d", "30d"].includes(range)) return (io.err("--range must be 24h, 7d or 30d."), 1);
  const now = new Date(io.now?.() ?? Date.now());
  const s = summarizeUsage(store.usage(), store.incidents(), parseRange(range), now, loadPrices(store.root));
  const names = new Map(store.agents().map((a) => [a.id, a.name]));
  io.out(`Last ${range === "24h" ? "24 hours" : range === "7d" ? "7 days" : "30 days"}`);
  io.out(`  ${s.totals.calls} model calls · ${formatTokens(s.totals.inputTokens)} in · ${formatTokens(s.totals.outputTokens)} out`);
  io.out(`  Estimated cost at list prices: $${s.totals.costUsd.toFixed(2)}`);
  if (s.totals.cacheSavedUsd > 0) io.out(`  Estimated saved by prompt caching: $${s.totals.cacheSavedUsd.toFixed(2)}`);
  io.out(`  Loops caught: ${s.totals.loopsCaught}`);
  if (s.byModel.length) {
    io.out("  By model:");
    for (const m of s.byModel.slice(0, 6)) io.out(`    ${m.model}  ${m.calls} calls  ${formatTokens(m.inputTokens + m.outputTokens)} tokens  $${m.costUsd.toFixed(2)}`);
  }
  if (s.byAgent.length) {
    io.out("  By agent:");
    for (const a of s.byAgent.slice(0, 6)) io.out(`    ${names.get(a.agentId) ?? a.agentId}  ${a.calls} calls  ${formatTokens(a.inputTokens + a.outputTokens)} tokens  $${a.costUsd.toFixed(2)}`);
  }
  io.out("Costs are estimates from list prices (edit ~/.argusops/prices.json); your provider's bill is what counts.");
  return 0;
}

export async function alerts(store: Store, io: Io, argv: string[]): Promise<number> {
  const now = io.now?.() ?? Date.now();
  const all = argv.includes("--all");
  const list = store.notifications(all ? 100 : 30).filter((n) => all || !n.read);
  if (list.length === 0) {
    io.out(all ? "No alerts." : "No unread alerts.");
    return 0;
  }
  for (const n of list) io.out(`${n.read ? " " : "•"} ${n.level.padEnd(8)} ${timeAgo(n.ts, now).padEnd(9)} ${n.title}${n.body ? `: ${n.body}` : ""}`);
  await store.markNotificationsRead(list.map((n) => n.id));
  return 0;
}

export async function webhook(store: Store, io: Io, argv: string[]): Promise<number> {
  const [sub, target] = argv;
  if (sub === "add") {
    if (!target) return (io.err("Usage: argus webhook add <url>"), 1);
    const r = await addWebhook(store, target);
    if (!r.ok) return (io.err(r.error), 1);
    io.out(`Added. ArgusOps will post here when an agent pauses or stops. Try it: argus webhook test`);
    return 0;
  }
  if (sub === "remove") {
    if (!target) return (io.err("Usage: argus webhook remove <url>"), 1);
    if (!(await removeWebhook(store, target))) return (io.err("No webhook matches that."), 1);
    io.out("Removed.");
    return 0;
  }
  if (sub === "test") {
    const urls = store.config().webhooks;
    if (urls.length === 0) return (io.err("No webhooks yet. Add one: argus webhook add <url>"), 1);
    let failed = 0;
    for (const u of urls) {
      const r = await postWebhook(u, { title: "ArgusOps test", body: "If you can read this, alerts will reach you here.", level: "INFO" });
      io.out(`${r.ok ? "ok    " : "FAILED"} ${u}${r.ok ? "" : "  (" + r.error + ")"}`);
      if (!r.ok) failed++;
    }
    return failed ? 1 : 0;
  }
  if (sub === undefined || sub === "list") {
    const urls = store.config().webhooks;
    io.out(urls.length ? urls.join("\n") : "No webhooks. Add one (Slack, Discord or any URL): argus webhook add <url>");
    return 0;
  }
  io.err("Usage: argus webhook [list | add <url> | remove <url> | test]");
  return 1;
}

/* ------------------- checking an agent's work (any agent, any editor) ------------------- */

const rootOf = (argv: string[], cwd: string) => {
  const dir = argv.find((a) => !a.startsWith("--"));
  return dir ? resolvePath(cwd, dir) : cwd;
};

export async function project(store: Store, io: Io, argv: string[], cwd = process.cwd()): Promise<number> {
  const [sub = "status", ...rest] = argv;
  const root = rootOf(rest, cwd);
  const gates = detectGates(root);
  if (sub === "status") {
    io.out(`Project: ${root}`);
    if (gates.length === 0) io.out("No test, lint or build commands detected (you can list them in .argusops.json).");
    for (const g of gates) io.out(`  ${g.name.padEnd(9)} ${g.command}${g.body !== g.command ? `   (runs: ${g.body})` : ""}`);
    if (gates.length) {
      const state = consentState(store, root, gates);
      io.out(
        state === "allowed" ? "Allowed: ArgusOps may run these after an agent's turn." : state === "changed" ? "These commands changed since you allowed them. Review them, then run: argus project allow" : state === "denied" ? "You chose not to allow this project. Change that with: argus project allow" : "Not allowed yet. ArgusOps will not run anything until you say so: argus project allow"
      );
    }
    return 0;
  }
  if (sub === "allow") {
    if (gates.length === 0) return (io.err("Nothing to allow: no test, lint or build commands were found in this folder."), 1);
    await allowProject(store, root, gates);
    io.out("Allowed. After an agent's turn, ArgusOps may run:");
    for (const g of gates) io.out(`  ${g.command}${g.body !== g.command ? `   (runs: ${g.body})` : ""}`);
    io.out("If these commands change you will be asked again.");
    return 0;
  }
  if (sub === "deny") {
    await denyProject(store, root);
    io.out("ArgusOps will not run anything in this project.");
    return 0;
  }
  io.err("Usage: argus project [status | allow | deny] [folder]");
  return 1;
}

export async function check(store: Store, io: Io, argv: string[], cwd = process.cwd()): Promise<number> {
  let since = "HEAD";
  let runChecks = true;
  let json = false;
  let alert = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") {
      since = argv[++i] ?? "";
      if (!since) return (io.err("--since needs a commit or branch name."), 1);
    } else if (a.startsWith("--since=")) since = a.slice(8);
    else if (a === "--no-checks" || a === "--no-gates") runChecks = false;
    else if (a === "--json") json = true;
    else if (a === "--alert") alert = true;
    else if (a.startsWith("--")) return (io.err(`Unknown option ${a}.`), 1);
    else rest.push(a);
  }
  const root = rootOf(rest, cwd);
  const baseline = await snapshotFromRef(root, since);
  if (!baseline) return (io.err(`Can't compare against "${since}": this needs a git repository (and that commit). To watch any folder instead, use: argus watch`), 1);
  const report = await inspectSince(store, baseline, { runGates: runChecks });
  if (alert) recordReport(store, report, webhookNotifier(store)); // a manual check shows its result here; alerts only when asked
  io.out(json ? JSON.stringify(report, null, 2) : `Changes since ${since} in ${report.root}\n\n${formatReport(report)}`);
  return report.worst === "CRITICAL" ? 1 : 0;
}

/** Runs until `signal` aborts (Ctrl+C in the real command). */
export async function watch(store: Store, io: Io, argv: string[], signal: AbortSignal, cwd = process.cwd(), debounceMs = 5000): Promise<number> {
  const root = rootOf(argv, cwd);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return (io.err(`"${root}" is not a folder.`), 1);
  const w = await watchWorkspace({
    store,
    root,
    debounceMs,
    onNotification: webhookNotifier(store),
    onReport: (r) => io.out(`\n[${new Date(r.at).toLocaleTimeString()}] ${formatReport(r)}`),
  });
  io.out(`Watching ${root}. After files settle for ${Math.round(debounceMs / 1000)}s, ArgusOps checks what changed. Press Ctrl+C to stop.`);
  await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
  w.stop();
  return 0;
}

export async function supervisor(store: Store, io: Io, argv: string[]): Promise<number> {
  let mode: "off" | "alert" | "redirect" | undefined;
  let maxTurnTokens: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "off" || a === "alert" || a === "redirect") mode = a;
    else if (a === "--max-turn-tokens" || a.startsWith("--max-turn-tokens=")) {
      const v = Number(a.includes("=") ? a.split("=")[1] : argv[++i]);
      if (!Number.isInteger(v) || v < 0) return (io.err("--max-turn-tokens must be a whole number (0 = no limit)."), 1);
      maxTurnTokens = v;
    } else return (io.err(`Unknown option ${a}. Usage: argus supervisor [off|alert|redirect] [--max-turn-tokens <n>]`), 1);
  }
  if (mode !== undefined || maxTurnTokens !== undefined) {
    const cur = store.config().supervisor;
    await store.saveConfig({ supervisor: { ...cur, ...(mode ? { mode } : {}), ...(maxTurnTokens !== undefined ? { maxTurnTokens } : {}) } });
  }
  const c = store.config().supervisor;
  const what = c.mode === "off" ? "off: no checks after the agent's turns" : c.mode === "alert" ? "alert: checks each turn and tells you what it found" : "redirect: checks each turn, tells you, and tells the agent what to fix (with your next message)";
  io.out(`Supervisor: ${what}.`);
  io.out(`Token limit per turn: ${c.maxTurnTokens ? c.maxTurnTokens.toLocaleString("en-US") : "none"}.`);
  if (c.mode === "redirect") io.out(`Redirects: at most one per turn, ${Math.round(c.redirectCooldownMs / 60000)} min apart, and it stops after ${c.maxRedirectsInARow} in a row.`);
  return 0;
}

/* ---------------------------- agents on this machine ---------------------------- */

export async function agents(io: Io, env: Env = realEnv(), home?: string): Promise<number> {
  const names = Object.fromEntries(knownEditors(env).map((e) => [e.id, e.name]));
  io.out(formatDiscovery(await discover(env, home), names));
  return 0;
}

/** Removes ArgusOps' leftover setting from editors (and this folder) when the proxy it points at is gone. */
export async function disconnect(io: Io, argv: string[], env: Env = realEnv(), cwd = process.cwd()): Promise<number> {
  const force = argv.includes("--force");
  const bad = argv.find((a) => a !== "--force");
  if (bad) return (io.err(`Unknown option ${bad}. Usage: argus disconnect [--force]`), 1);
  const files = [path.join(cwd, ".vscode", "settings.json"), ...knownEditors(env).flatMap((e) => e.settingsDirs.map((d) => path.join(d, "settings.json")))];
  let touched = 0;
  for (const f of [...new Set(files)]) {
    const r = await removeStaleEntry(f, env.probePort, force);
    if (r.action === "removed") {
      touched++;
      io.out(`Removed ${r.url} from ${f}`);
    } else if (r.action === "kept-live") io.out(`Kept ${f}: ${r.url} is running. Use --force to remove it anyway.`);
    else if (r.action === "needs-manual") {
      touched++;
      io.out(`${f} has comments, so ArgusOps will not edit it. Delete the ANTHROPIC_BASE_URL entry pointing at ${r.url} yourself.`);
    }
  }
  if (touched === 0) io.out("Nothing to clean up: no editor is pointed at a proxy that is gone.");
  else io.out("Reload the editor window so the agent picks up the change.");
  return 0;
}
