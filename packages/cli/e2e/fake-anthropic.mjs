// A stand-in for api.anthropic.com that costs nothing: lets you run the REAL Claude Code through
// `argus run` without a paid account or any real model call.
//
//   node packages/cli/e2e/fake-anthropic.mjs            (listens on http://127.0.0.1:8787)
//   node packages/cli/e2e/fake-anthropic.mjs 9000       (another port)
//   node packages/cli/e2e/fake-anthropic.mjs 8787 --loop  (makes the agent repeat one harmless command forever,
//                                                         until a message from the operator arrives)
//
// It answers every message with a short canned reply, with believable token usage, and prints one line
// per request so you can see exactly what Claude Code sends.
import http from "node:http";

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8787);
const loop = process.argv.includes("--loop");
let count = 0;

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    /* not JSON */
  }
  const url = req.url ?? "/";
  const model = typeof body.model === "string" ? body.model : "claude-sonnet-4-5";
  const messages = Array.isArray(body.messages) ? body.messages.length : 0;
  const tools = Array.isArray(body.tools) ? body.tools.length : 0;
  const inputTokens = Math.max(10, Math.round(raw.length / 4));
  console.log(`[fake-anthropic] #${++count} ${req.method} ${url}  model=${model} stream=${body.stream === true} messages=${messages} tools=${tools} ~${inputTokens} input tokens`);

  if (req.method === "POST" && /^\/v1\/messages\/count_tokens/.test(url)) return json(res, 200, { input_tokens: inputTokens });
  if (req.method === "GET" && /^\/v1\/models/.test(url)) return json(res, 200, { data: [], has_more: false });

  if (req.method === "POST" && /^\/v1\/messages(\?|$)/.test(url)) {
    const text = raw.includes("ArgusOps note") ? "Understood. I received the operator's note and will stop repeating that command." : "Hello from the fake provider. No real model was called, so this cost nothing.";
    const outputTokens = 20;
    const message = { id: `msg_fake_${count}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null };

    // --loop: while the agent has tools and nobody has intervened, ask it to run the same failing command again
    const intervened = raw.includes("ArgusOps note");
    if (loop && tools > 0 && !intervened) {
      const command = 'node -e "process.exit(1)"';
      if (body.stream !== true) {
        return json(res, 200, { ...message, content: [{ type: "tool_use", id: `toolu_fake_${count}`, name: "Bash", input: { command, description: "run the tests" } }], stop_reason: "tool_use", usage: { input_tokens: inputTokens, output_tokens: 30 } });
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      sse(res, "message_start", { type: "message_start", message: { ...message, usage: { input_tokens: inputTokens, output_tokens: 1 } } });
      sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_fake_${count}`, name: "Bash", input: {} } });
      sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command, description: "run the tests" }) } });
      sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
      sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } });
      sse(res, "message_stop", { type: "message_stop" });
      return res.end();
    }

    if (body.stream !== true) {
      return json(res, 200, { ...message, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: inputTokens, output_tokens: outputTokens } });
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    sse(res, "message_start", { type: "message_start", message: { ...message, usage: { input_tokens: inputTokens, output_tokens: 1 } } });
    sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    for (const word of text.split(" ")) sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word + " " } });
    sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } });
    sse(res, "message_stop", { type: "message_stop" });
    return res.end();
  }

  json(res, 404, { type: "error", error: { type: "not_found_error", message: `fake-anthropic does not implement ${req.method} ${url}` } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[fake-anthropic] listening on http://127.0.0.1:${port}  (no real model is called; nothing is billed)`);
});
