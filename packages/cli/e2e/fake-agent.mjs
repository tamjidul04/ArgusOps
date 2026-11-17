// Stands in for Claude Code: talks to ANTHROPIC_BASE_URL, gets stuck repeating a failing command.
const base = process.env.ANTHROPIC_BASE_URL;
if (!base) {
  console.error("ANTHROPIC_BASE_URL not set");
  process.exit(9);
}

const call = (id, name, input) => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
const err = (id, text) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: text }] });

async function ask(messages, label) {
  const started = Date.now();
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "sk-ant-FAKE-user-key", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 100, stream: true, messages }),
  });
  const text = await res.text();
  // a streamed reply arrives in pieces: join every text piece
  const reply = [...text.matchAll(/"text":"([^"]*)"/g)].map((m) => m[1]).join("").trim() || "(no text)";
  console.log(`[fake-agent] ${label}: HTTP ${res.status} after ${Date.now() - started}ms -> ${reply}`);
  return res.status;
}

await ask([{ role: "user", content: "fix the failing tests" }], "request 1 (healthy)");

const stuck = [{ role: "user", content: "fix the failing tests" }];
for (let i = 0; i < 4; i++) stuck.push(call(`c${i}`, "Bash", { command: "npm test" }), err(`c${i}`, "FAIL: expected 200 got 500"));
console.log("[fake-agent] request 2: the same failing command four times (stuck)...");
const status = await ask(stuck, "request 2 (stuck)");

// A stubborn agent ignores errors and keeps retrying forever: only a real process kill can end it.
if (process.env.FAKE_MODE === "stubborn") {
  console.log("[fake-agent] stubborn mode: retrying forever");
  for (;;) {
    await ask(stuck, "retry").catch(() => 0);
    await new Promise((r) => setTimeout(r, 300));
  }
}

if (status === 200) {
  await ask([...stuck, { role: "user", content: "continue" }], "request 3 (after resume)");
}
console.log("[fake-agent] done");
