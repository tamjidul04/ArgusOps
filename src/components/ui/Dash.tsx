import React from "react";
import { cn } from "@/lib/utils";

/** Page title block used at the top of every dashboard page. */
export function DashHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {badge}
        </div>
        {description && <p className="max-w-2xl text-pretty text-sm leading-relaxed text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A dashboard card: optional header (icon, title, description, action) and a body. */
export function Panel({
  title,
  icon: Icon,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  icon?: React.ElementType;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-900/5", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-900/5 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />}
              {title}
            </h2>
            {description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-900/[0.05] text-slate-700 ring-slate-900/10",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
  dark: "bg-slate-900 text-white ring-slate-900",
};

/** Small status pill. Green, amber and red keep their meaning (ok, attention, problem). */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Calm empty state: icon, one line on why it is empty, and an optional next step. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/[0.05] text-slate-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-pretty text-sm leading-relaxed text-slate-600">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** One metric: small label over a large value. */
export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Shared control styles so every form field and button in the dashboard matches. */
export const inputClass =
  "w-full rounded-xl bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-900/10 placeholder:text-slate-400 transition-shadow focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60";

export const tableHeadClass = "border-b border-slate-900/5 bg-slate-900/[0.02] text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500";

/** Skeleton shown while a dashboard page streams in. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <div className="h-8 w-64 max-w-full animate-pulse rounded-lg bg-slate-900/[0.07]" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-lg bg-slate-900/5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-white shadow-soft ring-1 ring-slate-900/5" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-white shadow-soft ring-1 ring-slate-900/5" />
    </div>
  );
}
