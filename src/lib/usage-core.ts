import { findPrice, type PriceRow } from "@/lib/pricing";

/** Pure helpers for the usage page: time ranges, bucket filling and the cache-savings estimate. */

export type UsageRange = "24h" | "7d" | "30d";
export const RANGES: UsageRange[] = ["24h", "7d", "30d"];

export function parseRange(value: unknown): UsageRange {
  return value === "24h" || value === "30d" ? value : "7d";
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const hourKey = (d: Date) => `${dayKey(d)} ${pad(d.getUTCHours())}:00:00`;

/** MySQL DATE_FORMAT pattern that produces the same keys as bucketKeys(). */
export function sqlBucketFormat(range: UsageRange): string {
  return range === "24h" ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d";
}

/** Every bucket in the range, oldest first, in UTC: 24 hours, or 7 / 30 days including today. */
export function bucketKeys(range: UsageRange, now: Date): string[] {
  const keys: string[] = [];
  if (range === "24h") {
    const top = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    for (let i = 23; i >= 0; i--) keys.push(hourKey(new Date(top.getTime() - i * 3_600_000)));
  } else {
    const days = range === "7d" ? 7 : 30;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(today.getTime() - i * 86_400_000)));
  }
  return keys;
}

/** The instant the range starts (the start of its first bucket). */
export function rangeStart(range: UsageRange, now: Date): Date {
  const first = bucketKeys(range, now)[0];
  return new Date(first.length === 10 ? `${first}T00:00:00Z` : `${first.replace(" ", "T")}Z`);
}

export interface BucketRow {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}

/** Puts query rows into every bucket of the range, with zeros where nothing happened. */
export function fillBuckets(rows: BucketRow[], keys: string[]): BucketRow[] {
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return keys.map((k) => byKey.get(k) ?? { bucket: k, inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 });
}

/** Cache reads are billed at about a tenth of the normal input price, so 90% of their list price was saved. */
export const CACHE_READ_DISCOUNT = 0.9;

/** Estimated USD saved by tokens the provider served from its prompt cache. Unpriced models count as 0. */
export function estimateCacheSavingUsd(rows: Array<{ model: string; cachedTokens: number }>, prices: PriceRow[]): number {
  let total = 0;
  for (const r of rows) {
    const price = findPrice(r.model, prices);
    if (!price || r.cachedTokens <= 0) continue;
    total += (r.cachedTokens * price.input_per_mtok * CACHE_READ_DISCOUNT) / 1_000_000;
  }
  return Math.round(total * 100) / 100;
}

/** Converts what a raw SQL driver returns for SUM/COUNT (bigint, Decimal, string, null) to a number. */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}
