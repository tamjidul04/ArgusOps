import crypto from "crypto";

/**
 * Pure crypto helpers for auth. No framework or database imports, so they are
 * trivial to unit-test. Cookie/session/route logic lives in `auth.ts`.
 */

export const API_KEY_PREFIX = "argus_live_";

/* ----------------------------- password hashing ---------------------------- */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * Constant-time password check. Only real hashes verify: scrypt (current) and the
 * legacy `salt:hash` PBKDF2 format early sign-ups were stored with. Anything else
 * (including the old placeholder seed hashes) never matches.
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    let expected: Buffer;
    let actual: Buffer;
    if (stored.startsWith("scrypt$")) {
      const [, salt, hash] = stored.split("$");
      if (!salt || !hash) return false;
      expected = Buffer.from(hash, "hex");
      actual = crypto.scryptSync(password, salt, expected.length, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      });
    } else if (/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored)) {
      const [salt, hash] = stored.split(":");
      expected = Buffer.from(hash, "hex");
      actual = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512");
    } else {
      return false;
    }
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith("scrypt$");
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

/* --------------------------------- hashing --------------------------------- */

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/* --------------------------------- API keys -------------------------------- */

export function generateApiKey() {
  const raw = `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
  return { raw, hash: sha256(raw), prefix: API_KEY_PREFIX };
}

export function extractApiKey(req: Request): string | null {
  const direct = req.headers.get("x-argus-key");
  if (direct) return direct.trim();
  const bearer = req.headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return null;
}

/* ------------------------- TOTP (RFC 6238, SHA-1) -------------------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret: string, timeMs: number): string {
  const counter = Math.floor(timeMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const drift of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totpAt(secret, now + drift));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export function totpUri(secret: string, email: string): string {
  return `otpauth://totp/ArgusOps:${encodeURIComponent(email)}?secret=${secret}&issuer=ArgusOps`;
}
