import net from "node:net";
import { describe, expect, it } from "vitest";
import { Supervisor, withProxyEntry, withoutProxyEntry, type EnvEntry } from "./supervise";

/** A port that is free right now (fixed ones can fall in a range Windows reserves). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });

describe("env entry helpers", () => {
  it("adds ours and keeps the user's other entries", () => {
    expect(withProxyEntry([{ name: "FOO", value: "1" }], "http://127.0.0.1:9")).toEqual([
      { name: "FOO", value: "1" },
      { name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:9" },
    ]);
  });
  it("replaces an older copy of ours instead of duplicating it", () => {
    const once = withProxyEntry([], "http://127.0.0.1:1");
    expect(withProxyEntry(once, "http://127.0.0.1:2")).toEqual([{ name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:2" }]);
  });
  it("never removes a base URL the user pointed somewhere else", () => {
    const mine = [{ name: "ANTHROPIC_BASE_URL", value: "https://gateway.example.com" }];
    expect(withoutProxyEntry(mine)).toEqual(mine);
  });
  it("copes with nothing set", () => {
    expect(withoutProxyEntry(undefined)).toEqual([]);
  });
});

describe("Supervisor", { timeout: 30000 }, () => {
  it("points the setting at the proxy while running and removes it on stop", async () => {
    const port = await freePort();
    let env: EnvEntry[] | undefined = [{ name: "FOO", value: "1" }];
    const sup = new Supervisor({ readEnv: () => env, writeEnv: async (l) => void (env = l), log: () => undefined }, port);
    await sup.set({ url: "http://127.0.0.1:1", key: "argus_live_x" });
    for (let i = 0; i < 200 && !env?.some((e) => e.name === "ANTHROPIC_BASE_URL"); i++) await new Promise((r) => setTimeout(r, 50));
    expect(env).toContainEqual({ name: "ANTHROPIC_BASE_URL", value: `http://127.0.0.1:${port}` });
    expect(env).toContainEqual({ name: "FOO", value: "1" });
    await sup.stop();
    expect(env).toEqual([{ name: "FOO", value: "1" }]);
  });

  it("leaves the setting alone when another window already owns the port", async () => {
    const port = await freePort();
    let env: EnvEntry[] | undefined = undefined;
    const writes: unknown[] = [];
    const host = { readEnv: () => env, writeEnv: async (l: EnvEntry[] | undefined) => void (writes.push(l), (env = l)), log: () => undefined };
    const first = new Supervisor(host, port);
    await first.set({ url: "http://127.0.0.1:1", key: "k" });
    for (let i = 0; i < 200 && !env; i++) await new Promise((r) => setTimeout(r, 50));
    const before = writes.length;
    const second = new Supervisor({ ...host, log: () => undefined }, port);
    await second.set({ url: "http://127.0.0.1:1", key: "k" });
    await new Promise((r) => setTimeout(r, 300));
    await second.stop();
    expect(writes.length).toBe(before); // second never wrote or cleared anything
    expect(env).toBeDefined();
    await first.stop();
  });
});
