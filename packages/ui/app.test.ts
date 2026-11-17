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
  const dom = new JSDOM(html, { runScripts: "outside-only", url: `http://127.0.0.1:47822/${o.hash ?? (o.stored ? "#tab=agents" : "")}`, pretendToBeVisual: true });
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

describe("the app's page", () => {
  it("takes the token from the address fragment, hides it, and sends it with every request", async () => {
    const { w, calls } = start({ hash: "#t=abc123" });
    await flush();
    expect(w.location.hash).toBe("");
    expect(w.location.href).not.toContain("abc123");
    expect(w.sessionStorage.getItem("argus-token")).toBe("abc123");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.token === "abc123")).toBe(true);
  });

  it("without a token it asks you to use `argus ui` and calls nothing", async () => {
    const { doc, calls } = start();
    await flush();
    expect(doc.getElementById("main")!.textContent).toContain("argus ui");
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
    gone.w.document.querySelector('[data-tab="alerts"]').click();
    await new Promise((r) => setTimeout(r, 2100));
    expect(gone.doc.getElementById("conn")!.textContent).toContain("can't reach");
  });

  it("shows agents, and what an agent writes can never become markup or script", async () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
    const { doc, w } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ name: evil, status: "PAUSED", desired: "PAUSE", reason: evil, suggestion: { id: "s", text: evil, observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" } })], unreadAlerts: 0 }, "/api/alerts": { alerts: [{ id: "n1", ts: 1, title: evil, body: evil, level: "WARN", read: false }] } } });
    await flush();
    const main = doc.getElementById("main")!;
    expect(main.textContent).toContain(evil);
    expect(main.querySelector("img, script, iframe")).toBeNull();
    (doc.querySelector('[data-tab="alerts"]') as HTMLElement).click();
    expect(main.textContent).toContain(evil);
    expect(main.querySelector("img, script, iframe")).toBeNull();
    expect(w.pwned).toBeUndefined();
  });

  it("an empty state tells you what to run", async () => {
    const { doc } = start({ stored: "t", routes: { "/api/agents": { agents: [], unreadAlerts: 0 } } });
    await flush();
    expect(doc.getElementById("main")!.textContent).toContain("argus run claude");
  });

  it("a paused agent: edit ArgusOps' suggestion and send it", async () => {
    const { doc, calls } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ status: "PAUSED", desired: "PAUSE", reason: "Repeated 3 times: npm test", suggestion: { id: "s", text: "Stop re-running npm test.", observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" } })], unreadAlerts: 0 } } });
    await flush();
    expect(doc.getElementById("b-agents")!.hidden).toBe(false); // needs you
    const ta = doc.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("Stop re-running npm test.");
    ta.value = "Read the failing test first.";
    ta.dispatchEvent(new (doc.defaultView as any).Event("input"));
    const send = Array.from(doc.querySelectorAll("button")).find((b) => b.textContent === "Send this and continue")!;
    send.click();
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.path === "/api/agents/ag_1/approve")!;
    expect(post.body).toEqual({ text: "Read the failing test first." });
    expect(post.token).toBe("t");
  });

  it("a running agent can be paused, and stopping asks first", async () => {
    const { doc, calls, w } = start({ stored: "t" });
    await flush();
    const find = (label: string) => Array.from(doc.querySelectorAll("button")).find((b) => b.textContent === label)!;
    find("Pause").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/pause" && c.method === "POST")).toBe(true);
    w.confirm = () => false;
    find("Stop").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/stop")).toBe(false);
    w.confirm = () => true;
    find("Stop").click();
    await flush();
    expect(calls.some((c) => c.path === "/api/agents/ag_1/stop")).toBe(true);
  });

  it("Autopilot: steps, a step that needed attempts, and what needs you", async () => {
    const run = { id: "ap_1", goal: "build a todo app", root: "/p", status: "needs-you", createdAt: 1, updatedAt: Date.now(), costUsd: 0.25, control: null, needsYou: "Step 2 did not pass after 3 attempts.", steps: [{ title: "Set up", size: "small", status: "passed", attempts: 1, problems: [] }, { title: "Add storage", size: "large", status: "failed", attempts: 3, problems: ["npm test fails"] }], log: [{ ts: 1, message: "Step 1/2: Set up" }] };
    const { doc } = start({ stored: "t", routes: { "/api/autopilot": { runs: [run] } } });
    await flush();
    (doc.querySelector('[data-tab="autopilot"]') as HTMLElement).click();
    const text = doc.getElementById("main")!.textContent!;
    expect(text).toContain("build a todo app");
    expect(text).toContain("1. Set up");
    expect(text).toContain("3 attempts");
    expect(text).toContain("npm test fails");
    expect(text).toContain("argus autopilot resume ap_1");
  });

  it("Usage and Models show the numbers, and switching the mode posts it", async () => {
    const { doc, calls } = start({ stored: "t" });
    await flush();
    (doc.querySelector('[data-tab="usage"]') as HTMLElement).click();
    await flush();
    expect(doc.getElementById("main")!.textContent).toContain("claude-sonnet-5-5");
    expect(doc.getElementById("main")!.textContent).toContain("$0.50");
    (doc.querySelector('[data-tab="routing"]') as HTMLElement).click();
    const auto = doc.getElementById("m-auto") as HTMLInputElement;
    expect((doc.getElementById("m-suggest") as HTMLInputElement).checked).toBe(true);
    auto.checked = true;
    auto.dispatchEvent(new (doc.defaultView as any).Event("change"));
    await flush();
    expect(calls.find((c) => c.path === "/api/routing" && c.method === "POST")!.body).toEqual({ mode: "auto" });
  });

  it("loads no script or style from anywhere but itself", () => {
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/<script>[^<]/); // no inline script (the page's security policy forbids it)
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});

