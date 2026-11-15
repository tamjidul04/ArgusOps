import { describe, it, expect } from "vitest";
import { SseUsageTap, applyHint, countToolCalls, extractToolTrace, isMainRequest, lastHumanIndex, stableStringify, turnStartOf, turnToolCalls, usageFromJson } from "./anthropic";

const call = (id: string, name: string, input: unknown) => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name, input }],
});
const result = (id: string, text: string, isError = false) => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: [{ type: "text", text }] }],
});

describe("stableStringify", () => {
  it("ignores key order and survives cycles", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(() => stableStringify(loop)).not.toThrow();
  });
});

describe("extractToolTrace", () => {
  it("treats retries that only reword the description as the same call", () => {
    const call = (d: string) => ({ role: "assistant", content: [{ type: "tool_use", id: d, name: "Bash", input: { command: "npm test", description: d, timeout: 120000 } }] });
    const t = extractToolTrace({ messages: [call("Run the tests"), call("Try the tests again"), call("Retry tests")] });
    expect(new Set(t.calls).size).toBe(1);
    expect(t.calls[0]).toBe('Bash({"command":"npm test"})');
  });

  const body = {
    messages: [
      { role: "user", content: "fix the tests" },
      call("1", "Bash", { command: "npm test", description: "run tests" }),
      result("1", "FAIL src/a.test.ts\nExpected 2 got 3", true),
      call("2", "Read", { file_path: "/p/a.ts" }),
      result("2", "file contents"),
      call("3", "Bash", { description: "run tests", command: "npm test" }),
      result("3", "FAIL src/a.test.ts\nExpected 2 got 3", true),
    ],
  };

  it("lists calls in order with stable signatures", () => {
    const t = extractToolTrace(body);
    expect(t.calls).toHaveLength(3);
    expect(t.calls[0]).toBe(t.calls[2]); // same call even though the keys were written in a different order
    expect(t.calls[1]).toContain("Read");
  });

  it("interleaves errors (and only errors) with the calls that caused them", () => {
    const t = extractToolTrace(body);
    expect(t.items.map((i) => i.sig.split("(")[0])).toEqual(["Bash", "error: FAIL src/a.test.ts Expected 2 got 3".split("(")[0], "Read", "Bash", "error: FAIL src/a.test.ts Expected 2 got 3"]);
    expect(t.items.map((i) => i.callNo)).toEqual([0, 0, 1, 2, 2]);
  });

  it("counts calls and tolerates junk bodies", () => {
    expect(countToolCalls(body)).toBe(3);
    for (const junk of [null, undefined, 5, "x", {}, { messages: "no" }, { messages: [null, 3, { role: "assistant", content: "text" }] }]) {
      expect(extractToolTrace(junk).calls).toEqual([]);
      expect(countToolCalls(junk)).toBe(0);
    }
  });
});

describe("applyHint", () => {
  const hint = "Skip the flaky test.";

  it("adds a text block to the last user turn without modifying the input", () => {
    const body = { model: "m", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }] }] };
    const copy = JSON.stringify(body);
    const out = applyHint(body, hint);
    expect(JSON.stringify(body)).toBe(copy);
    const last = out.messages[out.messages.length - 1] as { content: Array<{ type: string; text?: string }> };
    expect(last.content).toHaveLength(2);
    expect(last.content[1]).toMatchObject({ type: "text" });
    expect(last.content[1].text).toContain(hint);
    expect((out as { model: string }).model).toBe("m");
  });

  it("appends to a plain-string user message", () => {
    const out = applyHint({ messages: [{ role: "user", content: "do it" }] }, hint);
    expect((out.messages[0] as { content: string }).content).toMatch(/^do it\n\n\[ArgusOps note/);
  });

  it("adds a user turn when the conversation ends on the assistant or is empty", () => {
    expect(applyHint({ messages: [{ role: "assistant", content: "hi" }] }, hint).messages).toHaveLength(2);
    expect((applyHint({}, hint) as { messages: unknown[] }).messages).toHaveLength(1);
  });
});

