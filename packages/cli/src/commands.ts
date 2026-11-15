import { Controls } from "../../core/src/control";
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
