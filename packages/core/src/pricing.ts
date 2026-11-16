/**
 * Token pricing for cost accounting. Prices are USD per million tokens, kept in prices.ts and
 * overridable in ~/.argusops/prices.json. These are list-price estimates, not invoices: the provider bills the user
 * directly (bring your own key or login).
 */

export interface PriceRow {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  /** Price of reading cached input. Defaults to a tenth of the input price. */
  cache_read_per_mtok?: number;
}

/** Family keywords for model names that don't start with a seeded key (e.g. "claude-3-5-haiku-2024..."). */
const FAMILY_FALLBACKS: Array<{ word: string; key: string }> = [
  { word: "opus", key: "claude-opus" },
  { word: "sonnet", key: "claude-sonnet" },
  { word: "haiku", key: "claude-haiku" },
  { word: "fable", key: "claude-fable-5" },
];

/** Longest matching key wins: "gpt-4o-mini" must beat "gpt-4o". */
export function findPrice(model: string, prices: PriceRow[]): PriceRow | null {
  const name = model.toLowerCase().trim();
  if (!name) return null;
  const sorted = [...prices].sort((a, b) => b.model.length - a.model.length);

  const direct = sorted.find((p) => name.startsWith(p.model.toLowerCase()));
  if (direct) return direct;

  const family = FAMILY_FALLBACKS.find((f) => name.includes(f.word));
  if (family) return sorted.find((p) => p.model.toLowerCase() === family.key) ?? null;

  return sorted.find((p) => name.includes(p.model.toLowerCase())) ?? null;
}

export interface Usage {
  /** Input billed at full price or more: uncached input plus cache writes. */
  inputTokens: number;
  outputTokens: number;
  /** Input read from the cache (not part of inputTokens). */
  cacheReadTokens?: number;
  /** The part of inputTokens that was written to the cache (billed at 1.25x). */
  cacheWriteTokens?: number;
}

/** Cache writes cost 1.25x the input price (5-minute cache; the 1-hour cache costs more, so this is a low estimate). */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** USD cost for one request; 0 when the model has no price (we never invent one). */
export function costUsd(model: string, usage: Usage, prices: PriceRow[]): number {
  const price = findPrice(model, prices);
  if (!price) return 0;
  const inputAll = Math.max(0, usage.inputTokens);
  const written = Math.min(inputAll, Math.max(0, usage.cacheWriteTokens ?? 0));
  const input = (inputAll - written) * price.input_per_mtok + written * price.input_per_mtok * CACHE_WRITE_MULTIPLIER;
  const cached = Math.max(0, usage.cacheReadTokens ?? 0) * (price.cache_read_per_mtok ?? price.input_per_mtok * 0.1);
  const output = Math.max(0, usage.outputTokens) * price.output_per_mtok;
  return Math.round(((input + cached + output) / 1_000_000) * 1_000_000) / 1_000_000;
}
