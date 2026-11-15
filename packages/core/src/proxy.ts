import http from "node:http";
import https from "node:https";
import { applyHint, SseUsageTap, usageFromJson, type UsageResult } from "./anthropic";
import type { LoopDetector } from "./detect";
import type { ControlState } from "./state";

/**
 * A small HTTP proxy that runs on the user's own machine, between the agent and the model provider.
 * Prompts and credentials go straight to the provider; only token counts and incidents leave the machine.
 *  - reads each request's conversation to spot a stuck agent and holds its next request (pause)
 *  - hands the operator's hint to the agent by adding it to the request that follows a resume
 *  - meters real token usage from the provider's response
 */

/**
 * What a stopped agent is told. It must be a FINAL error (403): a 503 "overloaded" makes Claude Code retry for a long
 * time, which in an editor panel looks like endless spinning. 403 stops it at once and shows this message.
 */
export const STOPPED_MESSAGE = "ArgusOps: this agent was stopped. Start a new session to continue.";

export interface UsageOut {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  latency_ms: number;
}

export interface IncidentOut {
  kind: "LOOP";
  loop_type: "EXACT_TOOL_LOOP";
  action: "PAUSED";
  score: number;
  detail: string;
  interception_ms: number;
  evidence: { unit: string[]; repeats: number };
}

export interface ProxyOptions {
  provider: string;
  upstream: string;
  state: ControlState;
  detector: LoopDetector;
  onUsage: (e: UsageOut) => void;
  onIncident: (e: IncidentOut) => void;
  onNotice?: (message: string) => void;
  maxBodyBytes?: number;
  /** Listen on this port instead of a random free one (used by `argus proxy`). */
  port?: number;
}

export interface RunningProxy {
  port: number;
  close: () => Promise<void>;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length"]);
const MESSAGES_PATH = /^\/v1\/messages(?:\?|$)/;

function errorBody(type: string, message: string) {
  return JSON.stringify({ type: "error", error: { type, message } });
}

export function startProxy(opts: ProxyOptions): Promise<RunningProxy> {
  const target = new URL(opts.upstream);
  const lib = target.protocol === "https:" ? https : http;
  const basePath = target.pathname.replace(/\/$/, "");
  const maxBody = opts.maxBodyBytes ?? 64 * 1024 * 1024;

  const send = (res: http.ServerResponse, status: number, type: string, message: string) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(errorBody(type, message));
  };

  function forward(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer | null, requestModel: string) {
    const started = Date.now();
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    headers.host = target.host;
    headers["accept-encoding"] = "identity"; // so token usage can be read from the response
    if (body) headers["content-length"] = String(body.length);

    const upReq = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: basePath + (req.url ?? "/"),
        headers,
      },
      (upRes) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(upRes.headers)) if (!["connection", "keep-alive", "transfer-encoding"].includes(k.toLowerCase())) outHeaders[k] = v;
        res.writeHead(upRes.statusCode ?? 502, outHeaders);

        const type = String(upRes.headers["content-type"] ?? "");
        const sse = type.includes("text/event-stream") ? new SseUsageTap() : null;
        const jsonParts: Buffer[] = [];
        let jsonSize = 0;
        const readJson = type.includes("application/json") && !sse;

        upRes.on("data", (chunk: Buffer) => {
          if (sse) sse.push(chunk);
          else if (readJson && jsonSize < 5_000_000) {
            jsonParts.push(chunk);
            jsonSize += chunk.length;
          }
        });
        upRes.on("end", () => {
          const ok = (upRes.statusCode ?? 0) >= 200 && (upRes.statusCode ?? 0) < 300;
          let usage: UsageResult | null = null;
          if (ok && sse) usage = sse.result();
          else if (ok && readJson) usage = usageFromJson(Buffer.concat(jsonParts).toString("utf8"));
          if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheReadTokens > 0)) {
            opts.onUsage({
              provider: opts.provider,
              model: usage.model !== "unknown" ? usage.model : requestModel || "unknown",
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cache_read_tokens: usage.cacheReadTokens,
              latency_ms: Date.now() - started,
            });
          }
        });
        upRes.pipe(res);
      }
    );

    upReq.on("error", (e) => send(res, 502, "api_error", `ArgusOps proxy could not reach the provider: ${e.message}`));
    res.on("close", () => {
      if (!res.writableEnded) upReq.destroy(); // the agent gave up, so stop the upstream call too
    });

    if (body) upReq.end(body);
    else req.pipe(upReq);
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (opts.state.isKilled()) return send(res, 403, "permission_error", STOPPED_MESSAGE);

    const isMessages = req.method === "POST" && MESSAGES_PATH.test(req.url ?? "");
    if (!isMessages) return forward(req, res, null, "");

    // read the whole request so the conversation can be inspected
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > maxBody) return send(res, 413, "request_too_large", "Request is too large for the ArgusOps proxy.");
      chunks.push(c as Buffer);
    }
    const raw = Buffer.concat(chunks);

    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      body = null; // not JSON: forward untouched
    }

    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) gone.abort();
    });

    // 1. is the agent stuck?
    if (body && opts.state.desired === "RUN") {
      const verdict = opts.detector.check(body);
      if (verdict.tripped) {
        opts.state.pauseLocally(verdict.reason);
        opts.onIncident({
          kind: "LOOP",
          loop_type: verdict.loopType,
          action: "PAUSED",
          score: verdict.score,
          detail: verdict.reason,
          interception_ms: verdict.interceptionMs,
          evidence: verdict.evidence,
        });
        opts.onNotice?.(`Paused: ${verdict.reason}. Resume it with "argus resume" or end it with "argus stop".`);
      }
    }

    // 2. hold the request while paused
    if (opts.state.desired === "PAUSE") {
      try {
        await opts.state.waitUntilNotPaused(gone.signal);
      } catch {
        return; // the agent disconnected while waiting
      }
      if (opts.state.isKilled()) return send(res, 403, "permission_error", STOPPED_MESSAGE);
      if (body) opts.detector.markResumed(body); // don't re-pause for history the operator already reviewed
      opts.onNotice?.("Resumed.");
    }

    // 3. pass on the operator's hint, once
    let out = raw;
    const model = typeof body?.model === "string" ? (body.model as string) : "";
    const hint = opts.state.takeHint();
    if (hint && body) {
      out = Buffer.from(JSON.stringify(applyHint(body, hint)), "utf8");
      opts.onNotice?.("Delivered your hint to the agent.");
    }
    forward(req, res, out, model);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, "api_error", `ArgusOps proxy error: ${e instanceof Error ? e.message : "unknown"}`));
  });
  server.keepAliveTimeout = 60_000;

  return new Promise((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "EADDRINUSE" ? new Error(`Port ${opts.port} is already in use. Is another \`argus proxy\` running? Pick another with --port.`) : e)
    );
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("proxy failed to bind"));
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}
