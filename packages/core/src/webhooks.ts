import { buildWebhookPayload, validateWebhookUrl, type NotifyLevel } from "./notify-core";
import type { Store } from "./store";

const TIMEOUT_MS = 5000;
const MAX_WEBHOOKS = 10;

export type Delivery = { ok: true; status: number } | { ok: false; error: string };

/**
 * Posts one message to a webhook the user set up (Slack, Discord, or any URL). These are the user's own addresses on
 * their own machine, so local ones are allowed; only http(s) is. Never throws: a broken receiver must not disturb an agent.
 */
export async function postWebhook(target: string, message: { title: string; body: string; level: NotifyLevel }): Promise<Delivery> {
  const check = validateWebhookUrl(target, { allowPrivate: true });
  if (!check.ok) return { ok: false, error: check.error };
  try {
    const res = await fetch(check.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "ArgusOps-Webhook/1" },
      body: JSON.stringify(buildWebhookPayload({ ...message, createdAt: new Date() })),
      redirect: "manual", // never follow a redirect somewhere the user did not choose
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, error: `The receiver answered HTTP ${res.status}.` };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? "The receiver didn't answer within 5 seconds." : "Couldn't connect to the receiver." };
  }
}

/** A callback for LocalHub/Controls that sends each new alert to every configured webhook, in the background. */
export function webhookNotifier(store: Store): (n: { title: string; body: string; level: NotifyLevel }) => void {
  return (n) => {
    const urls = store.config().webhooks.slice(0, MAX_WEBHOOKS);
    for (const url of urls) void postWebhook(url, n);
  };
}

export async function addWebhook(store: Store, raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const check = validateWebhookUrl(raw, { allowPrivate: true });
  if (!check.ok) return check;
  const url = check.url.toString();
  const current = store.config().webhooks;
  if (current.includes(url)) return { ok: true, url };
  if (current.length >= MAX_WEBHOOKS) return { ok: false, error: `You can have at most ${MAX_WEBHOOKS} webhooks.` };
  await store.saveConfig({ webhooks: [...current, url] });
  return { ok: true, url };
}

export async function removeWebhook(store: Store, raw: string): Promise<boolean> {
  const current = store.config().webhooks;
  const next = current.filter((u) => u !== raw && u !== raw.trim() && !u.startsWith(raw.trim()));
  if (next.length === current.length) return false;
  await store.saveConfig({ webhooks: next });
  return true;
}
