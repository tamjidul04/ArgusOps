import { TABS, TAB_LABEL, MODES, type View } from "./keys";
import { clean, isGone, isWaiting, type Data } from "./model";

/** A piece of a line and how to draw it. */
interface Seg {
  t: string;
  s?: "bold" | "dim" | "inverse" | "red" | "green" | "yellow" | "blue" | "teal";
}
type Line = Seg[];

const ESC = String.fromCharCode(27);
const CODE: Record<NonNullable<Seg["s"]>, string> = { bold: "1", dim: "2", inverse: "7", red: "31", green: "32", yellow: "33", blue: "34", teal: "36" };

const seg = (t: string, s?: Seg["s"]): Seg => ({ t, s });
const plain = (t: string): Line => [seg(t)];

/** Draws one line, cut to the width of the terminal so nothing wraps and breaks the layout. */
export function paint(line: Line, cols: number): string {
  let left = Math.max(0, cols);
  let out = "";
  for (const { t, s } of line) {
    if (left <= 0) break;
    let text = clean(t);
    if (text.length > left) text = left > 1 ? text.slice(0, left - 1) + "…" : text.slice(0, left);
    left -= text.length;
    out += s ? `${ESC}[${CODE[s]}m${text}${ESC}[0m` : text;
  }
  return out;
}

/** The text of a line without styling (for tests and for measuring). */
export const visible = (line: Line) => line.map((x) => clean(x.t)).join("");

function wrap(text: string, width: number, indent = ""): Line[] {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const room = Math.max(10, width - indent.length);
  for (const w of words) {
    if (cur && (cur + " " + w).length > room) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
    while (cur.length > room) {
      lines.push(cur.slice(0, room));
      cur = cur.slice(room);
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => plain(indent + l));
}

export const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));
export const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : "$" + n.toFixed(2));
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

/** Keeps the selected row on screen when a list is longer than the room for it. */
function window<T>(items: T[], sel: number, room: number): Array<{ item: T; index: number }> {
  const n = Math.max(1, room);
  const start = Math.max(0, Math.min(sel - Math.floor(n / 2), items.length - n));
  return items.slice(start, start + n).map((item, k) => ({ item, index: start + k }));
}

const STATUS = (a: Data["agents"][number], now: number): Seg => {
  if (isGone(a, now)) return seg(a.status === "PAUSED" ? "paused (not running)" : "not running", "dim");
  if (a.status === "ACTIVE") return seg("running", "green");
  if (a.status === "PAUSED") return seg("PAUSED", "yellow");
  if (a.status === "STOPPED") return seg("stopped", "red");
  return seg("finished", "dim");
};
const AP: Record<string, [string, Seg["s"]]> = { planning: ["planning", "teal"], "awaiting-answers": ["has questions", "yellow"], "awaiting-approval": ["waiting for approval", "yellow"], running: ["running", "green"], paused: ["paused", "yellow"], "needs-you": ["needs you", "yellow"], done: ["done", "green"], stopped: ["stopped", "red"], failed: ["failed", "red"] };

/** One summary tile: a small box with a number and what it counts. */
function tiles(items: Array<{ n: string; label: string; color: Seg["s"] }>, cols: number): Line[] {
  if (cols < 72) return items.map((x) => [seg("  " + x.n.padEnd(8), x.color), seg(x.label, "dim")]);
  const w = Math.floor((cols - 2) / items.length);
  const inner = w - 3;
  const cut = (t: string) => (t.length > inner ? t.slice(0, inner - 1) + "…" : t).padEnd(inner);
  const row = (f: (x: (typeof items)[number]) => Seg) => {
    const line: Line = [seg("  ")];
    for (const x of items) {
      line.push(seg("│ ", x.color), f(x), seg(" ".repeat(Math.max(0, w - 2 - inner)), undefined));
    }
    return line;
  };
  const edge = (l: string, r: string) => {
    const line: Line = [seg("  ")];
    for (const x of items) line.push(seg(l + "─".repeat(inner + 1) + r + " ".repeat(Math.max(0, w - inner - 3)), x.color));
    return line;
  };
  return [edge("╭", "╮"), row((x) => seg(cut(x.n), "bold")), row((x) => seg(cut(x.label), "dim")), edge("╰", "╯")];
}

