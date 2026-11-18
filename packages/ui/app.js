"use strict";
/* ArgusOps desktop app screen. Talks only to the engine that served it. All text from the engine is put in the page with
   textContent, never as HTML, so nothing an agent writes can run as script here. Icons are built with DOM calls too. */

const $ = (sel) => document.querySelector(sel);
const main = $("#main");
const sideTop = $("#side-top");
const modal = $("#modal");
const state = {
  view: { page: "overview" },
  range: "7d",
  agents: null,
  alerts: null,
  autopilot: null,
  usage: null,
  routing: null,
  drafts: new Map(),
  error: null,
  open: null, // popup: "start"
  menu: false, // the More menu
  alertFilter: "all",
  alertQuery: "",
  cmdQuery: "",
  canStartAutopilot: false,
  editors: { available: false, connections: [] },
};

/* ---------------------------------- token ---------------------------------- */
// The app opens this page as /#t=<token>. A fragment is never sent to any server; it is stored for this window and removed from the address.
let token = "";
try {
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

const ICONS = {
  overview: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  bell: ["M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  chart: ["M3 3v18h18", "M7 15l4-4 3 3 5-6"],
  layers: ["M12 2 2 7l10 5 10-5-10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"],
  more: ["M7 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M17 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"],
  plus: ["M12 5v14", "M5 12h14"],
  terminal: ["M4 17l6-6-6-6", "M12 19h8"],
  agent: ["M12 8V4H8", "M4 8h16v12H4z", "M2 14h2", "M20 14h2", "M9 13v2", "M15 13v2"],
  route: ["M3 11l19-9-9 19-2-8-8-2z"],
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  clock: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7v5l3 2"],
  pause: ["M9 5v14", "M15 5v14"],
  alert: ["M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9v4", "M12 17h.01"],
  info: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 16v-4", "M12 8h.01"],
  sun: ["M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  search: ["M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M21 21l-4.3-4.3"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  dollar: ["M12 2v20", "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  off: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M5.6 5.6l12.8 12.8"],
  bolt: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
  plug: ["M9 2v6", "M15 2v6", "M6 8h12v4a6 6 0 0 1-12 0z", "M12 18v4"],
};
function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "i");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
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
const short = (ts) => {
  const s = ago(ts);
  return s === "just now" ? "now" : s.replace(" ago", "");
};
const STALE_MS = 30000;
const STATUS = { ACTIVE: ["running", "ok"], PAUSED: ["paused", "warn"], STOPPED: ["stopped", "bad"], ENDED: ["finished", ""] };
const AP_STATUS = { planning: ["planning", "accent"], "awaiting-answers": ["has questions", "warn"], "awaiting-approval": ["waiting for approval", "warn"], running: ["running", "ok"], paused: ["paused", "warn"], "needs-you": ["needs you", "warn"], done: ["done", "ok"], stopped: ["stopped", "bad"], failed: ["failed", "bad"] };
const RANGES = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]];
const RANGE_LABEL = Object.fromEntries(RANGES);
const chip = (label, kind) => h("span", { class: "chip " + (kind || "") }, label);
const code = (t) => h("code", null, t);

// an agent that has stopped checking in is gone, whatever its record says (a running agent reports every half second)
const isLive = (a) => (a.status === "ACTIVE" || a.status === "PAUSED") && Date.now() - a.lastSeen <= STALE_MS;
const isGone = (a) => (a.status === "ACTIVE" || a.status === "PAUSED") && Date.now() - a.lastSeen > STALE_MS;
const isWaiting = (a) => a.status === "PAUSED" && isLive(a);
const runAsks = (r) => r.status === "needs-you" || r.status === "awaiting-approval" || r.status === "awaiting-answers";
function agentStatus(a) {
  if (isGone(a)) return [a.status === "PAUSED" ? "paused (not running)" : "not running", ""];
  return STATUS[a.status] || [a.status, ""];
}

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
const button = (label, cls, fn, ic) => {
  const b = h("button", { class: "btn " + cls, type: "button" }, ic ? icon(ic) : null, label);
  b.addEventListener("click", () => act(b, fn));
  return b;
};
function link(el, fn) {
  el.classList.add("link");
  el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  });
  return el;
}
/** A list row: icon tile, title (with an optional chip), description, and something on the right. */
function lrow({ ic, tone, title, tag, text, right, onOpen }) {
  const el = h("div", { class: "lrow" }, h("div", { class: "tile " + (tone || "") }, icon(ic)), h("div", null, h("div", { class: "t" }, h("span", null, title), tag || null), text ? h("div", { class: "d" }, text) : null), h("div", { class: "r" }, right || null));
  return onOpen ? link(el, onOpen) : el;
}
const pageHead = (title, sub, actions, tag) => h("div", { class: "page-head" }, h("div", null, h("h1", null, h("span", null, title), tag || null), sub ? h("p", { class: "sub" }, sub) : null), actions && actions.length ? h("div", { class: "actions" }, ...actions) : null);
function seg(options, current, onPick, label) {
  return h("div", { class: "seg", role: "group", "aria-label": label }, ...options.map(([v, text]) => {
    const b = h("button", { type: "button", "aria-pressed": String(v === current), "data-value": v }, text);
    b.addEventListener("click", () => onPick(v));
    return b;
  }));
}
function emptyState(ic, text, action) {
  return h("div", { class: "empty" }, h("div", { class: "empty-art" }, icon(ic)), h("p", null, ...[].concat(text)), action || null);
}
async function copyText(t, btn) {
  try {
    await navigator.clipboard.writeText(t);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Select and copy";
  }
  setTimeout(() => {
    btn.replaceChildren(icon("copy"), "Copy");
  }, 1500);
}
function cmdRow(command, text, ic = "terminal") {
  const b = h("button", { class: "btn small", type: "button" }, icon("copy"), "Copy");
  b.addEventListener("click", () => copyText(command, b));
  return lrow({ ic, title: command, text, right: b });
}

