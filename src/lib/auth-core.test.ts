import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  isLegacyHash,
  validatePasswordStrength,
  generateApiKey,
  extractApiKey,
  generateTotpSecret,
  totpAt,
  verifyTotp,
  sha256,
} from "./auth-core";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", () => {
    const h = hashPassword("correct horse 42");
    expect(verifyPassword("correct horse 42", h)).toBe(true);
    expect(verifyPassword("wrong horse 42", h)).toBe(false);
  });

  it("uses a fresh salt every time", () => {
    expect(hashPassword("same-password-1")).not.toBe(hashPassword("same-password-1"));
  });

  it("never accepts the old placeholder seed hashes or arbitrary passwords", () => {
    const placeholder = "$2a$12$eX4mP1eHaShVaLuE.tamjidArgusOpsDemo2026PasswordHash";
    expect(verifyPassword("anything-long-enough", placeholder)).toBe(false);
    expect(verifyPassword("ArgusOps2026!", placeholder)).toBe(false);
    expect(verifyPassword("", "")).toBe(false);
  });

  it("still verifies legacy pbkdf2 hashes and flags them for rehash", () => {
    const salt = crypto.randomBytes(16).toString("hex");
    const legacy = `${salt}:${crypto.pbkdf2Sync("legacy-pass-9", salt, 1000, 64, "sha512").toString("hex")}`;
    expect(verifyPassword("legacy-pass-9", legacy)).toBe(true);
    expect(verifyPassword("nope", legacy)).toBe(false);
    expect(isLegacyHash(legacy)).toBe(true);
    expect(isLegacyHash(hashPassword("x1234567890"))).toBe(false);
  });

  it("enforces password strength", () => {
    expect(validatePasswordStrength("short1")).toMatch(/10 characters/);
    expect(validatePasswordStrength("onlyletterslong")).toMatch(/letter and one number/);
    expect(validatePasswordStrength("goodpassword1")).toBeNull();
  });
});

describe("api keys", () => {
  it("generates prefixed keys whose hash is sha256(raw)", () => {
    const k = generateApiKey();
    expect(k.raw.startsWith("argus_live_")).toBe(true);
    expect(k.hash).toBe(sha256(k.raw));
    expect(generateApiKey().raw).not.toBe(k.raw);
  });

  it("extracts keys from x-argus-key or Bearer headers", () => {
    expect(extractApiKey(new Request("http://x", { headers: { "x-argus-key": "argus_live_a" } }))).toBe("argus_live_a");
    expect(extractApiKey(new Request("http://x", { headers: { authorization: "Bearer argus_live_b" } }))).toBe("argus_live_b");
    expect(extractApiKey(new Request("http://x"))).toBeNull();
  });
});

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    // RFC 6238 secret "12345678901234567890" in base32, T=59s -> 94287082 (8 digits) -> last 6 = 287082
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(secret, 59_000)).toBe("287082");
    expect(totpAt(secret, 1111111109_000)).toBe("081804");
  });

  it("verifies current codes and rejects bad ones", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpAt(s, now), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, now - 30_000), now)).toBe(true); // one step of drift
    expect(verifyTotp(s, totpAt(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "123456", now)).toBe(totpAt(s, now) === "123456");
    expect(verifyTotp(s, "abc", now)).toBe(false);
  });
});
