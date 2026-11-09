import { describe, it, expect } from "vitest";
import { costUsd, findPrice, type PriceRow } from "./pricing";

const prices: PriceRow[] = [
  { model: "claude-opus", input_per_mtok: 15, output_per_mtok: 75 },
  { model: "claude-sonnet", input_per_mtok: 3, output_per_mtok: 15 },
  { model: "claude-haiku", input_per_mtok: 0.8, output_per_mtok: 4 },
  { model: "gpt-4o", input_per_mtok: 2.5, output_per_mtok: 10 },
  { model: "gpt-4o-mini", input_per_mtok: 0.15, output_per_mtok: 0.6 },
];

describe("findPrice", () => {
  it("matches by prefix and prefers the longest key", () => {
    expect(findPrice("claude-sonnet-4-5-20250929", prices)?.model).toBe("claude-sonnet");
    expect(findPrice("gpt-4o-mini-2024-07-18", prices)?.model).toBe("gpt-4o-mini");
    expect(findPrice("gpt-4o-2024-08-06", prices)?.model).toBe("gpt-4o");
  });

  it("falls back to the model family for older naming", () => {
    expect(findPrice("claude-3-5-haiku-20241022", prices)?.model).toBe("claude-haiku");
    expect(findPrice("claude-3-opus-20240229", prices)?.model).toBe("claude-opus");
    expect(findPrice("Claude-3-7-SONNET-latest", prices)?.model).toBe("claude-sonnet");
  });

  it("returns null for unknown or empty models (never guesses)", () => {
    expect(findPrice("mystery-model", prices)).toBeNull();
    expect(findPrice("", prices)).toBeNull();
    expect(findPrice("claude-sonnet", [])).toBeNull();
  });
});

describe("costUsd", () => {
  it("computes USD from per-million prices", () => {
    // 1M in + 1M out on sonnet = 3 + 15
    expect(costUsd("claude-sonnet-4", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, prices)).toBe(18);
    expect(costUsd("claude-haiku-4", { inputTokens: 250_000, outputTokens: 50_000 }, prices)).toBeCloseTo(0.4, 6);
  });
  it("is zero for unpriced models and ignores negative counts", () => {
    expect(costUsd("mystery", { inputTokens: 1000, outputTokens: 1000 }, prices)).toBe(0);
    expect(costUsd("claude-sonnet-4", { inputTokens: -5, outputTokens: -5 }, prices)).toBe(0);
  });
});