/* ---------------------------------- navigation ---------------------------------- */
function go(view) {
  state.view = view;
  state.menu = false;
  lastShown = "";
  render(true);
  main.scrollTop = 0;
}
const openAgent = (id) => () => go({ page: "agent", id });
const openRun = (id) => () => go({ page: "run", id });
function openPopup(kind) {
  state.open = kind;
  state.menu = false;
  lastShown = "";
  render(true);
}

/* ---------------------------------- sidebar ---------------------------------- */
const NAV = [
  ["overview", "Overview", "overview"],
  ["autopilot", "Autopilot", "route"],
  ["editors", "Editors", "plug"],
  ["alerts", "Alerts", "bell"],
  ["usage", "Usage", "chart"],
  ["models", "Models", "layers"],
];
function renderSide() {
  const unread = (state.alerts || []).filter((n) => !n.read).length;
  const page = state.view.page;
  const nav = h("nav", { "aria-label": "Sections" });
  for (const [p, label, ic] of NAV) {
    const b = h("button", { class: "nav-item", type: "button", "data-page": p, "aria-current": page === p ? "page" : false }, icon(ic), label, p === "alerts" && unread ? h("span", { class: "count" }, String(unread)) : null);
    b.addEventListener("click", () => go({ page: p }));
    nav.append(b);
  }
  const more = h("button", { class: "nav-item", type: "button", id: "more", "aria-expanded": String(state.menu), "aria-current": page === "commands" ? "page" : false }, icon("more"), "More");
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    state.menu = !state.menu;
    lastShown = "";
    render(true);
  });
  nav.append(more);
  if (state.menu) {
    const item = (label, ic, fn) => {
      const b = h("button", { class: "nav-item", type: "button" }, icon(ic), label);
      b.addEventListener("click", fn);
      return b;
    };
    nav.append(h("div", { class: "menu", role: "menu" }, item("All commands", "book", () => go({ page: "commands" })), item("Start an agent", "plus", () => openPopup("start"))));
  }

  const newBtn = h("button", { class: "new-btn", type: "button", id: "start" }, icon("plus"), "Start an agent");
  newBtn.addEventListener("click", () => openPopup("start"));

  const agents = [...(state.agents || [])].sort((x, y) => Number(isWaiting(y)) - Number(isWaiting(x)) || y.lastSeen - x.lastSeen).slice(0, 10);
  const agentRows = agents.length
    ? agents.map((a) => {
        const [, kind] = agentStatus(a);
        const b = h("button", { class: "side-row", type: "button", "aria-current": page === "agent" && state.view.id === a.id ? "page" : false }, h("span", { class: "dot " + kind }), h("span", { class: "name" }, a.name), h("span", { class: "when" }, short(a.lastSeen)));
        b.addEventListener("click", openAgent(a.id));
        return b;
      })
    : [h("div", { class: "side-empty" }, "None yet")];
  const runs = (state.autopilot || []).slice(0, 6);
  const runRows = runs.map((r) => {
    const [, kind] = AP_STATUS[r.status] || ["", ""];
    const b = h("button", { class: "side-row", type: "button", "aria-current": page === "run" && state.view.id === r.id ? "page" : false }, h("span", { class: "dot " + kind }), h("span", { class: "name" }, r.goal), h("span", { class: "when" }, short(r.updatedAt)));
    b.addEventListener("click", openRun(r.id));
    return b;
  });

  // replaceChildren turns a null into the text "null", so only real nodes go in
  sideTop.replaceChildren(...[
    h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), h("span", { class: "brand-name" }, "ArgusOps"), h("span", { class: "brand-tag" }, "LOCAL")),
    newBtn,
    nav,
    h("div", { class: "side-head" }, h("span", null, "Agents"), h("span", null, String((state.agents || []).length))),
    ...agentRows,
    runs.length ? h("div", { class: "side-head" }, h("span", null, "Autopilot"), h("span", null, String((state.autopilot || []).length))) : null,
    ...runRows
  ].filter(Boolean));
  const waiting = (state.agents || []).filter(isWaiting).length + (state.autopilot || []).filter(runAsks).length;
  document.title = (waiting ? `(${waiting}) ` : "") + "ArgusOps";
}

/* ---------------------------------- pages ---------------------------------- */
function stat(k, v) {
  return h("div", { class: "stat" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v));
}
const rangeSeg = () => seg(RANGES, state.range, (v) => {
  state.range = v;
  state.usage = null;
  lastShown = "";
  render(true);
  refresh();
}, "Time range");

function agentRow(a) {
  const [label, kind] = agentStatus(a);
  return lrow({ ic: "agent", tone: kind, title: a.name, tag: chip(label, kind), text: isWaiting(a) ? a.reason || "Paused." : a.currentTask || `${fmtTokens(a.tokensUsed)} tokens`, right: ago(a.lastSeen), onOpen: openAgent(a.id) });
}

/* A bento grid: one big tile with the cost chart, two tiles beside it, and a wide tile under those two. */
function costTile(u, sub) {
  const t = h("div", { class: "b-tile b-big" }, h("div", { class: "k" }, "Estimated cost, " + RANGE_LABEL[state.range]));
  if (!u) return (t.append(h("div", { class: "v" }, "…")), t);
  t.append(h("div", { class: "v big" }, fmtUsd(u.totals.costUsd)), h("div", { class: "muted" }, sub));
  const max = Math.max(...u.buckets.map((b) => b.costUsd), 0.000001);
  t.append(h("div", { class: "bars", role: "img", "aria-label": "Cost per period" }, ...u.buckets.map((b) => h("div", { class: "bar", title: `${b.bucket}: ${fmtUsd(b.costUsd)}`, style: `height:${Math.max(2, (b.costUsd / max) * 100)}%` }))));
  return t;
}
function tile(k, v, sub, tone, onOpen) {
  const t = h("div", { class: "b-tile " + (tone || "") }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), sub ? h("div", { class: "muted" }, sub) : null);
  return onOpen ? link(t, onOpen) : t;
}
function wideTile(items) {
  return h("div", { class: "b-tile b-wide" }, ...items.map(([k, v, tone]) => h("div", { class: "mini" }, h("div", { class: "k" }, k), h("div", { class: "v " + (tone || "") }, v))));
}
const bento = (...tiles) => h("div", { class: "bento" }, ...tiles);

