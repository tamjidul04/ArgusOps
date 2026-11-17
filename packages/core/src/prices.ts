import fs from "node:fs";
import path from "node:path";
import type { PriceRow } from "./pricing";

/**
 * List prices in USD per million tokens, used only to ESTIMATE cost and savings (the provider bills you directly).
 * A model with no matching row is shown as unpriced (cost 0), never guessed.
 *
 * These numbers are the project's starting estimates and can be out of date, especially for newer models. Put your own
 * in `~/.argusops/prices.json` as `[{ "model": "claude-sonnet", "input_per_mtok": 3, "output_per_mtok": 15 }]`; rows
 * there replace the ones here with the same `model`.
 */
export const DEFAULT_PRICES: PriceRow[] = [
  // Anthropic list prices (checked 2026-11). The most specific name wins, so "claude-opus-5-5" beats "claude-opus-5".
  { model: "claude-fable-5-2", input_per_mtok: 8, output_per_mtok: 40, cache_read_per_mtok: 0.2 },
  { model: "claude-fable-5-1", input_per_mtok: 10, output_per_mtok: 50 },
  { model: "claude-fable-5", input_per_mtok: 10, output_per_mtok: 50 },
  { model: "claude-mythos-5-2", input_per_mtok: 8, output_per_mtok: 40, cache_read_per_mtok: 0.2 },
  { model: "claude-mythos-5-1", input_per_mtok: 10, output_per_mtok: 50 },
  { model: "claude-opus-5-5", input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2 },
  { model: "claude-opus-5", input_per_mtok: 5, output_per_mtok: 25 },
  { model: "claude-opus-4-8", input_per_mtok: 5, output_per_mtok: 25 },
  { model: "claude-opus-4-7", input_per_mtok: 5, output_per_mtok: 25 },
  { model: "claude-opus-4-6", input_per_mtok: 5, output_per_mtok: 25 },
  { model: "claude-sonnet-5-5", input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.1 },
  { model: "claude-sonnet-5", input_per_mtok: 2, output_per_mtok: 10 },
  { model: "claude-sonnet-4-6", input_per_mtok: 3, output_per_mtok: 15 },
  // Haiku 5.5: prompts up to 100K tokens (longer prompts cost $0.50 / $2.50)
  { model: "claude-haiku-5-5", input_per_mtok: 0.1, output_per_mtok: 0.5 },
  { model: "claude-haiku-4-5", input_per_mtok: 1, output_per_mtok: 5 },
  // older models, matched by family
  { model: "claude-opus", input_per_mtok: 15, output_per_mtok: 75 },
  { model: "claude-sonnet", input_per_mtok: 3, output_per_mtok: 15 },
  { model: "claude-haiku", input_per_mtok: 0.8, output_per_mtok: 4 },
  { model: "gpt-5", input_per_mtok: 1.25, output_per_mtok: 10 },
  { model: "gpt-4o-mini", input_per_mtok: 0.15, output_per_mtok: 0.6 },
  { model: "gpt-4o", input_per_mtok: 2.5, output_per_mtok: 10 },
  { model: "o3", input_per_mtok: 2, output_per_mtok: 8 },
  { model: "gemini-2.5-pro", input_per_mtok: 1.25, output_per_mtok: 10 },
  { model: "gemini-2.5-flash", input_per_mtok: 0.3, output_per_mtok: 2.5 },
];

const valid = (r: unknown): r is PriceRow =>
  !!r &&
  typeof (r as PriceRow).model === "string" &&
  Number.isFinite((r as PriceRow).input_per_mtok) &&
  Number.isFinite((r as PriceRow).output_per_mtok) &&
  (r as PriceRow).input_per_mtok >= 0 &&
  (r as PriceRow).output_per_mtok >= 0 &&
  ((r as PriceRow).cache_read_per_mtok === undefined || (Number.isFinite((r as PriceRow).cache_read_per_mtok) && (r as PriceRow).cache_read_per_mtok! >= 0));

/** The built-in prices with the user's overrides from `<home>/prices.json` applied. A bad file is ignored. */
export function loadPrices(home: string): PriceRow[] {
  let extra: PriceRow[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, "prices.json"), "utf8"));
    if (Array.isArray(parsed)) extra = parsed.filter(valid);
  } catch {
    // no file, or not valid JSON: use the built-in prices
  }
  const overridden = new Set(extra.map((r) => r.model.toLowerCase()));
  return [...DEFAULT_PRICES.filter((p) => !overridden.has(p.model.toLowerCase())), ...extra];
}
