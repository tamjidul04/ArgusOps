import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPrices, DEFAULT_PRICES } from "./prices";
import { summarizeUsage } from "./usage";
import type { IncidentRow, UsageRow } from "./store";

const now = new Date("2026-11-10T12:30:00Z");
const row = (over: Partial<UsageRow>): UsageRow => ({
  ts: now.getTime() - 60_000,
  agentId: "a1",
  provider: "anthropic",
  model: "claude-sonnet-x",
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: 0,
  latency_ms: 10,
  cost_usd: 0.01,
  ...over,
});
const loop = (ts: number): IncidentRow => ({ id: String(ts), ts, agentId: "a1", agentName: "x", kind: "LOOP", action: "PAUSED", severity: "WARN", score: 0.9, detail: "d" });

describe("summarizeUsage", () => {
  it("adds up totals, buckets and breakdowns inside the range only", () => {
    const rows = [
      row({}),
      row({ input_tokens: 300, output_tokens: 100, cost_usd: 0.04, model: "claude-haiku-x", agentId: "a2" }),
      row({ ts: now.getTime() - 20 * 86_400_000 }), // outside 7d
    ];
    const s = summarizeUsage(rows, [loop(now.getTime() - 1000), loop(now.getTime() - 30 * 86_400_000)], "7d", now, DEFAULT_PRICES);
    expect(s.totals).toMatchObject({ inputTokens: 400, outputTokens: 150, calls: 2, loopsCaught: 1 });
    expect(s.totals.costUsd).toBeCloseTo(0.05, 6);
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets[6]).toMatchObject({ bucket: "2026-11-10", inputTokens: 400, calls: 2 });
    expect(s.buckets[0].calls).toBe(0);
    expect(s.byAgent.map((a) => a.agentId)).toEqual(["a2", "a1"]); // most expensive first
    expect(s.byModel).toHaveLength(2);
  });

  it("estimates cache savings from priced models and ignores unpriced ones", () => {
    const rows = [row({ cache_read_tokens: 1_000_000 }), row({ model: "mystery-model", cache_read_tokens: 5_000_000 })];
    const s = summarizeUsage(rows, [], "24h", now, DEFAULT_PRICES);
    expect(s.totals.cacheSavedUsd).toBeCloseTo(2.7, 2); // 1M tokens * $3 * 0.9
    expect(s.buckets).toHaveLength(24);
  });

  it("is all zeros for an empty log", () => {
    const s = summarizeUsage([], [], "30d", now, DEFAULT_PRICES);
    expect(s.totals).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0, cacheSavedUsd: 0, loopsCaught: 0 });
    expect(s.buckets).toHaveLength(30);
  });
});

describe("loadPrices", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const home = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-prices-"));
    made.push(d);
    return d;
  };

  it("uses the built-in prices when there is no file", () => {
    expect(loadPrices(home())).toEqual(DEFAULT_PRICES);
  });

  it("lets prices.json replace and add rows, and ignores invalid ones", () => {
    const h = home();
    fs.writeFileSync(
      path.join(h, "prices.json"),
      JSON.stringify([
        { model: "claude-sonnet", input_per_mtok: 4, output_per_mtok: 20 },
        { model: "my-local", input_per_mtok: 0, output_per_mtok: 0 },
        { model: "bad", input_per_mtok: "x" },
        { model: "neg", input_per_mtok: -1, output_per_mtok: 1 },
      ])
    );
    const p = loadPrices(h);
    expect(p.find((r) => r.model === "claude-sonnet")?.input_per_mtok).toBe(4);
    expect(p.find((r) => r.model === "my-local")).toBeTruthy();
    expect(p.find((r) => r.model === "bad")).toBeUndefined();
    expect(p.find((r) => r.model === "neg")).toBeUndefined();
    expect(p.filter((r) => r.model === "claude-sonnet")).toHaveLength(1);
  });

  it("ignores a file that is not valid JSON", () => {
    const h = home();
    fs.writeFileSync(path.join(h, "prices.json"), "{oops");
    expect(loadPrices(h)).toEqual(DEFAULT_PRICES);
  });
});
