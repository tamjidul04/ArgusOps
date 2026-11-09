"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, OctagonX, PauseCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  body: string;
  level: "INFO" | "WARN" | "CRITICAL";
  read: boolean;
  createdAt: string;
}

const POLL_MS = 8000;

const LEVEL_STYLE: Record<Item["level"], { icon: React.ElementType; tone: string }> = {
  INFO: { icon: Info, tone: "text-sky-600 bg-sky-50 border-sky-200" },
  WARN: { icon: PauseCircle, tone: "text-amber-700 bg-amber-50 border-amber-200" },
  CRITICAL: { icon: OctagonX, tone: "text-rose-700 bg-rose-50 border-rose-200" },
};

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Header bell: unread count, a short list, and a toast (plus an OS alert if allowed) when something new arrives. */
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; notifications: Item[] };
      setItems(data.notifications);
      setUnread(data.unread);

      // first load only records what exists; later loads announce anything new and unread
      if (seen.current === null) {
        seen.current = new Set(data.notifications.map((n) => n.id));
        return;
      }
      const fresh = data.notifications.filter((n) => !n.read && !seen.current!.has(n.id));
      for (const n of data.notifications) seen.current.add(n.id);
      if (fresh.length > 0) {
        setToast(fresh[0]);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(fresh[0].title, { body: fresh[0].body, tag: fresh[0].id });
          } catch {
            // some browsers only allow notifications from a service worker
          }
        }
      }
    } catch {
      // offline or server restarting: try again next tick
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const markAll = async () => {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", all: true }),
    });
    if (res.ok) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  return (
    <>
      <div className="relative" ref={box}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
          aria-haspopup="menu"
          aria-expanded={open}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div role="menu" className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-900">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet. You&apos;ll hear from us when an agent needs you.</li>}
              {items.map((n) => {
                const { icon: Icon, tone } = LEVEL_STYLE[n.level] ?? LEVEL_STYLE.INFO;
                return (
                  <li key={n.id} className={cn("flex gap-2.5 border-b border-slate-50 px-3 py-2.5 last:border-0", !n.read && "bg-slate-50/70")}>
                    <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border", tone)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900">{n.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-500">{n.body}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">{ago(n.createdAt)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-3 py-2 text-center text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
              All notifications &amp; alert settings
            </Link>
          </div>
        )}
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 right-6 z-[60] w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-start gap-3">
            {(() => {
              const { icon: Icon, tone } = LEVEL_STYLE[toast.level] ?? LEVEL_STYLE.INFO;
              return (
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", tone)}>
                  <Icon className="h-4 w-4" />
                </span>
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              <p className="mt-0.5 line-clamp-3 text-xs text-slate-500">{toast.body}</p>
              <Link href="/dashboard/guardrails" onClick={() => setToast(null)} className="mt-2 inline-block text-xs font-semibold text-slate-900 underline underline-offset-2">
                Review in Guardrails
              </Link>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
