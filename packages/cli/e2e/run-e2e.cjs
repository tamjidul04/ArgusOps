/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS script */
/**
 * End-to-end check: the real `argus` CLI against the real app and database, with a fake model provider and a
 * fake agent that gets stuck in a loop. It plays the operator through the real HTTP API.
 *
 *   1. npm run dev                 (app on http://localhost:3000, database seeded)
 *   2. npm run test:e2e
 *
 * Creates one throwaway account and deletes it afterwards. Set ARGUS_E2E_URL to test another server.
 */
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../../..");
process.chdir(ROOT);
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const { PrismaClient } = require(path.join(ROOT, "node_modules/@prisma/client"));

const BASE = process.env.ARGUS_E2E_URL || "http://localhost:3000";
const CLI = path.join(ROOT, "packages/cli/dist/argus.mjs");
const AGENT = path.join(__dirname, "fake-agent.mjs");
const prisma = new PrismaClient();
const tag = `e2e${Date.now()}`;
const email = `${tag}@example.test`;
const password = "e2e-password-123";
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-e2e-"));
let failures = 0;

const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "   " + extra : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---- fake Anthropic ----------------------------------------------------------------------------------------------
const seen = [];
const upstream = http.createServer((req, res) => {
  const parts = [];
  req.on("data", (c) => parts.push(c));
  req.on("end", () => {
    const body = Buffer.concat(parts).toString("utf8");
    seen.push({ url: req.url, key: req.headers["x-api-key"], body });
    const hinted = body.includes("ArgusOps note");
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-4-5-20250929", usage: { input_tokens: 1200, cache_read_input_tokens: 8000, output_tokens: 1 } } })}\n\n`);
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: `ok hint=${hinted}` } })}\n\n`);
    res.end(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 300 } })}\n\n`);
  });
});

// ---- helpers ---------------------------------------------------------------------------------------------------------
function cli(args, env = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ARGUS_CONFIG_DIR: cfgDir, ARGUS_API_URL: BASE, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((r) => child.on("exit", (code) => r(code)));
  return { child, done, out: () => stdout, errs: () => stderr };
}

let cookie = "";
async function api(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
}

