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
    <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-balance text-xl font-semibold tracking-[-0.01em] text-slate-900 sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {description && <p className="max-w-2xl text-pretty text-sm leading-relaxed text-slate-500">{description}</p>}
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
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("min-w-0 flex-1 p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-800",
  blue: "bg-sky-50 text-sky-800",
  dark: "bg-slate-900 text-white",
};
const DOTS: Record<Tone, string> = {
  neutral: "bg-slate-400",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-sky-500",
  dark: "bg-white",
};

/** Small status tag. Green, amber and red keep their meaning (ok, attention, problem). */
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-4", TONES[tone], className)}>
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />}
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
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-pretty text-[13px] leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** One metric: small label over a large figure. */
export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular mt-1 truncate text-2xl font-semibold tracking-[-0.02em] text-slate-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** Segmented control (time ranges, environment, view toggles). Square-ish, hairline, no pill. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: React.ReactNode; icon?: React.ElementType; iconClassName?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex w-fit items-center gap-0.5 rounded-md border border-slate-200 bg-slate-100/70 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors duration-150",
              active ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.08)] ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"
            )}
          >
            {Icon && <Icon className={cn("h-3.5 w-3.5", o.iconClassName)} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Shared control styles so every form field in the app matches. */
export const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60";

export const tableHeadClass = "border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500";

/** Skeleton shown while a dashboard page streams in. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className="space-y-2 border-b border-slate-200 pb-5">
        <div className="h-7 w-56 max-w-full animate-pulse rounded bg-slate-200/70" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-200/50" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}
