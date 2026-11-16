// Stands in for `claude -p --input-format stream-json --output-format stream-json`, for tests. It speaks the same
// protocol: one JSON line per user message in, events out, each turn ending with a "result" event.
// Commands inside the message text (several may be combined, one per line):
//   WRITE <path> <text...>   write a file in the working folder (what an agent's edit tool would do)
//   DELETE <path>            delete a file
//   SAY <text...>            the final text of the turn
//   ERROR                    end the turn as an error
//   DENY                     report a permission denial
//   SLOW                     never answer this turn
//   CRASH                    exit with code 3 in the middle of the turn
// It also writes every message it received to fake-claude.log in the working folder.
import fs from "node:fs";
import path from "node:path";

const out = (ev) => process.stdout.write(JSON.stringify(ev) + "\n");
let cost = 0;
let buf = "";
const session = "fake-session-1";
const argv = process.argv.slice(2);
out({ type: "system", subtype: "init", session_id: session, args: argv });

process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    const text = (msg.message?.content ?? []).map((b) => b.text ?? "").join("\n");
    fs.appendFileSync(path.join(process.cwd(), "fake-claude.log"), JSON.stringify(text) + "\n");
    let say = "Done.";
    let isError = false;
    let denials = [];
    for (const raw of text.split("\n")) {
      const l = raw.trim();
      if (l.startsWith("WRITE ")) {
        const [, file, ...rest] = l.split(" ");
        fs.mkdirSync(path.dirname(path.join(process.cwd(), file)), { recursive: true });
        fs.writeFileSync(path.join(process.cwd(), file), rest.join(" ").replace(/\\n/g, "\n") + "\n");
      } else if (l.startsWith("DELETE ")) fs.rmSync(path.join(process.cwd(), l.slice(7)), { force: true });
      else if (l.startsWith("SAY ")) say = l.slice(4);
      else if (l === "ERROR") isError = true;
      else if (l === "DENY") denials = [{ tool_name: "Bash", tool_input: { command: "rm -rf /" } }];
      else if (l === "SLOW") return;
      else if (l === "CRASH") process.exit(3);
    }
    cost += 0.01;
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: say }] }, session_id: session });
    out({ type: "result", subtype: isError ? "error_during_execution" : "success", is_error: isError, result: say, total_cost_usd: cost, num_turns: 1, permission_denials: denials, session_id: session });
  }
});
process.stdin.on("end", () => process.exit(0));