function overviewPage() {
  const agents = [...(state.agents || [])].sort((x, y) => Number(isWaiting(y)) - Number(isWaiting(x)) || y.lastSeen - x.lastSeen);
  const runs = state.autopilot || [];
  const running = agents.filter((a) => a.status === "ACTIVE" && isLive(a)).length;
  const waiting = agents.filter(isWaiting);
  const asking = runs.filter(runAsks);
  const u = state.usage;
  const start = h("button", { class: "btn primary", type: "button" }, icon("plus"), "Start an agent");
  start.addEventListener("click", () => openPopup("start"));
  const out = h("div", { class: "page" }, pageHead("Overview", "What your agents are doing right now", [start]), rangeSeg());
  const total = agents.length;
  const firstWaiting = waiting[0] ? openAgent(waiting[0].id) : asking[0] ? openRun(asking[0].id) : null;
  const saved = state.routing && state.routing.savings7d;
  out.append(bento(
    costTile(u, u ? `${fmtTokens(u.totals.inputTokens)} in · ${fmtTokens(u.totals.outputTokens)} out · ${u.totals.calls} model calls` : ""),
    tile("Agents running", String(running), total ? `of ${total} supervised` : "none supervised yet", running ? "ok" : ""),
    tile("Waiting for you", String(waiting.length + asking.length), firstWaiting ? "Open the first one" : "Nothing waiting", waiting.length + asking.length ? "warn" : "", firstWaiting),
    wideTile([["Loops caught", u ? String(u.totals.loopsCaught) : "…"], ["Saved by caching", u ? fmtUsd(u.totals.cacheSavedUsd) : "…", "good"], ["Saved by routing, 7 days", saved ? fmtUsd(saved.savedUsd) : "…", "good"]])
  ));

  // left: what to act on; right: what it cost and what happened
  const left = h("div", { class: "col" });
  const right = h("div", { class: "col" });
  const head = (title, action) => h("div", { class: "col-head" }, h("h2", null, title), action || null);

  if (waiting.length || asking.length) {
    const list = h("div", { class: "list" });
    for (const a of waiting) list.append(lrow({ ic: "pause", tone: "warn", title: a.name, tag: chip("paused", "warn"), text: a.reason || "Paused.", right: ago(a.lastSeen), onOpen: openAgent(a.id) }));
    for (const r of asking) list.append(lrow({ ic: "route", tone: "warn", title: r.goal, tag: chip(r.status === "needs-you" ? "needs you" : "approve plan", "warn"), text: r.needsYou || "Review the plan before it starts.", right: ago(r.updatedAt), onOpen: openRun(r.id) }));
    left.append(head("Needs you"), list);
  }
  left.append(head("Agents"));
  if (!agents.length) {
    const b = h("button", { class: "btn", type: "button" }, "Start an agent");
    b.addEventListener("click", () => openPopup("start"));
    left.append(emptyState("agent", ["No agent is being supervised yet. Start one with ", code("argus run claude"), "."], b));
  } else left.append(h("div", { class: "list" }, ...agents.map(agentRow)));
  if (runs.length) {
    left.append(head("Autopilot"), h("div", { class: "list" }, ...runs.slice(0, 5).map((r) => {
      const [label, kind] = AP_STATUS[r.status] || [r.status, ""];
      const done = r.steps.filter((s) => s.status === "passed" || s.status === "skipped").length;
      return lrow({ ic: "route", tone: kind, title: r.goal, tag: chip(label, kind), text: `${done} of ${r.steps.length} steps · ${fmtUsd(r.costUsd)}`, right: ago(r.updatedAt), onOpen: openRun(r.id) });
    })));
  }

  if (u && u.byModel.length) {
    const usageLink = h("button", { class: "btn small", type: "button" }, "Details");
    usageLink.addEventListener("click", () => go({ page: "usage" }));
    right.append(head("Top models", usageLink), h("div", { class: "card" }, ...u.byModel.slice(0, 4).map((m) => h("div", { class: "kv-row" }, h("span", null, m.model), h("span", null, fmtUsd(m.costUsd))))));
  }

  // routing
  const r = state.routing;
  if (r) {
    const change = h("button", { class: "btn small", type: "button" }, "Change");
    change.addEventListener("click", () => go({ page: "models" }));
    const mode = MODES.find((m) => m[0] === r.config.mode);
    right.append(head("Model routing", change), h("div", { class: "card" }, h("div", { class: "kv-row" }, h("span", null, "Mode"), h("strong", null, mode ? mode[1] : r.config.mode)), h("div", { class: "kv-row" }, h("span", null, "Moved, 7 days"), h("span", null, String(r.savings7d.calls))), h("div", { class: "kv-row" }, h("span", null, "Saved, 7 days"), h("span", { class: "good" }, fmtUsd(r.savings7d.savedUsd)))));
  }

  // alerts
  const all = h("button", { class: "btn small", type: "button" }, "See all");
  all.addEventListener("click", () => go({ page: "alerts" }));
  const recent = (state.alerts || []).slice(0, 5);
  right.append(head("Recent alerts", all), recent.length ? h("div", { class: "list" }, ...recent.map(alertRow)) : h("div", { class: "card muted" }, "Nothing to report yet."));

  out.append(h("div", { class: "split" }, left, right));
  return out;
}

