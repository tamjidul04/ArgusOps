import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./store";
import { addWebhook, postWebhook, removeWebhook, webhookNotifier } from "./webhooks";

const closers: Array<() => Promise<void>> = [];
const dirs: string[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function receiver(status = 200) {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(parts).toString("utf8")));
      res.writeHead(status).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { bodies, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook` };
}
const newStore = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-wh-"));
  dirs.push(d);
  return new Store(d);
};
const msg = { title: "Claude Code was paused", body: "Repeated 3 times", level: "WARN" as const };

describe("postWebhook", () => {
  it("sends one body that Slack, Discord and custom receivers understand", async () => {
    const r = await receiver();
    expect(await postWebhook(r.url, msg)).toEqual({ ok: true, status: 200 });
    expect(r.bodies[0]).toMatchObject({ argusops: { title: msg.title, level: "WARN" } });
    expect(String(r.bodies[0].text)).toContain("Claude Code was paused");
    expect(String(r.bodies[0].content)).toContain("Claude Code was paused");
  });

  it("reports a receiver error, a refused connection and a bad URL without throwing", async () => {
    const bad = await receiver(500);
    expect(await postWebhook(bad.url, msg)).toEqual({ ok: false, error: "The receiver answered HTTP 500." });
    expect(await postWebhook("http://127.0.0.1:1/x", msg)).toMatchObject({ ok: false });
    expect(await postWebhook("ftp://example.com", msg)).toMatchObject({ ok: false });
    expect(await postWebhook("not a url", msg)).toMatchObject({ ok: false });
  });

  it("does not follow a redirect", async () => {
    const hits: string[] = [];
    const target = http.createServer((req, res) => (hits.push(req.url ?? ""), res.writeHead(200).end()));
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const tport = (target.address() as { port: number }).port;
    const redirector = http.createServer((_q, res) => res.writeHead(302, { location: `http://127.0.0.1:${tport}/secret` }).end());
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", () => r()));
    closers.push(() => new Promise<void>((r) => { target.close(() => r()); }), () => new Promise<void>((r) => { redirector.close(() => r()); }));
    const res = await postWebhook(`http://127.0.0.1:${(redirector.address() as { port: number }).port}/`, msg);
    expect(res.ok).toBe(false);
    expect(hits).toEqual([]);
  });
});

describe("webhook settings", () => {
  it("adds, de-duplicates, lists and removes", async () => {
    const store = newStore();
    expect(await addWebhook(store, "https://hooks.example.com/abc")).toMatchObject({ ok: true });
    await addWebhook(store, "https://hooks.example.com/abc");
    expect(store.config().webhooks).toEqual(["https://hooks.example.com/abc"]);
    expect(await addWebhook(store, "nope")).toMatchObject({ ok: false });
    expect(await removeWebhook(store, "https://hooks.example.com/abc")).toBe(true);
    expect(await removeWebhook(store, "https://hooks.example.com/abc")).toBe(false);
    expect(store.config().webhooks).toEqual([]);
  });

  it("caps the number of webhooks", async () => {
    const store = newStore();
    for (let i = 0; i < 10; i++) await addWebhook(store, `https://hooks.example.com/${i}`);
    expect(await addWebhook(store, "https://hooks.example.com/extra")).toMatchObject({ ok: false });
  });
});

describe("webhookNotifier", () => {
  it("sends each alert to every configured webhook", async () => {
    const a = await receiver();
    const b = await receiver();
    const store = newStore();
    await addWebhook(store, a.url);
    await addWebhook(store, b.url);
    webhookNotifier(store)(msg);
    for (let i = 0; i < 100 && (a.bodies.length < 1 || b.bodies.length < 1); i++) await new Promise((r) => setTimeout(r, 20));
    expect(a.bodies).toHaveLength(1);
    expect(b.bodies).toHaveLength(1);
  });

  it("does nothing when no webhook is configured", () => {
    expect(() => webhookNotifier(newStore())(msg)).not.toThrow();
  });
});
