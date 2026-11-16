import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startControlApi, type RunningControlApi } from "./control-api";
import { Store, type AgentRecord } from "./store";

const closers: Array<() => Promise<void>> = [];
const dirs: string[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const TOKEN = "a".repeat(64);

async function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-api-"));
  dirs.push(d);
  const store = new Store(d);
  const api = await startControlApi({ store, port: 0, version: "9.9.9", token: TOKEN });
  closers.push(api.close);
  return { store, api };
}

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "ag_one",
  name: "Claude Code · shop",
  type: "CLAUDE",
  status: "PAUSED",
  runId: "r",
  startedAt: 1,
  lastSeen: Date.now(),
  tokensUsed: 10,
  desired: "PAUSE",
  reason: "loop",
  suggestion: { id: "s1", text: "Stop re-running npm test.", observed: "o", tokensBefore: 1, source: "rule", createdAt: 1, status: "PENDING" },
  ...over,
});

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
  raw: string;
}

/** Raw HTTP so the tests can send exactly the headers an attacker could (fetch forbids setting Host). */
function call(api: RunningControlApi, method: string, p: string, o: { headers?: Record<string, string>; body?: string; token?: string | null } = {}): Promise<Res> {
  const headers: Record<string, string> = { host: `127.0.0.1:${api.port}`, ...(o.headers ?? {}) };
  if (o.token !== null) headers["x-argus-token"] = o.token ?? TOKEN;
  if (o.body !== undefined) headers["content-length"] = String(Buffer.byteLength(o.body));
  // an empty Host means "send no Host header at all" (Node would otherwise fill in a default one)
  const noHost = headers.host === "";
  if (noHost) delete headers.host;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: api.port, method, path: p, headers, setHost: !noHost }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(parts).toString("utf8");
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw);
        } catch {
          // not JSON
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, raw });
      });
    });
    req.on("error", reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}
const json = { "content-type": "application/json" };