(async () => {
  try {
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

    // 1. a fresh account (Free plan: 2 agents)
    const reg = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E", email, password }) });
    cookie = (reg.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    check("account created and signed in", reg.status === 201 && cookie.includes("argus_session"));
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // 2. argus login (device pairing)
    const login = cli(["login", "--no-browser", "--api-url", BASE]);
    const code = await until(() => /confirm the code:\s+([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(login.out())?.[1], 15000, "the pairing code");
    const approve = await api("/api/device/approve", { user_code: code });
    check("code approved in the browser", approve.status === 200, approve.json.message ?? approve.json.error);
    check("argus login finished", (await login.done) === 0, login.out().split("\n").filter(Boolean).pop());
    const saved = JSON.parse(fs.readFileSync(path.join(cfgDir, "config.json"), "utf8"));
    check("key saved locally, user recorded", /^argus_live_/.test(saved.token) && saved.user.email === email);
    if (process.platform !== "win32") check("config file is private (0600)", (fs.statSync(path.join(cfgDir, "config.json")).mode & 0o777) === 0o600);
    const who = cli(["whoami"]);
    check("whoami works with the saved key", (await who.done) === 0 && who.out().includes(email), who.out().split("\n")[1]);

    // 3. run an agent that gets stuck, and watch ArgusOps catch it
    const before = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: user.id } });
    const run1 = cli(["run", "--upstream", upstreamUrl, "--name", "E2E Agent", "--", "node", AGENT]);
    const agentRow = await until(() => prisma.agent.findFirst({ where: { cluster: { user_id: user.id }, status: "PAUSED_NUDGE" } }), 30000, "the agent to be paused");
    check("loop detected: agent PAUSED in the dashboard", !!agentRow, agentRow?.current_task?.slice(0, 70));
    const incident = await prisma.incident.findFirst({ where: { user_id: user.id, agent_id: agentRow.agent_id } });
    check("incident recorded with loop type and sub-100ms detection", incident?.kind === "LOOP" && incident.action === "PAUSED" && incident.loop_type === "EXACT_TOOL_LOOP" && incident.interception_ms < 100, `interception ${incident?.interception_ms}ms`);
    check("only the healthy request reached the provider while paused", seen.length === 1, `provider saw ${seen.length} request(s)`);
    check("the agent's own credentials were forwarded untouched", seen[0]?.key === "sk-ant-FAKE-user-key");
    const note = await until(() => prisma.notification.findFirst({ where: { user_id: user.id, title: { endsWith: "was paused" } } }), 10000, "the pause notification");
    check("a notification was created for the pause", note.level === "WARN", note.title);
    const page = await fetch(BASE + "/dashboard/notifications", { headers: { cookie } });
    const html = await page.text();
    check("the Notifications page loads and lists it", page.status === 200 && html.includes(note.title), `HTTP ${page.status}`);
    const usage = await prisma.usageEvent.findMany({ where: { user_id: user.id } });
    check("real token usage recorded with cost", usage.length === 1 && usage[0].input_tokens === 1200 && usage[0].output_tokens === 300 && usage[0].cost_usd > 0, `${usage[0]?.input_tokens} in / ${usage[0]?.output_tokens} out, $${usage[0]?.cost_usd}`);
    const mid = await prisma.subscriptionAndWallet.findUniqueOrThrow({ where: { user_id: user.id } });
    check("wallet charged exactly the metered tokens", before.free_tokens - mid.free_tokens === 1500, `${before.free_tokens - mid.free_tokens} tokens`);
    const sug = await api("/api/rewrites?agentId=" + agentRow.agent_id);
    check("a suggested instruction was written for the loop", !!sug.json.suggestion && sug.json.suggestion.text.includes("npm test"), (sug.json.suggestion?.text || "").slice(0, 80));
    const guard = await api("/api/guardrails");
    check("dashboard API shows the paused agent and the incident", guard.json.flaggedAgents?.some((a) => a.agent_id === agentRow.agent_id) && guard.json.streamEvents?.length >= 1);

    // 4. the operator resumes it with a hint
    const resume = await api("/api/guardrails", { action: "SEND_NUDGE", agentId: agentRow.agent_id, hintText: "Skip the flaky test and run the build instead." });
    check("operator resumed the agent with a hint", resume.status === 200, resume.json.message ?? resume.json.error);
    const code1 = await Promise.race([run1.done, sleep(30000).then(() => "timeout")]);
    check("agent was released and finished normally", code1 === 0, `exit ${code1}`);
    const hintedReq = seen.find((s) => s.body.includes("Skip the flaky test"));
    check("the hint reached the model on the released request", !!hintedReq && hintedReq.body.includes("ArgusOps note"));
    check("the stuck request was forwarded once, not repeated", seen.filter((s) => s.body.includes("FAIL: expected 200")).length === 2, `provider saw ${seen.length} requests in total`);
    await sleep(500);
    const after = await prisma.agent.findUniqueOrThrow({ where: { agent_id: agentRow.agent_id } });
    check("clean exit freed the plan slot (agent hibernated)", after.status === "HIBERNATED", after.status);
    const usageAfter = await prisma.usageEvent.count({ where: { user_id: user.id } });
    check("every provider call was metered", usageAfter === seen.length, `${usageAfter} usage events / ${seen.length} calls`);
    console.log("--- CLI messages shown to the user:\n" + run1.errs().trim().split("\n").map((l) => "    " + l).join("\n"));

    // 5. run again, and stop the stuck agent from the dashboard
    seen.length = 0;
    const run2 = cli(["run", "--upstream", upstreamUrl, "--name", "E2E Agent", "--", "node", AGENT], { FAKE_MODE: "stubborn" });
    const row2 = await until(() => prisma.agent.findFirst({ where: { cluster: { user_id: user.id }, name: { startsWith: "E2E Agent" }, status: "PAUSED_NUDGE" } }), 30000, "the second pause");
    check("a fresh run starts clean, then gets paused again", !!row2);
    const kill = await api("/api/guardrails", { action: "TRIGGER_KILL_SWITCH", agentId: row2.agent_id });
    check("operator pressed stop", kill.status === 200);
    const code2 = await Promise.race([run2.done, sleep(30000).then(() => "timeout")]);
    check("CLI force-stopped an agent that ignores errors and keeps retrying", code2 !== "timeout" && code2 !== 0, `exit ${code2}`);
    const seenAtExit = seen.length;
    await sleep(1500);
    check("the agent process is really gone (no more traffic)", seen.length === seenAtExit, `${seen.length - seenAtExit} extra requests`);
    check("no further request reached the provider after stop", seen.filter((s) => s.body.includes("FAIL: expected 200")).length === 0, `provider saw ${seen.length}`);
    const killed = await prisma.agent.findUniqueOrThrow({ where: { agent_id: row2.agent_id } });
    check("agent shows as stopped", killed.status === "KILLED_LOOP");

    // 6. plan limit is enforced before an agent starts
    await prisma.agent.updateMany({ where: { cluster: { user_id: user.id } }, data: { status: "ACTIVE", last_heartbeat_at: new Date() } });
    for (const n of ["Filler A", "Filler B"]) {
      const c = await prisma.clusterAndWorkspace.findFirstOrThrow({ where: { user_id: user.id } });
      await prisma.agent.upsert({ where: { agent_id: `${tag}-${n}`.replace(/ /g, "") }, update: {}, create: { agent_id: `${tag}-${n}`.replace(/ /g, ""), cluster_id: c.cluster_id, name: n, agent_type: "CLAUDE", status: "ACTIVE" } });
    }
    seen.length = 0;
    const refused = cli(["run", "--upstream", upstreamUrl, "--name", "One Too Many", "--", "node", AGENT]);
    const refusedCode = await Promise.race([refused.done, sleep(20000).then(() => "timeout")]);
    check("a third concurrent agent on Free is refused before it starts", refusedCode === 2 && refused.errs().includes("allows 2 concurrent agents"), refused.errs().trim().split("\n").pop());
    check("the refused agent never contacted the provider", seen.length === 0);

    // 7. not signed in
    const lonely = cli(["run", "--", "node", AGENT], { ARGUS_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "argus-empty-")) });
    check("running without logging in explains what to do", (await lonely.done) === 1 && lonely.errs().includes("argus login"));
  } catch (e) {
    console.log("ERROR  " + (e && e.stack ? e.stack : e));
    failures++;
  } finally {
    try { await prisma.user.deleteMany({ where: { email: { startsWith: tag } } }); } catch {}
    try { await prisma.cliDevice.deleteMany({ where: { name: { not: null }, user_id: null, expires_at: { lt: new Date() } } }); } catch {}
    await prisma.$disconnect();
    upstream.close();
    fs.rmSync(cfgDir, { recursive: true, force: true });
    console.log(failures === 0 ? "\nE2E: ALL PASSED" : `\nE2E: ${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
