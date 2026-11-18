import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

const open: JSDOM[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.window.close();
});

interface Call {
  path: string;
  method: string;
  token: string | null;
  body: unknown;
}

const agent = (over: Record<string, unknown> = {}) => ({ id: "ag_1", name: "Claude Code · shop", type: "CLAUDE", status: "ACTIVE", runId: "r", startedAt: 1, lastSeen: Date.now(), tokensUsed: 1234, desired: "RUN", reason: "", suggestion: null, ...over });
const usage = { range: "7d", totals: { inputTokens: 1000, outputTokens: 200, calls: 3, costUsd: 0.5, cacheSavedUsd: 0, loopsCaught: 1 }, buckets: [{ bucket: "Mon", costUsd: 0.5 }], byAgent: [], byModel: [{ model: "claude-sonnet-5-5", calls: 3, inputTokens: 1000, outputTokens: 200, costUsd: 0.5 }] };
const routing = { config: { mode: "suggest" }, savings7d: { calls: 0, actualUsd: 0, originalUsd: 0, savedUsd: 0 }, decisions: [] };

function start(o: { hash?: string; stored?: string; routes?: Record<string, unknown>; status?: number } = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: `http://127.0.0.1:47822/${o.hash ?? ""}`, pretendToBeVisual: true });
  open.push(dom);
  const w = dom.window as unknown as Record<string, any>;
  if (o.stored) w.sessionStorage.setItem("argus-token", o.stored);
  const calls: Call[] = [];
  const routes: Record<string, unknown> = { "/api/agents": { agents: [agent()], unreadAlerts: 0 }, "/api/alerts": { alerts: [] }, "/api/autopilot": { runs: [] }, "/api/routing": routing, "/api/usage": usage, ...(o.routes ?? {}) };
  w.fetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const p = String(url).split("?")[0];
    calls.push({ path: String(url), method: init.method ?? "GET", token: init.headers?.["x-argus-token"] ?? null, body: init.body ? JSON.parse(init.body) : undefined });
    const status = o.status ?? (p in routes || init.method === "POST" ? 200 : 404);
    return { ok: status < 400, status, json: async () => (status >= 400 ? { error: "nope" } : routes[p] ?? { ok: true }) };
  };
  const alerts: string[] = [];
  w.alert = (m: string) => alerts.push(m);
  w.confirm = () => true;
  w.eval(js);
  return { dom, w, calls, alerts, doc: dom.window.document as Document };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const btn = (doc: Document, label: string, root = "#main") => Array.from(doc.querySelectorAll(`${root} button`)).find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
const nav = (doc: Document, page: string) => (doc.querySelector(`#side-top [data-page="${page}"]`) as HTMLElement).click();
const sideAgent = (doc: Document, name: string) => (Array.from(doc.querySelectorAll("#side-top .side-row")).find((b) => b.textContent!.includes(name)) as HTMLElement).click();
const mainText = (doc: Document) => doc.getElementById("main")!.textContent!;

