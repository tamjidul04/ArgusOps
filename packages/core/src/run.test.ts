import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { runAgent } from "./run";

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
      cloud: null,
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
    const code = await runAgent({ label: "x", type: "CLAUDE", args: [], provider: "anthropic", upstream: "http://127.0.0.1:1", baseUrlEnv: "ANTHROPIC_BASE_URL", cwd: process.cwd(), cloud: null, port, write: (t) => output.push(t) });
    expect(code).toBe(2);
    expect(output.join("")).toMatch(/already in use/);
  });
});
