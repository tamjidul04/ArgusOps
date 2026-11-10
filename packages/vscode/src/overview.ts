/**
 * The dashboard panel at the top of the ArgusOps sidebar, as pure HTML-building functions (no VS Code imports,
 * so it can be tested and previewed on its own).
 *
 * Everything that came from the server is escaped here. The page uses no inline styles or handlers, so the
 * strict Content-Security-Policy below can stay: styles and the one script carry a per-render nonce.
 */
import type { NotificationBrief, UsageBrief } from "./api";
import { clip, formatTokens, kindOf, summarize, timeAgo, type AgentView } from "./model";

export interface OverviewState {
  signedIn: boolean;
  offline: boolean;
  user: { name: string; email: string } | null;
  plan: { name: string; maxAgents: number; tokensRemaining: number } | null;
  agents: AgentView[];
  /** null while loading or if the server could not give it: shown as a dash, never invented. */
  usage: UsageBrief | null;
  notifications: NotificationBrief[] | null;
  unread: number;
  now?: number;
}

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const W = 260;
const H = 44;

/** A small area chart of one value per day. All-zero data is a flat line, not a blank. */
export function sparkline(values: number[], total: number): string {
  const n = values.length;
  const max = Math.max(...values, 0);
  const step = n > 1 ? W / (n - 1) : W;
  const y = (v: number) => (max === 0 ? H - 3 : H - 3 - (v / max) * (H - 9));
  const pts = values.map((v, i) => [i * step, y(v)] as const);
  const line = pts.map(([x, py], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tokens per day over the last 7 days, ${esc(formatTokens(total))} in total">` +
    `<path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`
  );
}

const levelClass = (level: string) => (level === "CRITICAL" ? "crit" : level === "WARN" ? "warn" : "info");

function stat(label: string, value: string, hint?: string): string {
  return `<div class="stat"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div>${hint ? `<div class="h">${esc(hint)}</div>` : ""}</div>`;
}

function needsYou(agents: AgentView[]): string {
  const paused = agents.filter((a) => kindOf(a.status) === "paused");
  if (paused.length === 0) return "";
  const cards = paused
    .map((a) => {
      const why = clip(a.currentTask ?? "It looked stuck.", 110);
      const sug = a.suggestion;
      return (
        `<article class="card">` +
        `<div class="name">${esc(a.name)}</div>` +
        `<p class="why">${esc(why)}</p>` +
        (sug ? `<blockquote><span class="lbl">Suggested instruction</span>${esc(clip(sug.text, 180))}</blockquote>` : "") +
        `<div class="row">` +
        (sug
          ? `<button class="primary" data-action="approve" data-id="${esc(a.id)}">Approve &amp; resume</button><button data-action="resume" data-id="${esc(a.id)}">Edit…</button>`
          : `<button class="primary" data-action="resume" data-id="${esc(a.id)}">Resume…</button>`) +
        `<button class="ghost" data-action="stop" data-id="${esc(a.id)}">Stop</button>` +
        `</div></article>`
      );
    })
    .join("");
  return `<section aria-label="Needs you"><h2>Needs you <span class="count">${paused.length}</span></h2>${cards}</section>`;
}

/** The inside of the panel. Re-sent to the open webview on every poll, so it must be cheap and self-contained. */
export function overviewBody(s: OverviewState): string {
  const now = s.now ?? Date.now();
  if (!s.signedIn) {
    return `<section class="empty"><p>Sign in to see your agents, usage and alerts here.</p><div class="row"><button class="primary" data-action="signin">Sign in to ArgusOps</button></div></section>`;
  }

  const sum = summarize(s.agents);
  const used = s.usage ? s.usage.totals.inputTokens + s.usage.totals.outputTokens : null;
  const days = s.usage ? s.usage.buckets.map((b) => b.inputTokens + b.outputTokens) : [];
  const notes = (s.notifications ?? []).slice(0, 4);

  const header =
    `<header class="who"><span class="plan">${esc(s.plan ? `${s.plan.name} plan` : "ArgusOps")}</span>` +
    (s.user ? `<span class="muted">${esc(s.user.email)}</span>` : "") +
    `</header>`;

  const stats =
    `<section class="stats" aria-label="At a glance">` +
    stat("Agents", s.plan ? `${sum.running} / ${s.plan.maxAgents}` : String(sum.running), "running") +
    stat("Tokens left", s.plan ? formatTokens(s.plan.tokensRemaining) : "—") +
    stat("Used, 7 days", used === null ? "—" : formatTokens(used)) +
    stat("Loops caught", s.usage ? String(s.usage.totals.loopsCaught) : "—", "last 7 days") +
    `</section>`;

  let chart = "";
  if (s.usage) {
    chart =
      s.usage.totals.calls === 0
        ? `<section aria-label="Usage"><h2>Tokens per day</h2><p class="muted">No model calls in the last 7 days.</p></section>`
        : `<section aria-label="Usage"><h2>Tokens per day</h2>${sparkline(days, used ?? 0)}<div class="axis"><span>7 days ago</span><span>today</span></div>` +
          `<p class="muted">≈ $${s.usage.totals.costUsd.toFixed(2)} at list prices</p></section>`;
  }

  const alerts =
    `<section aria-label="Recent alerts"><h2>Recent alerts${s.unread > 0 ? ` <span class="count">${s.unread} new</span>` : ""}</h2>` +
    (s.notifications === null
      ? `<p class="muted">—</p>`
      : notes.length === 0
        ? `<p class="muted">No alerts yet.</p>`
        : `<ul class="alerts">${notes
            .map(
              (n) =>
                `<li class="${levelClass(n.level)}${n.read ? "" : " unread"}"><span class="dot" aria-hidden="true"></span>` +
                `<span class="t"><span class="title">${esc(clip(n.title, 60))}</span><span class="when">${esc(timeAgo(n.createdAt, now))}</span></span></li>`
            )
            .join("")}</ul>`) +
    `</section>`;

  const idle = s.agents.length === 0 ? `<p class="muted tip">No agents are running. Start one with <code>argus run claude</code>.</p>` : "";

  return (
    (s.offline ? `<p class="banner" role="status">Can’t reach the ArgusOps server. Showing the last data. Retrying…</p>` : "") +
    header +
    needsYou(s.agents) +
    stats +
    idle +
    chart +
    alerts +
    `<footer class="row"><button class="primary" data-action="dashboard">Open dashboard</button><button class="ghost" data-action="refresh">Refresh</button></footer>`
  );
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:12px 14px 18px;color:var(--vscode-foreground);font:var(--vscode-font-size,13px)/1.45 var(--vscode-font-family,system-ui,sans-serif)}
h2{margin:18px 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}
p{margin:0 0 8px}.muted{color:var(--vscode-descriptionForeground)}
code{font-family:var(--vscode-editor-font-family,monospace);font-size:.92em}
.who{display:flex;flex-direction:column;gap:1px}.plan{font-weight:600;font-size:14px}
.banner{margin:0 0 10px;padding:6px 8px;border:1px solid var(--vscode-editorWarning-foreground,#cca700);border-radius:4px;color:var(--vscode-editorWarning-foreground,#cca700)}
.count{margin-left:6px;padding:0 6px;border-radius:9px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:10px;letter-spacing:0;text-transform:none}
.card{margin:0 0 10px;padding:10px;border:1px solid var(--vscode-editorWarning-foreground,#cca700);border-radius:6px;background:var(--vscode-editorWidget-background,transparent)}
.card .name{font-weight:600}.card .why{margin:2px 0 8px;color:var(--vscode-descriptionForeground)}
blockquote{margin:0 0 10px;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background)}
blockquote .lbl{display:block;margin-bottom:2px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground)}
.row{display:flex;flex-wrap:wrap;gap:6px}
button{font:inherit;cursor:pointer;padding:4px 10px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}
button.primary:hover{background:var(--vscode-button-hoverBackground)}
button.ghost{background:transparent;color:var(--vscode-textLink-foreground)}
button.ghost:hover{background:var(--vscode-toolbar-hoverBackground)}
button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:14px;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,#8884));border-radius:6px;overflow:hidden;background:var(--vscode-widget-border,var(--vscode-panel-border,#8884))}
.stat{padding:8px 10px;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}
.stat .k{font-size:11px;color:var(--vscode-descriptionForeground)}
.stat .v{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.25}
.stat .h{font-size:11px;color:var(--vscode-descriptionForeground)}
.spark{display:block;width:100%;height:44px}
.spark .area{fill:var(--vscode-charts-blue,#3794ff);opacity:.16}
.spark .line{fill:none;stroke:var(--vscode-charts-blue,#3794ff);stroke-width:1.6;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.axis{display:flex;justify-content:space-between;margin:2px 0 4px;font-size:10px;color:var(--vscode-descriptionForeground)}
.alerts{list-style:none;margin:0;padding:0}
.alerts li{display:flex;gap:8px;align-items:flex-start;padding:4px 0}
.alerts .dot{flex:none;width:7px;height:7px;margin-top:6px;border-radius:50%;background:var(--vscode-descriptionForeground);opacity:.45}
.alerts li.unread .dot{opacity:1}
.alerts li.warn .dot{background:var(--vscode-editorWarning-foreground,#cca700)}
.alerts li.crit .dot{background:var(--vscode-errorForeground,#f14c4c)}
.alerts .t{display:flex;flex-direction:column;min-width:0}
.alerts .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.alerts li.unread .title{font-weight:600}
.alerts .when{font-size:11px;color:var(--vscode-descriptionForeground)}
.tip{margin-top:10px}
footer.row{margin-top:18px;padding-top:12px;border-top:1px solid var(--vscode-widget-border,var(--vscode-panel-border,#8884))}
.empty{padding-top:8px}
`;

const SCRIPT = `
const api = acquireVsCodeApi();
const main = document.getElementById("app");
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("[data-action]") : null;
  if (b) api.postMessage({ type: b.getAttribute("data-action"), id: b.getAttribute("data-id") || undefined });
});
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "render" && typeof e.data.html === "string") main.innerHTML = e.data.html;
});
`;

/** The full page, set once; later polls only swap the inside of #app (no reload, no flicker). */
export function overviewHtml(s: OverviewState, env: { nonce: string }): string {
  const csp = `default-src 'none'; style-src 'nonce-${env.nonce}'; script-src 'nonce-${env.nonce}'; img-src data:;`;
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>ArgusOps</title><style nonce="${env.nonce}">${STYLE}</style></head>` +
    `<body><main id="app">${overviewBody(s)}</main><script nonce="${env.nonce}">${SCRIPT}</script></body></html>`
  );
}