describe("the app's window", () => {
  it("takes the token from the address fragment, hides it, and sends it with every request", async () => {
    const { w, calls } = start({ hash: "#t=abc123" });
    await flush();
    expect(w.location.hash).toBe("");
    expect(w.location.href).not.toContain("abc123");
    expect(w.sessionStorage.getItem("argus-token")).toBe("abc123");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.token === "abc123")).toBe(true);
  });

  it("without a token it says how to open it and calls nothing", async () => {
    const { doc, calls } = start();
    await flush();
    expect(mainText(doc)).toContain("argus app");
    expect(calls).toHaveLength(0);
  });

  it("says so when the token is wrong or the engine is gone", async () => {
    const wrong = start({ stored: "bad", status: 401 });
    await flush();
    expect(wrong.doc.getElementById("conn")!.textContent).toContain("wrong token");
    const gone = start({ stored: "x" });
    (gone.w.fetch as unknown) = async () => {
      throw new Error("offline");
    };
    await new Promise((r) => setTimeout(r, 2100));
    expect(gone.doc.getElementById("conn")!.textContent).toContain("can't reach");
  });

  it("opens on the overview: counts, what needs you, agents, and the sidebar lists them", async () => {
    const waiting = agent({ id: "ag_2", name: "Held agent", status: "PAUSED", desired: "PAUSE", reason: "Repeated 3 times: npm test" });
    const { doc } = start({ stored: "t", routes: { "/api/agents": { agents: [agent(), waiting], unreadAlerts: 0 } } });
    await flush();
    expect(doc.querySelector('[data-page="overview"]')!.getAttribute("aria-current")).toBe("page");
    const text = mainText(doc);
    expect(text).toContain("Agents running");
    expect(text).toContain("Needs you");
    expect(text).toContain("Held agent");
    expect(text).toContain("Repeated 3 times: npm test");
    expect(text).toContain("$0.50");
    const side = doc.getElementById("side-top")!.textContent!;
    expect(side).toContain("Claude Code · shop");
    expect(side).toContain("Held agent");
    expect(doc.title).toBe("(1) ArgusOps");
  });

  it("what an agent writes can never become markup or script", async () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
    const { doc, w } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ name: evil, status: "PAUSED", desired: "PAUSE", reason: evil, suggestion: { id: "s", text: evil, observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" } })], unreadAlerts: 0 }, "/api/alerts": { alerts: [{ id: "n1", ts: 1, title: evil, body: evil, level: "WARN", read: false }] } } });
    await flush();
    const main = doc.getElementById("main")!;
    const side = doc.getElementById("side-top")!;
    const clean = () => {
      expect(main.querySelector("img, script, iframe")).toBeNull();
      expect(side.querySelector("img, script, iframe")).toBeNull();
    };
    expect(main.textContent).toContain(evil);
    clean();
    sideAgent(doc, evil);
    expect(main.textContent).toContain(evil);
    clean();
    nav(doc, "alerts");
    expect(main.textContent).toContain(evil);
    clean();
    expect(w.pwned).toBeUndefined();
  });

  it("an empty overview tells you what to run, and Start an agent lists the commands", async () => {
    const { doc } = start({ stored: "t", routes: { "/api/agents": { agents: [], unreadAlerts: 0 } } });
    await flush();
    expect(mainText(doc)).toContain("No agent is being supervised yet");
    expect(mainText(doc)).toContain("argus run claude");
    (doc.getElementById("start") as HTMLElement).click();
    const modal = doc.getElementById("modal")!;
    expect(modal.hidden).toBe(false);
    expect(modal.textContent).toContain("argus run codex");
    expect(modal.textContent).toContain('argus autopilot "your goal"');
    doc.dispatchEvent(new (doc.defaultView as any).KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.hidden).toBe(true);
  });

  it("a paused agent's page: edit ArgusOps' suggestion and send it", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ status: "PAUSED", desired: "PAUSE", reason: "Repeated 3 times: npm test", suggestion: { id: "s", text: "Stop re-running npm test.", observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" } })], unreadAlerts: 0 } } });
    await flush();
    sideAgent(doc, "Claude Code · shop");
    expect(mainText(doc)).toContain("argus resume");
    const ta = doc.querySelector("#main textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("Stop re-running npm test.");
    ta.value = "Read the failing test first.";
    ta.dispatchEvent(new (doc.defaultView as any).Event("input"));
    btn(doc, "Send this and continue").click();
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/agents/ag_1/approve")!;
    expect(post.body).toEqual({ text: "Read the failing test first." });
    expect(post.token).toBe("t");
  });

  it("a running agent can be paused, and stopping asks first", async () => {
    const { doc, calls, w } = start({ stored: "t" });
    await flush();
    sideAgent(doc, "Claude Code · shop");
    btn(doc, "Pause").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/pause" && c.method === "POST")).toBe(true);
    w.confirm = () => false;
    btn(doc, "Stop").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/stop")).toBe(false);
    w.confirm = () => true;
    btn(doc, "Stop").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/stop")).toBe(true);
  });

  it("Autopilot: steps, a step that needed attempts, and what needs you", async () => {
    const run = { id: "ap_1", goal: "build a todo app", root: "/p", status: "needs-you", createdAt: 1, updatedAt: Date.now(), costUsd: 0.25, control: null, needsYou: "Step 2 did not pass after 3 attempts.", steps: [{ title: "Set up", size: "small", status: "passed", attempts: 1, problems: [] }, { title: "Add storage", size: "large", status: "failed", attempts: 3, problems: ["npm test fails"] }], log: [{ ts: 1, message: "Step 1/2: Set up" }] };
    const { doc } = start({ stored: "t", routes: { "/api/autopilot": { runs: [run] } } });
    await flush();
    expect(mainText(doc)).toContain("build a todo app"); // in Needs you
    sideAgent(doc, "build a todo app");
    const text = mainText(doc);
    expect(text).toContain("1. Set up");
    expect(text).toContain("3 attempts");
    expect(text).toContain("npm test fails");
    expect(text).toContain("argus autopilot resume ap_1");
  });

  it("Alerts: filter and search", async () => {
    const alerts = [{ id: "n1", ts: 1, title: "Loop caught", body: "npm test three times", level: "WARN", read: false }, { id: "n2", ts: 2, title: "Turn checked", body: "all good", level: "INFO", read: true }];
    const { doc, calls } = start({ stored: "t", routes: { "/api/alerts": { alerts } } });
    await flush();
    expect(doc.querySelector('[data-page="alerts"] .count')!.textContent).toBe("1");
    nav(doc, "alerts");
    expect(mainText(doc)).toContain("Turn checked");
    (doc.querySelector('#main .seg [data-value="unread"]') as HTMLElement).click();
    expect(mainText(doc)).not.toContain("Turn checked");
    (doc.querySelector('#main .seg [data-value="all"]') as HTMLElement).click();
    const search = doc.querySelector("#main .search input") as HTMLInputElement;
    search.value = "good";
    search.dispatchEvent(new (doc.defaultView as any).Event("input"));
    expect(mainText(doc)).not.toContain("Loop caught");
    expect(mainText(doc)).toContain("Turn checked");
    btn(doc, "Mark all as read").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/alerts/read" && c.method === "POST")).toBe(true);
  });

  it("Usage and Models show the numbers, and switching the mode posts it", async () => {
    const { doc, calls } = start({ stored: "t" });
    await flush();
    nav(doc, "usage");
    expect(mainText(doc)).toContain("claude-sonnet-5-5");
    expect(mainText(doc)).toContain("$0.50");
    (doc.querySelector('#main .seg [data-value="30d"]') as HTMLElement).click();
    await flush();
    expect(calls.some((c) => c.path === "/api/usage?range=30d")).toBe(true);
    nav(doc, "models");
    const auto = doc.getElementById("m-auto") as HTMLInputElement;
    expect((doc.getElementById("m-suggest") as HTMLInputElement).checked).toBe(true);
    auto.checked = true;
    auto.dispatchEvent(new (doc.defaultView as any).Event("change"));
    await flush();
    expect(calls.find((c) => c.path === "/api/routing" && c.method === "POST")!.body).toEqual({ mode: "auto" });
  });

  it("More opens a menu, and All commands lists and searches every command", async () => {
    const { doc } = start({ stored: "t" });
    await flush();
    (doc.getElementById("more") as HTMLElement).click();
    const menu = doc.querySelector("#side-top .menu")!;
    expect(menu.textContent).toContain("All commands");
    (Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "All commands") as HTMLElement).click();
    expect(doc.querySelector("#side-top .menu")).toBeNull();
    expect(mainText(doc)).toContain("argus project allow");
    const search = doc.querySelector("#main .search input") as HTMLInputElement;
    search.value = "codex";
    search.dispatchEvent(new (doc.defaultView as any).Event("input"));
    expect(mainText(doc)).toContain("argus run codex");
    expect(mainText(doc)).not.toContain("argus project allow");
  });

  it("switches between light and dark and remembers the choice", async () => {
    const { doc, w } = start({ stored: "t" });
    await flush();
    (doc.getElementById("theme") as HTMLElement).click();
    const first = doc.documentElement.dataset.theme;
    expect(["light", "dark"]).toContain(first);
    expect(w.localStorage.getItem("argus-theme")).toBe(first);
    (doc.getElementById("theme") as HTMLElement).click();
    expect(doc.documentElement.dataset.theme).not.toBe(first);
  });

  it("loads no script or style from anywhere but itself", () => {
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/<script>[^<]/); // no inline script (the page's security policy forbids it)
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});

