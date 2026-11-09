import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { startProxy, type IncidentOut, type RunningProxy, type UsageOut } from "./proxy";
import { LoopDetector } from "./detect";
import { ControlState } from "./state";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** A stand-in for api.anthropic.com. */
async function fakeUpstream(respond: (req: Seen, res: http.ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const s = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(parts).toString("utf8") };
      seen.push(s);
      respond(s, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { seen, url: `http://127.0.0.1:${port}`, port };
}

const sse = (res: http.ServerResponse, model = "claude-sonnet-4-5", input = 100, output = 40) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model, usage: { input_tokens: input, cache_read_input_tokens: 900, output_tokens: 1 } } })}\n\n`);
  res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}\n\n`);
  res.end(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: output } })}\n\n`);
};

async function setup(upstreamUrl: string, extra: { maxBodyBytes?: number } = {}) {
  const state = new ControlState();
  const detector = new LoopDetector();
  const usage: UsageOut[] = [];
  const incidents: IncidentOut[] = [];
  const notices: string[] = [];
  const proxy: RunningProxy = await startProxy({
    provider: "anthropic",
    upstream: upstreamUrl,
    state,
    detector,
    onUsage: (e) => usage.push(e),
    onIncident: (e) => incidents.push(e),
    onNotice: (m) => notices.push(m),
    ...extra,
  });
  closers.push(proxy.close);
  return { state, detector, usage, incidents, notices, base: `http://127.0.0.1:${proxy.port}` };
}

const call = (id: string, name: string, input: unknown) => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
const err = (id: string, text: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: text }] });
const stuckConversation = () => {
  const m: unknown[] = [{ role: "user", content: "fix the tests" }];
  for (let i = 0; i < 4; i++) m.push(call(`c${i}`, "Bash", { command: "npm test" }), err(`c${i}`, "FAIL"));
  return { model: "claude-sonnet-4-5", max_tokens: 100, messages: m };
};
const healthyConversation = { model: "claude-sonnet-4-5", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };

const post = (url: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body), signal });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("forwarding and metering", () => {
  it("passes credentials and body through untouched and streams the reply back", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);
    const r = await post(`${p.base}/v1/messages?beta=true`, healthyConversation, { "x-api-key": "sk-ant-user-key", authorization: "Bearer oauth-token", "anthropic-version": "2023-06-01" });

    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("message_start");
    expect(text).toContain("hello");

    expect(up.seen).toHaveLength(1);
    const s = up.seen[0];
    expect(s.url).toBe("/v1/messages?beta=true");
    expect(s.headers["x-api-key"]).toBe("sk-ant-user-key");
    expect(s.headers.authorization).toBe("Bearer oauth-token");
    expect(s.headers["anthropic-version"]).toBe("2023-06-01");
    expect(s.headers["accept-encoding"]).toBe("identity");
    expect(s.headers.host).toBe(new URL(up.url).host);
    expect(JSON.parse(s.body)).toEqual(healthyConversation);
  });

  it("meters real token usage from a streamed response", async () => {
    const up = await fakeUpstream((_r, res) => sse(res, "claude-sonnet-4-5-20250929", 120, 55));
    const p = await setup(up.url);
    await (await post(`${p.base}/v1/messages`, healthyConversation)).text();
    await sleep(20);
    expect(p.usage).toHaveLength(1);
    expect(p.usage[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-5-20250929", input_tokens: 120, output_tokens: 55, cache_read_tokens: 900 });
    expect(p.usage[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("meters a non-streamed response and falls back to the requested model", async () => {
    const up = await fakeUpstream((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 20 } }));
    });
    const p = await setup(up.url);
    await (await post(`${p.base}/v1/messages`, healthyConversation)).text();
    await sleep(20);
    expect(p.usage[0]).toMatchObject({ model: "claude-sonnet-4-5", input_tokens: 10, output_tokens: 20 });
  });

  it("relays provider errors untouched and records no usage for them", async () => {
    const up = await fakeUpstream((_r, res) => {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
      res.end('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}');
    });
    const p = await setup(up.url);
    const r = await post(`${p.base}/v1/messages`, healthyConversation);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("7");
    expect(await r.text()).toContain("rate_limit_error");
    await sleep(20);
    expect(p.usage).toHaveLength(0);
  });

  it("passes other endpoints straight through without inspecting them", async () => {
    const up = await fakeUpstream((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":[{"id":"claude-sonnet-4-5"}]}');
    });
    const p = await setup(up.url);
    const models = await fetch(`${p.base}/v1/models`, { headers: { "x-api-key": "k" } });
    expect(await models.json()).toEqual({ data: [{ id: "claude-sonnet-4-5" }] });
    const count = await post(`${p.base}/v1/messages/count_tokens`, stuckConversation());
    expect(count.status).toBe(200);
    expect(up.seen.map((s) => s.url)).toEqual(["/v1/models", "/v1/messages/count_tokens"]);
    expect(p.incidents).toHaveLength(0); // count_tokens is not a model call, so no loop check
  });

  it("forwards a body that isn't JSON unchanged", async () => {
    const up = await fakeUpstream((_r, res) => { res.writeHead(400); res.end("bad"); });
    const p = await setup(up.url);
    const r = await post(`${p.base}/v1/messages`, "not json at all");
    expect(r.status).toBe(400);
    expect(up.seen[0].body).toBe("not json at all");
  });

  it("answers 502 when the provider is unreachable and 413 for oversized bodies", async () => {
    const dead = await setup("http://127.0.0.1:1"); // nothing listens on port 1
    const r = await post(`${dead.base}/v1/messages`, healthyConversation);
    expect(r.status).toBe(502);
    expect((await r.json()).error.message).toContain("could not reach the provider");

    const up = await fakeUpstream((_r, res) => { res.writeHead(200); res.end("{}"); });
    const small = await setup(up.url, { maxBodyBytes: 50 });
    expect((await post(`${small.base}/v1/messages`, healthyConversation)).status).toBe(413);
    expect(up.seen).toHaveLength(0);
  });
});

