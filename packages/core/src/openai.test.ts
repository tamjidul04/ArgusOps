import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { adapterFor } from "./adapters";
import { LoopDetector } from "./detect";
import { looksLikeError, openaiAdapter as ad } from "./openai";
import { startProxy } from "./proxy";
import { ControlState } from "./state";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/* -------- Chat Completions bodies -------- */
const chatCall = (id: string, name: string, args: unknown) => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const chatResult = (id: string, text: string) => ({ role: "tool", tool_call_id: id, content: text });
const tools = [{ type: "function", function: { name: "shell" } }];

/* -------- Responses bodies -------- */
const respCall = (id: string, name: string, args: unknown) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const respOut = (id: string, output: string) => ({ type: "function_call_output", call_id: id, output });
const respUser = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });

describe("recognising requests", () => {
  it("handles both OpenAI endpoints, with or without /v1, and only POST", () => {
    for (const u of ["/v1/chat/completions", "/v1/responses", "/chat/completions", "/responses?x=1"]) expect(ad.isModelRequest("POST", u), u).toBe(true);
    expect(ad.isModelRequest("GET", "/v1/responses")).toBe(false);
    expect(ad.isModelRequest("POST", "/v1/embeddings")).toBe(false);
    expect(ad.isModelRequest("POST", "/v1/messages")).toBe(false);
  });
  it("is chosen by provider name, with the right base-URL conventions", () => {
    expect(adapterFor("openai")).toBe(ad);
    expect(adapterFor("nonsense")).toBeNull();
    expect(ad.baseUrlSuffix).toBe("/v1"); // OpenAI clients expect the /v1 in their base URL
    expect(ad.baseUrlEnv).toBe("OPENAI_BASE_URL");
  });
});

describe("tool calls and loops", () => {
  it("reads Chat Completions calls and errors, ignoring wording differences in text", () => {
    const body = { messages: [{ role: "user", content: "fix it" }, chatCall("1", "shell", { cmd: "npm test" }), chatResult("1", "Error: tests failed"), chatCall("2", "shell", { cmd: "npm test" }), chatResult("2", "ok")] };
    const t = ad.extractToolTrace(body);
    expect(t.calls).toEqual(['shell({"cmd":"npm test"})', 'shell({"cmd":"npm test"})']);
    expect(t.items.map((i) => i.sig)).toEqual(['shell({"cmd":"npm test"})', "error: Error: tests failed", 'shell({"cmd":"npm test"})']);
    expect(ad.countToolCalls(body)).toBe(2);
  });

  it("reads Responses items: function calls, shell calls, and exit codes in JSON outputs", () => {
    const body = {
      input: [
        respUser("fix it"),
        respCall("a", "shell", { command: ["npm", "test"] }),
        respOut("a", JSON.stringify({ output: "boom", metadata: { exit_code: 1 } })),
        { type: "local_shell_call", call_id: "b", action: { type: "exec", command: ["ls"] } },
        { type: "local_shell_call_output", call_id: "b", output: JSON.stringify({ output: "x", metadata: { exit_code: 0 } }) },
        { type: "reasoning", summary: [] },
      ],
    };
    const t = ad.extractToolTrace(body);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0]).toBe('shell({"command":["npm","test"]})');
    expect(t.items.filter((i) => i.sig.startsWith("error:"))).toHaveLength(1);
  });

  it("the loop detector catches an OpenAI loop and ignores a healthy session", () => {
    const stuck = { messages: [{ role: "user", content: "fix" }, ...[1, 2, 3, 4].flatMap((i) => [chatCall(`c${i}`, "shell", { cmd: "npm test" }), chatResult(`c${i}`, "Error: FAIL")])] };
    const v = new LoopDetector(ad).check(stuck);
    expect(v.tripped).toBe(true);
    expect(v.reason).toContain("shell");
    const healthy = { messages: [{ role: "user", content: "fix" }, chatCall("1", "shell", { cmd: "ls" }), chatResult("1", "a b"), chatCall("2", "shell", { cmd: "cat a" }), chatResult("2", "hi")] };
    expect(new LoopDetector(ad).check(healthy).tripped).toBe(false);
    const stuckResponses = { input: [respUser("fix"), ...[1, 2, 3, 4].flatMap((i) => [respCall(`c${i}`, "shell", { cmd: "npm test" }), respOut(`c${i}`, "FAILED")])] };
    expect(new LoopDetector(ad).check(stuckResponses).tripped).toBe(true);
  });

  it("judges tool output as failure from exit codes and common error words only", () => {
    expect(looksLikeError(JSON.stringify({ metadata: { exit_code: 2 } }))).toBe(true);
    expect(looksLikeError(JSON.stringify({ metadata: { exit_code: 0 }, output: "no errors here" }))).toBe(false);
    expect(looksLikeError("Traceback (most recent call last)")).toBe(true);
    expect(looksLikeError("Process exited with code 1")).toBe(true);
    expect(looksLikeError("all 12 tests passed")).toBe(false);
  });
});

