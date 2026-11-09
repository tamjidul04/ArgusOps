/** Pure logic for the extension: how agents are described and when the user should be alerted. No VS Code imports. */

export interface Suggestion {
  id: string;
  text: string;
  observed: string;
  tokensBefore: number;
  source: string;
}

export interface AgentView {
  id: string;
  name: string;
  type: string;
  status: string;
  tokensUsed: number;
  currentTask: string | null;
  lastSeen: string;
  suggestion: Suggestion | null;
}

export type Kind = "running" | "paused" | "stopped" | "idle";

export function kindOf(status: string): Kind {
  if (status === "ACTIVE") return "running";
  if (status === "PAUSED_NUDGE") return "paused";
  if (status === "KILLED_LOOP") return "stopped";
  return "idle";
}

export const KIND_LABEL: Record<Kind, string> = { running: "Running", paused: "Paused", stopped: "Stopped", idle: "Idle" };

export interface Summary {
  running: number;
  paused: number;
  stopped: number;
}

export function summarize(agents: AgentView[]): Summary {
  const s: Summary = { running: 0, paused: 0, stopped: 0 };
  for (const a of agents) {
    const k = kindOf(a.status);
    if (k === "running") s.running++;
    else if (k === "paused") s.paused++;
    else if (k === "stopped") s.stopped++;
  }
  return s;
}

export interface StatusBarState {
  text: string;
  tooltip: string;
  /** Draws attention (warning colour) when something needs the user. */
  attention: boolean;
}

export function statusBar(args: { signedIn: boolean; offline: boolean; summary: Summary }): StatusBarState {
  if (!args.signedIn) return { text: "$(shield) ArgusOps: sign in", tooltip: "Sign in to see and control your coding agents", attention: false };
  if (args.offline) return { text: "$(debug-disconnect) ArgusOps: offline", tooltip: "Can't reach the ArgusOps server. Retrying…", attention: false };
  const { running, paused, stopped } = args.summary;
  if (paused > 0) {
    return {
      text: `$(warning) ArgusOps: ${paused} paused`,
      tooltip: `${paused} agent${paused === 1 ? " is" : "s are"} waiting for you${running ? `, ${running} running` : ""}. Click to review.`,
      attention: true,
    };
  }
  if (running > 0) return { text: `$(shield) ArgusOps: ${running} running`, tooltip: `${running} agent${running === 1 ? "" : "s"} running, none stuck.`, attention: false };
  return { text: "$(shield) ArgusOps", tooltip: stopped ? `${stopped} stopped agent${stopped === 1 ? "" : "s"}. None running.` : "No agents running. Start one with `argus run claude`.", attention: false };
}

export interface Alerts {
  /** Agents that just became paused (or, on the first load, are paused right now). */
  paused: AgentView[];
  /** Agents that just got stopped. */
  stopped: AgentView[];
}

/**
 * What changed since the last poll that the user should hear about. An agent alerts once per pause: it must
 * have been seen in another state before (or this is the very first load).
 */
export function diffForAlerts(prev: AgentView[] | null, next: AgentView[]): Alerts {
  const before = new Map((prev ?? []).map((a) => [a.id, a]));
  const alerts: Alerts = { paused: [], stopped: [] };
  for (const a of next) {
    const was = before.get(a.id);
    const k = kindOf(a.status);
    if (k === "paused" && (!was || kindOf(was.status) !== "paused")) alerts.paused.push(a);
    // a first load shouldn't re-announce old stops; only a stop we watched happen counts
    if (k === "stopped" && was && kindOf(was.status) !== "stopped") alerts.stopped.push(a);
  }
  return alerts;
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** A server URL the extension is willing to send credentials to: http(s) only, no path tricks, no trailing slash. */
export function normalizeServerUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
