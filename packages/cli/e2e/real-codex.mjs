/**
 * Free test with the REAL OpenAI Codex CLI: real `codex` + the real `argus` CLI. Only the model is fake (a local
 * stand-in for api.openai.com), so it costs nothing and needs no OpenAI account. The fake model keeps asking Codex to
 * run the same failing code with its `exec` tool (code that only throws an error), so Codex really loops.
 *
 *   npm install -g @openai/codex        (or set CODEX_BIN to its path)
 *   npm run test:codex
 */
import fs from "node:fs";
import path from "node:path";
import { argus, check, CLI, finish, HERE, sleep, start, tempDir, until } from "./lib.mjs";

const CODEX = process.env.CODEX_BIN || "codex";
const home = tempDir("argus-cx-home-");
const work = tempDir("argus-cx-work-");
const codexHome = tempDir("argus-cx-config-");
const cleanup = [];

try {
  if (!fs.existsSync(CLI)) throw new Error("Build the CLI first: npm run cli:build");
  const fake = start(process.execPath, [path.join(HERE, "fake-openai.mjs"), "0", "--loop"]);
  cleanup.push(() => fake.child.kill());
  const url = (await until(() => /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(fake.out), 10_000, "the fake provider"))[1];
  const requests = () => fake.out.split(/\r?\n/).filter((l) => /POST \/v1\/responses/.test(l)).length;

  const run = start(process.execPath, [CLI, "run", "--upstream", url, "--name", "Real Codex", "codex", "exec", "--skip-git-repo-check", "run the tests until they pass"], {
    env: { ARGUSOPS_HOME: home, OPENAI_API_KEY: "sk-fake-key-for-free-testing", CODEX_HOME: codexHome, PATH: process.env.CODEX_DIR ? `${process.env.CODEX_DIR}${path.delimiter}${process.env.PATH}` : process.env.PATH },
    cwd: work,
  });
  cleanup.push(() => run.child.kill());

  const status = async () => JSON.parse((await argus(home, ["status", "--json"])).out || "{}");
  const paused = await until(async () => (await status()).agents?.find((a) => a.status === "PAUSED"), 90_000, "the real Codex to be paused");
  check("REAL Codex was routed through ArgusOps (the fake provider got its requests)", requests() >= 3, `${requests()} requests`);
  check("REAL Codex got stuck repeating a failing call and ArgusOps paused it", !!paused, paused.reason?.slice(0, 90));
  const atPause = requests();
  await sleep(3000);
  check("while paused, Codex's next request is held", requests() === atPause, `${requests()} requests, unchanged for 3 s`);
  check("its API key reached the provider unchanged", /auth=Bearer/.test(fake.out));

  const resumed = await argus(home, ["resume", "--approve"]);
  check("argus resume --approve from another process", resumed.code === 0, resumed.out.trim());
  const code = await Promise.race([run.exited, sleep(90_000).then(() => "timeout")]);
  check("Codex received the instruction and finished normally", code === 0, `exit ${code}`);
  check("its final answer shows the model read the operator's note", /operator's note/i.test(run.out + run.err), (run.out.trim().split("\n").pop() ?? "").slice(0, 100));
  const usage = await argus(home, ["usage", "--range", "24h"]);
  check("Codex's token usage is recorded", /\d+ model calls/.test(usage.out), usage.out.split("\n")[1]?.trim());
} catch (e) {
  check("no unexpected error", false, e && e.stack ? e.stack : String(e));
}

finish("REAL CODEX TEST", [...cleanup, ...[home, work, codexHome].map((d) => () => fs.rmSync(d, { recursive: true, force: true }))]);
