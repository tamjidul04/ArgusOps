import { prisma } from "@/lib/prisma";
import {
  bucketKeys,
  estimateCacheSavingUsd,
  fillBuckets,
  rangeStart,
  sqlBucketFormat,
  toNumber,
  type BucketRow,
  type UsageRange,
} from "@/lib/usage-core";

export interface UsageSummary {
  range: UsageRange;
  from: string;
  totals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    calls: number;
    cachedTokens: number;
    cacheSavingUsd: number;
    loopsCaught: number;
  };
  buckets: BucketRow[];
  byAgent: Array<{ agentId: string | null; name: string; inputTokens: number; outputTokens: number; costUsd: number; calls: number }>;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; calls: number }>;
  allowance: { planName: string; included: number; remaining: number };
}

/** Real usage for one user over a range, straight from UsageEvent and Incident. Nothing is estimated except where labelled. */
export async function getUsageSummary(userId: string, range: UsageRange, now = new Date()): Promise<UsageSummary> {
  const from = rangeStart(range, now);
  const where = { user_id: userId, created_at: { gte: from } };

  const [totals, rawBuckets, byAgentRaw, byModelRaw, loopsCaught, prices, sub] = await Promise.all([
    prisma.usageEvent.aggregate({
      where,
      _sum: { input_tokens: true, output_tokens: true, cost_usd: true, tokens_saved: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ b: string; i: unknown; o: unknown; c: unknown; n: unknown }>>`
      SELECT DATE_FORMAT(created_at, ${sqlBucketFormat(range)}) AS b,
             SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cost_usd) AS c, COUNT(*) AS n
      FROM Usage_Events
      WHERE user_id = ${userId} AND created_at >= ${from}
      GROUP BY b
      ORDER BY b`,
    prisma.usageEvent.groupBy({
      by: ["agent_id"],
      where,
      _sum: { input_tokens: true, output_tokens: true, cost_usd: true },
      _count: { _all: true },
    }),
    prisma.usageEvent.groupBy({
      by: ["model"],
      where,
      _sum: { input_tokens: true, output_tokens: true, cost_usd: true, tokens_saved: true },
      _count: { _all: true },
    }),
    prisma.incident.count({ where: { ...where, kind: "LOOP", action: { in: ["PAUSED", "KILLED"] } } }),
    prisma.modelPrice.findMany(),
    prisma.subscriptionAndWallet.findUnique({ where: { user_id: userId }, include: { plan: true } }),
  ]);

  const agentIds = byAgentRaw.map((a) => a.agent_id).filter((x): x is string => !!x);
  const agents = agentIds.length
    ? await prisma.agent.findMany({ where: { agent_id: { in: agentIds }, cluster: { user_id: userId } }, select: { agent_id: true, name: true } })
    : [];
  const nameOf = new Map(agents.map((a) => [a.agent_id, a.name]));

  const buckets = fillBuckets(
    rawBuckets.map((r) => ({ bucket: String(r.b), inputTokens: toNumber(r.i), outputTokens: toNumber(r.o), costUsd: toNumber(r.c), calls: toNumber(r.n) })),
    bucketKeys(range, now)
  );

  const cachedTokens = totals._sum.tokens_saved ?? 0;
  return {
    range,
    from: from.toISOString(),
    totals: {
      inputTokens: totals._sum.input_tokens ?? 0,
      outputTokens: totals._sum.output_tokens ?? 0,
      costUsd: Math.round((totals._sum.cost_usd ?? 0) * 10_000) / 10_000,
      calls: totals._count._all,
      cachedTokens,
      cacheSavingUsd: estimateCacheSavingUsd(
        byModelRaw.map((m) => ({ model: m.model, cachedTokens: m._sum.tokens_saved ?? 0 })),
        prices
      ),
      loopsCaught,
    },
    buckets,
    byAgent: byAgentRaw
      .map((a) => ({
        agentId: a.agent_id,
        name: (a.agent_id && nameOf.get(a.agent_id)) || "Unassigned",
        inputTokens: a._sum.input_tokens ?? 0,
        outputTokens: a._sum.output_tokens ?? 0,
        costUsd: a._sum.cost_usd ?? 0,
        calls: a._count._all,
      }))
      .sort((x, y) => y.inputTokens + y.outputTokens - (x.inputTokens + x.outputTokens)),
    byModel: byModelRaw
      .map((m) => ({
        model: m.model,
        inputTokens: m._sum.input_tokens ?? 0,
        outputTokens: m._sum.output_tokens ?? 0,
        costUsd: m._sum.cost_usd ?? 0,
        calls: m._count._all,
      }))
      .sort((x, y) => y.costUsd - x.costUsd),
    allowance: {
      planName: sub?.plan.name ?? "Free",
      included: sub?.plan.included_tokens ?? 0,
      remaining: (sub?.free_tokens ?? 0) + (sub?.paid_tokens ?? 0),
    },
  };
}
