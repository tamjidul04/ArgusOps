import { describe, it, expect } from "vitest";
import { bucketKeys, estimateCacheSavingUsd, fillBuckets, parseRange, rangeStart, sqlBucketFormat, toNumber } from "./usage-core";

const now = new Date("2026-11-09T15:42:10Z");

describe("ranges and buckets", () => {
  it("parses the range, defaulting to 7 days", () => {
    expect(parseRange("24h")).toBe("24h");
    expect(parseRange("30d")).toBe("30d");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("1y")).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
  });

  it("makes 24 hourly buckets ending with the current hour", () => {
    const k = bucketKeys("24h", now);
    expect(k).toHaveLength(24);
    expect(k[23]).toBe("2026-11-09 15:00:00");
    expect(k[0]).toBe("2026-11-08 16:00:00");
    expect(rangeStart("24h", now).toISOString()).toBe("2026-11-08T16:00:00.000Z");
  });

  it("makes daily buckets including today, across a month boundary", () => {
    expect(bucketKeys("7d", now)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    const thirty = bucketKeys("30d", now);
    expect(thirty).toHaveLength(30);
    expect(thirty[0]).toBe("2026-10-11");
    expect(rangeStart("7d", now).toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  it("uses a SQL format that matches the bucket keys", () => {
    expect(sqlBucketFormat("24h")).toBe("%Y-%m-%d %H:00:00");
    expect(sqlBucketFormat("7d")).toBe("%Y-%m-%d");
  });

  it("fills missing buckets with zeros and keeps order", () => {
    const filled = fillBuckets([{ bucket: "2026-11-05", inputTokens: 10, outputTokens: 2, costUsd: 0.5, calls: 1 }], bucketKeys("7d", now));
    expect(filled).toHaveLength(7);
    expect(filled[2]).toMatchObject({ bucket: "2026-11-05", inputTokens: 10 });
    expect(filled[0]).toMatchObject({ bucket: "2026-11-03", inputTokens: 0, calls: 0 });
  });
});

describe("estimateCacheSavingUsd", () => {
  const prices = [{ model: "claude-sonnet", input_per_mtok: 3, output_per_mtok: 15 }];
  it("values cache reads at 90% of the input price", () => {
    // 1M cached sonnet tokens: $3 list, billed ~$0.30, saved $2.70
    expect(estimateCacheSavingUsd([{ model: "claude-sonnet-4-5", cachedTokens: 1_000_000 }], prices)).toBe(2.7);
  });
  it("ignores unpriced models and empty rows", () => {
    expect(estimateCacheSavingUsd([{ model: "mystery", cachedTokens: 5_000_000 }, { model: "claude-sonnet", cachedTokens: 0 }], prices)).toBe(0);
  });
});

describe("toNumber", () => {
  it("handles what SQL drivers return", () => {
    expect(toNumber(BigInt(5))).toBe(5);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber({ toString: () => "7" })).toBe(7);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});
