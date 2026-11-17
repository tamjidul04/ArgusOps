/**
 * End-to-end check of the local product, free and offline: the real built `argus` CLI and local engine, a fake model
 * provider, and a fake agent that gets stuck in a loop. It plays the operator through the real control API and CLI.
 *
 *   npm run test:e2e
 */
import fs from "node:fs";
import path from "node:path";
import { argus, check, CLI, fakeProvider, finish, freePort, HERE, sleep, start, tempDir, until } from "./lib.mjs";

const AGENT = path.join(HERE, "fake-agent.mjs");
const home = tempDir("argus-e2e-home-");
const work = tempDir("argus-e2e-work-");
const cleanup = [];

try {
  if (!fs.existsSync(CLI)) throw new Error("Build the CLI first: npm run cli:build");
  const fake = await fakeProvider();
  cleanup.push(() => fake.child.kill());

  // the local control API, as the desktop app and `argus ui` use it
  const apiPort = await freePort();
  const serve = start(process.execPath, [CLI, "serve", "--port", String(apiPort)], { env: { ARGUSOPS_HOME: home } });
  cleanup.push(() => serve.child.kill());
  await until(() => serve.out.includes("control API on"), 10_000, "argus serve");
  const token = fs.readFileSync(path.join(home, "control.token"), "utf8").trim();
  const api = (p, init = {}) => fetch(`http://127.0.0.1:${apiPort}${p}`, { ...init, headers: { "x-argus-token": token, "content-type": "application/json", ...(init.headers ?? {}) } });

  // 1. an agent that loops is paused, with a suggested way out
  const run = start(process.execPath, [CLI, "run", "--upstream", fake.url, "--name", "E2E agent", "--", process.execPath, AGENT], { env: { ARGUSOPS_HOME: home }, cwd: work });
  cleanup.push(() => run.child.kill());
  const paused = await until(async () => (await (await api("/api/agents")).json()).agents.find((a) => a.status === "PAUSED"), 30_000, "the agent to be paused");
  check("a looping agent is paused", !!paused, paused.reason);
  check("ArgusOps suggests an instruction naming the repeated command", /npm test/.test(paused.suggestion?.text ?? ""), (paused.suggestion?.text ?? "").slice(0, 90));
  const before = fake.requests();
  await sleep(1500);
  check("while paused, its next request is held (nothing reaches the provider)", fake.requests() === before);

  const incidents = (await (await api("/api/incidents")).json()).incidents;
  check("an incident is recorded", incidents.some((i) => i.kind === "LOOP" && i.action === "PAUSED"));
  const alerts = (await (await api("/api/alerts")).json()).alerts;
  check("an alert is waiting for you", alerts.some((n) => !n.read && /paused/i.test(n.title)), alerts[0]?.title);

  // 2. the local API refuses web pages and missing tokens
  check("no token: refused", (await fetch(`http://127.0.0.1:${apiPort}/api/agents`)).status === 401);
  check("a web page's Origin: refused", (await api("/api/agents", { headers: { origin: "https://evil.example" } })).status === 403);

  // 3. approve the suggestion through the API (what the app's button does)
  const approved = await api(`/api/agents/${paused.id}/approve`, { method: "POST", body: "{}" });
  check("approving the suggestion through the local API works", approved.status === 200, (await approved.json()).message);
  const code = await Promise.race([run.exited, sleep(20_000).then(() => "timeout")]);
  check("the agent continued with the instruction and finished", code === 0, `exit ${code}`);
  check("the model received the operator's note", /received the operator's note/.test(run.out), run.out.trim().split("\n").filter((l) => l.includes("request")).pop());
  await sleep(700);
  const ended = (await (await api("/api/agents")).json()).agents.find((a) => a.id === paused.id);
  check("the agent is shown as finished", ended?.status === "ENDED", ended?.status);

  const usage = (await (await api("/api/usage?range=24h")).json()).totals;
  check("token usage and an estimated cost are recorded", usage.calls >= 3 && usage.costUsd > 0, `${usage.calls} calls, $${usage.costUsd}`);

  // 4. the same through the CLI
  const st = await argus(home, ["status"]);
  check("argus status lists the agent", st.code === 0 && st.out.includes("E2E agent"));
  const us = await argus(home, ["usage", "--range", "24h"]);
  check("argus usage shows the calls", us.code === 0 && /model calls/.test(us.out));

  // 5. a stubborn agent that ignores errors is ended for real by `argus stop`
  const stubborn = start(process.execPath, [CLI, "run", "--upstream", fake.url, "--name", "Stubborn agent", "--", process.execPath, AGENT], { env: { ARGUSOPS_HOME: home, FAKE_MODE: "stubborn" }, cwd: work });
  cleanup.push(() => stubborn.child.kill());
  await until(async () => (await (await api("/api/agents")).json()).agents.find((a) => a.name.startsWith("Stubborn") && a.status === "PAUSED"), 30_000, "the stubborn agent to be paused");
  const stop = await argus(home, ["stop", "Stubborn"]);
  check("argus stop accepts", stop.code === 0, stop.out.trim());
  const stopped = await Promise.race([stubborn.exited, sleep(15_000).then(() => "timeout")]);
  check("the stubborn agent's process is ended", stopped !== "timeout", `exit ${stopped}`);
  const s2 = (await (await api("/api/agents")).json()).agents.find((a) => a.name.startsWith("Stubborn"));
  check("and shown as stopped", s2?.status === "STOPPED", s2?.status);

  // 6. nothing left the machine: every model call went to the fake provider
  check("every model call went to the provider given (the fake one)", fake.requests() >= 4, `${fake.requests()} calls`);
} catch (e) {
  check("no unexpected error", false, e && e.stack ? e.stack : String(e));
}

finish("END-TO-END", [...cleanup, () => fs.rmSync(home, { recursive: true, force: true }), () => fs.rmSync(work, { recursive: true, force: true })]);