function overviewBody(v: View, d: Data, cols: number): Line[] {
  const running = d.agents.filter((a) => a.status === "ACTIVE" && !isGone(a, d.now)).length;
  const waiting = d.agents.filter((a) => isWaiting(a, d.now));
  const asking = d.runs.filter((r) => r.status === "needs-you" || r.status === "awaiting-approval" || r.status === "awaiting-answers");
  const t = d.usage.totals;
  const out: Line[] = [plain("")];
  out.push(
    ...tiles(
      [
        { n: String(running), label: "agents running", color: "teal" },
        { n: String(waiting.length + asking.length), label: "waiting for you", color: "yellow" },
        { n: fmtUsd(t.costUsd), label: "cost, last 7 days", color: "blue" },
        d.routing.moved ? { n: fmtUsd(d.routing.savedUsd), label: "saved by routing", color: "green" } : { n: String(t.loopsCaught), label: "loops caught", color: "green" },
      ],
      cols
    )
  );
  out.push(plain(""), [seg("  Needs you", "teal")]);
  const unread = d.alerts.filter((n) => !n.read).slice(0, 3);
  if (!waiting.length && !asking.length && !unread.length) out.push([seg("    Nothing is waiting.", "dim")]);
  for (const a of waiting) out.push([seg("    ● ", "yellow"), seg(a.name, "bold"), seg("  " + (a.reason || "Paused."), "dim")]);
  for (const r of asking) out.push([seg("    ● ", "yellow"), seg(r.goal, "bold"), seg(r.status === "needs-you" ? "  needs you" : "  approve the plan", "dim")]);
  for (const n of unread) out.push([seg("    ○ ", "yellow"), seg(n.title), seg("  " + ago(n.ts, d.now), "dim")]);
  const max = Math.max(...d.usage.buckets.map((b) => b.costUsd), 0);
  if (max > 0) out.push(plain(""), [seg("  Cost per day  ", "teal"), seg(d.usage.buckets.map((b) => SPARK[Math.min(7, Math.round((b.costUsd / max) * 7))]).join(""), "blue")]);
  const active = d.runs.filter((r) => r.status === "running" || r.status === "paused");
  for (const r of active) {
    const done = r.steps.filter((s) => s.status === "passed" || s.status === "skipped").length;
    const n = Math.max(1, r.plan.steps.length);
    const bar = Math.round((done / n) * 20);
    out.push(plain(""), [seg("  Autopilot  ", "teal"), seg(r.goal, "bold")], [seg("    " + "█".repeat(bar), "teal"), seg("░".repeat(20 - bar), "dim"), seg(`  ${done}/${n} steps · ${fmtUsd(r.costUsd)}`, "dim")]);
  }
  if (!d.agents.length && !d.runs.length) out.push(plain(""), plain("  No agent is being supervised yet."), plain("  Start one with:  argus run claude"), plain('  or let Autopilot build something:  argus autopilot "your goal"'));
  void v;
  return out;
}


function agentsBody(v: View, d: Data, cols: number, rows: number): Line[] {
  const out: Line[] = [];
  if (!d.agents.length) return [plain(""), plain("  No agent is being supervised yet."), plain(""), plain("  Start one with:  argus run claude"), plain('  or let Autopilot build something:  argus autopilot "your goal"')];
  const sel = Math.min(v.sel.agents, d.agents.length - 1);
  for (const { item: a, index } of window(d.agents, sel, Math.max(2, Math.min(d.agents.length, Math.floor(rows / 2))))) {
    out.push([seg(index === sel ? "▸ " : "  ", "teal"), seg(a.name, index === sel ? "bold" : undefined), seg("  "), STATUS(a, d.now), seg(`  ${fmtTokens(a.tokensUsed)} tokens · ${ago(a.lastSeen, d.now)}`, "dim")]);
  }
  const a = d.agents[sel];
  out.push(plain(""));
  if (isGone(a, d.now)) out.push(...wrap("ArgusOps is no longer connected to this agent, so there is nothing to pause or resume. Start it again with: argus run", cols - 2, "  "));
  else if (isWaiting(a, d.now)) {
    out.push(...wrap(a.reason || "Paused.", cols - 2, "  "));
    const s = a.suggestion?.status === "PENDING" ? a.suggestion : null;
    if (s) {
      out.push(plain(""), [seg("  ArgusOps suggests telling the agent:", "dim")], ...wrap(s.text, cols - 2, "    "));
    }
  } else if (a.status === "ACTIVE" && a.currentTask) out.push(...wrap(a.currentTask, cols - 2, "  "));
  else if (a.reason) out.push(...wrap(a.reason, cols - 2, "  "));
  if (a.hint) out.push(plain(""), ...wrap("Waiting to be delivered: " + a.hint, cols - 2, "  "));
  return out;
}

