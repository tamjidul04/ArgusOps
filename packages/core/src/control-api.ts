import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import nodePath from "node:path";
import type { AutopilotRun } from "./autopilot";
import { Controls } from "./control";
import { loadPrices } from "./prices";
import type { NotificationRow, Store } from "./store";
import { summarizeRouting, summarizeUsage } from "./usage";
import { parseRange } from "./usage-core";

/**
 * The local control API: how the desktop app, the terminal app and a future editor extension read ArgusOps' state and
 * pause, resume or stop agents. It listens on 127.0.0.1 only.
 *
 * Being on loopback is not enough on its own: any web page you visit can make your browser send requests to
 * 127.0.0.1. So every request must pass all of these:
 *   1. Host is exactly 127.0.0.1:<port> or localhost:<port>  (stops DNS rebinding: evil.example resolving to 127.0.0.1)
 *   2. No foreign Origin, and no cross-site Sec-Fetch-Site      (stops a web page from calling it through your browser)
 *   3. The secret token from <home>/control.token               (only programs that can read your files get in)
 *   4. POST bodies are application/json, small, and valid       (no form posts, no oversized input)
 * There are no CORS headers, so a browser never lets a foreign page read a response either.
 * Only /api/health answers without the token, and it says nothing beyond "ArgusOps is here".
 */

export interface ControlApiOptions {
  store: Store;
  port: number;
  version: string;
  /** The token to require. Defaults to the store's control token. */
  token?: string;
  /** Extra origins allowed to call the API (for example a future editor webview). Its own origin is always allowed. */
  allowedOrigins?: string[];
  onNotification?: (n: NotificationRow) => void;
  maxBodyBytes?: number;
  /** A folder with the app's web page (index.html, app.js, style.css). When given, GET / serves it. */
  uiDir?: string;
}

/** The only files the page is served from; nothing else on disk is reachable by name. */
const UI_FILES: Record<string, string> = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/style.css": "style.css" };
const UI_TYPES: Record<string, string> = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8" };
/** No inline script, nothing from other sites, no framing: a page that cannot be turned against the token it holds. */
const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface RunningControlApi {
  port: number;
  url: string;
  close(): Promise<void>;
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_MAX_BODY = 64 * 1024;
const TOKEN_HEADER = "x-argus-token";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Compares secrets in constant time (hashing first makes the lengths equal, so length leaks nothing either). */
function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) && given.length > 0;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(text);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, "Request body is too large."));
    }
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(new HttpError(413, "Request body is too large."));
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(parts).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        if (!v || typeof v !== "object" || Array.isArray(v)) return reject(new HttpError(400, "The body must be a JSON object."));
        resolve(v);
      } catch {
        reject(new HttpError(400, "The body is not valid JSON."));
      }
    });
    req.on("error", () => reject(new HttpError(400, "The request could not be read.")));
  });
}

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new HttpError(400, `"${key}" must be text.`);
  return v;
};