describe("turns", () => {
  it("sees a turn start when the human spoke last, in both formats", () => {
    expect(ad.turnStartOf({ messages: [{ role: "system", content: "x" }, { role: "user", content: "fix the tests" }] })?.humanText).toBe("fix the tests");
    expect(ad.turnStartOf({ input: "fix the tests" })?.humanText).toBe("fix the tests");
    expect(ad.turnStartOf({ input: [respUser("fix")] })?.humanText).toBe("fix");
    expect(ad.turnStartOf({ messages: [{ role: "user", content: "fix" }, chatCall("1", "shell", {}), chatResult("1", "ok")] })).toBeNull();
    expect(ad.turnStartOf({ input: [respUser("fix"), respCall("a", "shell", {}), respOut("a", "ok")] })).toBeNull();
  });
  it("lists only this turn's tool calls", () => {
    const body = { messages: [{ role: "user", content: "old" }, chatCall("1", "shell", { cmd: "ls" }), chatResult("1", "ok"), { role: "assistant", content: "done" }, { role: "user", content: "now test" }, chatCall("2", "shell", { cmd: "npm test" }), chatResult("2", "ok")] };
    expect(ad.turnToolCalls(body)).toEqual(['shell({"cmd":"npm test"})']);
  });
  it("tells the main conversation from side requests by its tools", () => {
    expect(ad.isMainRequest({ tools, messages: [] })).toBe(true);
    expect(ad.isMainRequest({ messages: [] })).toBe(false);
  });
});

describe("passing on an instruction", () => {
  it("adds it to the last user message in Chat Completions", () => {
    const out = ad.applyHint({ messages: [{ role: "user", content: "fix" }] }, "use the other file") as { messages: Array<{ content: string }> };
    expect(out.messages[0].content).toBe("fix\n\n[ArgusOps note from the operator] use the other file");
    const parts = ad.applyHint({ messages: [{ role: "user", content: [{ type: "text", text: "fix" }] }] }, "x") as { messages: Array<{ content: unknown[] }> };
    expect(parts.messages[0].content).toHaveLength(2);
    const afterTool = ad.applyHint({ messages: [{ role: "user", content: "fix" }, chatCall("1", "shell", {}), chatResult("1", "ok")] }, "x") as { messages: unknown[] };
    expect(afterTool.messages).toHaveLength(4);
  });
  it("adds it to a Responses input of any shape, without changing the original", () => {
    const original = { input: [respUser("fix")] };
    const out = ad.applyHint(original, "x") as { input: Array<{ content: unknown[] }> };
    expect(out.input[0].content).toHaveLength(2);
    expect(original.input[0].content).toHaveLength(1);
    expect((ad.applyHint({ input: "fix" }, "x") as { input: string }).input).toContain("[ArgusOps note");
    const mid = ad.applyHint({ input: [respUser("fix"), respCall("a", "shell", {}), respOut("a", "ok")] }, "x") as { input: unknown[] };
    expect(mid.input).toHaveLength(4);
  });
});

describe("reading usage", () => {
  it("asks a streamed Chat Completions request to include usage, and changes nothing else", () => {
    const body = { model: "m", stream: true, messages: [{ role: "user", content: "x" }] };
    expect(ad.prepare(body)).toEqual({ ...body, stream_options: { include_usage: true } });
    expect(ad.prepare({ ...body, stream_options: { include_usage: true } })).toBeNull();
    expect(ad.prepare({ ...body, stream: false })).toBeNull();
    expect(ad.prepare({ model: "m", stream: true, input: "x" })).toBeNull(); // Responses already reports usage
  });

  it("reads a streamed Chat Completions reply: cached tokens are split from the rest, text and stop reason kept", () => {
    const tap = ad.newTap();
    tap.push('data: {"model":"gpt-x","choices":[{"delta":{"content":"All tests "},"finish_reason":null}]}\n\n');
    tap.push('data: {"choices":[{"delta":{"content":"pass."},"finish_reason":"stop"}]}\n\n');
    tap.push('data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":400}}}\n\ndata: [DONE]\n\n');
    expect(tap.result()).toEqual({ model: "gpt-x", inputTokens: 600, outputTokens: 50, cacheReadTokens: 400, stopReason: "end_turn", text: "All tests pass." });
  });

  it("reads a streamed Responses reply, and tells a tool request from the end of a turn", () => {
    const done = (output: unknown[]) => `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-y", status: "completed", output, usage: { input_tokens: 300, output_tokens: 20, input_tokens_details: { cached_tokens: 100 } } } })}\n\n`;
    const a = ad.newTap();
    a.push('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Fixed."}\n\n');
    a.push(done([{ type: "message" }]));
    expect(a.result()).toMatchObject({ model: "gpt-y", inputTokens: 200, outputTokens: 20, cacheReadTokens: 100, stopReason: "end_turn", text: "Fixed." });
    const b = ad.newTap();
    b.push(done([{ type: "function_call" }]));
    expect(b.result().stopReason).toBe("tool_use");
  });

  it("copes with chunks split anywhere and with garbage", () => {
    const tap = ad.newTap();
    const line = 'data: {"model":"m","choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n';
    for (let i = 0; i < line.length; i += 7) tap.push(line.slice(i, i + 7));
    tap.push("data: not json\n\n");
    expect(tap.result()).toMatchObject({ model: "m", inputTokens: 5, outputTokens: 2, text: "hi", stopReason: "end_turn" });
  });

  it("reads plain (non-streamed) replies of both kinds", () => {
    const chat = ad.usageFromJson(JSON.stringify({ model: "m", choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3 } }));
    expect(chat).toMatchObject({ inputTokens: 10, outputTokens: 3, stopReason: "end_turn", text: "done" });
    const resp = ad.usageFromJson(JSON.stringify({ model: "m", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 4, output_tokens: 1 } }));
    expect(resp).toMatchObject({ stopReason: "end_turn", text: "ok" });
    expect(ad.usageFromJson("nope")).toBeNull();
    expect(ad.usageFromJson(JSON.stringify({ model: "m" }))).toBeNull();
  });
});