describe("control API: who may call it", () => {
  it("listens on loopback only", async () => {
    const { api } = await setup();
    expect(api.url).toBe(`http://127.0.0.1:${api.port}`);
  });

  it("answers health without the token, revealing nothing else", async () => {
    const { api } = await setup();
    const r = await call(api, "GET", "/api/health", { token: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, app: "argusops", version: "9.9.9" });
  });

  it("refuses everything else without the right token", async () => {
    const { api } = await setup();
    expect((await call(api, "GET", "/api/agents", { token: null })).status).toBe(401);
    expect((await call(api, "GET", "/api/agents", { token: "b".repeat(64) })).status).toBe(401);
    expect((await call(api, "GET", "/api/agents", { token: TOKEN.slice(0, 63) })).status).toBe(401);
    expect((await call(api, "GET", "/api/agents", { token: "" })).status).toBe(401);
  });

  it("accepts the token as x-argus-token or as a Bearer token", async () => {
    const { api } = await setup();
    expect((await call(api, "GET", "/api/agents")).status).toBe(200);
    expect((await call(api, "GET", "/api/agents", { token: null, headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
  });

  it("rejects a foreign Host header even with the token (DNS rebinding)", async () => {
    const { api } = await setup();
    for (const host of ["evil.example", `evil.example:${api.port}`, "127.0.0.1", `127.0.0.1:${api.port + 1}`]) {
      const r = await call(api, "GET", "/api/agents", { headers: { host } });
      expect(r.status, `host "${host}"`).toBe(403);
    }
    // no Host at all: Node's HTTP server already refuses it (400) before our check runs
    expect([400, 403]).toContain((await call(api, "GET", "/api/agents", { headers: { host: "" } })).status);
    expect((await call(api, "GET", "/api/health", { token: null, headers: { host: "evil.example" } })).status).toBe(403);
    expect((await call(api, "GET", "/api/agents", { headers: { host: `localhost:${api.port}` } })).status).toBe(200);
  });

  it("rejects calls made by a web page through the browser, even with the token", async () => {
    const { api } = await setup();
    for (const origin of ["https://evil.example", "null", `http://127.0.0.1:${api.port + 1}`, "http://localhost"]) {
      const r = await call(api, "GET", "/api/agents", { headers: { origin } });
      expect(r.status, `origin "${origin}"`).toBe(403);
    }
    for (const site of ["cross-site", "same-site"]) {
      expect((await call(api, "GET", "/api/agents", { headers: { "sec-fetch-site": site } })).status).toBe(403);
    }
    const stop = await call(api, "POST", "/api/agents/ag_one/stop", { headers: { ...json, origin: "https://evil.example" }, body: "{}" });
    expect(stop.status).toBe(403);
  });

  it("allows its own origin (for the local dashboard it will serve) and configured extras", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-api-"));
    dirs.push(d);
    const api = await startControlApi({ store: new Store(d), port: 0, version: "1", token: TOKEN, allowedOrigins: ["vscode-webview://abc"] });
    closers.push(api.close);
    expect((await call(api, "GET", "/api/agents", { headers: { origin: `http://127.0.0.1:${api.port}`, "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await call(api, "GET", "/api/agents", { headers: { origin: "vscode-webview://abc" } })).status).toBe(200);
  });

  it("never sends CORS headers, even to a preflight", async () => {
    const { api } = await setup();
    const r = await call(api, "GET", "/api/agents");
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await call(api, "OPTIONS", "/api/agents", { token: null, headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(403);
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("does not put the token in any response", async () => {
    const { api, store } = await setup();
    await store.updateAgent("ag_one", () => agent());
    for (const p of ["/api/agents", "/api/config", "/api/routing", "/api/alerts", "/api/usage", "/api/incidents", "/api/health"]) {
      expect((await call(api, "GET", p)).raw).not.toContain(TOKEN);
    }
  });

  it("uses the store's token file by default", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-api-"));
    dirs.push(d);
    const store = new Store(d);
    const api = await startControlApi({ store, port: 0, version: "1" });
    closers.push(api.close);
    expect((await call(api, "GET", "/api/agents", { token: store.token() })).status).toBe(200);
    expect((await call(api, "GET", "/api/agents")).status).toBe(401);
  });
});

describe("control API: input checks", () => {
  it("requires JSON for POST, and a small, valid object", async () => {
    const { api, store } = await setup();
    await store.updateAgent("ag_one", () => agent());
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "hint=x" })).status).toBe(415);
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: json, body: "{bad" })).status).toBe(400);
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: json, body: "[1,2]" })).status).toBe(400);
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: json, body: JSON.stringify({ hint: 5 }) })).status).toBe(400);
    expect((await call(api, "POST", "/api/agents/ag_one/resume", { headers: json, body: JSON.stringify({ hint: "x".repeat(70_000) }) })).status).toBe(413);
    expect(store.agent("ag_one")?.desired).toBe("PAUSE"); // nothing above changed anything
  });

  it("validates agent ids and methods", async () => {
    const { api } = await setup();
    expect((await call(api, "POST", "/api/agents/..%2F..%2Fetc/stop", { headers: json, body: "{}" })).status).toBe(400);
    expect((await call(api, "POST", "/api/agents/%E0%A4%A/stop", { headers: json, body: "{}" })).status).toBe(400);
    expect((await call(api, "POST", "/api/agents/ag_missing/stop", { headers: json, body: "{}" })).status).toBe(404);
    expect((await call(api, "GET", "/api/agents/ag_one/stop")).status).toBe(405);
    expect((await call(api, "DELETE", "/api/agents")).status).toBe(405);
    expect((await call(api, "GET", "/api/nope")).status).toBe(404);
    expect((await call(api, "GET", "/")).status).toBe(404);
  });
});