async function stopAgent(a) {
  if (confirm(`Stop "${a.name}"? It will not be able to continue; you will need to start a new session.`)) await api(`/api/agents/${a.id}/stop`, {});
}
function agentPage(a) {
  const [label, kind] = agentStatus(a);
  const live = isLive(a);
  const actions = [];
  if (live && a.status === "ACTIVE") actions.push(button("Pause", "", () => api(`/api/agents/${a.id}/pause`, {}), "pause"));
  if (live) actions.push(button("Stop", "danger", () => stopAgent(a), "x"));
  const out = h("div", { class: "page" }, pageHead(a.name, `${fmtTokens(a.tokensUsed)} tokens · seen ${ago(a.lastSeen)}`, actions, chip(label, kind)));
  const key = "hint:" + a.id;
  if (isGone(a)) {
    out.append(h("div", { class: "notice info" }, "ArgusOps is no longer connected to this agent, so there is nothing to pause or resume. Start it again with ", code("argus run"), "."));
  } else if (a.status === "PAUSED") {
    const box = h("div", { class: "card stack" }, h("div", { class: "t" }, h("strong", null, "Paused: "), a.reason || "Paused."));
    if (a.suggestion && a.suggestion.status === "PENDING") {
      const ta = h("textarea", { "aria-label": "Instruction to send the agent" });
      ta.value = state.drafts.get(key) ?? a.suggestion.text;
      ta.addEventListener("input", () => state.drafts.set(key, ta.value));
      box.append(h("div", { class: "muted" }, "ArgusOps suggests telling the agent (you can edit it):"), ta, h("div", { class: "row" },
        button("Send this and continue", "primary", async () => {
          await api(`/api/agents/${a.id}/approve`, { text: ta.value });
          state.drafts.delete(key);
        }),
        button("Continue without it", "", () => api(`/api/agents/${a.id}/dismiss`, {}).then(() => api(`/api/agents/${a.id}/resume`, {})))));
    } else {
      const inp = h("input", { type: "text", placeholder: "Optional: tell the agent what to do differently", "aria-label": "Instruction to send the agent" });
      inp.value = state.drafts.get(key) ?? "";
      inp.addEventListener("input", () => state.drafts.set(key, inp.value));
      box.append(inp, h("div", { class: "row" }, button("Continue", "primary", async () => {
        await api(`/api/agents/${a.id}/resume`, inp.value.trim() ? { hint: inp.value.trim() } : {});
        state.drafts.delete(key);
      })));
    }
    out.append(box);
  } else if (a.status === "ACTIVE") {
    out.append(h("div", { class: "card" }, h("div", { class: "muted" }, "Working on"), h("div", null, a.currentTask || "Waiting for the next request.")));
  } else if (a.reason) out.append(h("div", { class: "card muted" }, a.reason));
  if (a.hint) out.append(h("div", { class: "notice info", style: "margin-top:12px" }, "Waiting to be delivered with the next request: " + a.hint));
  out.append(h("h2", null, "From the terminal"), h("div", { class: "list" },
    cmdRow("argus status", "See every agent and what it is doing"),
    cmdRow("argus resume --approve", "Continue a paused agent with ArgusOps' suggestion"),
    cmdRow('argus resume --hint "..."', "Continue with your own instruction"),
    cmdRow("argus pause · argus stop", "Pause or end the agent")));
  return out;
}

/* ---------------------------------- Autopilot from the app ---------------------------------- */
// Choosing a folder: the desktop app offers its own folder picker; anywhere else you type the path.
function folderField(key, label) {
  const inp = h("input", { type: "text", placeholder: "Full path of the project folder, for example D:\\work\\my-app", "aria-label": label });
  inp.value = state.drafts.get(key) ?? "";
  inp.addEventListener("input", () => state.drafts.set(key, inp.value));
  const row = h("div", { class: "row folder-row" }, inp);
  if (window.argusDesktop && typeof window.argusDesktop.pickFolder === "function") {
    const browse = h("button", { class: "btn", type: "button" }, "Browse…");
    browse.addEventListener("click", async () => {
      const picked = await window.argusDesktop.pickFolder();
      if (typeof picked === "string" && picked) {
        inp.value = picked;
        state.drafts.set(key, picked);
      }
    });
    row.append(browse);
  }
  return { row, value: () => inp.value.trim() };
}

function autopilotPage() {
  const runs = state.autopilot || [];
  const actions = [];
  if (state.canStartAutopilot) {
    const b = h("button", { class: "btn primary", type: "button" }, icon("plus"), "New run");
    b.addEventListener("click", () => go({ page: "autopilot-new" }));
    actions.push(b);
  }
  const out = h("div", { class: "page" }, pageHead("Autopilot", "Give it a goal: it asks a few questions, shows you a plan, and builds it step by step once you approve", actions));
  if (!state.canStartAutopilot) out.append(h("div", { class: "notice info" }, "Start Autopilot runs from the desktop app, or in a terminal: ", code('argus autopilot "your goal"'), "."));
  if (!runs.length) {
    const b = state.canStartAutopilot ? h("button", { class: "btn", type: "button" }, "New run") : null;
    b?.addEventListener("click", () => go({ page: "autopilot-new" }));
    out.append(emptyState("route", "No Autopilot runs yet.", b));
    return out;
  }
  out.append(h("div", { class: "list" }, ...runs.map((r) => {
    const [label, kind] = AP_STATUS[r.status] || [r.status, ""];
    const done = r.steps.filter((s) => s.status === "passed" || s.status === "skipped").length;
    const text = r.status === "planning" ? "Planning…" : r.status === "awaiting-answers" ? "Waiting for your answers" : r.status === "awaiting-approval" ? "Waiting for you to approve the plan" : `${done} of ${r.steps.length} steps · ${fmtUsd(r.costUsd)}`;
    return lrow({ ic: "route", tone: kind, title: r.goal, tag: chip(label, kind), text, right: ago(r.updatedAt), onOpen: openRun(r.id) });
  })));
  return out;
}

