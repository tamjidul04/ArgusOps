import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Controls } from "./control";
import { LocalHub } from "./hub";
import { DEFAULT_PRICES } from "./prices";
import { runAgent } from "./run";
import { Store } from "./store";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function freePort() {
  return new Promise<number>((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

/** A stand-in for api.anthropic.com that records what it receives. */
async function fakeAnthropic() {
  const seen: Array<{ url: string; auth: string | undefined; body: string }> = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization as string | undefined, body: Buffer.concat(parts).toString("utf8") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { seen, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

describe("argus proxy (run without launching an agent)", () => {
  it("forwards an already-running agent's calls untouched until it is told to stop", async () => {
    const upstream = await fakeAnthropic();
    const port = await freePort();
    const stop = new AbortController();
    const output: string[] = [];

    const running = runAgent({
      label: "Claude Code (IDE)",
      type: "CLAUDE",
      args: [],
      provider: "anthropic",
      upstream: upstream.url,
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      cwd: process.cwd(),
      hub: null,
      port,
      stopSignal: stop.signal,
      write: (t) => output.push(t),
    });

    // wait for the proxy to be listening, then talk to it the way the Claude Code panel would
    let res: Response | undefined;
    for (let i = 0; i < 50 && !res; i++) {
      try {
        res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer sk-ant-oat-fake-login", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 10, messages: [{ role: "user", content: "hello" }] }),
        });
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    expect(res?.status).toBe(200);
    expect(upstream.seen).toHaveLength(1);
    expect(upstream.seen[0].auth).toBe("Bearer sk-ant-oat-fake-login"); // the agent's own login goes through untouched

    stop.abort();
    expect(await running).toBe(0);
    expect(output.join("")).toContain(`Supervising anything that uses ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
  });

  it("refuses to start when the port is taken instead of hiding the problem", async () => {
    const port = await freePort();
    const squatter = http.createServer();
    await new Promise<void>((r) => squatter.listen(port, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => { squatter.close(() => r()); }));
    const output: string[] = [];
    const code = await runAgent({ label: "x", type: "CLAUDE", args: [], provider: "anthropic", upstream: "http://127.0.0.1:1", baseUrlEnv: "ANTHROPIC_BASE_URL", cwd: process.cwd(), hub: null, port, write: (t) => output.push(t) });
    expect(code).toBe(2);
    expect(output.join("")).toMatch(/already in use/);
  });
});

describe("a whole supervised run with the local store (no website, no cloud)", () => {
  const call = (id: string, name: string, input: unknown) => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
  const failed = (id: string, text: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: text }] });
  const stuck = () => {
    const m: unknown[] = [{ role: "user", content: "fix the tests" }];
    for (let i = 0; i < 4; i++) m.push(call(`c${i}`, "Bash", { command: "npm test", description: `try ${i}` }), failed(`c${i}`, "FAIL src/a.test.ts"));
    return { model: "claude-sonnet-4-5", max_tokens: 100, messages: m };
  };
  const until = async <T,>(fn: () => T | undefined | false | null, ms = 8000): Promise<T> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timed out");
  };
  const send = (port: number, body: unknown) =>
    fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("meters usage, pauses on a loop with a suggestion, resumes with a hint, then stops", async () => {
    const upstream = await fakeAnthropic();
    const port = await freePort();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-run-"));
    closers.push(async () => fs.rmSync(home, { recursive: true, force: true }));
    const store = new Store(home);
    const controls = new Controls(store);
    const stop = new AbortController();

    const running = runAgent({
      label: "Claude Code (IDE)",
      type: "CLAUDE",
      args: [],
      provider: "anthropic",
      upstream: upstream.url,
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      cwd: process.cwd(),
      hub: new LocalHub(store, DEFAULT_PRICES),
      port,
      stopSignal: stop.signal,
      syncIntervalMs: 40,
      write: () => undefined,
    });

    // 1. a normal request is forwarded and metered into the local store
    let ok: Response | undefined;
    for (let i = 0; i < 80 && !ok; i++) ok = await send(port, { model: "claude-sonnet-4-5", max_tokens: 10, messages: [{ role: "user", content: "hello" }] }).catch(() => undefined);
    expect(ok?.status).toBe(200);
    const agent = await until(() => store.agents()[0]);
    await until(() => store.usage().length > 0);
    expect(store.usage()[0]).toMatchObject({ provider: "anthropic", input_tokens: 10, output_tokens: 2 });

    // 2. a loop holds the next request and is recorded with a suggestion
    const held = send(port, stuck());
    const paused = await until(() => store.agent(agent.id)?.status === "PAUSED" && store.agent(agent.id));
    expect(paused.suggestion?.text).toMatch(/npm test/);
    expect(store.incidents().some((i) => i.action === "PAUSED")).toBe(true);
    expect(upstream.seen).toHaveLength(1); // the held request has not been forwarded

    // 3. approving the suggestion releases the request, and the agent receives the instruction
    expect((await controls.applySuggestion(agent.id)).ok).toBe(true);
    const released = await held;
    expect(released.status).toBe(200);
    await until(() => upstream.seen.length === 2);
    expect(upstream.seen[1].body).toContain("Stop re-running");

    // 4. stop: the next request is refused with a final 403 (not a retryable 5xx)
    await controls.stop(agent.id);
    await until(() => store.agent(agent.id)?.status === "STOPPED");
    let status = 0;
    for (let i = 0; i < 100 && status !== 403; i++) {
      status = (await send(port, { model: "claude-sonnet-4-5", max_tokens: 10, messages: [{ role: "user", content: "again" }] })).status;
      if (status !== 403) await new Promise((r) => setTimeout(r, 30));
    }
    expect(status).toBe(403);

    stop.abort();
    expect(await running).toBe(0);
  });
});

describe("the supervisor during a real proxied session", () => {
  it("checks a turn when the agent hands back, catches a false claim, and redirects with the next message", async () => {
    const { execFileSync } = await import("node:child_process");
    const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const { allowProject, detectGates } = await import("./gates");

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sup-run-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sup-proj-"));
    closers.push(async () => {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    });
    git(root, "init", "-q");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: 'node -e "process.exit(require(\'fs\').existsSync(\'BROKEN\') ? 1 : 0)"' } }));
    fs.writeFileSync(path.join(root, "a.js"), "module.exports = 1;\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");

    const store = new Store(home);
    await store.saveConfig({ supervisor: { mode: "redirect", maxTurnTokens: 0, redirectCooldownMs: 0, maxRedirectsInARow: 3 } });
    await allowProject(store, root, detectGates(root));

    // the "model": during the first turn it edits the project (as the agent would through tools) and claims success
    const bodies: string[] = [];
    let turn = 0;
    const upstream = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        bodies.push(Buffer.concat(parts).toString("utf8"));
        turn++;
        if (turn === 1) {
          fs.writeFileSync(path.join(root, "BROKEN"), "x");
          fs.writeFileSync(path.join(root, "a.js"), "module.exports = 2;\n");
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-4-5", usage: { input_tokens: 50 } } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Fixed it. All tests pass." } })}\n\n`);
        res.end(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } })}\n\n`);
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));

    const port = await freePort();
    const stop = new AbortController();
    const output: string[] = [];
    const running = runAgent({
      label: "Claude Code (IDE)",
      type: "CLAUDE",
      args: [],
      provider: "anthropic",
      upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      cwd: root,
      hub: new LocalHub(store, DEFAULT_PRICES),
      supervise: { store, root },
      port,
      stopSignal: stop.signal,
      syncIntervalMs: 40,
      write: (t) => output.push(t),
    });

    const ask = (messages: unknown[]) =>
      fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 50, stream: true, tools: [{ name: "Bash" }], messages }) });
    let r: Response | undefined;
    for (let i = 0; i < 80 && !r; i++) r = await ask([{ role: "user", content: "fix the bug" }]).catch(() => undefined);
    expect(r?.status).toBe(200);
    await r!.text();

    // the check runs in the background: wait for the redirect to be queued
    const until = async (fn: () => boolean, ms = 60_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end && !fn()) await new Promise((x) => setTimeout(x, 50));
      return fn();
    };
    const agentId = store.agents()[0]?.id;
    const sawFinding = await until(() => store.incidents().some((i) => i.kind === "FINDING"), 30_000);
    if (!sawFinding) throw new Error(`no finding was recorded. The run said: ${JSON.stringify(output.join(""))}. Incidents: ${JSON.stringify(store.incidents().map((i) => i.kind))}. Upstream calls: ${bodies.length}`);
    const finding = store.incidents().find((i) => i.kind === "FINDING")!;
    expect(finding.findings?.map((f) => f.code)).toEqual(expect.arrayContaining(["claim-contradicted", "gate-test"]));
    expect(finding.agentId).toBe(agentId);

    // the redirect is stored just after the incident; wait for it, and for the run to pick it up
    // (the run picks it up within ~40 ms, so polling the store for it would often just miss it: use the run's own message)
    expect(await until(() => output.join("").includes("will pass what needs fixing"))).toBe(true);
    expect(await until(() => !store.agent(agentId)?.hint)).toBe(true);

    // the human's next message carries the supervisor's instruction to the agent
    await (await ask([{ role: "user", content: "fix the bug" }, { role: "assistant", content: "Fixed it. All tests pass." }, { role: "user", content: "thanks, anything else?" }])).text();
    expect(await until(() => bodies.length >= 2)).toBe(true);
    expect(bodies[1]).toContain("said the tests pass, but they fail");
    expect(output.join("")).toContain("ArgusOps checked the last turn");

    stop.abort();
    expect(await running).toBe(0);
  }, 150_000);
});