describe("an agent that stopped checking in", () => {
  it("is shown as not running, with no controls and no 'needs you' badge", async () => {
    const old = Date.now() - 5 * 60_000;
    const { doc } = start({ stored: "t", routes: { "/api/agents": { agents: [agent({ lastSeen: old }), agent({ id: "ag_2", name: "Held", status: "PAUSED", desired: "PAUSE", reason: "loop", lastSeen: old })], unreadAlerts: 0 } } });
    await flush();
    const text = doc.getElementById("main")!.textContent!;
    expect(text).toContain("not running");
    expect(text).toContain("paused (not running)");
    expect(Array.from(doc.querySelectorAll("#main button"))).toHaveLength(0);
    expect(doc.getElementById("b-agents")!.hidden).toBe(true);
  });
});

describe("the overview", () => {
  it("is the landing page: counts, who needs you, and spend", async () => {
    const waiting = agent({ id: "ag_2", name: "Held agent", status: "PAUSED", desired: "PAUSE", reason: "Repeated 3 times: npm test" });
    const { doc } = start({ stored: "t", hash: "#x=1", routes: { "/api/agents": { agents: [agent(), waiting], unreadAlerts: 0 } } });
    await flush();
    expect(doc.querySelector('[data-tab="overview"]')!.getAttribute("aria-selected")).toBe("true");
    expect(doc.getElementById("title")!.textContent).toBe("Overview");
    const text = doc.getElementById("main")!.textContent!;
    expect(text).toContain("agents running");
    expect(text).toContain("Held agent");
    expect(text).toContain("Repeated 3 times: npm test");
    expect(text).toContain("$0.50");
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
});

describe("opening on a tab", () => {
  it("#t=<token>&tab=usage opens the Usage tab", async () => {
    const { doc } = start({ hash: "#t=abc&tab=usage" });
    await flush();
    expect(doc.querySelector('[data-tab="usage"]')!.getAttribute("aria-selected")).toBe("true");
    expect(doc.getElementById("main")!.textContent).toContain("claude-sonnet-5-5");
  });
});

describe("styles under the page's security policy", () => {
  it("never writes a style attribute through markup, and sizes the chart bars through the DOM", async () => {
    expect(js).not.toMatch(/setAttribute\(\s*["']style["']/);
    expect(html).not.toMatch(/\sstyle=/);
    const { doc } = start({ stored: "t", hash: "#tab=usage", routes: { "/api/usage": { ...usage, buckets: [{ bucket: "a", costUsd: 0.1 }, { bucket: "b", costUsd: 0.2 }] } } });
    await flush();
    const bars = Array.from(doc.querySelectorAll(".bar")) as HTMLElement[];
    expect(bars.map((b) => b.style.height)).toEqual(["50%", "100%"]);
  });
});