function newRunPage() {
  const out = h("div", { class: "page narrow" }, pageHead("New Autopilot run", "Nothing runs until you have seen the plan and approved it"));
  const goal = h("textarea", { "aria-label": "What should Autopilot build?", placeholder: "For example: a command-line todo app in Node, with tests" });
  goal.value = state.drafts.get("ap:goal") ?? "";
  goal.addEventListener("input", () => state.drafts.set("ap:goal", goal.value));
  const folder = folderField("ap:folder", "Project folder");
  const ask = h("input", { type: "checkbox", id: "ap-questions", checked: state.drafts.get("ap:questions") !== "no" });
  ask.addEventListener("change", () => state.drafts.set("ap:questions", ask.checked ? "yes" : "no"));
  const start = button("Plan it", "primary", async () => {
    const res = await api("/api/autopilot", { goal: goal.value, root: folder.value(), questions: ask.checked });
    for (const k of ["ap:goal", "ap:folder", "ap:questions"]) state.drafts.delete(k);
    state.view = { page: "run", id: res.id };
  });
  const cancel = h("button", { class: "btn", type: "button" }, "Cancel");
  cancel.addEventListener("click", () => go({ page: "autopilot" }));
  out.append(h("div", { class: "card stack form" },
    h("label", { class: "field" }, h("span", null, "What should it build?"), goal),
    h("div", { class: "field" }, h("span", null, "In which project folder?"), folder.row, h("span", { class: "muted" }, "Use a git repository, so you can review or undo what it changes.")),
    h("label", { class: "check" }, ask, h("span", null, "Let it ask me a few questions first")),
    h("div", { class: "row" }, start, cancel)));
  out.append(h("p", { class: "muted" }, "Autopilot uses Claude Code with your own login. It may edit files in the folder and run only the commands listed in the plan you approve."));
  return out;
}

function runControls(r) {
  const out = [];
  const stop = (label) => button(label, "danger", async () => {
    if (confirm("Stop this Autopilot run?")) await api(`/api/autopilot/${r.id}/stop`, {});
  }, "x");
  if (r.status === "running" && !r.control) out.push(button("Pause", "", () => api(`/api/autopilot/${r.id}/pause`, {}), "pause"), stop("Stop"));
  else if (r.status === "paused") {
    if (state.canStartAutopilot) out.push(button("Continue", "primary", () => api(`/api/autopilot/${r.id}/resume`, {}), "route"));
    out.push(stop("Stop"));
  } else if (["planning", "awaiting-answers", "awaiting-approval", "needs-you"].includes(r.status)) out.push(stop(r.status === "awaiting-approval" ? "Discard" : "Stop"));
  return out;
}

function answersForm(r) {
  const box = h("div", { class: "card stack form" }, h("div", { class: "card-title" }, "A few questions before planning"), h("div", { class: "muted" }, "Leave one empty to skip it."));
  const inputs = (r.questions || []).map((q, i) => {
    const key = `ap:${r.id}:a${i}`;
    const inp = h("input", { type: "text", "aria-label": q });
    inp.value = state.drafts.get(key) ?? "";
    inp.addEventListener("input", () => state.drafts.set(key, inp.value));
    box.append(h("label", { class: "field" }, h("span", null, q), inp));
    return { key, inp };
  });
  box.append(h("div", { class: "row" }, button("Continue", "primary", async () => {
    await api(`/api/autopilot/${r.id}/answers`, { answers: inputs.map((x) => x.inp.value) });
    for (const x of inputs) state.drafts.delete(x.key);
  })));
  return box;
}

function reviewPanel(r) {
  const v = r.review;
  const out = h("div");
  if (!v) return out;
  out.append(h("div", { class: "notice info" }, "Review the plan. Approving lets Autopilot edit files in ", code(r.root), " and run only the commands listed below."));
  if (v.git === "none") out.append(h("div", { class: "notice" }, "This folder is not a git repository, so the changes will be hard to undo. Consider running git init first."));
  if (v.git === "dirty") out.append(h("div", { class: "notice" }, "You have uncommitted changes. Commit or stash them first so you can review exactly what Autopilot changed."));
  if (v.summary) out.append(h("p", null, v.summary));
  out.append(h("h2", null, `Plan: ${v.steps.length} step${v.steps.length === 1 ? "" : "s"}`));
  out.append(h("div", { class: "list" }, ...v.steps.map((s, i) => {
    const text = h("div", null, h("div", { class: "pre" }, s.instructions), ...s.checks.map((c) => h("div", { class: "muted" }, "Check: " + c)));
    return lrow({ ic: "check", tone: "accent", title: `${i + 1}. ${s.title}`, tag: s.size ? chip(s.size) : null, text });
  })));
  out.append(h("h2", null, "Commands it may run"));
  out.append(v.commands.length ? h("div", { class: "card stack" }, ...v.commands.map((c) => h("div", null, code(c)))) : h("p", { class: "muted" }, "This plan's checks run no commands."));
  if (v.projectChecks !== "none") out.append(h("p", { class: "muted" }, v.projectChecks === "allowed" ? "The project's own checks are allowed and will also run after each step." : "The project's own checks will not run (allow them with argus project allow)."));
  if (state.canStartAutopilot) {
    out.append(h("div", { class: "row approve-row" }, button("Approve and start", "primary", () => api(`/api/autopilot/${r.id}/approve`, { planHash: v.planHash }), "check")));
  } else out.append(h("div", { class: "notice" }, "Approve it in a terminal: ", code(`argus autopilot resume ${r.id} --yes`)));
  return out;
}