function autopilotBody(v: View, d: Data, cols: number, rows: number): Line[] {
  if (!d.runs.length) return [plain(""), plain("  No Autopilot runs yet."), plain(""), plain('  Start one:  argus autopilot "a command-line todo app with tests"')];
  const out: Line[] = [];
  const sel = Math.min(v.sel.autopilot, d.runs.length - 1);
  for (const { item: r, index } of window(d.runs, sel, Math.max(2, Math.min(d.runs.length, Math.floor(rows / 3))))) {
    const [label, color] = AP[r.status] ?? [r.status, undefined];
    out.push([seg(index === sel ? "▸ " : "  ", "teal"), seg(r.goal, index === sel ? "bold" : undefined), seg("  "), seg(label, color), seg(`  ${fmtUsd(r.costUsd)} · ${ago(r.updatedAt, d.now)}`, "dim")]);
  }
  const r = d.runs[sel];
  out.push(plain(""));
  r.plan.steps.forEach((s, i) => {
    const st = r.steps[i];
    const mark = st?.status === "passed" ? "✓" : st?.status === "failed" ? "✗" : st?.status === "running" ? "…" : st?.status === "skipped" ? "–" : "○";
    out.push([seg("  " + mark + " ", st?.status === "passed" ? "green" : st?.status === "failed" ? "red" : undefined), seg(`${i + 1}. ${s.title}`), seg(st && st.attempts > 1 ? `  ${st.attempts} attempts` : "", "dim")]);
  });
  if (r.needsYou) out.push(plain(""), ...wrap(r.needsYou, cols - 2, "  "), plain(`  Continue with: argus autopilot resume ${r.id}`));
  else if (r.status === "awaiting-approval") out.push(plain(""), plain(`  Review and approve in a terminal: argus autopilot resume ${r.id} --yes`));
  else if (r.control) out.push(plain(""), plain(r.control === "pause" ? "  Will pause after the current turn." : "  Will stop after the current turn."));
  return out;
}

const SPARK = "▁▂▃▄▅▆▇█";
function usageBody(d: Data): Line[] {
  const u = d.usage;
  const t = u.totals;
  const out: Line[] = [[seg("  Last 7 days", "bold")], plain(""), plain(`  ${t.calls} model calls · ${fmtTokens(t.inputTokens)} in · ${fmtTokens(t.outputTokens)} out`), plain(`  Estimated cost at list prices: ${fmtUsd(t.costUsd)}`)];
  if (t.cacheSavedUsd > 0) out.push(plain(`  Saved by prompt caching: ${fmtUsd(t.cacheSavedUsd)}`));
  if (d.routing.moved) out.push(plain(`  Saved by model routing: ${fmtUsd(d.routing.savedUsd)} (${d.routing.moved} requests)`));
  out.push(plain(`  Loops caught: ${t.loopsCaught}`));
  const max = Math.max(...u.buckets.map((b) => b.costUsd), 0);
  if (max > 0) out.push(plain(""), plain("  Cost per day  " + u.buckets.map((b) => SPARK[Math.min(7, Math.round((b.costUsd / max) * 7))]).join("")));
  if (u.byModel.length) {
    out.push(plain(""), [seg("  By model", "dim")]);
    for (const m of u.byModel.slice(0, 6)) out.push(plain(`    ${m.model.padEnd(24)} ${String(m.calls).padStart(4)} calls  ${fmtTokens(m.inputTokens + m.outputTokens).padStart(7)} tokens  ${fmtUsd(m.costUsd).padStart(7)}`));
  }
  out.push(plain(""), [seg("  Costs are estimates from list prices. Your provider's bill is what counts.", "dim")]);
  return out;
}

function alertsBody(v: View, d: Data, cols: number, rows: number): Line[] {
  if (!d.alerts.length) return [plain(""), plain("  Nothing to report. ArgusOps will tell you here when an agent is paused or its work has a problem.")];
  const out: Line[] = [];
  const sel = Math.min(v.sel.alerts, d.alerts.length - 1);
  for (const { item: n, index } of window(d.alerts, sel, Math.max(2, Math.min(d.alerts.length, Math.floor(rows / 2))))) {
    out.push([seg(index === sel ? "▸ " : "  ", "teal"), seg(n.read ? "  " : "● ", "yellow"), seg(n.title, index === sel ? "bold" : undefined), seg(`  ${ago(n.ts, d.now)}`, "dim")]);
  }
  out.push(plain(""), ...wrap(d.alerts[sel].body, cols - 2, "  "));
  return out;
}

