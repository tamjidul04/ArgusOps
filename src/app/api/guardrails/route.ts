import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { evaluateAgentStreamForLoops } from "@/lib/guardrails-engine";
import {
  sanitizePolicyInput,
  type GuardrailPolicy,
  type StreamEvent,
} from "@/lib/control-plane-core";
import {
  getLatencyStats,
  getPolicy,
  getPolicyRow,
  killAgent,
  listStreamEvents,
  ownedAgent,
  recordIncident,
  resumeAgent,
  updatePolicy,
} from "@/lib/control-plane";
import { notifyLoop } from "@/lib/notifier";

export type { GuardrailPolicy, StreamEvent };

const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_CHARS = 2000;

/**
 * Agent state changes made here are the control plane's *desired state*. The `argus` CLI/daemon
 * reads them and applies them to the real process; until a daemon is connected they only update
 * what the dashboard shows. Every lookup is scoped to the signed-in user's own agents.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const mine = { cluster: { user_id: userId } };

    const [policy, streamEvents, flaggedAgents, activeAgents, latency] = await Promise.all([
      getPolicy(userId),
      listStreamEvents(userId),
      prisma.agent.findMany({
        where: {
          ...mine,
          OR: [{ status: "PAUSED_NUDGE" }, { status: "KILLED_LOOP" }, { loop_score: { gte: 0.5 } }],
        },
        orderBy: { loop_score: "desc" },
        take: 100,
      }),
      prisma.agent.findMany({
        where: { ...mine, status: "ACTIVE" },
        take: 12,
        orderBy: { ram_usage: "desc" },
      }),
      getLatencyStats(userId),
    ]);

    return NextResponse.json({
      success: true,
      policy,
      streamEvents,
      flaggedAgents,
      activeAgents,
      avgLatencyMs: latency.avg,
      p99LatencyMs: latency.p99,
    });
  } catch (error) {
    console.error("Guardrails GET error:", error);
    return NextResponse.json({ error: "Failed to retrieve guardrails data." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // Controlling a running agent (resume / stop) is allowed with a device key, so the VS Code extension works.
    // Changing settings (policy, throttling) needs a browser session.
    const controlOnly = action === "SEND_NUDGE" || action === "TRIGGER_KILL_SWITCH";
    if (auth.via !== "session" && !controlOnly) {
      return NextResponse.json({ error: "Sign in to change guardrails." }, { status: 403 });
    }
    const agentIdOf = (): string | null => (typeof body.agentId === "string" && body.agentId ? body.agentId : null);

    switch (action) {
      case "UPDATE_POLICY": {
        const policy = await updatePolicy(userId, sanitizePolicyInput(body.policy));
        return NextResponse.json({
          success: true,
          message: "Guardrail thresholds saved. They apply to the next request each agent makes.",
          policy,
        });
      }

      case "SEND_NUDGE": {
        const agentId = agentIdOf();
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        const r = await resumeAgent(userId, agentId, typeof body.hintText === "string" ? body.hintText : undefined);
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
        return NextResponse.json({
          success: true,
          message: `${r.value.agent.name} will resume with your hint on its next sync.`,
          agent: r.value.agent,
        });
      }

      case "THROTTLE_DOWNGRADE": {
        const agentId = agentIdOf();
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        const agent = await ownedAgent(userId, agentId);
        if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

        const updated = await prisma.agent.update({
          where: { agent_id: agent.agent_id },
          data: { model_tier: "DOWNGRADED_FAST" },
        });
        await recordIncident({
          userId,
          agentId: agent.agent_id,
          agentName: agent.name,
          kind: "WASTE",
          severity: "INFO",
          action: "THROTTLED",
          detail: `${agent.name} switched to the fast model tier to cut token cost.`,
        });
        return NextResponse.json({
          success: true,
          message: `${agent.name} will use the fast model tier for new requests.`,
          agent: updated,
        });
      }

      case "TRIGGER_KILL_SWITCH": {
        const agentId = agentIdOf();
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        const r = await killAgent(userId, agentId, "Stopped by operator kill switch.");
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
        return NextResponse.json({
          success: true,
          message: `${r.value.agent.name} was marked stopped. Its CLI will terminate the process on the next sync.`,
          agent: r.value.agent,
        });
      }

      case "EVALUATE_STREAM": {
        const rawLogs: unknown[] = Array.isArray(body.logs) ? body.logs.slice(-MAX_LOG_LINES) : [];
        const logs = rawLogs.map((l) => String(l).slice(0, MAX_LOG_LINE_CHARS));
        const progress = typeof body.taskProgressPct === "number" ? body.taskProgressPct : 50;
        const policy = await getPolicyRow(userId);

        const evaluation = evaluateAgentStreamForLoops(logs, progress, {
          loopScoreThreshold: policy.loop_score_threshold,
          nudgeProgressPct: policy.nudge_progress_pct,
          exactRepeatLimit: policy.exact_repeat_limit,
        });

        const agentId = agentIdOf();
        if (agentId && (evaluation.status === "KILLED_LOOP" || evaluation.status === "PAUSED_NUDGE")) {
          const agent = await ownedAgent(userId, agentId);
          if (agent) {
            await prisma.agent.update({
              where: { agent_id: agent.agent_id },
              data: {
                status: evaluation.status,
                loop_score: evaluation.loopScore,
                ...(evaluation.status === "KILLED_LOOP" && { ram_usage: 0, cpu_usage: 0 }),
                current_task: evaluation.reason.slice(0, 500),
                last_heartbeat_at: new Date(),
              },
            });
            const incident = await recordIncident({
              userId,
              agentId: agent.agent_id,
              agentName: agent.name,
              kind: "LOOP",
              loopType: evaluation.loopType === "SEMANTIC_REASONING_LOOP" ? "SEMANTIC_REASONING_LOOP" : "EXACT_TOOL_LOOP",
              severity: evaluation.status === "KILLED_LOOP" ? "CRITICAL" : "WARN",
              action: evaluation.status === "KILLED_LOOP" ? "KILLED" : "PAUSED",
              score: evaluation.loopScore,
              detail: evaluation.reason,
              interceptionMs: evaluation.interceptionMs,
            });
            await notifyLoop(userId, {
              agentName: agent.name,
              agentId: agent.agent_id,
              incidentId: incident.id,
              action: evaluation.status === "KILLED_LOOP" ? "KILLED" : "PAUSED",
              detail: evaluation.reason,
            });
          }
        }
        return NextResponse.json({ success: true, evaluation });
      }

      default:
        return NextResponse.json(
          { error: `Unknown or removed action: ${String(action)}. Simulation actions are no longer available.` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Guardrails action error:", error);
    return NextResponse.json({ error: "Internal server error while processing the guardrails action." }, { status: 500 });
  }
}