function decidePanel(r) {
  const box = h("div", { class: "card stack form" }, h("div", { class: "card-title" }, "A step keeps failing"), h("div", null, r.needsYou || "Decide what to do with the step."));
  if (!state.canStartAutopilot) {
    box.append(h("div", { class: "muted" }, "Continue in a terminal: ", code(`argus autopilot resume ${r.id}`)));
    return box;
  }
  const key = `ap:${r.id}:decide`;
  const ta = h("textarea", { "aria-label": "What should the agent know?", placeholder: "Optional: what should the agent know or try differently?" });
  ta.value = state.drafts.get(key) ?? "";
  ta.addEventListener("input", () => state.drafts.set(key, ta.value));
  box.append(ta, h("div", { class: "row" },
    button("Try again", "primary", async () => {
      await api(`/api/autopilot/${r.id}/decide`, { action: "retry", instruction: ta.value });
      state.drafts.delete(key);
    }),
    button("Skip this step", "", () => api(`/api/autopilot/${r.id}/decide`, { action: "skip" }))));
  return box;
}

function runPage(r) {
  const [label, kind] = AP_STATUS[r.status] || [r.status, ""];
  const out = h("div", { class: "page" }, pageHead(r.goal, `${r.root} · ${fmtUsd(r.costUsd)} · updated ${ago(r.updatedAt)}`, runControls(r), chip(label, kind)));
  if (r.control) out.append(h("div", { class: "notice info" }, r.control === "pause" ? "Will pause after the current turn." : "Will stop after the current turn."));
  if (r.status === "planning") out.append(h("div", { class: "notice info" }, "Planning with Claude Code. This usually takes under a minute."));
  if (r.status === "awaiting-answers") out.append(answersForm(r));
  if (r.status === "awaiting-approval") out.append(reviewPanel(r));
  if (r.status === "needs-you") out.append(decidePanel(r));
  if (r.status === "failed" && r.log.length) out.append(h("div", { class: "notice" }, r.log[r.log.length - 1].message));
  if (r.steps.length && r.status !== "awaiting-approval") {
    out.append(h("h2", null, "Steps"));
    const list = h("div", { class: "list" });
    r.steps.forEach((s, i) => {
      const [ic, tone] = s.status === "passed" ? ["check", "ok"] : s.status === "failed" ? ["x", "bad"] : s.status === "running" ? ["clock", "accent"] : s.status === "skipped" ? ["off", ""] : ["clock", ""];
      const extra = [s.attempts > 1 ? `${s.attempts} attempts` : "", s.status === "failed" && s.problems[0] ? s.problems[0] : ""].filter(Boolean).join(" · ");
      list.append(lrow({ ic, tone, title: `${i + 1}. ${s.title}`, text: extra || s.status, right: s.size || "" }));
    });
    out.append(list);
  }
  if (r.log.length) out.append(h("h2", null, "Activity"), h("div", { class: "card stack" }, ...r.log.slice(-30).map((l) => h("div", { class: "muted" }, `${ago(l.ts)}: ${l.message}`))));
  return out;
}

/* ---------------------------------- editors ---------------------------------- */
function editorsPage() {
  const out = h("div", { class: "page" }, pageHead("Editors", "Supervise the Claude Code panel in VS Code, Antigravity or Cursor"));
  const conns = state.editors.connections || [];
  if (state.editors.available) {
    const folder = folderField("ed:folder", "Project folder to connect");
    out.append(h("div", { class: "card stack form" },
      h("div", { class: "field" }, h("span", null, "Project folder open in your editor"), folder.row),
      h("div", { class: "row" }, button("Connect", "primary", async () => {
        await api("/api/editors/connect", { folder: folder.value() });
        state.drafts.delete("ed:folder");
      }, "plus"))));
    out.append(h("div", { class: "notice info" }, "After connecting, run ", h("strong", null, "Developer: Reload Window"), " in that editor once. Reloading restarts the Claude panel, so connect before you start a chat. Disconnecting (or closing ArgusOps) undoes the setting."));
  } else out.append(h("div", { class: "notice info" }, "Connect editors from the desktop app, or run ", code("argus ide"), " in the project folder."));
  out.append(h("h2", null, "Connected"));
  out.append(conns.length
    ? h("div", { class: "list" }, ...conns.map((c) => lrow({ ic: "terminal", tone: "ok", title: c.folder, tag: chip("connected", "ok"), text: `Supervising through ${c.url} since ${ago(c.since)}`, right: button("Disconnect", "small", () => api("/api/editors/disconnect", { folder: c.folder })) })))
    : h("p", { class: "muted" }, "No editor is connected."));
  const panels = (state.agents || []).filter((a) => /\((IDE|editor)\)/.test(a.name));
  if (panels.length) out.append(h("h2", null, "Editor agents seen"), h("div", { class: "list" }, ...panels.map(agentRow)));
  return out;
}

function alertRow(n) {
  const [ic, tone] = n.level === "CRITICAL" ? ["alert", "bad"] : n.level === "WARN" ? ["alert", "warn"] : ["info", "accent"];
  return lrow({ ic, tone, title: n.title, tag: n.read ? null : chip("new", "accent"), text: n.body, right: ago(n.ts) });
}
function alertsPage() {
  const list = state.alerts || [];
  const actions = list.some((n) => !n.read) ? [button("Mark all as read", "", () => api("/api/alerts/read", {}), "check")] : [];
  const out = h("div", { class: "page" }, pageHead("Alerts", "What ArgusOps noticed while watching your agents", actions));
  out.append(seg([["all", "All"], ["unread", "Unread"], ["warn", "Warnings"]], state.alertFilter, (v) => {
    state.alertFilter = v;
    lastShown = "";
    render(true);
  }, "Filter"));
  const input = h("input", { type: "text", placeholder: "Search alerts", "aria-label": "Search alerts" });
  input.value = state.alertQuery;
  const box = h("div", { class: "list" });
  const fill = () => {
    const q = state.alertQuery.trim().toLowerCase();
    const shown = list.filter((n) => (state.alertFilter === "unread" ? !n.read : state.alertFilter === "warn" ? n.level !== "INFO" : true) && (!q || (n.title + " " + n.body).toLowerCase().includes(q)));
    box.replaceChildren(...(shown.length ? shown.map(alertRow) : [emptyState("bell", list.length ? "No alerts match." : "Nothing to report. ArgusOps will tell you here when an agent is paused or its work has a problem.")]));
  };
  input.addEventListener("input", () => {
    state.alertQuery = input.value;
    fill();
  });
  fill();
  out.append(h("div", { class: "search" }, icon("search"), input), box);
  return out;
}

