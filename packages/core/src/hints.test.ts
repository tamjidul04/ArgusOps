import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LoopDetector } from "./detect";
import { HintLedger, NOTE_PREFIX } from "./hints";
import { startProxy } from "./proxy";
import { ControlState } from "./state";

const first = { role: "user", content: [{ type: "text", text: "fix the tests" }] };
const think = (sig: string) => ({ type: "thinking", thinking: "", signature: sig });
const call = (id: string) => ({ role: "assistant", content: [think("sig-" + id), { type: "tool_use", id, name: "Read", input: { file_path: id } }] });
const result = (id: string, cache = false) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", ...(cache ? { cache_control: { type: "ephemeral" } } : {}) }] });
type Body = { model: string; max_tokens: number; tools: unknown[]; messages: Array<{ role?: string; content: unknown }> };
const body = (...messages: unknown[]): Body => ({ model: "claude-haiku-5-5", max_tokens: 100, tools: [{ name: "Read" }], messages: [first, ...messages] as Body["messages"] });
const NOTE = `${NOTE_PREFIX}check the config first`;

describe("HintLedger", () => {
  it("adds the note after the tool results, and puts it back in the same place on every later request", () => {
    const l = new HintLedger();
    const delivered = l.deliver(body(call("a"), result("a")), "check the config first");
    expect(delivered.messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "a", content: "ok" }, { type: "text", text: NOTE }]);

    // the agent's own copy of the history does not have the note
    const next = body(call("a"), result("a"), call("b"), result("b"));
    const fixed = l.replay(next)!;
    expect(fixed.messages[2].content).toEqual(delivered.messages[2].content);
    expect(fixed.messages.slice(3)).toEqual(next.messages.slice(3)); // nothing else touched
    expect(next.messages[2].content).toHaveLength(1); // the input is not modified
  });

  it("ignores cache markers the agent moves from message to message", () => {
    const l = new HintLedger();
    const delivered = l.deliver(body(call("a"), result("a", true)), "check the config first");
    // next time the cache marker has moved to the newest message
    const fixed = l.replay(body(call("a"), result("a"), call("b"), result("b", true)))!;
    expect(fixed).not.toBeNull();
    expect((fixed.messages[2].content as unknown[]).at(-1)).toEqual({ type: "text", text: NOTE });
    expect(delivered.messages[2].content).toHaveLength(2);
  });

  it("handles a plain-text human message and a history that ends with the assistant", () => {
    const l = new HintLedger();
    const s = { model: "m", messages: [{ role: "user", content: "hello" }] };
    expect(l.deliver(s, "be brief").messages[0].content).toBe(`hello\n\n${NOTE_PREFIX}be brief`);
    expect(l.replay({ model: "m", messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }] })!.messages[0].content).toBe(`hello\n\n${NOTE_PREFIX}be brief`);

    const l2 = new HintLedger();
    const endsWithAssistant = body(call("a"), result("a"), { role: "assistant", content: [{ type: "text", text: "Done." }] });
    const d = l2.deliver(endsWithAssistant, "one more thing");
    expect(d.messages).toHaveLength(5);
    expect(d.messages[4]).toEqual({ role: "user", content: [{ type: "text", text: `${NOTE_PREFIX}one more thing` }] });
    const later = l2.replay(body(call("a"), result("a"), { role: "assistant", content: [{ type: "text", text: "Done." }] }, { role: "user", content: "next" }))!;
    expect(later.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "user"]);
    expect(later.messages[4]).toEqual(d.messages[4]);
  });

  it("keeps several notes, in order, each in its own place", () => {
    const l = new HintLedger();
    l.deliver(body(call("a"), result("a")), "first");
    const second = l.deliver(l.replay(body(call("a"), result("a"), call("b"), result("b")))!, "second");
    const fixed = l.replay(body(call("a"), result("a"), call("b"), result("b"), call("c"), result("c")))!;
    expect(fixed.messages.slice(0, 5)).toEqual(second.messages);
    expect(l.size()).toBe(2);
  });

  it("does not replay into a history that changed under it, or into another conversation", () => {
    const l = new HintLedger();
    l.deliver(body(call("a"), result("a")), "check the config first");
    // the agent rewrote the message the note was attached to
    expect(l.replay(body(call("a"), { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "different" }] }, call("b")))).toBeNull();
    // a sub-agent, or a new session: it began differently
    expect(l.replay({ model: "m", messages: [{ role: "user", content: "another task" }, call("a"), result("a")] })).toBeNull();
    // the history is shorter than where the note was (compacted)
    expect(l.replay(body())).toBeNull();
  });

  it("does nothing when the note is already there (a retry of the delivered request)", () => {
    const l = new HintLedger();
    const delivered = l.deliver(body(call("a"), result("a")), "check the config first");
    expect(l.replay(delivered)).toBeNull();
  });
});

/* -------------------- through the proxy -------------------- */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe("operator notes through the proxy", () => {
  it("the request after a hint still carries it where the model saw it, so the history stays append-only", async () => {
    const seen: Array<{ messages: Array<{ content: unknown }> }> = [];
    const up = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        seen.push(JSON.parse(Buffer.concat(parts).toString("utf8")));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "tool_use", content: [], usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => up.close(() => r())));
    const state = new ControlState();
    const p = await startProxy({ provider: "anthropic", upstream: `http://127.0.0.1:${(up.address() as { port: number }).port}`, state, detector: new LoopDetector(), onUsage: () => undefined, onIncident: () => undefined });
    closers.push(p.close);
    const post = (b: unknown) => fetch(`http://127.0.0.1:${p.port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

    state.apply({ hint: "check the config first" });
    await post(body(call("a"), result("a")));
    await post(body(call("a"), result("a"), call("b"), result("b")));
    await post(body(call("a"), result("a"), call("b"), result("b"), call("c"), result("c")));
    expect(seen[0].messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "a", content: "ok" }, { type: "text", text: NOTE }]);
    expect(seen[1].messages[2].content).toEqual(seen[0].messages[2].content);
    expect(seen[2].messages[2].content).toEqual(seen[0].messages[2].content);
    // and only once: no second copy appears
    expect(JSON.stringify(seen[2]).split(NOTE).length - 1).toBe(1);
  });
});

describe("a note in the very first message", () => {
  it("is still found on later requests (the conversation is recognised without ArgusOps' own notes)", () => {
    const l = new HintLedger();
    const d = l.deliver({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "start" }] }] }, "be careful");
    expect(d.messages[0].content).toHaveLength(2);
    const later = l.replay({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "start" }] }, { role: "assistant", content: "ok" }, { role: "user", content: "go on" }] });
    expect(later!.messages[0]).toEqual(d.messages[0]);
    // and a second note is filed under the same conversation
    l.deliver(later!, "second");
    expect(l.size()).toBe(2);
    const third = l.replay({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "start" }] }, { role: "assistant", content: "ok" }, { role: "user", content: "go on" }, { role: "assistant", content: "k" }] });
    expect(JSON.stringify(third)).toContain("be careful");
    expect(JSON.stringify(third)).toContain("second");
  });
});
