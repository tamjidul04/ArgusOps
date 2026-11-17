import type { AutopilotRun } from "../../../core/src/autopilot";
import { loadPrices } from "../../../core/src/prices";
import type { RoutingConfig } from "../../../core/src/routing";
import type { AgentRecord, NotificationRow, RoutingRow, Store } from "../../../core/src/store";
import { summarizeRouting, summarizeUsage, type UsageSummary } from "../../../core/src/usage";
import { parseRange } from "../../../core/src/usage-core";

/** Everything the terminal app shows, read from the local store in one go. */
export interface Data {
  now: number;
  agents: AgentRecord[];
  runs: AutopilotRun[];
  alerts: NotificationRow[];
  usage: UsageSummary;
  routing: { config: RoutingConfig; savedUsd: number; moved: number; decisions: RoutingRow[] };
}

/** An agent that has not checked in for this long is gone, whatever its record says. */
export const STALE_MS = 30_000;
export const isGone = (a: AgentRecord, now: number) => (a.status === "ACTIVE" || a.status === "PAUSED") && now - a.lastSeen > STALE_MS;
export const isWaiting = (a: AgentRecord, now: number) => a.status === "PAUSED" && !isGone(a, now);

export function readData(store: Store, now = Date.now()): Data {
  const agents = store.agents().sort((x, y) => Number(isWaiting(y, now)) - Number(isWaiting(x, now)) || y.lastSeen - x.lastSeen);
  const week = now - 7 * 86_400_000;
  const routed = summarizeRouting(store.usage(), week);
  return {
    now,
    agents,
    runs: store.autopilotRuns<AutopilotRun>().slice(0, 20),
    alerts: store.notifications(50),
    usage: summarizeUsage(store.usage(), store.incidents(), parseRange("7d"), new Date(now), loadPrices(store.root)),
    routing: { config: store.config().routing, savedUsd: routed.savedUsd, moved: routed.calls, decisions: store.routing(week).slice(-20).reverse() },
  };
}

/**
 * Text that came from an agent or a model must never reach the terminal as it is: an escape sequence in it could move
 * the cursor, rewrite the screen or set the window title. Control characters (including the C1 range) become spaces.
 */
export function clean(text: unknown): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0)!;
    out += c < 32 || (c >= 127 && c <= 159) || c === 0x2028 || c === 0x2029 ? " " : ch;
  }
  return out;
}
