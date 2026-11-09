/** Integration tests: notifications and webhook delivery, against the real database and a local receiver. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { prisma } from "@/lib/prisma";
import { POST as syncPOST } from "@/app/api/cli/sync/route";
import { GET as listGET, POST as listPOST } from "@/app/api/notifications/route";
import { GET as chGET, POST as chPOST, DELETE as chDELETE } from "@/app/api/notifications/channels/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("ntf");
const { makeUser, withKey, withSession, anonymous, request } = kit;

interface Received {
  path: string;
  body: Record<string, unknown>;
}
const received: Received[] = [];
let failNext = 0;
let receiver: http.Server;
let hookBase = "";

let alice: TestUser;
let bob: TestUser;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | null | undefined> | T | null | undefined, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out");
    await sleep(100);
  }
}

beforeAll(async () => {
  await requirePlansSeeded();
  receiver = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      if (failNext > 0) {
        failNext--;
        res.writeHead(500);
        return res.end("nope");
      }
      try {
        received.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(parts).toString("utf8")) });
      } catch {
        received.push({ path: req.url ?? "", body: {} });
      }
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  hookBase = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterAll(async () => {
  receiver.close();
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

const loopIncident = {
  type: "incident",
  kind: "LOOP",
  loop_type: "EXACT_TOOL_LOOP",
  action: "PAUSED",
  score: 0.94,
  detail: "Repeated 3 times: Bash(npm test)",
  interception_ms: 1,
};
const run = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ run: { id, agent: { name, type: "claude" }, ...extra } });

describe("in-app notifications", () => {
  it("a paused agent creates an unread notification, visible only to its owner", async () => {
    await syncPOST(withKey(alice, "/api/cli/sync", run("n1", "Notify Me", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", { ...run("n1", "Notify Me"), events: [loopIncident] }));

    const mine = await (await listGET(withKey(alice, "/api/notifications"))).json();
    expect(mine.unread).toBe(1);
    expect(mine.notifications[0]).toMatchObject({ title: "Notify Me was paused", level: "WARN", read: false });
    expect(mine.notifications[0].body).toContain("Repeated 3 times");

    const theirs = await (await listGET(withKey(bob, "/api/notifications"))).json();
    expect(theirs.unread).toBe(0);
    expect(theirs.notifications).toHaveLength(0);
  });

  it("marks notifications read, and only the caller's own", async () => {
    const id = (await (await listGET(withKey(alice, "/api/notifications"))).json()).notifications[0].id;
    // bob trying to mark alice's notification does nothing
    await listPOST(withSession(bob, "/api/notifications", { action: "mark_read", ids: [id] }));
    expect((await (await listGET(withKey(alice, "/api/notifications"))).json()).unread).toBe(1);

    const res = await (await listPOST(withSession(alice, "/api/notifications", { action: "mark_read", ids: [id] }))).json();
    expect(res).toMatchObject({ success: true, marked: 1, unread: 0 });
  });

  it("requires sign-in and validates input", async () => {
    expect((await listGET(anonymous("/api/notifications"))).status).toBe(401);
    expect((await listPOST(withSession(alice, "/api/notifications", { action: "nope" }))).status).toBe(400);
    expect((await listPOST(withSession(alice, "/api/notifications", { action: "mark_read" }))).status).toBe(400);
  });

  it("warns once when the token allowance runs out", async () => {
    const carol = await makeUser("carol");
    await prisma.subscriptionAndWallet.update({ where: { user_id: carol.id }, data: { free_tokens: 1000, paid_tokens: 0 } });
    const usage = (n: number) => ({ type: "usage", model: "claude-sonnet-4", input_tokens: n, output_tokens: 0 });
    await syncPOST(withKey(carol, "/api/cli/sync", { ...run("q", "Quota", { start: true }), events: [usage(400)] }));
    expect(await prisma.notification.count({ where: { user_id: carol.id } })).toBe(0);
    await syncPOST(withKey(carol, "/api/cli/sync", { ...run("q", "Quota"), events: [usage(900)] }));
    await syncPOST(withKey(carol, "/api/cli/sync", { ...run("q", "Quota"), events: [usage(500)] }));
    const rows = await prisma.notification.findMany({ where: { user_id: carol.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Token allowance used up", level: "CRITICAL" });
  });
});

describe("webhook channels", () => {
  it("adds a webhook, masks its URL, and delivers a Slack/Discord-compatible message on pause", async () => {
    const add = await chPOST(withSession(alice, "/api/notifications/channels", { action: "create", target: `${hookBase}/hooks/T0SECRET/abcd1234`, label: "#alerts" }));
    expect(add.status).toBe(201);
    const listed = await (await chGET(withSession(alice, "/api/notifications/channels"))).json();
    expect(listed.channels).toHaveLength(1);
    expect(listed.channels[0].label).toBe("#alerts");
    expect(listed.channels[0].target).not.toContain("T0SECRET"); // the secret part of the URL never leaves the server
    expect(listed.email.available).toBe(false);

    const before = received.length;
    await syncPOST(withKey(alice, "/api/cli/sync", run("n2", "Webhook Agent", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", { ...run("n2", "Webhook Agent"), events: [loopIncident] }));

    const got = await until(() => received.slice(before).find((r) => JSON.stringify(r.body).includes("Webhook Agent")));
    expect(got.path).toBe("/hooks/T0SECRET/abcd1234");
    expect(String(got.body.text)).toContain("*Webhook Agent was paused*");
    expect(String(got.body.content)).toContain("**Webhook Agent was paused**");
    expect(got.body.argusops).toMatchObject({ title: "Webhook Agent was paused", level: "WARN" });
    expect(String((got.body.argusops as { link: string }).link)).toContain("/dashboard/guardrails");

    const ch = await until(() => prisma.notificationChannel.findFirst({ where: { user_id: alice.id, last_delivered_at: { not: null } } }));
    expect(ch?.last_error).toBeNull();
  });

  it("'Send test' reports success, and a failing receiver is shown as an error", async () => {
    const ch = await prisma.notificationChannel.findFirstOrThrow({ where: { user_id: alice.id } });
    const ok = await (await chPOST(withSession(alice, "/api/notifications/channels", { action: "test", id: ch.id }))).json();
    expect(ok).toMatchObject({ success: true, message: "Test message delivered." });

    failNext = 1;
    const bad = await (await chPOST(withSession(alice, "/api/notifications/channels", { action: "test", id: ch.id }))).json();
    expect(bad.success).toBe(false);
    expect(bad.message).toContain("HTTP 500");
    expect(bad.channels[0].lastError).toContain("HTTP 500");
  });

  it("a disabled webhook receives nothing", async () => {
    const ch = await prisma.notificationChannel.findFirstOrThrow({ where: { user_id: alice.id } });
    await chPOST(withSession(alice, "/api/notifications/channels", { action: "toggle", id: ch.id, enabled: false }));
    const before = received.length;
    await syncPOST(withKey(alice, "/api/cli/sync", run("n3", "Quiet Agent", { start: true })));
    await syncPOST(withKey(alice, "/api/cli/sync", { ...run("n3", "Quiet Agent"), events: [loopIncident] }));
    await sleep(1500);
    expect(received.slice(before).some((r) => JSON.stringify(r.body).includes("Quiet Agent"))).toBe(false);
    // the in-app notification still exists
    expect(await prisma.notification.count({ where: { user_id: alice.id, title: "Quiet Agent was paused" } })).toBe(1);
  });

  it("rejects bad URLs, API-key changes and other users' channels", async () => {
    for (const target of ["ftp://example.com", "not a url", "", "https://user:pw@example.com/x"]) {
      expect((await chPOST(withSession(alice, "/api/notifications/channels", { action: "create", target }))).status, target).toBe(400);
    }
    expect((await chPOST(withKey(alice, "/api/notifications/channels", { action: "create", target: `${hookBase}/x` }))).status).toBe(403);
    expect((await chGET(anonymous("/api/notifications/channels"))).status).toBe(401);

    const ch = await prisma.notificationChannel.findFirstOrThrow({ where: { user_id: alice.id } });
    expect((await chPOST(withSession(bob, "/api/notifications/channels", { action: "test", id: ch.id }))).status).toBe(404);
    expect((await chPOST(withSession(bob, "/api/notifications/channels", { action: "toggle", id: ch.id, enabled: true }))).status).toBe(404);
    expect((await chDELETE(request(`/api/notifications/channels?id=${ch.id}`, { cookie: bob.cookie }))).status).toBe(404);
    expect(await prisma.notificationChannel.count({ where: { id: ch.id } })).toBe(1);

    expect((await chDELETE(request(`/api/notifications/channels?id=${ch.id}`, { cookie: alice.cookie }))).status).toBe(200);
    expect(await prisma.notificationChannel.count({ where: { id: ch.id } })).toBe(0);
  });

  it("caps the number of webhooks", async () => {
    const dana = await makeUser("dana");
    for (let i = 0; i < 10; i++) {
      expect((await chPOST(withSession(dana, "/api/notifications/channels", { action: "create", target: `${hookBase}/h${i}` }))).status).toBe(201);
    }
    const eleventh = await chPOST(withSession(dana, "/api/notifications/channels", { action: "create", target: `${hookBase}/h10` }));
    expect(eleventh.status).toBe(400);
  });
});
