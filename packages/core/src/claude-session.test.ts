import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeSession, SessionError } from "./claude-session";

const FAKE = path.join(__dirname, "fixtures", "fake-claude.mjs");
const dirs: string[] = [];
const sessions: ClaudeSession[] = [];
afterEach(async () => {
  // wait for each process to really exit: on Windows a running process keeps its folder from being deleted
  await Promise.all(sessions.splice(0).map((s) => s.close(2000)));
  await new Promise((r) => setTimeout(r, 200));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** The fake runs under node; ClaudeSession is given "node" with the script as the first argument. */
function start(opts: { turnTimeoutMs?: number; events?: unknown[] } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sess-"));
  dirs.push(cwd);
  const s = ClaudeSession.start({ command: process.execPath, args: [FAKE], cwd, turnTimeoutMs: opts.turnTimeoutMs, onEvent: (e) => opts.events?.push(e) });
  sessions.push(s);
  return { s, cwd };
}

describe("ClaudeSession", () => {
  it("runs several instructions one after another in the same conversation", async () => {
    const { s, cwd } = start();
    const a = await s.send("SAY first");
    const b = await s.send("SAY second");
    expect([a.text, b.text]).toEqual(["first", "second"]);
    expect(a.sessionId).toBe("fake-session-1");
    expect(fs.readFileSync(path.join(cwd, "fake-claude.log"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("reports the cost of each turn, not the running total", async () => {
    const { s } = start();
    expect((await s.send("x")).costUsd).toBeCloseTo(0.01, 6);
    expect((await s.send("y")).costUsd).toBeCloseTo(0.01, 6);
  });

  it("passes through what the agent did to the files", async () => {
    const { s, cwd } = start();
    await s.send("WRITE src/a.js export const a = 1;");
    expect(fs.readFileSync(path.join(cwd, "src", "a.js"), "utf8")).toBe("export const a = 1;\n");
  });

  it("reports errors and permission denials", async () => {
    const { s } = start();
    const r = await s.send("ERROR\nDENY");
    expect(r.isError).toBe(true);
    expect(r.permissionDenials).toEqual([{ tool: "Bash", input: { command: "rm -rf /" } }]);
  });

  it("refuses a second instruction while the first is running", async () => {
    const { s } = start();
    const first = s.send("SAY one");
    await expect(s.send("SAY two")).rejects.toMatchObject({ kind: "busy" });
    expect((await first).text).toBe("one");
  });

  it("gives up on a turn that takes too long", async () => {
    const { s } = start({ turnTimeoutMs: 300 });
    await expect(s.send("SLOW")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects the turn if the agent crashes, and later sends too", async () => {
    const { s } = start();
    await expect(s.send("CRASH")).rejects.toBeInstanceOf(SessionError);
    expect(s.running).toBe(false);
    await expect(s.send("hello")).rejects.toMatchObject({ kind: "closed" });
  });

  it("closes cleanly", async () => {
    const { s } = start();
    await s.send("SAY ok");
    expect(await s.close()).toBe(0);
    expect(s.running).toBe(false);
  });

  it("emits every event for a live view", async () => {
    const events: Array<{ type?: string }> = [];
    const { s } = start({ events });
    await s.send("SAY hi");
    expect(events.map((e) => e.type)).toEqual(["system", "assistant", "result"]);
  });

  it("reports a program that cannot be started", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sess-"));
    dirs.push(cwd);
    const s = ClaudeSession.start({ command: path.join(cwd, "no-such-claude.exe"), cwd });
    sessions.push(s);
    await expect(s.send("x")).rejects.toBeInstanceOf(SessionError);
  });
});
