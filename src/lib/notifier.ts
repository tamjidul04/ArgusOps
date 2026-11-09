import dns from "node:dns/promises";
import net from "node:net";
import { prisma } from "@/lib/prisma";
import { buildWebhookPayload, isPrivateAddress, validateWebhookUrl, type NotifyLevel } from "@/lib/notify-core";

/**
 * Creates in-app notifications and delivers them to the user's webhooks.
 * Webhook delivery runs in the background so a slow receiver never delays an agent or a page.
 */

const WEBHOOK_TIMEOUT_MS = 5000;
const MAX_CHANNELS = 10;

/** http and private hosts are only allowed outside production (so a test receiver on this machine works). */
export function allowPrivateWebhooks(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ARGUS_ALLOW_PRIVATE_WEBHOOKS === "1";
}

function appLink(path: string): string {
  return `${(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "")}${path}`;
}

export interface NotifyInput {
  title: string;
  body: string;
  level: NotifyLevel;
  incidentId?: string | null;
  agentId?: string | null;
  linkPath?: string;
}

type Delivery = { ok: true; status: number } | { ok: false; error: string };

/** Posts one payload to one URL, re-checking where the name resolves right before sending. */
export async function postWebhook(target: string, payload: unknown): Promise<Delivery> {
  const allowPrivate = allowPrivateWebhooks();
  const check = validateWebhookUrl(target, { allowPrivate });
  if (!check.ok) return { ok: false, error: check.error };

  if (!allowPrivate) {
    const host = check.url.hostname.replace(/^\[|\]$/g, "");
    try {
      const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
      if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
        return { ok: false, error: "That address points to a private network." };
      }
    } catch {
      return { ok: false, error: "Couldn't resolve that address." };
    }
  }

  try {
    const res = await fetch(check.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "ArgusOps-Webhook/1" },
      body: JSON.stringify(payload),
      redirect: "manual", // a redirect could lead to an internal address
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, error: `The receiver answered HTTP ${res.status}.` };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? "The receiver didn't answer within 5 seconds." : "Couldn't connect to the receiver." };
  }
}

async function deliverToChannels(userId: string, input: NotifyInput, createdAt: Date) {
  const channels = await prisma.notificationChannel.findMany({
    where: { user_id: userId, kind: "WEBHOOK", enabled: true },
    take: MAX_CHANNELS,
  });
  if (channels.length === 0) return;

  const payload = buildWebhookPayload({
    title: input.title,
    body: input.body,
    level: input.level,
    link: appLink(input.linkPath ?? "/dashboard/guardrails"),
    createdAt,
  });

  await Promise.allSettled(
    channels.map(async (ch) => {
      const result = await postWebhook(ch.target, payload);
      await prisma.notificationChannel.update({
        where: { id: ch.id },
        data: result.ok ? { last_delivered_at: new Date(), last_error: null } : { last_error: result.error.slice(0, 300) },
      });
    })
  );
}

/** Records an in-app notification and, in the background, sends it to the user's webhooks. */
export async function notify(userId: string, input: NotifyInput) {
  const row = await prisma.notification.create({
    data: {
      user_id: userId,
      incident_id: input.incidentId ?? null,
      agent_id: input.agentId ?? null,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 4000),
      level: input.level,
    },
  });
  void deliverToChannels(userId, input, row.created_at).catch((e) =>
    console.error("Webhook delivery failed:", e instanceof Error ? e.message : e)
  );
  return row;
}

/** The standard message for an agent that was paused or stopped by loop detection. */
export function notifyLoop(
  userId: string,
  args: {
    agentName: string;
    agentId?: string | null;
    incidentId?: string | null;
    action: "PAUSED" | "KILLED";
    detail: string;
    /** "ready": a suggested instruction is waiting for approval. "applied": the agent was resumed with it automatically. */
    suggestion?: "ready" | "applied";
  }
) {
  const paused = args.action === "PAUSED";
  if (paused && args.suggestion === "applied") {
    return notify(userId, {
      title: `${args.agentName} was un-stuck automatically`,
      body: `It looked stuck: ${args.detail}\nArgusOps resumed it with a suggested instruction (your auto-resume setting is on).`,
      level: "INFO",
      agentId: args.agentId,
      incidentId: args.incidentId,
      linkPath: "/dashboard/guardrails",
    });
  }
  const suggestionLine = paused && args.suggestion === "ready" ? "\nA suggested instruction is ready: approve or edit it to resume." : "";
  return notify(userId, {
    title: paused ? `${args.agentName} was paused` : `${args.agentName} was stopped`,
    body: paused
      ? `It looked stuck: ${args.detail}\nNo more tokens are spent until you resume or stop it.${suggestionLine}`
      : `It was stopped because it looked stuck: ${args.detail}`,
    level: paused ? "WARN" : "CRITICAL",
    agentId: args.agentId,
    incidentId: args.incidentId,
    linkPath: "/dashboard/guardrails",
  });
}

/** Sends a sample message to one channel right away and reports what happened (for the "Send test" button). */
export async function sendTestToChannel(userId: string, channelId: string) {
  const ch = await prisma.notificationChannel.findFirst({ where: { id: channelId, user_id: userId } });
  if (!ch) return { ok: false as const, error: "Channel not found." };
  const result = await postWebhook(
    ch.target,
    buildWebhookPayload({
      title: "ArgusOps test notification",
      body: "If you can read this, ArgusOps can reach this webhook. You'll get a message here when an agent is paused or stopped.",
      level: "INFO",
      link: appLink("/dashboard/notifications"),
      createdAt: new Date(),
    })
  );
  await prisma.notificationChannel.update({
    where: { id: ch.id },
    data: result.ok ? { last_delivered_at: new Date(), last_error: null } : { last_error: result.error.slice(0, 300) },
  });
  return result;
}