describe("pause, resume and stop", () => {
  it("holds a stuck agent's request, then releases it with the operator's hint added", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);

    let status: number | null = null;
    const pending = post(`${p.base}/v1/messages`, stuckConversation()).then(async (r) => { status = r.status; await r.text(); });

    await sleep(150);
    expect(status).toBeNull(); // still waiting
    expect(up.seen).toHaveLength(0); // nothing reached the provider, so no tokens are being spent
    expect(p.state.desired).toBe("PAUSE");
    expect(p.incidents).toHaveLength(1);
    expect(p.incidents[0]).toMatchObject({ kind: "LOOP", action: "PAUSED", loop_type: "EXACT_TOOL_LOOP" });
    expect(p.incidents[0].interception_ms).toBeLessThan(100);
    expect(p.notices.join(" ")).toContain("Paused");

    // the operator resumes it from the dashboard with a hint
    p.state.apply({ desired: "RUN", hint: "Skip the flaky test and run the build." });
    await pending;

    expect(status).toBe(200);
    expect(up.seen).toHaveLength(1);
    const forwarded = JSON.parse(up.seen[0].body);
    const last = forwarded.messages[forwarded.messages.length - 1];
    expect(JSON.stringify(last)).toContain("Skip the flaky test and run the build.");
    expect(JSON.stringify(last)).toContain("ArgusOps note");
    expect(forwarded.messages.length).toBe(stuckConversation().messages.length); // hint rides on the last turn, no extra turn
  });

  it("does not pause again for history the operator already reviewed, but catches a new loop", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);

    const first = post(`${p.base}/v1/messages`, stuckConversation()).then((r) => r.text());
    await sleep(100);
    p.state.apply({ desired: "RUN" });
    await first;
    expect(p.incidents).toHaveLength(1);

    // same history again: fine
    await (await post(`${p.base}/v1/messages`, stuckConversation())).text();
    expect(p.incidents).toHaveLength(1);
    expect(p.state.desired).toBe("RUN");

    // now it gets stuck on something new
    const convo = stuckConversation();
    for (let i = 0; i < 4; i++) convo.messages.push(call(`n${i}`, "Bash", { command: "pnpm build" }), err(`n${i}`, "ENOENT"));
    const second = post(`${p.base}/v1/messages`, convo).then((r) => r.text());
    await sleep(100);
    expect(p.incidents).toHaveLength(2);
    p.state.apply({ desired: "RUN" });
    await second;
  });

  it("hands over a hint left while the agent was running, on its next request, once", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);
    p.state.apply({ desired: "RUN", hint: "Use pnpm, not npm." });
    await (await post(`${p.base}/v1/messages`, healthyConversation)).text();
    await (await post(`${p.base}/v1/messages`, healthyConversation)).text();
    expect(up.seen[0].body).toContain("Use pnpm, not npm.");
    expect(up.seen[1].body).not.toContain("Use pnpm");
  });

  it("answers 503 to a held request when the agent is stopped, and never calls the provider", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);
    const pending = post(`${p.base}/v1/messages`, stuckConversation());
    await sleep(100);
    p.state.apply({ desired: "KILL", reason: "Stopped by operator." });
    const r = await pending;
    expect(r.status).toBe(503);
    expect(up.seen).toHaveLength(0);

    // and every later request is refused too
    expect((await post(`${p.base}/v1/messages`, healthyConversation)).status).toBe(503);
    expect((await fetch(`${p.base}/v1/models`)).status).toBe(503);
  });

  it("a client that gives up while held causes no upstream call and no crash", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);
    const ac = new AbortController();
    const pending = post(`${p.base}/v1/messages`, stuckConversation(), {}, ac.signal).catch(() => "aborted");
    await sleep(100);
    ac.abort();
    expect(await pending).toBe("aborted");
    await sleep(50);
    p.state.apply({ desired: "RUN" });
    await sleep(100);
    expect(up.seen).toHaveLength(0);
    // the proxy still works afterwards
    expect((await post(`${p.base}/v1/messages`, healthyConversation)).status).toBe(200);
  });

  it("holds several requests at once and releases them together", async () => {
    const up = await fakeUpstream((_r, res) => sse(res));
    const p = await setup(up.url);
    p.state.pauseLocally("manual");
    const results = [1, 2, 3].map(() => post(`${p.base}/v1/messages`, healthyConversation).then((r) => r.status));
    await sleep(100);
    expect(up.seen).toHaveLength(0);
    p.state.apply({ desired: "RUN" });
    expect(await Promise.all(results)).toEqual([200, 200, 200]);
  });
});

describe("ControlState", () => {
  it("ignores a stale 'run' that was in flight when a local pause happened", () => {
    const s = new ControlState();
    const epochWhenSent = s.epoch;
    s.pauseLocally("loop");
    s.apply({ desired: "RUN", reason: "ok" }, epochWhenSent);
    expect(s.desired).toBe("PAUSE");
    expect(s.reason).toBe("loop");
    // a reply to a sync sent after the pause is honoured
    s.apply({ desired: "RUN" }, s.epoch);
    expect(s.desired).toBe("RUN");
  });

  it("always honours a stop, even from a stale reply", () => {
    const s = new ControlState();
    const sent = s.epoch;
    s.pauseLocally("loop");
    s.apply({ desired: "KILL" }, sent);
    expect(s.desired).toBe("KILL");
  });
});
