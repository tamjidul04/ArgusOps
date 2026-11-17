// A stand-in for api.openai.com (Responses API and Chat Completions) that costs nothing: lets you run the REAL
// Codex CLI through `argus run` without an OpenAI account or any real model call.
//
//   node packages/cli/e2e/fake-openai.mjs [port] [--loop] [--dump <file>]
//
// --loop: while nobody has intervened, answer every request by asking the agent to run the same failing shell
//         command again (so the agent really loops), until a message from the ArgusOps operator arrives.
// --dump: write the first request body to a file (to see what the agent sends).
import fs from "node:fs";
import http from "node:http";

const args = process.argv.slice(2);
const portArg = args.find((a) => /^\d+$/.test(a));
const port = portArg !== undefined ? Number(portArg) : 8788;
const loop = args.includes("--loop");
const dumpAt = args.indexOf("--dump");
const dump = dumpAt >= 0 ? args[dumpAt + 1] : null;
let count = 0;
const COMMAND = 'node -e "process.exit(1)"';

const readBody = (req) =>
  new Promise((resolve) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  });
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const event = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

/** Which tool the agent offers for running commands, and how its arguments look. */
function shellTool(tools) {
  const names = (tools ?? []).map((t) => t?.name ?? t?.function?.name).filter(Boolean);
  for (const n of ["shell", "shell_command", "exec_command", "local_shell"]) if (names.includes(n)) return n;
  return names[0] ?? "shell";
}
function shellArgs(name) {
  if (name === "shell") return { command: ["node", "-e", "process.exit(1)"] };
  if (name === "exec_command") return { cmd: COMMAND };
  return { command: COMMAND };
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
  const n = ++count;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const input = Array.isArray(body.input) ? body.input.length : Array.isArray(body.messages) ? body.messages.length : 0;
  const inputTokens = Math.max(10, Math.round(raw.length / 4));
  const auth = req.headers.authorization ? `auth=${String(req.headers.authorization).split(" ")[0]}` : "auth=none";
  console.log(`[fake-openai] #${n} ${req.method} ${url}  model=${body.model ?? "?"} stream=${body.stream === true} items=${input} tools=${tools.length} ${auth}`);
  if (dump && n === 1 && raw) fs.writeFileSync(dump, raw);

  if (req.method === "GET" && /\/models/.test(url)) return send(res, 200, { object: "list", data: [{ id: "gpt-5", object: "model" }] });
  if (req.method !== "POST" || !/\/(responses|chat\/completions)(\?|$)/.test(url)) return send(res, 404, { error: { message: `fake-openai does not implement ${req.method} ${url}` } });

  const intervened = raw.includes("ArgusOps note");
  const callTool = loop && tools.length > 0 && !intervened;
  const text = intervened ? "Understood. I received the operator's note and will stop repeating that command." : "Hello from the fake OpenAI provider. Nothing was billed.";

  if (/chat\/completions/.test(url)) {
    // Chat Completions, not streamed (enough for agents that use it)
    const message = callTool
      ? { role: "assistant", content: null, tool_calls: [{ id: `call_${n}`, type: "function", function: { name: shellTool(tools), arguments: JSON.stringify(shellArgs(shellTool(tools))) } }] }
      : { role: "assistant", content: text };
    return send(res, 200, { id: `chatcmpl_${n}`, object: "chat.completion", model: body.model, choices: [{ index: 0, message, finish_reason: callTool ? "tool_calls" : "stop" }], usage: { prompt_tokens: inputTokens, completion_tokens: 20, total_tokens: inputTokens + 20 } });
  }

  // Responses API. Codex 0.169+ offers its tools as `additional_tools` input items; its tool is a custom `exec`
  // that runs JavaScript in an isolate. The loop asks it to run code that only throws, so nothing touches the system.
  const offered = (Array.isArray(body.input) ? body.input : []).filter((i) => i?.type === "additional_tools").flatMap((i) => i.tools ?? []);
  const flat = offered.flatMap((t) => (Array.isArray(t.tools) ? t.tools : [t]));
  const customExec = flat.find((t) => t.type === "custom" && t.name === "exec");
  const loopNow = loop && !intervened && (tools.length > 0 || flat.length > 0);
  const id = `resp_${n}`;
  const item = !loopNow
    ? { id: `msg_${n}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }
    : customExec
      ? { id: `ctc_${n}`, type: "custom_tool_call", status: "completed", call_id: `call_${n}`, name: "exec", input: 'throw new Error("tests failed: expected 200 got 500")' }
      : { id: `fc_${n}`, type: "function_call", status: "completed", call_id: `call_${n}`, name: shellTool(tools), arguments: JSON.stringify(shellArgs(shellTool(tools))) };
  const usage = { input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inputTokens + 20 };
  const response = (status, output) => ({ id, object: "response", created_at: Math.floor(Date.now() / 1000), status, model: body.model ?? "gpt-5", output, usage: status === "completed" ? usage : null });
  if (body.stream !== true) return send(res, 200, response("completed", [item]));

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  event(res, "response.created", { response: response("in_progress", []) });
  const empty = item.type === "message" ? { content: [] } : item.type === "custom_tool_call" ? { input: "" } : { arguments: "" };
  event(res, "response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", ...empty } });
  if (item.type === "message") event(res, "response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: text });
  else if (item.type === "custom_tool_call") event(res, "response.custom_tool_call_input.delta", { item_id: item.id, output_index: 0, delta: item.input });
  else event(res, "response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: item.arguments });
  event(res, "response.output_item.done", { output_index: 0, item });
  event(res, "response.completed", { response: response("completed", [item]) });
  res.end();
});

server.listen(port, "127.0.0.1", () => console.log(`[fake-openai] listening on http://127.0.0.1:${server.address().port}  (no real model is called; nothing is billed)`));
