import crypto from "crypto";

/**
 * Device pairing (RFC 8628 style). The CLI shows a short code, the user approves it in the browser,
 * and the CLI then collects a one-time API key. Pure helpers here; endpoints live in /api/device/*.
 */

/** No 0/O, 1/I/L or vowels, so codes are easy to read aloud and never spell words. */
const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_POLL_INTERVAL_S = 2;

export function generateDeviceCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** e.g. "KMTR-4B9X" */
export function generateUserCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Accepts what a person types ("kmtr 4b9x", "KMTR4B9X") and returns the canonical form, or null. */
export function normalizeUserCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 8) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export type DevicePollOutcome =
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "approved" }
  | { kind: "already_delivered" };

/** Maps a stored device row to what the polling CLI should be told. */
export function pollOutcome(
  device: { status: string; expires_at: Date; last_polled_at?: Date | null },
  now = Date.now()
): DevicePollOutcome {
  if (device.status === "ACTIVE") return { kind: "already_delivered" };
  if (device.status === "DENIED") return { kind: "denied" };
  if (device.expires_at.getTime() <= now || device.status === "EXPIRED") return { kind: "expired" };
  if (device.status === "APPROVED") return { kind: "approved" };
  if (device.last_polled_at && now - device.last_polled_at.getTime() < (DEVICE_POLL_INTERVAL_S * 1000) / 2) {
    return { kind: "slow_down" };
  }
  return { kind: "pending" };
}
