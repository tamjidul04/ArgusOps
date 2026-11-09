import { describe, it, expect } from "vitest";
import { buildWebhookPayload, isPrivateAddress, validateWebhookUrl } from "./notify-core";

describe("isPrivateAddress", () => {
  it("flags private, loopback, link-local and reserved IPv4", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.10", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "52.84.12.3"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("handles IPv6, including IPv4-mapped addresses", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("treats anything that isn't an IP as unsafe", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("validateWebhookUrl (production rules)", () => {
  const prod = { allowPrivate: false };
  it("accepts public https URLs like Slack and Discord webhooks", () => {
    expect(validateWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX", prod).ok).toBe(true);
    expect(validateWebhookUrl("https://discord.com/api/webhooks/123/abc", prod).ok).toBe(true);
    expect(validateWebhookUrl("  https://example.com/hook  ", prod).ok).toBe(true);
  });
  it("rejects http, other schemes and junk", () => {
    expect(validateWebhookUrl("http://example.com/hook", prod)).toMatchObject({ ok: false, error: expect.stringContaining("https://") });
    for (const bad of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "not a url", "", "   ", 42, null]) {
      expect(validateWebhookUrl(bad, prod).ok, String(bad)).toBe(false);
    }
    expect(validateWebhookUrl("https://example.com/" + "a".repeat(1100), prod).ok).toBe(false);
  });
  it("rejects internal addresses and hostnames", () => {
    for (const bad of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://[::1]/hook",
      "https://[fd00::1]/hook",
      "https://printer.local/hook",
      "https://db.internal/hook",
      "https://intranet/hook",
    ]) {
      expect(validateWebhookUrl(bad, prod).ok, bad).toBe(false);
    }
  });
  it("rejects credentials embedded in the URL", () => {
    expect(validateWebhookUrl("https://user:pass@example.com/hook", prod)).toMatchObject({ ok: false, error: expect.stringContaining("password") });
  });
});

describe("validateWebhookUrl (development)", () => {
  it("allows a local http receiver for testing", () => {
    expect(validateWebhookUrl("http://127.0.0.1:9999/hook", { allowPrivate: true }).ok).toBe(true);
    expect(validateWebhookUrl("ftp://127.0.0.1", { allowPrivate: true }).ok).toBe(false);
  });
});

describe("buildWebhookPayload", () => {
  const msg = { title: "Agent paused", body: "Claude Code · app repeated a failing command 3 times.", level: "WARN" as const, link: "https://app.example.com/dashboard/guardrails", createdAt: new Date("2026-01-01T00:00:00Z") };

  it("fills Slack, Discord and structured fields", () => {
    const p = buildWebhookPayload(msg);
    expect(p.text).toContain("*Agent paused*");
    expect(p.text).toContain(msg.link);
    expect(p.content).toContain("**Agent paused**");
    expect(p.argusops).toEqual({ title: msg.title, body: msg.body, level: "WARN", link: msg.link, created_at: "2026-01-01T00:00:00.000Z" });
  });

  it("respects Discord's 2000-character limit", () => {
    const p = buildWebhookPayload({ ...msg, body: "x".repeat(5000) });
    expect(p.content.length).toBeLessThanOrEqual(2000);
    expect(p.text.length).toBeLessThanOrEqual(3000);
  });
});
