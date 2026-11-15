/**
 * Token pricing for cost accounting. Prices are USD per million tokens, kept in prices.ts and
 * overridable in ~/.argusops/prices.json. These are list-price estimates, not invoices: the provider bills the user
 * directly (bring your own key or login).
 */

export interface PriceRow {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
}

/** Family keywords for model names that don't start with a seeded key (e.g. "claude-3-5-haiku-2024..."). */
const FAMILY_FALLBACKS: Array<{ word: string; key: string }> = [
  { word: "opus", key: "claude-opus" },
  { word: "sonnet", key: "claude-sonnet" },
  { word: "haiku", key: "claude-haiku" },
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
  inputTokens: number;
  outputTokens: number;
}

/** USD cost for one request; 0 when the model has no price (we never invent one). */
export function costUsd(model: string, usage: Usage, prices: PriceRow[]): number {
  const price = findPrice(model, prices);
  if (!price) return 0;
  const input = Math.max(0, usage.inputTokens) * price.input_per_mtok;
  const output = Math.max(0, usage.outputTokens) * price.output_per_mtok;
  return Math.round(((input + output) / 1_000_000) * 1_000_000) / 1_000_000;
}