describe("through the proxy", () => {
  it("meters a streamed Chat Completions session, asks for usage, and holds a looping agent", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const upstream = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        seen.push(JSON.parse(Buffer.concat(parts).toString("utf8")));
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"model":"gpt-x","choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\n');
        res.end('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":40}}}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));

    const usage: Array<{ input_tokens: number; output_tokens: number; cache_read_tokens: number; model: string }> = [];
    const incidents: unknown[] = [];
    const state = new ControlState();
    const proxy = await startProxy({ provider: "openai", adapter: ad, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, state, detector: new LoopDetector(ad), onUsage: (u) => usage.push(u), onIncident: (i) => incidents.push(i) });
    closers.push(proxy.close);
    const base = `http://127.0.0.1:${proxy.port}/v1`;
    const post = (body: unknown) => fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-user" }, body: JSON.stringify(body) });

    const ok = await post({ model: "gpt-x", stream: true, messages: [{ role: "user", content: "hi" }] });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("hello"); // the answer reaches the agent untouched
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].stream_options).toEqual({ include_usage: true });
    expect(usage[0]).toMatchObject({ model: "gpt-x", input_tokens: 60, output_tokens: 10, cache_read_tokens: 40 });

    const stuck = { model: "gpt-x", messages: [{ role: "user", content: "fix" }, ...[1, 2, 3, 4].flatMap((i) => [chatCall(`c${i}`, "shell", { cmd: "npm test" }), chatResult(`c${i}`, "Error: FAIL")])] };
    const held = post(stuck);
    await new Promise((r) => setTimeout(r, 300));
    expect(state.desired).toBe("PAUSE");
    expect(incidents).toHaveLength(1);
    expect(seen).toHaveLength(1); // the looping request has not been forwarded
    state.apply({ desired: "RUN", hint: "try the other config" });
    expect((await held).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.stringify(seen[1])).toContain("[ArgusOps note from the operator] try the other config");
  });

  it("forwards a Responses request and reads its usage", async () => {
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-y", status: "completed", output: [{ type: "message" }], usage: { input_tokens: 50, output_tokens: 5 } } })}\n\n`);
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));
    const usage: unknown[] = [];
    const proxy = await startProxy({ provider: "openai", adapter: ad, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, state: new ControlState(), detector: new LoopDetector(ad), onUsage: (u) => usage.push(u), onIncident: () => undefined });
    closers.push(proxy.close);
    const r = await fetch(`http://127.0.0.1:${proxy.port}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-y", stream: true, input: "hi" }) });
    expect(r.status).toBe(200);
    await r.text();
    await new Promise((x) => setTimeout(x, 30));
    expect(usage[0]).toMatchObject({ model: "gpt-y", input_tokens: 50, output_tokens: 5 });
  });
});

describe("Codex 0.169 request shape", () => {
  // Codex sends its tools as an `additional_tools` input item, and its tool is a custom `exec` (JavaScript)
  const codexBody = (calls: number) => {
    const input: unknown[] = [
      { type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] }] },
      respUser("run the tests until they pass"),
    ];
    for (let i = 0; i < calls; i++) {
      input.push({ type: "custom_tool_call", call_id: `c${i}`, name: "exec", input: 'throw new Error("tests failed")' });
      input.push({ type: "custom_tool_call_output", call_id: `c${i}`, output: "Script failed\nOutput: Script error: Error: tests failed" });
    }
    return { model: "gpt-6.1-sol", stream: true, input };
  };

  it("counts as the main conversation even though `tools` is empty", () => {
    expect(ad.isMainRequest(codexBody(0))).toBe(true);
    expect(ad.isMainRequest({ model: "m", input: [respUser("title this")] })).toBe(false);
  });

  it("its repeated failing exec calls are caught as a loop", () => {
    const d = new LoopDetector(ad);
    expect(d.check(codexBody(1)).tripped).toBe(false);
    const v = d.check(codexBody(3));
    expect(v.tripped).toBe(true);
    expect(v.reason).toContain("exec");
  });
});
