"use strict";
/* ArgusOps local page. Talks only to the engine that served it. All text from the engine is put in the page with
   textContent, never as HTML, so nothing an agent writes can run as script here. */

const $ = (sel) => document.querySelector(sel);
const main = $("#main");
const state = { tab: "agents", range: "7d", agents: null, alerts: null, autopilot: null, usage: null, routing: null, drafts: new Map(), error: null };

/* ---------------------------------- token ---------------------------------- */
// `argus ui` opens this page as /#t=<token>. A fragment is never sent to any server; it is stored for this tab and removed from the address bar.
let token = "";
try {
  const wanted = /[#&]tab=(agents|autopilot|usage|alerts|routing)(?![A-Za-z])/.exec(location.hash);
  if (wanted) {
    state.tab = wanted[1];
    for (const t of document.querySelectorAll("#tabs button")) t.setAttribute("aria-selected", String(t.dataset.tab === state.tab));
  }
  const m = /[#&]t=([A-Za-z0-9]+)/.exec(location.hash);
  if (m) {
    sessionStorage.setItem("argus-token", m[1]);
    history.replaceState(null, "", location.pathname);
  }
  token = sessionStorage.getItem("argus-token") || "";
} catch {
  /* storage blocked: the token stays only in the fragment until reload */
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-argus-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/* ---------------------------------- helpers ---------------------------------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v; // set through the DOM, since the page's security policy forbids style="" attributes in the HTML
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n)));
const fmtUsd = (n) => (n > 0 && n < 0.01 ? "<$0.01" : "$" + n.toFixed(2));
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
const STALE_MS = 30000;
const STATUS = { ACTIVE: ["running", "ok"], PAUSED: ["paused", "warn"], STOPPED: ["stopped", "bad"], ENDED: ["finished", ""] };
const AP_STATUS = { "awaiting-approval": ["waiting for approval", "warn"], running: ["running", "ok"], paused: ["paused", "warn"], "needs-you": ["needs you", "warn"], done: ["done", "ok"], stopped: ["stopped", "bad"], failed: ["failed", "bad"] };
const pill = (label, kind) => h("span", { class: "pill " + (kind || "") }, label);
const empty = (...kids) => h("div", { class: "empty" }, ...kids);

async function act(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
    await refresh();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}
const button = (label, cls, fn) => {
  const b = h("button", { class: "btn " + cls, type: "button" }, label);
  b.addEventListener("click", () => act(b, fn));
  return b;
};

/* ----------------------------------- views ----------------------------------- */
function agentCard(a) {
  const live = a.status === "ACTIVE" || a.status === "PAUSED";
  // a run that has stopped checking in is gone, whatever its record says (a running agent reports every half second)
  const gone = live && Date.now() - a.lastSeen > STALE_MS;
  const [label, kind] = gone ? [a.status === "PAUSED" ? "paused (not running)" : "not running", ""] : STATUS[a.status] || [a.status, ""];
  const card = h("div", { class: "card" + (a.status === "PAUSED" && !gone ? " needs" : "") });
  card.append(h("div", { class: "row sp" }, h("div", { class: "row" }, h("span", { class: "title" }, a.name), pill(label, kind)), h("span", { class: "muted" }, `${fmtTokens(a.tokensUsed)} tokens · seen ${ago(a.lastSeen)}`)));
  if (gone) {
    card.append(h("div", { class: "muted" }, "ArgusOps is no longer connected to this agent, so there is nothing to pause or resume. Start it again with ", h("code", null, "argus run"), "."));
  } else if (a.status === "PAUSED") {
    const stack = h("div", { class: "stack" });
    stack.append(h("div", null, a.reason || "Paused."));
    const key = "hint:" + a.id;
    if (a.suggestion && a.suggestion.status === "PENDING") {
      const ta = h("textarea", { "aria-label": "Instruction to send the agent" });
      ta.value = state.drafts.get(key) ?? a.suggestion.text;
      ta.addEventListener("input", () => state.drafts.set(key, ta.value));
      stack.append(h("div", { class: "muted" }, "ArgusOps suggests telling the agent (you can edit it):"), ta);
      stack.append(
        h("div", { class: "row" },
          button("Send this and continue", "primary", async () => {
            await api(`/api/agents/${a.id}/approve`, { text: ta.value });
            state.drafts.delete(key);
          }),
          button("Continue without it", "", () => api(`/api/agents/${a.id}/dismiss`, {}).then(() => api(`/api/agents/${a.id}/resume`, {}))),
          button("Stop the agent", "danger", () => stopAgent(a))
        )
      );
    } else {
      const inp = h("input", { type: "text", placeholder: "Optional: tell the agent what to do differently", "aria-label": "Instruction to send the agent" });
      inp.value = state.drafts.get(key) ?? "";
      inp.addEventListener("input", () => state.drafts.set(key, inp.value));
      stack.append(inp, h("div", { class: "row" }, button("Continue", "primary", async () => {
        await api(`/api/agents/${a.id}/resume`, inp.value.trim() ? { hint: inp.value.trim() } : {});
        state.drafts.delete(key);
      }), button("Stop the agent", "danger", () => stopAgent(a))));
    }
    card.append(stack);
  } else if (a.status === "ACTIVE") {
    if (a.currentTask) card.append(h("div", { class: "muted" }, a.currentTask));
    card.append(h("div", { class: "row", style: "margin-top:10px" }, button("Pause", "", () => api(`/api/agents/${a.id}/pause`, {})), button("Stop", "danger", () => stopAgent(a))));
  } else if (!live && a.reason) card.append(h("div", { class: "muted" }, a.reason));
  if (a.hint) card.append(h("div", { class: "muted" }, "Waiting to be delivered: " + a.hint));
  return card;
}
async function stopAgent(a) {
  if (confirm(`Stop "${a.name}"? It will not be able to continue; you will need to start a new session.`)) await api(`/api/agents/${a.id}/stop`, {});
}

function viewAgents() {
  const out = h("div");
  out.append(h("h2", null, "Agents"));
  const list = state.agents || [];
  if (!list.length) {
    out.append(empty(h("p", null, "No agent is being supervised yet."), h("p", null, "Start one with ", h("code", null, "argus run claude"), " or ", h("code", null, "argus proxy"), ", or let Autopilot build something with ", h("code", null, 'argus autopilot "your goal"'), ".")));
    return out;
  }
  const waiting = (x) => x.status === "PAUSED" && Date.now() - x.lastSeen <= STALE_MS;
  list.sort((x, y) => waiting(y) - waiting(x));
  for (const a of list) out.append(agentCard(a));
  return out;
}

function viewAutopilot() {
  const out = h("div");
  out.append(h("h2", null, "Autopilot"));
  const runs = state.autopilot || [];
  if (!runs.length) {
    out.append(empty(h("p", null, "No Autopilot runs yet."), h("p", null, "Start one in a terminal: ", h("code", null, 'argus autopilot "a command-line todo app with tests"'), ". You review the plan, then follow it here.")));
    return out;
  }
  for (const r of runs) {
    const [label, kind] = AP_STATUS[r.status] || [r.status, ""];
    const card = h("div", { class: "card" + (r.status === "needs-you" ? " needs" : "") });
    card.append(h("div", { class: "row sp" }, h("div", { class: "row" }, h("span", { class: "title" }, r.goal), pill(label, kind)), h("span", { class: "muted" }, `${fmtUsd(r.costUsd)} · ${ago(r.updatedAt)}`)));
    card.append(h("div", { class: "muted" }, r.root));
    const steps = h("ul", { class: "steps" });
    r.steps.forEach((s, i) => {
      const mark = s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "…" : s.status === "skipped" ? "–" : "○";
      steps.append(h("li", null, h("span", { "aria-hidden": "true" }, mark), h("span", null, `${i + 1}. ${s.title}`), s.attempts > 1 ? h("span", { class: "muted" }, `${s.attempts} attempts`) : null, s.status === "failed" && s.problems[0] ? h("span", { class: "muted" }, s.problems[0]) : null));
    });
    card.append(steps);
    if (r.needsYou) card.append(h("div", { class: "note WARN" }, r.needsYou), h("div", { class: "muted" }, "Continue in a terminal: ", h("code", null, `argus autopilot resume ${r.id}`)));
    if (r.status === "awaiting-approval") card.append(h("div", { class: "muted", style: "margin-top:8px" }, "Review the plan and approve it in a terminal: ", h("code", null, `argus autopilot resume ${r.id} --yes`)));
    if (r.status === "running" || r.status === "paused") {
      card.append(h("div", { class: "row", style: "margin-top:10px" },
        r.control ? h("span", { class: "muted" }, r.control === "pause" ? "Will pause after the current turn." : "Will stop after the current turn.") : [
          button("Pause", "", () => api(`/api/autopilot/${r.id}/pause`, {})),
          button("Stop", "danger", async () => { if (confirm("Stop this Autopilot run?")) await api(`/api/autopilot/${r.id}/stop`, {}); }),
        ]));
    }
    if (r.log.length) card.append(h("details", null, h("summary", { class: "muted" }, "Activity"), ...r.log.map((l) => h("div", { class: "muted" }, `${ago(l.ts)}: ${l.message}`))));
    out.append(card);
  }
  return out;
}

function viewUsage() {
  const out = h("div");
  const sel = h("select", { "aria-label": "Time range", style: "width:auto" }, ...[["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]].map(([v, t]) => h("option", { value: v, selected: v === state.range }, t)));
  sel.addEventListener("change", () => { state.range = sel.value; state.usage = null; refresh(); });
  out.append(h("div", { class: "row sp" }, h("h2", null, "Usage"), sel));
  const u = state.usage;
  if (!u) {
    out.append(h("div", { class: "muted" }, "Loading…"));
    return out;
  }
  const t = u.totals;
  const saved = state.routing && state.routing.savings7d;
  out.append(h("div", { class: "tiles" },
    tile(String(t.calls), "model calls"),
    tile(`${fmtTokens(t.inputTokens)} / ${fmtTokens(t.outputTokens)}`, "tokens in / out"),
    tile(fmtUsd(t.costUsd), "estimated cost"),
    tile(String(t.loopsCaught), "loops caught"),
    t.cacheSavedUsd > 0 ? tile(fmtUsd(t.cacheSavedUsd), "saved by caching") : null,
    state.range === "7d" && saved && saved.calls ? tile(fmtUsd(saved.savedUsd), "saved by model routing") : null));
  const max = Math.max(...u.buckets.map((b) => b.costUsd), 0.000001);
  out.append(h("div", { class: "card" }, h("div", { class: "muted" }, "Estimated cost over time"), h("div", { class: "bars", role: "img", "aria-label": "Cost per period" }, ...u.buckets.map((b) => h("div", { class: "bar", title: `${b.bucket}: ${fmtUsd(b.costUsd)}`, style: `height:${Math.max(2, (b.costUsd / max) * 100)}%` })))));
  if (u.byModel.length) out.append(h("h3", null, "By model"), table(["Model", "Calls", "Tokens", "Cost"], u.byModel.map((m) => [m.model, m.calls, fmtTokens(m.inputTokens + m.outputTokens), fmtUsd(m.costUsd)])));
  if (u.byAgent.length) {
    const names = new Map((state.agents || []).map((a) => [a.id, a.name]));
    out.append(h("h3", null, "By agent"), table(["Agent", "Calls", "Tokens", "Cost"], u.byAgent.map((a) => [names.get(a.agentId) || a.agentId, a.calls, fmtTokens(a.inputTokens + a.outputTokens), fmtUsd(a.costUsd)])));
  }
  out.append(h("p", { class: "muted" }, "Costs are estimates from list prices. Your provider's bill is what counts."));
  return out;
}
const tile = (n, label) => h("div", { class: "tile" }, h("div", { class: "n" }, n), h("div", { class: "muted" }, label));
function table(head, rows) {
  return h("div", { class: "card", style: "padding:6px 8px;overflow-x:auto" }, h("table", null, h("thead", null, h("tr", null, ...head.map((x, i) => h("th", { class: i ? "num" : "" }, x)))), h("tbody", null, ...rows.map((r) => h("tr", null, ...r.map((c, i) => h("td", { class: i ? "num" : "" }, c)))))));
}

function viewAlerts() {
  const out = h("div");
  const list = state.alerts || [];
  const unread = list.some((n) => !n.read);
  out.append(h("div", { class: "row sp" }, h("h2", null, "Alerts"), unread ? button("Mark all as read", "", () => api("/api/alerts/read", {})) : null));
  if (!list.length) {
    out.append(empty("Nothing to report. ArgusOps will tell you here when an agent is paused or its work has a problem."));
    return out;
  }
  for (const n of list) {
    out.append(h("div", { class: "card" }, h("div", { class: "row sp" }, h("div", { class: "row" }, h("span", { class: "title" }, n.title), pill(n.level.toLowerCase(), n.level === "CRITICAL" ? "bad" : n.level === "WARN" ? "warn" : ""), n.read ? null : pill("new", "")), h("span", { class: "muted" }, ago(n.ts))), h("div", { class: "muted", style: "white-space:pre-wrap" }, n.body)));
  }
  return out;
}

const MODES = [
  ["suggest", "Suggest (default)", "Tells you when a cheaper model could do a turn and what it would save. Changes nothing."],
  ["auto", "Automatic", "Small turns run on a cheaper model, and go back to yours when the work needs it or the cheaper one struggles. It never picks a model more expensive than yours."],
  ["off", "Off", "Your agents always use the model you chose."],
];
function viewRouting() {
  const out = h("div");
  out.append(h("h2", null, "Models"));
  const r = state.routing;
  if (!r) {
    out.append(h("div", { class: "muted" }, "Loading…"));
    return out;
  }
  const card = h("div", { class: "card" });
  for (const [v, label, text] of MODES) {
    const radio = h("input", { type: "radio", name: "mode", id: "m-" + v, checked: r.config.mode === v });
    radio.addEventListener("change", () => act(radio, () => api("/api/routing", { mode: v })));
    card.append(h("label", { class: "radio", for: "m-" + v }, radio, h("div", null, h("div", { class: "title" }, label), h("div", { class: "muted" }, text))));
  }
  out.append(card);
  const s = r.savings7d;
  out.append(h("div", { class: "tiles" }, tile(String(s.calls), "requests moved (7 days)"), tile(fmtUsd(s.savedUsd), "estimated saved")));
  out.append(h("p", { class: "muted" }, "Change which models small turns go to with ", h("code", null, "argus route set trivial <model> low"), "."));
  out.append(h("h3", null, "Recent decisions"));
  if (!r.decisions.length) out.append(empty("No decisions yet."));
  for (const d of r.decisions) out.append(h("div", { class: "note" }, h("div", null, d.message), h("div", { class: "muted" }, ago(d.ts))));
  return out;
}

const VIEWS = { agents: viewAgents, autopilot: viewAutopilot, usage: viewUsage, alerts: viewAlerts, routing: viewRouting };

/* ----------------------------------- loop ----------------------------------- */
let lastShown = "";
function render(force) {
  const needs = (state.agents || []).filter((a) => a.status === "PAUSED" && Date.now() - a.lastSeen <= STALE_MS).length;
  const unread = (state.alerts || []).filter((n) => !n.read).length;
  for (const [id, n] of [["b-agents", needs], ["b-alerts", unread]]) {
    const b = $("#" + id);
    b.hidden = !n;
    b.textContent = String(n);
  }
  document.title = (needs ? `(${needs}) ` : "") + "ArgusOps";
  const conn = $("#conn");
  conn.textContent = state.error || "connected";
  conn.className = "conn" + (state.error ? " bad" : "");
  if (!token) {
    main.replaceChildren(empty(h("p", null, "This page needs your ArgusOps token."), h("p", null, "Open it with ", h("code", null, "argus ui"), " instead of typing the address.")));
    return;
  }
  // do not wipe something the person is typing
  const a = document.activeElement;
  const typing = a && main.contains(a) && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT");
  const snapshot = state.tab + JSON.stringify([state.agents, state.alerts, state.autopilot, state.usage, state.routing, state.range]);
  if (!force && (typing || snapshot === lastShown)) return;
  lastShown = snapshot;
  main.replaceChildren(VIEWS[state.tab]());
}

async function refresh() {
  if (!token) return render(true);
  try {
    const [ag, al, ap, rt] = await Promise.all([api("/api/agents"), api("/api/alerts?limit=50"), api("/api/autopilot"), api("/api/routing")]);
    state.agents = ag.agents;
    state.alerts = al.alerts ?? al.notifications ?? [];
    state.autopilot = ap.runs;
    state.routing = rt;
    if (state.tab === "usage" || !state.usage) state.usage = await api("/api/usage?range=" + state.range);
    state.error = null;
  } catch (e) {
    state.error = e.status === 401 ? "wrong token: reopen with argus ui" : "can't reach ArgusOps";
  }
  render(false);
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  state.tab = b.dataset.tab;
  for (const t of document.querySelectorAll("#tabs button")) t.setAttribute("aria-selected", String(t === b));
  render(true);
  if (state.tab === "usage") refresh();
});
refresh();
setInterval(refresh, 2000);
