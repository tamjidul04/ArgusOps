import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines Tailwind CSS classes safely with clsx and twMerge.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats token counts into readable notation.
 * Defaults to compact notation (e.g. 1.2M, 45.8k, 320) or standard comma-separated integers.
 */
export function formatTokens(
  tokens: number,
  options?: { compact?: boolean; maximumFractionDigits?: number }
): string {
  if (!Number.isFinite(tokens)) return "0";
  const compact = options?.compact ?? true;
  const maxDigits = options?.maximumFractionDigits ?? 1;

  if (compact) {
    const abs = Math.abs(tokens);
    const sign = tokens < 0 ? "-" : "";
    if (abs >= 1_000_000_000) {
      return `${sign}${(abs / 1_000_000_000).toFixed(options?.maximumFractionDigits ?? 2).replace(/\.0+$/, "")}B`;
    }
    if (abs >= 1_000_000) {
      return `${sign}${(abs / 1_000_000).toFixed(maxDigits).replace(/\.0+$/, "")}M`;
    }
    if (abs >= 1_000) {
      return `${sign}${(abs / 1_000).toFixed(maxDigits).replace(/\.0+$/, "")}k`;
    }
    return `${sign}${abs.toLocaleString("en-US")}`;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
  }).format(tokens);
}

/**
 * Formats a numeric amount as currency (defaults to USD).
 */
export function formatCurrency(
  amount: number,
  currency = "USD",
  options?: { compact?: boolean; maximumFractionDigits?: number }
): string {
  if (!Number.isFinite(amount)) return "$0.00";
  const compact = options?.compact ?? false;

  if (compact && Math.abs(amount) >= 1_000) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";
    const prefix = currency === "USD" ? "$" : `${currency} `;
    const maxDigits = options?.maximumFractionDigits ?? 1;

    if (abs >= 1_000_000) {
      return `${sign}${prefix}${(abs / 1_000_000).toFixed(maxDigits).replace(/\.0+$/, "")}M`;
    }
    return `${sign}${prefix}${(abs / 1_000).toFixed(maxDigits).replace(/\.0+$/, "")}k`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: options?.maximumFractionDigits !== undefined ? 0 : 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(amount);
}

/**
 * Agent lifecycle statuses recognized by ArgusOps.
 */
export type AgentStatus = "ACTIVE" | "HIBERNATED" | "PAUSED_NUDGE" | "KILLED_LOOP";

/**
 * Enterprise status badge color definitions conforming to .antigravityrules.
 */
export const STATUS_STYLES: Record<
  AgentStatus,
  {
    badge: string;
    dot: string;
    label: string;
  }
> = {
  ACTIVE: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    label: "Active",
  },
  HIBERNATED: {
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
    label: "Hibernated (Zero-Token)",
  },
  PAUSED_NUDGE: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    label: "Paused (Nudge)",
  },
  KILLED_LOOP: {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    label: "Killed (Loop Breaker)",
  },
};

/**
 * Returns the CSS classes for an agent status badge.
 */
export function getStatusBadgeClasses(status: AgentStatus | string): string {
  if (status in STATUS_STYLES) {
    return STATUS_STYLES[status as AgentStatus].badge;
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