const MODE_TEXT: Record<(typeof MODES)[number], [string, string]> = {
  suggest: ["Suggest (default)", "Tells you when a cheaper model could do a turn and what it would save. Changes nothing."],
  auto: ["Automatic", "Small turns run on a cheaper model, and go back to yours when the work needs it. Never more expensive than yours."],
  off: ["Off", "Your agents always use the model you chose."],
};
function modelsBody(v: View, d: Data, cols: number): Line[] {
  const out: Line[] = [];
  MODES.forEach((m, i) => {
    out.push([seg(i === v.sel.models ? "▸ " : "  ", "teal"), seg(d.routing.config.mode === m ? "● " : "○ ", "green"), seg(MODE_TEXT[m][0], i === v.sel.models ? "bold" : undefined)]);
    out.push(...wrap(MODE_TEXT[m][1], cols - 2, "      ").map((l) => [seg(visible(l), "dim")]));
  });
  out.push(plain(""), plain(`  Last 7 days: ${d.routing.moved} requests moved, about ${fmtUsd(d.routing.savedUsd)} saved (estimated)`));
  if (d.routing.decisions.length) {
    out.push(plain(""), [seg("  Recent decisions", "dim")]);
    for (const r of d.routing.decisions.slice(0, 5)) out.push(...wrap(`${ago(r.ts, d.now)}: ${r.message}`, cols - 2, "    "));
  }
  return out;
}

const HELP: string[] = ["", "  Keys", "", "  1-6, Tab, ← →     switch screen", "  ↑ ↓  (or j k)      choose an item", "", "  Agents", "    p  pause a running agent        x  stop it (asks first)", "    r  continue a paused agent      a  send ArgusOps' suggestion", "    e  edit the suggestion, then send   h  continue with your own words", "", "  Autopilot   p pause   x stop", "  Alerts      m mark all as read", "  Models      Enter or m  change how routing behaves", "", "  ?  this help      q  quit", "", "  Everything here stays on this computer."];

function keysFor(v: View, d: Data): string {
  const base = "1-6 screens · ↑↓ choose · ? help · q quit";
  if (v.tab === "agents") {
    const a = d.agents[Math.min(v.sel.agents, d.agents.length - 1)];
    if (a && isWaiting(a, d.now)) return `r continue · ${a.suggestion?.status === "PENDING" ? "a send suggestion · e edit · " : ""}h your words · x stop · ${base}`;
    if (a && a.status === "ACTIVE" && !isGone(a, d.now)) return `p pause · x stop · ${base}`;
  }
  if (v.tab === "autopilot") return `p pause · x stop · ${base}`;
  if (v.tab === "alerts") return `m mark read · ${base}`;
  if (v.tab === "models") return `Enter choose · ${base}`;
  return base;
}

/** The whole screen as `rows` lines, each already cut to `cols`. Pure. */
export function render(v: View, d: Data, cols: number, rows: number): string[] {
  const waiting = d.agents.filter((a) => isWaiting(a, d.now)).length;
  const unread = d.alerts.filter((n) => !n.read).length;
  const header: Line = [seg(" ArgusOps ", "teal"), seg(" ")];
  TABS.forEach((t, i) => {
    const badge = t === "agents" && waiting ? ` (${waiting})` : t === "alerts" && unread ? ` (${unread})` : "";
    header.push(seg(` ${i + 1} ${TAB_LABEL[t]}${badge} `, t === v.tab ? "inverse" : undefined));
  });
  const bodyRows = Math.max(1, rows - 4);
  let body: Line[] = v.help ? HELP.map(plain) : v.tab === "overview" ? overviewBody(v, d, cols) : v.tab === "agents" ? agentsBody(v, d, cols, bodyRows) : v.tab === "autopilot" ? autopilotBody(v, d, cols, bodyRows) : v.tab === "usage" ? usageBody(d) : v.tab === "alerts" ? alertsBody(v, d, cols, bodyRows) : modelsBody(v, d, cols);
  body = body.slice(0, bodyRows);

  let status: Line;
  if (v.mode === "input") status = [seg(v.inputKind === "edit" ? " Instruction › " : " Tell the agent › ", "yellow"), seg(v.input), seg("█", "dim")];
  else if (v.mode === "confirm") status = [seg(` ${v.confirm?.text ?? ""}`, "yellow")];
  else status = [seg(` ${v.message}`, "green")];
  const help: Line = [seg(v.mode === "input" ? " Enter send · Esc cancel" : v.mode === "confirm" ? " y yes · any other key no" : ` ${keysFor(v, d)}`, "dim")];

  const lines = [paint(header, cols), "─".repeat(Math.max(0, cols))];
  for (const l of body) lines.push(paint(l, cols));
  while (lines.length < rows - 2) lines.push("");
  lines.push(paint(status, cols), paint(help, cols));
  return lines.slice(0, rows);
}