function table(head, rows) {
  return h("table", null, h("thead", null, h("tr", null, ...head.map((x, i) => h("th", { class: i ? "num" : "" }, x)))), h("tbody", null, ...rows.map((r) => h("tr", null, ...r.map((c, i) => h("td", { class: i ? "num" : "" }, c))))));
}
function usagePage() {
  const out = h("div", { class: "page" }, pageHead("Usage", "Tokens and estimated cost from list prices. Your provider's bill is what counts."), rangeSeg());
  const u = state.usage;
  if (!u) return (out.append(h("div", { class: "muted" }, "Loading…")), out);
  const t = u.totals;
  const saved = state.routing && state.routing.savings7d;
  out.append(bento(
    costTile(u, `${fmtTokens(t.inputTokens)} in · ${fmtTokens(t.outputTokens)} out`),
    tile("Model calls", String(t.calls)),
    tile("Tokens in / out", `${fmtTokens(t.inputTokens)} / ${fmtTokens(t.outputTokens)}`),
    wideTile([["Loops caught", String(t.loopsCaught)], ["Saved by caching", fmtUsd(t.cacheSavedUsd), "good"], ["Saved by routing, 7 days", saved ? fmtUsd(saved.savedUsd) : "$0.00", "good"]])
  ));
  const two = h("div", { class: "cols2" });
  out.append(two);
  if (u.byModel.length) two.append(h("div", null, h("h2", null, "By model"), h("div", { class: "card" }, table(["Model", "Calls", "Tokens", "Cost"], u.byModel.map((m) => [m.model, String(m.calls), fmtTokens(m.inputTokens + m.outputTokens), fmtUsd(m.costUsd)])))));
  if (u.byAgent.length) {
    const names = new Map((state.agents || []).map((a) => [a.id, a.name]));
    two.append(h("div", null, h("h2", null, "By agent"), h("div", { class: "card" }, table(["Agent", "Calls", "Tokens", "Cost"], u.byAgent.map((a) => [names.get(a.agentId) || a.agentId, String(a.calls), fmtTokens(a.inputTokens + a.outputTokens), fmtUsd(a.costUsd)])))));
  }
  return out;
}

const MODES = [
  ["suggest", "Suggest", "Tells you when a cheaper model could do a turn and what it would save. Changes nothing.", "info"],
  ["auto", "Automatic", "Small turns run on a cheaper model and go back to yours when the work needs it or the cheaper one struggles. Never more expensive than yours.", "bolt"],
  ["off", "Off", "Your agents always use the model you chose.", "off"],
];
function modelsPage() {
  const out = h("div", { class: "page" }, pageHead("Models", "Run small turns on a cheaper model, and move back up when it struggles"));
  const r = state.routing;
  if (!r) return (out.append(h("div", { class: "muted" }, "Loading…")), out);
  out.append(h("h2", { style: "margin-top:0" }, "Routing mode"));
  const list = h("div", { class: "list" });
  for (const [v, label, text, ic] of MODES) {
    const radio = h("input", { type: "radio", name: "mode", id: "m-" + v, checked: r.config.mode === v, "aria-label": label });
    radio.addEventListener("change", () => act(radio, () => api("/api/routing", { mode: v })));
    list.append(lrow({ ic, tone: r.config.mode === v ? "accent" : "", title: label, tag: v === "suggest" ? chip("default") : null, text, right: radio }));
  }
  out.append(list);
  const s = r.savings7d;
  out.append(h("h2", null, "Last 7 days"), h("div", { class: "stats" }, stat("Requests moved", String(s.calls)), stat("Estimated saved", fmtUsd(s.savedUsd))));
  out.append(h("h2", null, "Recent decisions"));
  out.append(r.decisions.length ? h("div", { class: "list" }, ...r.decisions.slice(0, 12).map((d) => lrow({ ic: "route", title: d.message, right: ago(d.ts) }))) : h("div", { class: "muted" }, "No decisions yet."));
  out.append(h("p", { class: "muted", style: "margin-top:20px" }, "Change which models small turns go to with ", code("argus route set trivial <model> low"), "."));
  return out;
}

const COMMANDS = [
  ["argus run claude", "Start Claude Code in this terminal, supervised"],
  ["argus run codex", "Start the Codex CLI, supervised"],
  ["argus ide", "Supervise the Claude Code panel in VS Code, Antigravity or Cursor"],
  ["argus proxy", "Supervise an agent you start yourself"],
  ['argus autopilot "your goal"', "Plan and build something step by step, checking every step"],
  ["argus autopilot status", "Autopilot runs and their progress"],
  ["argus status", "Every agent and what it is doing"],
  ["argus pause", "Pause an agent"],
  ['argus resume [--approve | --hint "..."]', "Continue a paused agent"],
  ["argus stop", "End an agent"],
  ["argus alerts", "What ArgusOps noticed"],
  ["argus usage", "Tokens and estimated cost"],
  ["argus route [suggest|auto|off]", "How model routing behaves"],
  ["argus project allow", "Let ArgusOps run this project's tests and checks"],
  ["argus supervisor [alert|redirect]", "Only tell you, or also tell the agent what to fix"],
  ["argus check · argus watch", "Check work done by any agent, including ones ArgusOps cannot control"],
  ["argus agents", "Agents on this computer and what ArgusOps can do for each"],
  ["argus tui", "This app's screens inside the terminal"],
];
function commandsPage() {
  const out = h("div", { class: "page" }, pageHead("All commands", "Everything you can do here, you can also do from a terminal"));
  const input = h("input", { type: "text", placeholder: "Search commands", "aria-label": "Search commands" });
  input.value = state.cmdQuery;
  const box = h("div", { class: "list" });
  const fill = () => {
    const q = state.cmdQuery.trim().toLowerCase();
    box.replaceChildren(...COMMANDS.filter(([c, d]) => !q || (c + " " + d).toLowerCase().includes(q)).map(([c, d]) => cmdRow(c, d)));
  };
  input.addEventListener("input", () => {
    state.cmdQuery = input.value;
    fill();
  });
  fill();
  out.append(h("div", { class: "search" }, icon("search"), input), box);
  return out;
}

