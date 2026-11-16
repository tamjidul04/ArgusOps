// Stands in for Claude Code in tests. Two modes, like the real thing:
//
// 1) `-p --input-format stream-json --output-format stream-json` (Autopilot's agent): one JSON line per user message in,
//    events out, each turn ending with a "result" event. Commands inside the message text (one per line):
//      WRITE <path> <text...>   write a file in the working folder (\n in the text becomes a new line)
//      DELETE <path>            delete a file
//      SAY <text...>            the final text of the turn
//      ERROR                    end the turn as an error
//      DENY                     report a permission denial
//      SLOW                     never answer this turn
//      CRASH                    exit with code 3 in the middle of the turn
//    Every message received is appended to fake-claude.log in the working folder.
//
// 2) `-p --output-format json` (the planner): reads the whole prompt from stdin and answers once. Answers come from the
//    FAKE_CLAUDE_REPLIES environment variable, separated by "|||" (the n-th call gets the n-th answer). The answer
//    "ERROR" is reported as an error. Each call is logged to fake-claude-oneshot.log.
import fs from "node:fs";
import path from "node:path";

const NL = String.fromCharCode(10);
const out = (ev) => process.stdout.write(JSON.stringify(ev) + NL);
const argv = process.argv.slice(2);
const fmt = argv[argv.indexOf("--output-format") + 1];

if (argv.includes("--output-format") && fmt === "json") {
  let prompt = "";
  process.stdin.on("data", (d) => (prompt += d));
  process.stdin.on("end", () => {
    const log = path.join(process.cwd(), "fake-claude-oneshot.log");
    fs.appendFileSync(log, JSON.stringify({ argv, prompt }) + NL);
    const calls = fs.readFileSync(log, "utf8").trim().split(NL).length;
    const replies = (process.env.FAKE_CLAUDE_REPLIES ?? "").split("|||");
    const reply = replies[Math.min(calls, replies.length) - 1] ?? "{}";
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: reply === "ERROR", result: reply }));
    process.exit(0);
  });
} else {
  let cost = 0;
  let buf = "";
  const session = "fake-session-1";
  out({ type: "system", subtype: "init", session_id: session, args: argv });

  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf(NL)) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const text = (msg.message?.content ?? []).map((b) => b.text ?? "").join(NL);
      fs.appendFileSync(path.join(process.cwd(), "fake-claude.log"), JSON.stringify(text) + NL);
      let say = "Done.";
      let isError = false;
      let denials = [];
      let silent = false;
      for (const raw of text.split(NL)) {
        const l = raw.trim();
        if (l.startsWith("WRITE ")) {
          const [, file, ...rest] = l.split(" ");
          const full = path.join(process.cwd(), file);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, rest.join(" ").split("\\n").join(NL) + NL);
        } else if (l.startsWith("DELETE ")) fs.rmSync(path.join(process.cwd(), l.slice(7)), { force: true });
        else if (l.startsWith("SAY ")) say = l.slice(4);
        else if (l === "ERROR") isError = true;
        else if (l === "DENY") denials = [{ tool_name: "Bash", tool_input: { command: "rm -rf /" } }];
        else if (l === "SLOW") silent = true;
        else if (l === "CRASH") process.exit(3);
      }
      if (silent) continue;
      cost += 0.01;
      out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: say }] }, session_id: session });
      out({ type: "result", subtype: isError ? "error_during_execution" : "success", is_error: isError, result: say, total_cost_usd: cost, num_turns: 1, permission_denials: denials, session_id: session });
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
