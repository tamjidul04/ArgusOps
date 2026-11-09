import { describe, it, expect } from "vitest";
import { generateDeviceCode, generateUserCode, normalizeUserCode, pollOutcome } from "./device-flow";

describe("codes", () => {
  it("generates readable user codes that normalise to themselves", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateUserCode();
      expect(c).toMatch(/^[BCDFGHJKMNPQRSTVWXZ2-9]{4}-[BCDFGHJKMNPQRSTVWXZ2-9]{4}$/);
      expect(normalizeUserCode(c)).toBe(c);
    }
  });

  it("generates long unguessable device codes", () => {
    const a = generateDeviceCode();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(generateDeviceCode()).not.toBe(a);
  });

  it("normalises typed input and rejects bad codes", () => {
    expect(normalizeUserCode("kmtr 4b9x")).toBe("KMTR-4B9X");
    expect(normalizeUserCode("KMTR4B9X")).toBe("KMTR-4B9X");
    expect(normalizeUserCode(" kmtr-4b9x ")).toBe("KMTR-4B9X");
    expect(normalizeUserCode("KMTR-4B9")).toBeNull();
    expect(normalizeUserCode("KMTR-4B9XX")).toBeNull();
    expect(normalizeUserCode("AEIO-0000")).toBeNull(); // vowels / zero are not in the alphabet
    expect(normalizeUserCode("")).toBeNull();
  });
});

describe("pollOutcome", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  const future = new Date(now + 60_000);
  const past = new Date(now - 1);

  it("is pending until approved", () => {
    expect(pollOutcome({ status: "PENDING", expires_at: future }, now)).toEqual({ kind: "pending" });
  });
  it("reports approval, denial, expiry and prior delivery", () => {
    expect(pollOutcome({ status: "APPROVED", expires_at: future }, now)).toEqual({ kind: "approved" });
    expect(pollOutcome({ status: "DENIED", expires_at: future }, now)).toEqual({ kind: "denied" });
    expect(pollOutcome({ status: "PENDING", expires_at: past }, now)).toEqual({ kind: "expired" });
    expect(pollOutcome({ status: "APPROVED", expires_at: past }, now)).toEqual({ kind: "expired" });
    expect(pollOutcome({ status: "ACTIVE", expires_at: past }, now)).toEqual({ kind: "already_delivered" });
  });
  it("asks fast pollers to slow down", () => {
    const justNow = new Date(now - 200);
    expect(pollOutcome({ status: "PENDING", expires_at: future, last_polled_at: justNow }, now)).toEqual({ kind: "slow_down" });
    const earlier = new Date(now - 5000);
    expect(pollOutcome({ status: "PENDING", expires_at: future, last_polled_at: earlier }, now)).toEqual({ kind: "pending" });
  });
});