function currentPage() {
  const v = state.view;
  if (v.page === "agent") {
    const a = (state.agents || []).find((x) => x.id === v.id);
    if (a) return agentPage(a);
  } else if (v.page === "run") {
    const r = (state.autopilot || []).find((x) => x.id === v.id);
    if (r) return runPage(r);
  } else if (v.page === "autopilot") return autopilotPage();
  else if (v.page === "autopilot-new") return state.canStartAutopilot ? newRunPage() : autopilotPage();
  else if (v.page === "editors") return editorsPage();
  else if (v.page === "alerts") return alertsPage();
  else if (v.page === "usage") return usagePage();
  else if (v.page === "models") return modelsPage();
  else if (v.page === "commands") return commandsPage();
  state.view = { page: "overview" };
  return overviewPage();
}

/* ---------------------------------- popup ---------------------------------- */
function startShortcuts() {
  const rows = [];
  const open = (label, text, ic, view) => {
    const b = h("button", { class: "btn small", type: "button" }, "Open");
    b.addEventListener("click", () => {
      state.open = null;
      go(view);
    });
    rows.push(lrow({ ic, tone: "accent", title: label, text, right: b }));
  };
  if (state.canStartAutopilot) open("New Autopilot run", "Give it a goal here in the app", "route", { page: "autopilot-new" });
  if (state.editors.available) open("Connect your editor", "Supervise the Claude Code panel in VS Code or Antigravity", "plug", { page: "editors" });
  return rows;
}
function closePopup() {
  state.open = null;
  lastShown = "";
  render(true);
}
function renderModal() {
  if (state.open !== "start") {
    modal.hidden = true;
    modal.replaceChildren();
    return;
  }
  const was = !modal.hidden;
  modal.hidden = false;
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon("x"));
  close.addEventListener("click", closePopup);
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Start an agent", tabindex: "-1" },
    h("div", { class: "dialog-head" }, h("span", { class: "title" }, "Start an agent"), close),
    h("div", { class: "dialog-body" }, h("p", { class: "muted", style: "margin-top:0" }, "Run one of these in your project folder. The agent shows up here as soon as it starts."), h("div", { class: "list" },
      ...startShortcuts(),
      cmdRow("argus run claude", "Claude Code in a terminal", "agent"),
      cmdRow("argus run codex", "The Codex CLI with an API key", "agent"),
      cmdRow("argus ide", "The Claude Code panel in your editor", "terminal"),
      cmdRow('argus autopilot "your goal"', "Let Autopilot plan and build it", "route"))));
  modal.replaceChildren(dlg);
  if (!was) dlg.focus();
}
modal.addEventListener("click", (e) => {
  if (e.target === modal) closePopup();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state.open) closePopup();
  else if (state.menu) {
    state.menu = false;
    lastShown = "";
    render(true);
  }
});
document.addEventListener("click", (e) => {
  if (state.menu && !(e.target.closest && e.target.closest(".menu"))) {
    state.menu = false;
    lastShown = "";
    render(true);
  }
});

/* ---------------------------------- loop ---------------------------------- */
let lastShown = "";
function render(force) {
  const conn = $("#conn");
  conn.textContent = state.error || "connected";
  conn.className = "conn" + (state.error ? " bad" : "");
  if (!token) {
    main.replaceChildren(h("div", { class: "page" }, emptyState("shield", ["This window needs your ArgusOps token. Open it with ", code("argus app"), "."])));
    return;
  }
  // do not wipe something the person is typing
  const a = document.activeElement;
  const typing = a && (main.contains(a) || modal.contains(a)) && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text"));
  const snapshot = JSON.stringify([state.agents, state.alerts, state.autopilot, state.usage, state.routing, state.range, state.view, state.open, state.menu, state.alertFilter, state.canStartAutopilot, state.editors]);
  if (!force && (typing || snapshot === lastShown)) return;
  lastShown = snapshot;
  renderSide();
  main.replaceChildren(currentPage());
  renderModal();
}

async function refresh() {
  if (!token) return render(true);
  try {
    const [ag, al, ap, rt, us, ed] = await Promise.all([api("/api/agents"), api("/api/alerts?limit=50"), api("/api/autopilot"), api("/api/routing"), api("/api/usage?range=" + state.range), api("/api/editors").catch(() => ({ available: false, connections: [] }))]);
    state.canStartAutopilot = !!ap.canStart;
    state.editors = { available: !!ed.available, connections: ed.connections || [] };
    state.agents = ag.agents;
    state.alerts = al.alerts ?? al.notifications ?? [];
    state.autopilot = ap.runs;
    state.routing = rt;
    state.usage = us;
    state.error = null;
  } catch (e) {
    state.error = e.status === 401 ? "wrong token: reopen the app" : "can't reach ArgusOps";
  }
  render(false);
}

/* light / dark: follows the system until the person picks; the choice is remembered when storage allows */
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  $("#theme").replaceChildren(icon(isDark() ? "sun" : "moon"));
}
try {
  applyTheme(localStorage.getItem("argus-theme"));
} catch {
  applyTheme(null);
}
$("#theme").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("argus-theme", next);
  } catch {
    /* not remembered */
  }
});

refresh();
setInterval(refresh, 2000);
