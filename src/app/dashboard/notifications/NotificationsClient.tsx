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
import { Badge, DashHeader, EmptyState, Panel, buttonClasses, inputClass } from "@/components/ui";

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
  INFO: { icon: Info, tone: "text-sky-800 bg-sky-50 ring-sky-600/20", label: "Info" },
  WARN: { icon: PauseCircle, tone: "text-amber-800 bg-amber-50 ring-amber-600/25", label: "Paused" },
  CRITICAL: { icon: OctagonX, tone: "text-red-800 bg-red-50 ring-red-600/20", label: "Critical" },
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
      <DashHeader
        title="Notifications"
        description="You're told when an agent is paused or stopped, or your allowance runs out, wherever you choose below."
      />

      {flash && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-md px-4 py-3 text-sm ring-1",
            flash.ok ? "bg-emerald-50 text-emerald-900 ring-emerald-600/20" : "bg-red-50 text-red-900 ring-red-600/20"
          )}
        >
          {flash.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{flash.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* ---------------- recent ---------------- */}
        <Panel
          className="xl:col-span-3"
          title="Recent"
          icon={Bell}
          action={
            <div className="flex items-center gap-3">
              {unread > 0 && <Badge tone="red">{unread} unread</Badge>}
              {unread > 0 && (
                <button type="button" onClick={markAll} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50">
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
                </button>
              )}
            </div>
          }
          bodyClassName="p-0 sm:p-0"
        >
          {items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications yet">
              Run an agent with <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs">argus run claude</code>. If it gets stuck, you&apos;ll see it here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-900/5">
              {items.map((n) => {
                const { icon: Icon, tone, label: tag } = LEVEL[n.level] ?? LEVEL.INFO;
                return (
                  <li key={n.id} className={cn("flex gap-3 px-5 py-4 sm:px-6", !n.read && "bg-slate-900/[0.025]")}>
                    <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1", tone)}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium ring-1", tone)}>{tag}</span>
                        {!n.read && <span className="h-2 w-2 rounded-full bg-red-600" role="img" aria-label="unread" />}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{n.body}</p>
                      <p className="mt-1.5 text-xs text-slate-500">{when(n.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* ---------------- where alerts go ---------------- */}
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Where alerts go">
            <ul className="space-y-4">
              <ChannelRow icon={MonitorSmartphone} title="In the dashboard" status="On" ok detail="The bell in the header, plus a pop-up while this site is open." />
              <ChannelRow icon={Laptop} title="Desktop pop-up from the CLI" status="On" ok detail="argus run shows a system notification on your computer. Set ARGUS_NO_DESKTOP_NOTIFY=1 to turn it off." />
              <li className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white">
                  <Globe className="h-4 w-4 text-slate-600" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-slate-900">Browser alerts</span>
                    {browserPerm === "granted" ? (
                      <Badge tone="green">On</Badge>
                    ) : browserPerm === "denied" ? (
                      <span className="text-xs font-medium text-slate-600">Blocked in browser settings</span>
                    ) : browserPerm === "unsupported" ? (
                      <span className="text-xs text-slate-600">Not supported</span>
                    ) : (
                      <button type="button" onClick={enableBrowser} className={buttonClasses("primary", false, "px-3.5 py-1.5 text-xs")}>
                        Turn on
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">A system notification from this tab, even when it&apos;s in the background.</p>
                </div>
              </li>
              <ChannelRow icon={Mail} title="Email" status="Not available yet" detail="Email alerts need an email provider set up on this server." />
            </ul>
          </Panel>

          <Panel
            title="Webhooks"
            icon={Webhook}
            description="Paste a Slack or Discord incoming-webhook URL, or any https endpoint. We POST a JSON message there."
            bodyClassName="space-y-4"
          >
            <form onSubmit={addWebhook} className="space-y-2.5">
              <label htmlFor="webhook-url" className="sr-only">
                Webhook URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                required
                className={cn(inputClass, "font-mono text-xs")}
              />
              <div className="flex gap-2">
                <label htmlFor="webhook-label" className="sr-only">
                  Label (optional)
                </label>
                <input
                  id="webhook-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (optional), e.g. #alerts"
                  maxLength={80}
                  className={cn(inputClass, "min-w-0 flex-1 text-xs")}
                />
                <button type="submit" disabled={busy === "add"} className={buttonClasses("primary", false, "shrink-0 disabled:opacity-60")}>
                  {busy === "add" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Add
                </button>
              </div>
            </form>

            <ul className="space-y-2.5">
              {channels.length === 0 && (
                <li className="rounded-md border border-dashed border-slate-900/15 px-3 py-5 text-center text-sm text-slate-600">No webhooks yet.</li>
              )}
              {channels.map((c) => (
                <li key={c.id} className="rounded-md bg-slate-50 p-3.5 border border-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{c.label || "Webhook"}</p>
                      <p className="truncate font-mono text-xs text-slate-600">{c.target}</p>
                    </div>
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        onChange={(e) => channelAction({ action: "toggle", id: c.id, enabled: e.target.checked }, `tog-${c.id}`)}
                        className="h-4 w-4 accent-slate-900"
                      />
                      On
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className={cn("min-w-0 truncate", c.lastError ? "text-red-700" : "text-slate-600")}>
                      {c.lastError ? `Last attempt failed: ${c.lastError}` : c.lastDeliveredAt ? `Last delivered ${when(c.lastDeliveredAt)}` : "Not used yet"}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => channelAction({ action: "test", id: c.id }, `test-${c.id}`)}
                        disabled={busy === `test-${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {busy === `test-${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Send className="h-3 w-3" aria-hidden="true" />} Test
                      </button>
                      <button
                        type="button"
                        onClick={() => removeChannel(c.id)}
                        disabled={busy === `del-${c.id}`}
                        aria-label="Remove webhook"
                        className="rounded-md bg-white px-2.5 py-1.5 text-slate-600 border border-slate-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({ icon: Icon, title, status, detail, ok }: { icon: React.ElementType; title: string; status: string; detail: string; ok?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white">
        <Icon className="h-4 w-4 text-slate-600" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-slate-900">{title}</span>
          {ok ? <Badge tone="green">{status}</Badge> : <span className="text-xs text-slate-600">{status}</span>}
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{detail}</p>
      </div>
    </li>
  );
}