describe("usage from a streamed response", () => {
  const stream = [
    'event: message_start',
    'data: {"type":"message_start","message":{"model":"claude-sonnet-4-5-20250929","usage":{"input_tokens":120,"cache_creation_input_tokens":30,"cache_read_input_tokens":5000,"output_tokens":1}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":42}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join("\n");

  it("reads model, billed input, output and cache reads", () => {
    const tap = new SseUsageTap();
    tap.push(stream);
    expect(tap.result()).toEqual({ model: "claude-sonnet-4-5-20250929", inputTokens: 150, outputTokens: 42, cacheReadTokens: 5000, stopReason: undefined, text: "hi" });
  });

  it("is correct however the bytes are split, even one at a time and with CRLF", () => {
    const tap = new SseUsageTap();
    for (const ch of stream.replace(/\n/g, "\r\n")) tap.push(Buffer.from(ch));
    expect(tap.result().outputTokens).toBe(42);
    expect(tap.result().inputTokens).toBe(150);
  });

  it("ignores garbage and reports unknown when nothing was seen", () => {
    const tap = new SseUsageTap();
    tap.push("data: {not json}\n\ndata: [DONE]\n\nrandom\n");
    expect(tap.result()).toMatchObject({ model: "unknown", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  });
});

describe("usage from a plain JSON response", () => {
  it("reads usage and model", () => {
    const text = JSON.stringify({ model: "claude-haiku-4-5", usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 7 } });
    expect(usageFromJson(text)).toEqual({ model: "claude-haiku-4-5", inputTokens: 10, outputTokens: 20, cacheReadTokens: 7 });
  });
  it("returns null for errors and non-JSON", () => {
    expect(usageFromJson('{"type":"error","error":{"message":"x"}}')).toBeNull();
    expect(usageFromJson("<html>")).toBeNull();
  });
});

describe("turns", () => {
  const human = (text: string) => ({ role: "user", content: text });
  const humanBlocks = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
  const call = (id: string, cmd: string) => ({ role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd, description: "x" } }] });
  const result = (id: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] });
  const tools = [{ name: "Bash" }];

  it("tells the main conversation from side calls", () => {
    expect(isMainRequest({ tools, messages: [] })).toBe(true);
    expect(isMainRequest({ messages: [] })).toBe(false);
    expect(isMainRequest({ tools: [], messages: [] })).toBe(false);
  });

  it("sees a turn start only when the human spoke last", () => {
    expect(turnStartOf({ tools, messages: [human("fix the tests")] })?.humanText).toBe("fix the tests");
    expect(turnStartOf({ tools, messages: [humanBlocks("fix it")] })).not.toBeNull();
    expect(turnStartOf({ tools, messages: [human("fix"), call("c1", "npm test"), result("c1")] })).toBeNull();
    expect(turnStartOf({ tools, messages: [] })).toBeNull();
  });

  it("gives a retried request the same key and a new message a new key", () => {
    const a = turnStartOf({ messages: [human("one")] });
    const b = turnStartOf({ messages: [human("one")] });
    const c = turnStartOf({ messages: [human("one"), { role: "assistant", content: "done" }, human("two")] });
    expect(a?.key).toBe(b?.key);
    expect(c?.key).not.toBe(a?.key);
  });

  it("lists only this turn's tool calls, without the description field", () => {
    const body = { messages: [human("old task"), call("a", "ls"), result("a"), { role: "assistant", content: "ok" }, human("run the tests"), call("b", "npm test"), result("b")] };
    expect(turnToolCalls(body)).toEqual(['Bash({"command":"npm test"})']);
    expect(lastHumanIndex(body)).toBe(-1); // mid-turn
  });

  it("reads the stop reason and text from streamed and plain responses", () => {
    const tap = new SseUsageTap();
    tap.push('data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":5}}}\n');
    tap.push('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"All tests "}}\n');
    tap.push('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"pass."}}\n');
    tap.push('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n');
    expect(tap.result()).toMatchObject({ stopReason: "end_turn", text: "All tests pass.", outputTokens: 7 });
    const plain = usageFromJson(JSON.stringify({ model: "m", stop_reason: "tool_use", content: [{ type: "text", text: "Let me check." }, { type: "tool_use" }], usage: { input_tokens: 1, output_tokens: 1 } }));
    expect(plain).toMatchObject({ stopReason: "tool_use", text: "Let me check." });
  });
});