describe("an agent that stopped checking in", () => {
  it("is shown as not running, with no controls and not counted as waiting", async () => {
    const old = Date.now() - 5 * 60_000;
    const { doc } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ lastSeen: old }), agent({ id: "ag_2", name: "Held", status: "PAUSED", desired: "PAUSE", reason: "loop", lastSeen: old })], unreadAlerts: 0 } } });
    await flush();
    expect(mainText(doc)).toContain("not running");
    expect(mainText(doc)).toContain("paused (not running)");
    expect(doc.title).toBe("ArgusOps");
    sideAgent(doc, "Held");
    expect(mainText(doc)).toContain("no longer connected");
    expect(btn(doc, "Pause")).toBeUndefined();
    expect(btn(doc, "Stop")).toBeUndefined();
  });
});

describe("styles under the page's security policy", () => {
  it("never writes a style attribute through markup, and sizes the chart bars through the DOM", async () => {
    expect(js).not.toMatch(/setAttribute\(\s*["']style["']/);
    expect(html).not.toMatch(/\sstyle=/);
    const { doc } = start({ stored: "t", routes: { "/api/usage": { ...usage, buckets: [{ bucket: "a", costUsd: 0.1 }, { bucket: "b", costUsd: 0.2 }] } } });
    await flush();
    nav(doc, "usage");
    const bars = Array.from(doc.querySelectorAll("#main .bar")) as HTMLElement[];
    expect(bars.map((b) => b.style.height)).toEqual(["50%", "100%"]);
  });
});

describe("the sidebar", () => {
  it("never shows the word null (a missing Autopilot heading must not become text)", async () => {
    const { doc } = start({ stored: "t" });
    await flush();
    expect(doc.getElementById("side-top")!.textContent).not.toContain("null");
  });
});

describe("Autopilot from the app", () => {
  const draft = (over: Record<string, unknown>) => ({ id: "ap_9", goal: "a todo app", root: "D:/work/todo", createdAt: 1, updatedAt: Date.now(), costUsd: 0, control: null, needsYou: null, steps: [], log: [], live: true, ...over });

  it("New run: goal and folder go to the engine, and nothing else is sent", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/autopilot": { runs: [], canStart: true } } });
    await flush();
    nav(doc, "autopilot");
    btn(doc, "New run").click();
    const goal = doc.querySelector("#main textarea") as HTMLTextAreaElement;
    goal.value = "a todo app";
    goal.dispatchEvent(new (doc.defaultView as any).Event("input"));
    const folder = doc.querySelector('#main input[type="text"]') as HTMLInputElement;
    folder.value = "D:/work/todo";
    folder.dispatchEvent(new (doc.defaultView as any).Event("input"));
    btn(doc, "Plan it").click();
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/autopilot")!;
    expect(post.body).toEqual({ goal: "a todo app", root: "D:/work/todo", questions: true });
  });

  it("without an engine that can build, it says how to start from a terminal and offers no New run", async () => {
    const { doc } = start({ stored: "t", routes: { "/api/autopilot": { runs: [], canStart: false } } });
    await flush();
    nav(doc, "autopilot");
    expect(mainText(doc)).toContain('argus autopilot "your goal"');
    expect(btn(doc, "New run")).toBeUndefined();
  });

  it("answers the planner's questions", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/autopilot": { runs: [draft({ status: "awaiting-answers", questions: ["Which language?", "Tests?"] })], canStart: true } } });
    await flush();
    sideAgent(doc, "a todo app");
    const inputs = Array.from(doc.querySelectorAll('#main input[type="text"]')) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    inputs[0].value = "JavaScript";
    inputs[0].dispatchEvent(new (doc.defaultView as any).Event("input"));
    btn(doc, "Continue").click();
    await flush();
    expect(calls.find((c) => c.path === "/api/autopilot/ap_9/answers")!.body).toEqual({ answers: ["JavaScript", ""] });
  });

  it("shows the whole plan and every command before approval, and approves that exact plan", async () => {
    const review = { planHash: "abc123", summary: "Build it", steps: [{ title: "Set up", size: "small", instructions: "Create package.json", checks: ['"npm test" succeeds'] }], commands: ["npm test"], git: "dirty", projectChecks: "none", answers: [] };
    const { doc, calls } = start({ stored: "t", routes: { "/api/autopilot": { runs: [draft({ status: "awaiting-approval", review, steps: [{ title: "Set up", status: "pending", attempts: 0, problems: [] }] })], canStart: true } } });
    await flush();
    sideAgent(doc, "a todo app");
    const text = mainText(doc);
    expect(text).toContain("Create package.json");
    expect(text).toContain("npm test");
    expect(text).toContain("uncommitted changes");
    btn(doc, "Approve and start").click();
    await flush();
    expect(calls.find((c) => c.path === "/api/autopilot/ap_9/approve")!.body).toEqual({ planHash: "abc123" });
  });

  it("a step that keeps failing: try again with your words, or skip it", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/autopilot": { runs: [draft({ status: "needs-you", needsYou: "Step 1 still fails after 3 attempts.", steps: [{ title: "Set up", status: "failed", attempts: 3, problems: ["npm test fails"] }] })], canStart: true } } });
    await flush();
    sideAgent(doc, "a todo app");
    const ta = doc.querySelector("#main textarea") as HTMLTextAreaElement;
    ta.value = "read the error first";
    ta.dispatchEvent(new (doc.defaultView as any).Event("input"));
    btn(doc, "Try again").click();
    await flush();
    expect(calls.find((c) => c.path === "/api/autopilot/ap_9/decide")!.body).toEqual({ action: "retry", instruction: "read the error first" });
  });
});

describe("Editors", () => {
  it("connects a folder and disconnects it", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/editors": { available: true, connections: [{ folder: "D:/work/shop", url: "http://127.0.0.1:5000", since: Date.now() }] } } });
    await flush();
    nav(doc, "editors");
    expect(mainText(doc)).toContain("Reload Window");
    expect(mainText(doc)).toContain("D:/work/shop");
    const folder = doc.querySelector('#main input[type="text"]') as HTMLInputElement;
    folder.value = "D:/work/app";
    folder.dispatchEvent(new (doc.defaultView as any).Event("input"));
    btn(doc, "Connect").click();
    await flush();
    expect(calls.find((c) => c.path === "/api/editors/connect")!.body).toEqual({ folder: "D:/work/app" });
    btn(doc, "Disconnect").click();
    await flush();
    expect(calls.find((c) => c.path === "/api/editors/disconnect")!.body).toEqual({ folder: "D:/work/shop" });
  });
});
