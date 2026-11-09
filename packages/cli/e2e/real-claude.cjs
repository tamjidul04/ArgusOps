/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
/**
 * Free test with the REAL Claude Code: real `claude` + real `argus` CLI + real app and database. Only the model
 * is fake (a local stand-in for api.anthropic.com), so it costs nothing and needs no Anthropic account.
 * The fake model keeps asking Claude Code to run the same failing command, so Claude Code really loops.
 *
 *   1. npm install -g @anthropic-ai/claude-code        (free; or set CLAUDE_BIN to its path)
 *   2. npm run dev                                      (app on http://localhost:3000, database seeded)
 *   3. npm run test:claude
 *
 * Creates one throwaway account and deletes it afterwards. Claude Code runs with --dangerously-skip-permissions
 * in an empty temporary folder, and the only command it is ever asked to run is `node -e "process.exit(1)"`.
 */
const ROOT = require("node:path").resolve(__dirname, "../../..");
process.chdir(ROOT);
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));

const CLAUDE = process.env.CLAUDE_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");
const CLI = path.join(ROOT, "packages/cli/dist/argus.mjs");
const FAKE = path.join(__dirname, "fake-anthropic.mjs");
const FAKE_PORT = 8791;
const BASE = process.env.ARGUS_E2E_URL || "http://localhost:3000";
let fakeOut = "";
const prisma = new PrismaClient();
const tag = `rc${Date.now()}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "argus-realclaude-"));
let failures = 0;

const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "   " + extra : ""}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500); }
  throw new Error("timed out waiting for " + what);
}
const toolRequests = () => (fakeOut.match(/POST \/v1\/messages\S*\s+model=\S+ stream=\w+ messages=\d+ tools=([1-9]\d*)/g) || []).length;

(async () => {
  let child;
  let fake;
  try {
    fake = spawn(process.execPath, [FAKE, String(FAKE_PORT), "--loop"], { stdio: ["ignore", "pipe", "pipe"] });
    fake.stdout.on("data", (d) => (fakeOut += d));
    fake.stderr.on("data", (d) => (fakeOut += d));
    await until(() => fakeOut.includes("listening"), 10000, "the fake provider to start");

    const plan = await prisma.pricingPlan.findUniqueOrThrow({ where: { plan_id: "plan_free" } });
    const user = await prisma.user.create({
      data: {
        email: `${tag}@example.test`, name: "Real Claude Test", password_hash: "oauth$none", role: "USER", status: "ACTIVE",
        subscription: { create: { plan_id: plan.plan_id, free_tokens: 5_000_000, paid_tokens: 0, max_agents: plan.agent_limit, purchase_status: "NONE" } },
        policy: { create: {} },
        clusters: { create: { name: "RC", environment: "LOCAL_PC" } },
      },
    });
    const raw = "argus_live_" + crypto.randomBytes(24).toString("hex");
    await prisma.apiKey.create({ data: { user_id: user.id, label: "rc", key_prefix: "argus_live_", key_hash: crypto.createHash("sha256").update(raw).digest("hex") } });
    const session = "tok-" + tag;
    await prisma.session.create({ data: { user_id: user.id, token_hash: crypto.createHash("sha256").update(session).digest("hex"), expires_at: new Date(Date.now() + 3600_000) } });

    let stdout = "", stderr = "";
    child = spawn(process.execPath, [CLI, "run", "--upstream", `http://127.0.0.1:${FAKE_PORT}`, "--name", "Real Claude", "--", CLAUDE,
      "-p", "run the tests until they pass", "--dangerously-skip-permissions", "--max-turns", "40"], {
      cwd: work,
      env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-api03-fake-key-for-free-testing", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ARGUS_API_KEY: raw, ARGUS_API_URL: BASE, ARGUS_CONFIG_DIR: path.join(work, "cfg") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const exited = new Promise((r) => child.on("exit", (c) => r(c)));

    const paused = await until(() => prisma.agent.findFirst({ where: { cluster: { user_id: user.id }, status: "PAUSED_NUDGE" } }), 120000, "the real Claude Code to be paused");
    check("REAL Claude Code got stuck repeating a command and ArgusOps paused it", !!paused, paused.current_task?.slice(0, 80));
    const requestsAtPause = toolRequests();
    await sleep(4000);
    check("while paused, Claude Code's next request is held (no new request reaches the provider)", toolRequests() === requestsAtPause, `${toolRequests()} tool requests, unchanged for 4s`);

    const incident = await prisma.incident.findFirst({ where: { user_id: user.id } });
    check("incident recorded", incident?.kind === "LOOP" && incident.action === "PAUSED", `${incident?.detail?.slice(0, 70)}`);
    const usage = await prisma.usageEvent.findMany({ where: { user_id: user.id } });
    check("real token usage from real Claude Code recorded", usage.length >= 3 && usage.every((u) => u.input_tokens > 1000 && u.cost_usd > 0), `${usage.length} requests, ~${usage[0]?.input_tokens} input tokens each, model ${usage[0]?.model}`);

    const cookieHeader = { "content-type": "application/json", cookie: "argus_session=" + session };
    const resume = await fetch(BASE + "/api/guardrails", { method: "POST", headers: cookieHeader, body: JSON.stringify({ action: "SEND_NUDGE", agentId: paused.agent_id, hintText: "Stop re-running that command; it will always fail." }) });
    check("operator resumed it with a hint from the dashboard API", resume.status === 200, (await resume.json()).message);

    const code = await Promise.race([exited, sleep(120000).then(() => "timeout")]);
    check("Claude Code received the hint and finished normally", code === 0, `exit ${code}`);
    check("Claude Code's final answer shows it read the operator's note", /operator's note/i.test(stdout), stdout.trim().split("\n").pop()?.slice(0, 100));
    await sleep(800);
    const after = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: user.id } } });
    check("agent freed its slot on exit", after.status === "HIBERNATED", after.status);
    console.log("--- what the user saw from ArgusOps:\n" + stderr.trim().split("\n").filter(Boolean).map((l) => "    " + l).join("\n"));
  } catch (e) {
    console.log("ERROR  " + (e && e.stack ? e.stack : e));
    failures++;
  } finally {
    try { child && child.kill(); } catch {}
    try { fake && fake.kill(); } catch {}
    try { await prisma.user.deleteMany({ where: { email: { startsWith: tag } } }); } catch {}
    await prisma.$disconnect();
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
    console.log(failures === 0 ? "\nREAL CLAUDE CODE TEST: ALL PASSED" : `\nREAL CLAUDE CODE TEST: ${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
