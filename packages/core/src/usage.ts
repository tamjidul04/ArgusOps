import { bucketKeyFor, bucketKeys, estimateCacheSavingUsd, fillBuckets, rangeStart, type BucketRow, type UsageRange } from "./usage-core";
import type { PriceRow } from "./pricing";
import type { IncidentRow, UsageRow } from "./store";

export interface UsageSummary {
  range: UsageRange;
  totals: { inputTokens: number; outputTokens: number; calls: number; costUsd: number; cacheSavedUsd: number; loopsCaught: number };
  buckets: BucketRow[];
  byAgent: Array<{ agentId: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number }>;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number }>;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Totals, per-bucket series and breakdowns for one time range, computed from the local usage log.
 * Pure: pass in the rows (from Store.usage / Store.incidents) and the prices.
 */
export function summarizeUsage(rows: UsageRow[], incidents: IncidentRow[], range: UsageRange, now: Date, prices: PriceRow[]): UsageSummary {
  const start = rangeStart(range, now).getTime();
  const inRange = rows.filter((r) => r.ts >= start && r.ts <= now.getTime());

  const buckets = new Map<string, BucketRow>();
  const byAgent = new Map<string, UsageSummary["byAgent"][number]>();
  const byModel = new Map<string, UsageSummary["byModel"][number]>();
  const totals = { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0, cacheSavedUsd: 0, loopsCaught: 0 };
  const cached = new Map<string, number>();

  for (const r of inRange) {
    totals.inputTokens += r.input_tokens;
    totals.outputTokens += r.output_tokens;
    totals.calls += 1;
    totals.costUsd += r.cost_usd;
    cached.set(r.model, (cached.get(r.model) ?? 0) + r.cache_read_tokens);

    const key = bucketKeyFor(range, new Date(r.ts));
    const b = buckets.get(key) ?? { bucket: key, inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
    b.inputTokens += r.input_tokens;
    b.outputTokens += r.output_tokens;
    b.costUsd += r.cost_usd;
    b.calls += 1;
    buckets.set(key, b);

    const a = byAgent.get(r.agentId) ?? { agentId: r.agentId, inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };
    a.inputTokens += r.input_tokens;
    a.outputTokens += r.output_tokens;
    a.calls += 1;
    a.costUsd += r.cost_usd;
    byAgent.set(r.agentId, a);

    const m = byModel.get(r.model) ?? { model: r.model, inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };
    m.inputTokens += r.input_tokens;
    m.outputTokens += r.output_tokens;
    m.calls += 1;
    m.costUsd += r.cost_usd;
    byModel.set(r.model, m);
  }

  totals.costUsd = round6(totals.costUsd);
  totals.cacheSavedUsd = estimateCacheSavingUsd([...cached].map(([model, cachedTokens]) => ({ model, cachedTokens })), prices);
  totals.loopsCaught = incidents.filter((i) => i.kind === "LOOP" && i.ts >= start && i.ts <= now.getTime()).length;

  const byCost = <T extends { costUsd: number; inputTokens: number }>(a: T, b: T) => b.costUsd - a.costUsd || b.inputTokens - a.inputTokens;
  return {
    range,
    totals,
    buckets: fillBuckets([...buckets.values()].map((b) => ({ ...b, costUsd: round6(b.costUsd) })), bucketKeys(range, now)),
    byAgent: [...byAgent.values()].map((a) => ({ ...a, costUsd: round6(a.costUsd) })).sort(byCost),
    byModel: [...byModel.values()].map((m) => ({ ...m, costUsd: round6(m.costUsd) })).sort(byCost),
  };
}
