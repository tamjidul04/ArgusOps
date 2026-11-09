import net from "node:net";

/**
 * Pure helpers for notifications: webhook URL validation (with private-network blocking, so a user
 * can't point our server at internal addresses) and the message format Slack and Discord both accept.
 */

export type NotifyLevel = "INFO" | "WARN" | "CRITICAL";

/* ----------------------------- private addresses ----------------------------- */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** True for loopback, private, link-local, reserved and similar non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return PRIVATE_V4.some(([base, bits]) => inV4Range(ip, base, bits));
  if (kind !== 6) return true; // not an IP at all: treat as unsafe

  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (v6 === "::" || v6 === "::1") return true;
  const first = parseInt(v6.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/* ------------------------------- webhook URLs -------------------------------- */

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

/**
 * Checks a webhook URL a user typed. In production only public https URLs are accepted. `allowPrivate`
 * (development only) also allows http and local addresses so a test receiver on this machine works.
 * The resolved IP is checked again at send time (see notifier.ts), since a public name can point inward.
 */
export function validateWebhookUrl(raw: unknown, opts: { allowPrivate: boolean }): UrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Enter a webhook URL." };
  const text = raw.trim();
  if (text.length > 1024) return { ok: false, error: "That URL is too long." };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }
  if (url.username || url.password) return { ok: false, error: "Remove the username or password from the URL." };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (opts.allowPrivate) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Use an http or https URL." };
    return { ok: true, url };
  }

  if (url.protocol !== "https:") return { ok: false, error: "Webhook URLs must start with https://" };
  const singleLabel = !host.includes(".") && !net.isIP(host); // e.g. "intranet"
  if (host === "localhost" || singleLabel || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "That address isn't reachable from the internet." };
  }
  if (net.isIP(host) && isPrivateAddress(host)) return { ok: false, error: "That address isn't reachable from the internet." };
  return { ok: true, url };
}

/* ------------------------------- message format ------------------------------ */

export interface NotificationMessage {
  title: string;
  body: string;
  level: NotifyLevel;
  link?: string;
  createdAt: Date;
}

const LEVEL_ICON: Record<NotifyLevel, string> = { INFO: "ℹ️", WARN: "⏸️", CRITICAL: "🛑" };

/** One JSON body that Slack (`text`), Discord (`content`) and custom receivers (`argusops`) all understand. */
export function buildWebhookPayload(m: NotificationMessage) {
  const icon = LEVEL_ICON[m.level];
  const linkLine = m.link ? `\n${m.link}` : "";
  return {
    text: `${icon} *${m.title}*\n${m.body}${linkLine}`.slice(0, 3000),
    content: `${icon} **${m.title}**\n${m.body}${linkLine}`.slice(0, 2000),
    argusops: {
      title: m.title,
      body: m.body,
      level: m.level,
      link: m.link ?? null,
      created_at: m.createdAt.toISOString(),
    },
  };
}
