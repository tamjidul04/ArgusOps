"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Globe,
  Info,
  Laptop,
  Loader2,
  Mail,
  MonitorSmartphone,
  OctagonX,
  PauseCircle,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  body: string;
  level: "INFO" | "WARN" | "CRITICAL";
  read: boolean;
  createdAt: string;
}

interface Channel {
  id: string;
  kind: string;
  label: string | null;
  target: string;
  enabled: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

const LEVEL: Record<Item["level"], { icon: React.ElementType; tone: string; label: string }> = {
  INFO: { icon: Info, tone: "text-sky-700 bg-sky-50 border-sky-200", label: "Info" },
  WARN: { icon: PauseCircle, tone: "text-amber-700 bg-amber-50 border-amber-200", label: "Paused" },
  CRITICAL: { icon: OctagonX, tone: "text-rose-700 bg-rose-50 border-rose-200", label: "Critical" },
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function NotificationsClient({ initialItems, initialUnread }: { initialItems: Item[]; initialUnread: number }) {
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [browserPerm, setBrowserPerm] = useState<string>("unknown");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setChannels(d.channels);
      })
      .catch(() => undefined);
    const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    const t = setTimeout(() => {
      if (!cancelled) setBrowserPerm(perm);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  async function channelAction(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setFlash(null);
    try {
      const res = await fetch("/api/notifications/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.channels) setChannels(data.channels);
      setFlash({ ok: res.ok && data.success !== false, text: data.message || data.error || (res.ok ? "Saved." : "Something went wrong.") });
      return res.ok;
    } finally {
      setBusy(null);
    }
  }

  async function addWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (await channelAction({ action: "create", target: url, label }, "add")) {
      setUrl("");
      setLabel("");
    }
  }

  async function removeChannel(id: string) {
    setBusy(`del-${id}`);
    const res = await fetch(`/api/notifications/channels?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (data.channels) setChannels(data.channels);
    setFlash({ ok: res.ok, text: res.ok ? "Webhook removed." : data.error || "Couldn't remove it." });
    setBusy(null);
  }

  async function markAll() {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", all: true }),
    });
    if (res.ok) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  async function enableBrowser() {
    if (typeof Notification === "undefined") return;
    setBrowserPerm(await Notification.requestPermission());
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
        <p className="text-sm text-slate-500">You&apos;re told when an agent is paused or stopped, or your allowance runs out, wherever you choose below.</p>
      </div>

      {flash && (
        <div role="status" className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", flash.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700")}>
          {flash.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{flash.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* ---------------- recent ---------------- */}
        <section className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft xl:col-span-3">
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Bell className="h-4 w-4 text-slate-500" /> Recent
              {unread > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">{unread} unread</span>}
            </h2>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </header>
          {items.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Bell className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">No notifications yet</p>
              <p className="mt-1 text-xs text-slate-500">Run an agent with <span className="font-mono">argus run claude</span>. If it gets stuck, you&apos;ll see it here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => {
                const { icon: Icon, tone, label: tag } = LEVEL[n.level] ?? LEVEL.INFO;
                return (
                  <li key={n.id} className={cn("flex gap-3 px-5 py-3.5", !n.read && "bg-slate-50/70")}>
                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                        <span className={cn("rounded border px-1.5 py-px text-[10px] font-semibold", tone)}>{tag}</span>
                        {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-rose-600" aria-label="unread" />}
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">{n.body}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{when(n.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---------------- where alerts go ---------------- */}
        <section className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-5">
            <h2 className="text-sm font-bold text-slate-900">Where alerts go</h2>
            <ul className="mt-3 space-y-3 text-xs">
              <ChannelRow icon={MonitorSmartphone} title="In the dashboard" status="On" ok detail="The bell in the header, plus a pop-up while this site is open." />
              <ChannelRow icon={Laptop} title="Desktop pop-up from the CLI" status="On" ok detail="argus run shows a system notification on your computer. Set ARGUS_NO_DESKTOP_NOTIFY=1 to turn it off." />
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                  <Globe className="h-3.5 w-3.5 text-slate-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">Browser alerts</span>
                    {browserPerm === "granted" ? (
                      <span className="font-semibold text-emerald-700">On</span>
                    ) : browserPerm === "denied" ? (
                      <span className="font-semibold text-slate-400">Blocked in browser settings</span>
                    ) : browserPerm === "unsupported" ? (
                      <span className="text-slate-400">Not supported</span>
                    ) : (
                      <button type="button" onClick={enableBrowser} className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-800">
                        Turn on
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-slate-500">A system notification from this tab, even when it&apos;s in the background.</p>
                </div>
              </li>
              <ChannelRow icon={Mail} title="Email" status="Not available yet" detail="Email alerts need an email provider set up on this server." />
            </ul>
          </div>

          <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Webhook className="h-4 w-4 text-slate-500" /> Webhooks
            </h2>
            <p className="mt-1 text-xs text-slate-500">Paste a Slack or Discord incoming-webhook URL, or any https endpoint. We POST a JSON message there.</p>

            <form onSubmit={addWebhook} className="mt-3 space-y-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                required
                className="w-full rounded-full border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <div className="flex gap-2">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (optional), e.g. #alerts"
                  maxLength={80}
                  className="min-w-0 flex-1 rounded-full border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <button type="submit" disabled={busy === "add"} className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {busy === "add" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add
                </button>
              </div>
            </form>

            <ul className="mt-4 space-y-2">
              {channels.length === 0 && <li className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No webhooks yet.</li>}
              {channels.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{c.label || "Webhook"}</p>
                      <p className="truncate font-mono text-[11px] text-slate-500">{c.target}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                      <input type="checkbox" checked={c.enabled} onChange={(e) => channelAction({ action: "toggle", id: c.id, enabled: e.target.checked }, `tog-${c.id}`)} className="h-3.5 w-3.5 accent-slate-900" />
                      On
                    </label>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className={cn("truncate", c.lastError ? "text-rose-600" : "text-slate-400")}>
                      {c.lastError ? `Last attempt failed: ${c.lastError}` : c.lastDeliveredAt ? `Last delivered ${when(c.lastDeliveredAt)}` : "Not used yet"}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => channelAction({ action: "test", id: c.id }, `test-${c.id}`)} disabled={busy === `test-${c.id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {busy === `test-${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Test
                      </button>
                      <button type="button" onClick={() => removeChannel(c.id)} disabled={busy === `del-${c.id}`} aria-label="Remove webhook" className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function ChannelRow({ icon: Icon, title, status, detail, ok }: { icon: React.ElementType; title: string; status: string; detail: string; ok?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-900">{title}</span>
          <span className={cn("font-semibold", ok ? "text-emerald-700" : "text-slate-400")}>{status}</span>
        </div>
        <p className="mt-0.5 text-slate-500">{detail}</p>
      </div>
    </li>
  );
}
