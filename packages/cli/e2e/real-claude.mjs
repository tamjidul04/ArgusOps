/**
 * Free test with the REAL Claude Code: real `claude` + the real `argus` CLI. Only the model is fake (a local
 * stand-in for api.anthropic.com), so it costs nothing and needs no Anthropic account. The fake model keeps asking
 * Claude Code to run the same failing command, so Claude Code really loops, and ArgusOps must catch it.
 *
 *   npm install -g @anthropic-ai/claude-code   (or set CLAUDE_BIN to its path)
 *   npm run test:claude
 *
 * Claude Code may run exactly one command, `node -e "process.exit(1)"`, in an empty temporary folder.
 */
import fs from "node:fs";
import { argus, check, CLI, fakeProvider, finish, sleep, start, tempDir, until } from "./lib.mjs";

const CLAUDE = process.env.CLAUDE_BIN || "claude";
const home = tempDir("argus-rc-home-");
const work = tempDir("argus-rc-work-");
const cleanup = [];

try {
  if (!fs.existsSync(CLI)) throw new Error("Build the CLI first: npm run cli:build");
  const fake = await fakeProvider(["--loop"]);
  cleanup.push(() => fake.child.kill());
  const toolRequests = () => fake.out.split(/\r?\n/).filter((l) => /POST \/v1\/messages/.test(l) && /tools=[1-9]/.test(l)).length;

  const run = start(
    process.execPath,
    [CLI, "run", "--upstream", fake.url, "--name", "Real Claude", "--", CLAUDE, "-p", "run the tests until they pass", "--allowedTools", 'Bash(node -e "process.exit(1)")', "--max-turns", "40"],
    { env: { ARGUSOPS_HOME: home, ANTHROPIC_API_KEY: "sk-ant-api03-fake-key-for-free-testing", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, cwd: work }
  );
  cleanup.push(() => run.child.kill());

  const status = async () => JSON.parse((await argus(home, ["status", "--json"])).out || "{}");
  const paused = await until(async () => (await status()).agents?.find((a) => a.status === "PAUSED"), 120_000, "the real Claude Code to be paused");
  check("REAL Claude Code got stuck repeating a command and ArgusOps paused it", !!paused, paused.reason?.slice(0, 80));
  const atPause = toolRequests();
  check("the fake model's tool requests are being counted", atPause >= 3, `${atPause} so far`);
  await sleep(4000);
  check("while paused, Claude Code's next request is held", toolRequests() === atPause, `${toolRequests()} requests with tools, unchanged for 4 s`);
  check("ArgusOps wrote an instruction naming the repeated command", (paused.suggestion?.text ?? "").includes("process.exit(1)"), (paused.suggestion?.text ?? "").slice(0, 90));

  const resumed = await argus(home, ["resume", "--approve"]);
  check("argus resume --approve from another process", resumed.code === 0, resumed.out.trim());
  const code = await Promise.race([run.exited, sleep(120_000).then(() => "timeout")]);
  check("Claude Code received the instruction and finished normally", code === 0, `exit ${code}`);
  check("its final answer shows the model read the operator's note", /operator's note/i.test(run.out), run.out.trim().split("\n").pop()?.slice(0, 100));
  await sleep(800);
  const after = (await status()).agents?.find((a) => a.name.startsWith("Real Claude"));
  check("the agent is shown as finished", after?.status === "ENDED", after?.status);
  const usage = await argus(home, ["usage", "--range", "24h"]);
  check("real Claude Code's token usage is recorded", /\d+ model calls/.test(usage.out), usage.out.split("\n")[1]?.trim());
  console.log("--- what the user saw from ArgusOps:\n" + run.err.trim().split("\n").filter((l) => l.includes("[argus]")).map((l) => "    " + l).join("\n"));
} catch (e) {
  check("no unexpected error", false, e && e.stack ? e.stack : String(e));
}

finish("REAL CLAUDE CODE TEST", [...cleanup, () => fs.rmSync(home, { recursive: true, force: true }), () => fs.rmSync(work, { recursive: true, force: true })]);
