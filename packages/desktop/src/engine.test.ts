import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startControlApi } from "../../core/src/control-api";
import { Store, type AgentRecord } from "../../core/src/store";
import { agentsNeedingYou, ensureEngine } from "./engine";

const closers: Array<() => Promise<void>> = [];
const dirs: string[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-desk-"));
  dirs.push(d);
  return d;
};
const agent = (over: Partial<AgentRecord>): AgentRecord => ({ id: "ag_1", name: "a", type: "CLAUDE", status: "PAUSED", runId: "r", startedAt: 1, lastSeen: Date.now(), tokensUsed: 0, desired: "PAUSE", reason: "", suggestion: null, ...over });

describe("ensureEngine", () => {
  it("starts an engine that serves the page, and hands back an address carrying the token in the fragment", async () => {
    const store = new Store(tmp());
    const e = await ensureEngine(store, { port: 0, uiDir: path.resolve(__dirname, "..", "..", "ui"), version: "1" });
    closers.push(e.close);
    expect(e.owned).toBe(true);
    expect(e.openUrl).toBe(`${e.url}/#t=${store.token()}`);
    expect((await fetch(e.url + "/")).status).toBe(200);
  });

  it("uses an engine that is already running instead of fighting for the port", async () => {
    const store = new Store(tmp());
    const first = await startControlApi({ store, port: 0, version: "1" });
    closers.push(first.close);
    const e = await ensureEngine(store, { port: first.port, uiDir: "/nowhere", version: "1" });
    expect(e.owned).toBe(false);
    expect(e.url).toBe(first.url);
    await e.close(); // closing a borrowed engine does nothing
    expect((await fetch(first.url + "/api/health")).status).toBe(200);
  });

  it("does not mistake some other program on the port for ArgusOps", async () => {
    const http = await import("node:http");
    const other = http.createServer((_q, r) => r.end("{}"));
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()));
    const port = (other.address() as { port: number }).port;
    closers.push(() => new Promise<void>((r) => other.close(() => r())));
    const store = new Store(tmp());
    await expect(ensureEngine(store, { port, uiDir: "/nowhere", version: "1" })).rejects.toThrow(/already in use/);
  });
});

describe("agentsNeedingYou", () => {
  it("counts paused agents that are still connected, not stale or running ones", async () => {
    const store = new Store(tmp());
    const now = Date.now();
    await store.updateAgent("ag_1", () => agent({ id: "ag_1" }));
    await store.updateAgent("ag_2", () => agent({ id: "ag_2", lastSeen: now - 120_000 }));
    await store.updateAgent("ag_3", () => agent({ id: "ag_3", status: "ACTIVE", desired: "RUN" }));
    expect(agentsNeedingYou(store, now)).toBe(1);
  });
});