describe("control API: what it does", () => {
  it("lists agents and unread alerts", async () => {
    const { api, store } = await setup();
    await store.updateAgent("ag_one", () => agent());
    store.appendNotification({ title: "paused", body: "", level: "WARN" });
    const r = await call(api, "GET", "/api/agents");
    expect(r.body.unreadAlerts).toBe(1);
    expect((r.body.agents as AgentRecord[])[0].id).toBe("ag_one");
  });

  it("resumes with a hint, approves or dismisses the suggestion, pauses and stops", async () => {
    const { api, store } = await setup();
    await store.updateAgent("ag_one", () => agent());

    const resumed = await call(api, "POST", "/api/agents/ag_one/resume", { headers: json, body: JSON.stringify({ hint: "use the other config" }) });
    expect(resumed.status).toBe(200);
    expect(store.agent("ag_one")).toMatchObject({ desired: "RUN", hint: "use the other config" });

    await call(api, "POST", "/api/agents/ag_one/pause", { headers: json, body: "{}" });
    expect(store.agent("ag_one")?.desired).toBe("PAUSE");

    const approved = await call(api, "POST", "/api/agents/ag_one/approve", { headers: json, body: JSON.stringify({ text: "edited words" }) });
    expect(approved.status).toBe(200);
    expect(store.agent("ag_one")).toMatchObject({ desired: "RUN", hint: "edited words" });
    expect(store.agent("ag_one")?.suggestion?.status).toBe("APPLIED");

    const again = await call(api, "POST", "/api/agents/ag_one/approve", { headers: json, body: "{}" });
    expect(again.status).toBe(409); // nothing pending any more

    const stopped = await call(api, "POST", "/api/agents/ag_one/stop", { headers: json, body: "" });
    expect(stopped.status).toBe(200);
    expect(store.agent("ag_one")).toMatchObject({ desired: "KILL", status: "STOPPED" });
  });

  it("dismisses a suggestion", async () => {
    const { api, store } = await setup();
    await store.updateAgent("ag_one", () => agent());
    expect((await call(api, "POST", "/api/agents/ag_one/dismiss", { headers: json, body: "{}" })).status).toBe(200);
    expect(store.agent("ag_one")?.suggestion?.status).toBe("DISMISSED");
  });

  it("returns usage, alerts, incidents and config, and marks alerts read", async () => {
    const { api, store } = await setup();
    store.appendUsage({ ts: Date.now() - 1000, agentId: "ag_one", provider: "anthropic", model: "claude-sonnet-x", input_tokens: 100, output_tokens: 10, cache_read_tokens: 0, latency_ms: 1, cost_usd: 0.001 });
    const n = store.appendNotification({ title: "paused", body: "", level: "WARN" });
    const usage = await call(api, "GET", "/api/usage?range=24h");
    expect(usage.body.range).toBe("24h");
    expect((usage.body.totals as { calls: number }).calls).toBe(1);
    expect(((await call(api, "GET", "/api/alerts?limit=5")).body.alerts as unknown[]).length).toBe(1);
    expect((await call(api, "GET", "/api/incidents")).body.incidents).toEqual([]);
    expect((await call(api, "GET", "/api/config")).body).toMatchObject({ proxyPort: 47821, apiPort: 47822 });
    expect((await call(api, "GET", "/api/routing")).body).toMatchObject({ config: { mode: "suggest" }, savings7d: { calls: 0 }, decisions: [] });
    expect((await call(api, "POST", "/api/alerts/read", { headers: json, body: JSON.stringify({ ids: [n.id] }) })).status).toBe(200);
    expect(store.notifications()[0].read).toBe(true);
    expect((await call(api, "POST", "/api/alerts/read", { headers: json, body: JSON.stringify({ ids: [1] }) })).status).toBe(400);
  });

  it("reports a taken port clearly", async () => {
    const { api, store } = await setup();
    await expect(startControlApi({ store, port: api.port, version: "1", token: TOKEN })).rejects.toThrow(/already in use/);
  });
});
