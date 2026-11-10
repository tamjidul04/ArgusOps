/** Integration tests: billing must never show or print anything that did not happen. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as invoiceGET } from "@/app/api/billing/invoice/route";
import { POST as upgradePOST } from "@/app/api/billing/upgrade/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("bil");
const { makeUser, withSession, anonymous } = kit;

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("GET /api/billing/invoice", () => {
  it("requires sign-in", async () => {
    expect((await invoiceGET(anonymous("/api/billing/invoice"))).status).toBe(401);
  });

  it("does not invent an invoice for an account that has none", async () => {
    const res = await invoiceGET(withSession(alice, "/api/billing/invoice"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no invoices/i);
  });

  it("shows the account's real request, with the real plan and price", async () => {
    const up = await upgradePOST(withSession(alice, "/api/billing/upgrade", { planId: "plan_pro" }));
    expect((await up.json()).success).toBe(true);

    const res = await invoiceGET(withSession(alice, "/api/billing/invoice"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("29.00"); // Pro costs $29, from the database
    expect(html).not.toContain("49.00"); // the old invented price
    expect(html.toUpperCase()).toContain("PENDING"); // it was only requested, never approved
  });

  it("never shows one account another account's request", async () => {
    const res = await invoiceGET(withSession(bob, "/api/billing/invoice"));
    expect(res.status).toBe(404);
  });
});