export function startControlApi(opts: ControlApiOptions): Promise<RunningControlApi> {
  const { store } = opts;
  const token = opts.token ?? store.token();
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const controls = new Controls(store, opts.onNotification);
  let boundPort = opts.port;

  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
  const allowedOrigins = () => new Set([`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`, ...(opts.allowedOrigins ?? [])]);

  /** Returns null when the request may proceed, or the reason it may not. */
  function gate(req: http.IncomingMessage): HttpError | null {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts().has(host)) return new HttpError(403, "Unexpected Host header.");

    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().has(origin)) return new HttpError(403, "Requests from web pages are not allowed.");

    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return new HttpError(403, "Requests from web pages are not allowed.");
    return null;
  }

  function authorized(req: http.IncomingMessage): boolean {
    const header = req.headers[TOKEN_HEADER];
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const given = (typeof header === "string" ? header : bearer ?? "").trim();
    return sameSecret(given, token);
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const blocked = gate(req);
    if (blocked) throw blocked;

    if (path === "/api/health") {
      if (method !== "GET") throw new HttpError(405, "Use GET.");
      return send(res, 200, { ok: true, app: "argusops", version: opts.version });
    }

    if (method === "GET" && opts.uiDir && UI_FILES[path]) {
      const name = UI_FILES[path];
      let data: Buffer;
      try {
        data = fs.readFileSync(nodePath.join(opts.uiDir, name));
      } catch {
        throw new HttpError(404, "The app's page is not installed.");
      }
      res.writeHead(200, {
        "content-type": UI_TYPES[name],
        "content-length": data.length,
        "cache-control": "no-store",
        "content-security-policy": UI_CSP,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
      });
      return res.end(data);
    }
    if (!path.startsWith("/api/")) throw new HttpError(404, "Not found.");
    if (!authorized(req)) throw new HttpError(401, "Missing or wrong ArgusOps token.");

    let body: Record<string, unknown> = {};
    if (method === "POST") {
      const type = (req.headers["content-type"] ?? "").toLowerCase();
      if (!type.startsWith("application/json")) throw new HttpError(415, "Send JSON (content-type: application/json).");
      body = (await readBody(req, maxBody)) as Record<string, unknown>;
    } else if (method !== "GET") {
      throw new HttpError(405, "Use GET or POST.");
    }

    const get = (p: string) => method === "GET" && path === p;
    const post = (p: string) => method === "POST" && path === p;

    if (get("/api/agents")) {
      const unread = store.notifications(200).filter((n) => !n.read).length;
      return send(res, 200, { agents: store.agents().sort((a, b) => b.lastSeen - a.lastSeen), unreadAlerts: unread });
    }
    if (get("/api/usage")) {
      const summary = summarizeUsage(store.usage(), store.incidents(), parseRange(url.searchParams.get("range")), new Date(), loadPrices(store.root));
      return send(res, 200, summary);
    }
    if (get("/api/alerts")) {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      return send(res, 200, { alerts: store.notifications(limit) });
    }
    if (post("/api/alerts/read")) {
      const ids = body.ids;
      if (ids !== undefined && !(Array.isArray(ids) && ids.every((i) => typeof i === "string"))) throw new HttpError(400, '"ids" must be a list of alert ids.');
      await store.markNotificationsRead(ids as string[] | undefined);
      return send(res, 200, { ok: true });
    }
    if (get("/api/incidents")) {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      return send(res, 200, { incidents: store.incidents().slice(-limit).reverse() });
    }
    if (post("/api/routing")) {
      const mode = body.mode;
      if (mode !== "off" && mode !== "suggest" && mode !== "auto") throw new HttpError(400, '"mode" must be off, suggest or auto.');
      const cur = store.config().routing;
      await store.saveConfig({ routing: { ...cur, mode } });
      return send(res, 200, { ok: true, mode });
    }
    if (get("/api/autopilot")) {
      const runs = store.autopilotRuns<AutopilotRun>().slice(0, 20).map((r) => ({
        id: r.id,
        goal: r.goal,
        root: r.root,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        costUsd: r.costUsd,
        control: r.control,
        needsYou: r.needsYou,
        steps: r.plan.steps.map((st, i) => ({ title: st.title, size: st.size ?? null, status: r.steps[i]?.status ?? "pending", attempts: r.steps[i]?.attempts ?? 0, problems: r.steps[i]?.problems ?? [] })),
        log: r.log.slice(-12),
      }));
      return send(res, 200, { runs });
    }
    const ap = method === "POST" ? /^\/api\/autopilot\/([A-Za-z0-9_-]{1,64})\/(pause|stop)$/.exec(path) : null;
    if (ap) {
      const run = store.autopilotRun<AutopilotRun>(ap[1]);
      if (!run) throw new HttpError(404, `No Autopilot run "${ap[1]}".`);
      if (run.status === "done" || run.status === "stopped" || run.status === "failed") throw new HttpError(409, `That run is already ${run.status}.`);
      store.saveAutopilotRun({ ...run, control: ap[2] as "pause" | "stop" });
      return send(res, 200, { ok: true, message: ap[2] === "pause" ? "Autopilot will pause after the agent's current turn." : "Autopilot will stop after the agent's current turn." });
    }
    if (get("/api/routing")) {
      const since = Date.now() - 7 * 86_400_000;
      return send(res, 200, { config: store.config().routing, savings7d: summarizeRouting(store.usage(), since), decisions: store.routing(since).slice(-50).reverse() });
    }
    if (get("/api/config")) {
      const c = store.config();
      return send(res, 200, { policy: c.policy, webhooks: c.webhooks, proxyPort: c.proxyPort, apiPort: c.apiPort });
    }

    const m = /^\/api\/agents\/([^/]+)\/(pause|resume|approve|dismiss|stop)$/.exec(path);
    if (m) {
      if (method !== "POST") throw new HttpError(405, "Use POST.");
      let id = "";
      try {
        id = decodeURIComponent(m[1]);
      } catch {
        // malformed percent-encoding: falls through to the invalid-id answer
      }
      if (!AGENT_ID.test(id)) throw new HttpError(400, "That is not a valid agent id.");
      if (!store.agent(id)) throw new HttpError(404, `No agent with id "${id}".`);
      const action = m[2];
      const result =
        action === "pause"
          ? await controls.pause(id, optionalString(body, "reason"))
          : action === "resume"
            ? await controls.resume(id, optionalString(body, "hint"))
            : action === "approve"
              ? await controls.applySuggestion(id, optionalString(body, "text"))
              : action === "dismiss"
                ? await controls.dismissSuggestion(id)
                : await controls.stop(id);
      return result.ok ? send(res, 200, { ok: true, message: result.message, agent: store.agent(id) }) : send(res, 409, { ok: false, error: result.error });
    }

    throw new HttpError(404, "Not found.");
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
      send(res, 500, { ok: false, error: "Something went wrong inside ArgusOps." });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  return new Promise((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "EADDRINUSE" ? new Error(`Port ${opts.port} is already in use. Is ArgusOps already serving? Pick another port with --port.`) : e)
    );
    server.listen(opts.port, "127.0.0.1", () => {
      boundPort = (server.address() as { port: number }).port;
      resolve({
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}
