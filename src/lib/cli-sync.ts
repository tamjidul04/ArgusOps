import { prisma } from "@/lib/prisma";
import { costUsd, type PriceRow } from "@/lib/pricing";
import { notify, notifyLoop } from "@/lib/notifier";
import { proposeRewrite } from "@/lib/rewriter";
import {
  checkAgentSlot,
  ensureLocalCluster,
  getPolicyRow,
  planLimits,
  recordIncident,
} from "@/lib/control-plane";

/**
 * The CLI calls this every couple of seconds with what happened locally (token usage, incidents) and
 * gets back what the agent should do now. All state changes are scoped to the API key's owner.
 */

export type DesiredState = "RUN" | "PAUSE" | "KILL";

export interface SyncResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_EVENTS = 200;
const AGENT_TYPE_RE = /^[A-Z][A-Z0-9_]{1,29}$/;
const PRICE_CACHE_MS = 5 * 60_000;
let priceCache: { at: number; rows: PriceRow[] } | null = null;

async function getPrices(): Promise<PriceRow[]> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_MS) return priceCache.rows;
  const rows = await prisma.modelPrice.findMany();
  priceCache = { at: Date.now(), rows };
  return rows;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function int(v: unknown, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
}
function float(v: unknown, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

export interface SyncContext {
  userId: string;
  userName: string;
  apiKeyId?: string;
}

export async function processSync(ctx: SyncContext, raw: unknown): Promise<SyncResult> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const run = (body.run && typeof body.run === "object" ? body.run : {}) as Record<string, unknown>;
  const agentIn = (run.agent && typeof run.agent === "object" ? run.agent : {}) as Record<string, unknown>;

  const runId = str(run.id, 64);
  const agentName = str(agentIn.name, 100);
  const type = (str(agentIn.type, 30) ?? "AGENT").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!runId || !agentName || !AGENT_TYPE_RE.test(type)) {
    return { status: 400, body: { error: "invalid_request", message: "run.id, run.agent.name and run.agent.type are required." } };
  }
  const isStart = run.start === true;
  const isEnd = run.end === true;
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

  if (ctx.apiKeyId) {
    await prisma.cliDevice
      .updateMany({ where: { user_id: ctx.userId, api_key_id: ctx.apiKeyId }, data: { last_seen_at: new Date() } })
      .catch(() => undefined);
  }

  // ---- resolve (or register) the agent --------------------------------------------------------------
  const cluster = await ensureLocalCluster(ctx.userId, ctx.userName);
  let agent = await prisma.agent.findFirst({ where: { cluster_id: cluster.cluster_id, name: agentName } });

  if (!agent) {
    const slot = await checkAgentSlot(ctx.userId);
    if (!slot.ok) return { status: 403, body: { error: "agent_limit", message: slot.message } };
    agent = await prisma.agent.create({
      data: { cluster_id: cluster.cluster_id, name: agentName, agent_type: type, status: "ACTIVE" },
    });
  } else if (isStart && agent.status !== "ACTIVE") {
    // A fresh `argus run` replaces any earlier process, so it starts from a clean state but needs a free slot.
    const slot = await checkAgentSlot(ctx.userId);
    if (!slot.ok) return { status: 403, body: { error: "agent_limit", message: slot.message } };
    agent = await prisma.agent.update({
      where: { agent_id: agent.agent_id },
      data: { status: "ACTIVE", loop_score: 0, pending_hint: null, current_task: null },
    });
  }

  // ---- apply events in order ---------------------------------------------------------------------------
  const prices = await getPrices();
  let tokensThisSync = 0;
  const agentUpdate: { status?: string; loop_score?: number; current_task?: string | null; pending_hint?: string | null } = {};

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;

    if (e.type === "usage") {
      const model = str(e.model, 120) ?? "unknown";
      const inputTokens = int(e.input_tokens, 50_000_000);
      const outputTokens = int(e.output_tokens, 50_000_000);
      const provider = (str(e.provider, 20) ?? "anthropic").toLowerCase();
      const cacheRead = int(e.cache_read_tokens, 50_000_000);
      await prisma.usageEvent.create({
        data: {
          user_id: ctx.userId,
          agent_id: agent.agent_id,
          run_id: runId,
          provider,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd(model, { inputTokens, outputTokens }, prices),
          latency_ms: int(e.latency_ms, 3_600_000),
          // tokens the provider served from its prompt cache: billed far lower, so reported as "saved"
          cache_hit: cacheRead > 0,
          tokens_saved: cacheRead,
        },
      });
      tokensThisSync += inputTokens + outputTokens;
    } else if (e.type === "incident") {
      const action = e.action === "KILLED" ? "KILLED" : e.action === "PAUSED" ? "PAUSED" : "NONE";
      const loopType = e.loop_type === "SEMANTIC_REASONING_LOOP" ? "SEMANTIC_REASONING_LOOP" : "EXACT_TOOL_LOOP";
      const detail = str(e.detail, 2000) ?? "Loop detected.";
      const score = float(e.score, 1);
      const incident = await recordIncident({
        userId: ctx.userId,
        agentId: agent.agent_id,
        agentName: agent.name,
        kind: "LOOP",
        loopType,
        severity: action === "KILLED" ? "CRITICAL" : "WARN",
        action,
        score,
        detail,
        interceptionMs: float(e.interception_ms, 60_000),
      });
      // what the agent kept repeating (newer CLIs send the exact steps; older ones only the summary)
      const ev2 = (e.evidence && typeof e.evidence === "object" ? e.evidence : {}) as Record<string, unknown>;
      const unit = (Array.isArray(ev2.unit) ? ev2.unit : [])
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .slice(0, 8)
        .map((u) => u.slice(0, 400));
      const repeats = int(ev2.repeats, 1000) || 3;

      let suggestion: "ready" | "applied" | undefined;
      if (action === "PAUSED") {
        const proposed = await proposeRewrite({
          userId: ctx.userId,
          agentId: agent.agent_id,
          agentName: agent.name,
          incidentId: incident.id,
          unit: unit.length ? unit : [detail],
          repeats,
        });
        if (proposed.autoApplied) {
          // stay running and hand the instruction to the agent right away, instead of pausing
          suggestion = "applied";
          Object.assign(agentUpdate, { loop_score: score, pending_hint: proposed.rewrite.rewritten_prompt, current_task: "Resumed automatically with a suggested instruction" });
        } else {
          suggestion = "ready";
        }
      }
      if (action !== "NONE") {
        await notifyLoop(ctx.userId, { agentName: agent.name, agentId: agent.agent_id, incidentId: incident.id, action, detail, suggestion });
      }
      if (action === "PAUSED" && suggestion !== "applied") Object.assign(agentUpdate, { status: "PAUSED_NUDGE", loop_score: score, current_task: detail.slice(0, 500) });
      if (action === "KILLED") Object.assign(agentUpdate, { status: "KILLED_LOOP", loop_score: score, current_task: detail.slice(0, 500) });
    }
  }

  // ---- telemetry, wallet and agent row ---------------------------------------------------------------------
  const telemetry = (body.telemetry && typeof body.telemetry === "object" ? body.telemetry : {}) as Record<string, unknown>;
  const currentTask = str(telemetry.current_task, 500);

  agent = await prisma.agent.update({
    where: { agent_id: agent.agent_id },
    data: {
      ...agentUpdate,
      ...(agentUpdate.status === "KILLED_LOOP" && { ram_usage: 0, cpu_usage: 0 }),
      ...(telemetry.ram_mb !== undefined && agentUpdate.status !== "KILLED_LOOP" && { ram_usage: float(telemetry.ram_mb, 1_000_000) }),
      ...(telemetry.cpu_percent !== undefined && agentUpdate.status !== "KILLED_LOOP" && { cpu_usage: float(telemetry.cpu_percent, 10_000) }),
      ...(currentTask && !agentUpdate.current_task && { current_task: currentTask }),
      ...(tokensThisSync > 0 && { tokens_used: { increment: tokensThisSync } }),
      // A clean exit frees the plan slot straight away.
      ...(isEnd && agent.status === "ACTIVE" && { status: "HIBERNATED", ram_usage: 0, cpu_usage: 0 }),
      last_heartbeat_at: new Date(),
    },
  });

  let remaining = 0;
  const sub = await prisma.subscriptionAndWallet.findUnique({ where: { user_id: ctx.userId } });
  if (sub) {
    let free = sub.free_tokens;
    let paid = sub.paid_tokens;
    if (tokensThisSync > 0) {
      const fromFree = Math.min(free, tokensThisSync);
      free -= fromFree;
      paid = Math.max(0, paid - (tokensThisSync - fromFree));
      await prisma.subscriptionAndWallet.update({ where: { user_id: ctx.userId }, data: { free_tokens: free, paid_tokens: paid } });
      // Tell the user once, at the moment the allowance runs out (not on every sync afterwards).
      if (sub.free_tokens + sub.paid_tokens > 0 && free + paid <= 0) {
        await notify(ctx.userId, {
          title: "Token allowance used up",
          body: "Your supervised agents are paused until you upgrade or top up. They resume on their own once tokens are available.",
          level: "CRITICAL",
          agentId: agent.agent_id,
          linkPath: "/dashboard/billing",
        });
      }
    }
    remaining = free + paid;
  }

  // ---- what should the agent do now? ---------------------------------------------------------------------------
  let desired: DesiredState = "RUN";
  let reason: string | undefined;
  if (agent.status === "KILLED_LOOP") {
    desired = "KILL";
    reason = agent.current_task ?? "Stopped.";
  } else if (agent.status === "PAUSED_NUDGE") {
    desired = "PAUSE";
    reason = agent.current_task ?? "Paused for review.";
  } else if (agent.status === "HIBERNATED" && !isEnd) {
    desired = "PAUSE";
    reason = "This agent was hibernated from the dashboard.";
  } else if (remaining <= 0) {
    desired = "PAUSE";
    reason = "Your token allowance for this plan is used up. Upgrade or top up to continue.";
  }

  // Hand the operator's hint over exactly once, and only while the agent is allowed to run.
  let hint: string | undefined;
  if (desired === "RUN" && agent.pending_hint) {
    const cleared = await prisma.agent.updateMany({
      where: { agent_id: agent.agent_id, pending_hint: agent.pending_hint },
      data: { pending_hint: null },
    });
    if (cleared.count === 1) hint = agent.pending_hint;
  }

  const policy = await getPolicyRow(ctx.userId);
  const { maxAgents } = await planLimits(ctx.userId);

  return {
    status: 200,
    body: {
      ok: true,
      agentId: agent.agent_id,
      desired,
      ...(reason && { reason }),
      ...(hint && { hint }),
      quota: { remaining },
      limits: { maxAgents },
      policy: {
        loopScoreThreshold: policy.loop_score_threshold,
        nudgeProgressPct: policy.nudge_progress_pct,
        exactRepeatLimit: policy.exact_repeat_limit,
      },
      serverTime: new Date().toISOString(),
    },
  };
}
