import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateAgentStreamForLoops } from "@/lib/guardrails-engine";

export interface GuardrailPolicy {
  maxConsecutiveRetries: number;
  semanticSimilarityThreshold: number;
  nudgeCompletionThreshold: number;
  maxRamPerAgentMb: number;
  autoThrottleEnabled: boolean;
}

export interface StreamEvent {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  eventType: "EXACT_TOOL_LOOP" | "SEMANTIC_REASONING_LOOP" | "MEMORY_GOVERNANCE";
  toolName?: string;
  similarityScore?: number;
  retryCount?: number;
  latencyMs: number;
  actionTaken: "KILLED_LOOP" | "PAUSED_NUDGE" | "THROTTLED" | "FLAGGED";
  summary: string;
}

// In-memory policy state with realistic defaults
let currentPolicy: GuardrailPolicy = {
  maxConsecutiveRetries: 3,
  semanticSimilarityThreshold: 0.88,
  nudgeCompletionThreshold: 80,
  maxRamPerAgentMb: 250,
  autoThrottleEnabled: true,
};

// Initial stream events
const streamEvents: StreamEvent[] = [
  {
    id: "evt-01",
    timestamp: "10:14:02",
    agentId: "agent_cloud_killed_30",
    agentName: "Cloud-Worker-30-Crawler",
    eventType: "EXACT_TOOL_LOOP",
    toolName: "fetch_vector_chunks(offset=1024)",
    retryCount: 4,
    latencyMs: 38,
    actionTaken: "KILLED_LOOP",
    summary: "Tool call failed with identical ECONNRESET error 4x. Hard circuit breaker tripped at 38ms.",
  },
  {
    id: "evt-02",
    timestamp: "10:13:48",
    agentId: "agent_cloud_nudge_29",
    agentName: "Cloud-Worker-29-Auditor",
    eventType: "SEMANTIC_REASONING_LOOP",
    similarityScore: 0.94,
    latencyMs: 31,
    actionTaken: "PAUSED_NUDGE",
    summary: "Cosine similarity 0.94 detected repeated reasoning cycle on migration alter statement. Task is 92% complete: Paused for human nudge.",
  },
  {
    id: "evt-03",
    timestamp: "10:12:15",
    agentId: "agent_cloud_active_12",
    agentName: "Cloud-Worker-12",
    eventType: "MEMORY_GOVERNANCE",
    latencyMs: 29,
    actionTaken: "THROTTLED",
    summary: "Resident memory reached 268MB (cap: 250MB). Memory bus governor throttled AST buffer down to 142MB in 29ms.",
  },
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clusterId = searchParams.get("clusterId") || "cluster_cloud_useast";

    // Fetch flagged/high-risk agents
    const flaggedAgents = await prisma.agent.findMany({
      where: {
        cluster_id: clusterId,
        OR: [
          { status: "PAUSED_NUDGE" },
          { status: "KILLED_LOOP" },
          { loop_score: { gte: 0.5 } },
          { ram_usage: { gte: 200 } },
        ],
      },
      orderBy: { loop_score: "desc" },
    });

    // Fetch active agents for RAM & CPU meters
    const activeAgents = await prisma.agent.findMany({
      where: {
        cluster_id: clusterId,
        status: "ACTIVE",
      },
      take: 12,
      orderBy: { ram_usage: "desc" },
    });

    return NextResponse.json({
      success: true,
      policy: currentPolicy,
      streamEvents,
      flaggedAgents,
      activeAgents,
      avgLatencyMs: 38,
      p99LatencyMs: 8.2,
    });
  } catch (error) {
    console.error("Guardrails GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve guardrails data." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, agentId, hintText, policy } = body;

    switch (action) {
      case "UPDATE_POLICY": {
        if (policy) {
          currentPolicy = {
            ...currentPolicy,
            ...policy,
          };
        }
        return NextResponse.json({
          success: true,
          message: "Guardrail thresholds and circuit-breaker policy updated.",
          policy: currentPolicy,
        });
      }

      case "SEND_NUDGE": {
        if (!agentId) {
          return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        }

        const agent = await prisma.agent.findUnique({ where: { agent_id: agentId } });
        if (!agent) {
          return NextResponse.json({ error: "Agent not found." }, { status: 404 });
        }

        const hint = hintText || "Bypass foreign-key check temporarily and proceed with commit";

        const updated = await prisma.agent.update({
          where: { agent_id: agentId },
          data: {
            status: "ACTIVE",
            loop_score: 0.04,
            ram_usage: 145.0,
            cpu_usage: 12.5,
            current_task: `Resumed via Human Nudge: "${hint}"`,
            last_heartbeat_at: new Date(),
          },
        });

        // Add event to stream
        streamEvents.unshift({
          id: `evt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          agentId: agent.agent_id,
          agentName: agent.name,
          eventType: "SEMANTIC_REASONING_LOOP",
          similarityScore: agent.loop_score,
          latencyMs: 34,
          actionTaken: "FLAGGED",
          summary: `Human operator supplied hint: "${hint}". Agent loop cleared and resumed.`,
        });

        return NextResponse.json({
          success: true,
          message: `Nudge delivered to ${agent.name}. Resumed active execution.`,
          agent: updated,
        });
      }

      case "THROTTLE_DOWNGRADE": {
        if (!agentId) {
          return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        }

        const agent = await prisma.agent.findUnique({ where: { agent_id: agentId } });
        if (!agent) {
          return NextResponse.json({ error: "Agent not found." }, { status: 404 });
        }

        const updated = await prisma.agent.update({
          where: { agent_id: agentId },
          data: {
            model_tier: "DOWNGRADED_FAST",
            ram_usage: +(agent.ram_usage * 0.6).toFixed(1),
            cpu_usage: +(agent.cpu_usage * 0.5).toFixed(1),
            current_task: "Throttled to fast model (Haiku/Flash) to curb resource consumption",
            last_heartbeat_at: new Date(),
          },
        });

        streamEvents.unshift({
          id: `evt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          agentId: agent.agent_id,
          agentName: agent.name,
          eventType: "MEMORY_GOVERNANCE",
          latencyMs: 28,
          actionTaken: "THROTTLED",
          summary: `${agent.name} downgraded to fast model tier. Memory throttled by 40%.`,
        });

        return NextResponse.json({
          success: true,
          message: `${agent.name} throttled and downgraded to fast leaf-model.`,
          agent: updated,
        });
      }

      case "TRIGGER_KILL_SWITCH": {
        if (!agentId) {
          return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        }

        const agent = await prisma.agent.findUnique({ where: { agent_id: agentId } });
        if (!agent) {
          return NextResponse.json({ error: "Agent not found." }, { status: 404 });
        }

        const killed = await prisma.agent.update({
          where: { agent_id: agentId },
          data: {
            status: "KILLED_LOOP",
            loop_score: 0.99,
            ram_usage: 0.0,
            cpu_usage: 0.0,
            current_task: "Terminated by operator kill switch. 0 tokens consumed.",
            last_heartbeat_at: new Date(),
          },
        });

        streamEvents.unshift({
          id: `evt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          agentId: agent.agent_id,
          agentName: agent.name,
          eventType: "EXACT_TOOL_LOOP",
          latencyMs: 14,
          actionTaken: "KILLED_LOOP",
          summary: `Manual kill switch triggered on ${agent.name}. 0 token burn.`,
        });

        return NextResponse.json({
          success: true,
          message: `Kill switch executed: ${agent.name} halted immediately (0 tokens).`,
          agent: killed,
        });
      }

      case "TEST_MEMORY_SPIKE": {
        // Pick an active agent and simulate a spike to 340MB, then auto-throttle back to 135MB
        let activeAgent = await prisma.agent.findFirst({
          where: { status: "ACTIVE" },
        });

        if (!activeAgent) {
          activeAgent = await prisma.agent.findFirst();
        }

        if (!activeAgent) {
          return NextResponse.json({ error: "No agent available." }, { status: 404 });
        }

        // Simulate auto-governance: RAM spiked to 340MB -> Hypervisor intercepted at 32ms -> clamped to 138MB
        const governedAgent = await prisma.agent.update({
          where: { agent_id: activeAgent.agent_id },
          data: {
            ram_usage: 138.4,
            cpu_usage: 9.5,
            current_task: "Auto-governed: Memory buffer flushed after 340MB spike test.",
            last_heartbeat_at: new Date(),
          },
        });

        streamEvents.unshift({
          id: `evt-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString(),
          agentId: activeAgent.agent_id,
          agentName: activeAgent.name,
          eventType: "MEMORY_GOVERNANCE",
          latencyMs: 32,
          actionTaken: "THROTTLED",
          summary: `Memory spike simulated: ${activeAgent.name} surged to 340MB. Hypervisor clamped memory down to 138MB in 32ms.`,
        });

        return NextResponse.json({
          success: true,
          message: `Memory spike simulated! ${activeAgent.name} spiked to 340MB and was auto-throttled back to 138MB in 32ms.`,
          agent: governedAgent,
        });
      }

      case "EVALUATE_STREAM": {
        const { logs = [], taskProgressPct = 50, agentId } = body;
        const evaluation = evaluateAgentStreamForLoops(logs, taskProgressPct);

        if (agentId && (evaluation.status === "KILLED_LOOP" || evaluation.status === "PAUSED_NUDGE")) {
          try {
            await prisma.agent.update({
              where: { agent_id: agentId },
              data: {
                status: evaluation.status,
                loop_score: evaluation.loopScore,
                ram_usage: evaluation.status === "KILLED_LOOP" ? 0.0 : undefined,
                cpu_usage: evaluation.status === "KILLED_LOOP" ? 0.0 : undefined,
                current_task: evaluation.reason,
                last_heartbeat_at: new Date(),
              },
            });

            streamEvents.unshift({
              id: `evt-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              agentId,
              agentName: agentId,
              eventType: evaluation.loopType === "EXACT_TOOL_LOOP" ? "EXACT_TOOL_LOOP" : "SEMANTIC_REASONING_LOOP",
              latencyMs: evaluation.interceptionMs,
              actionTaken: evaluation.status,
              summary: evaluation.reason,
            });
          } catch (err) {
            console.error("Failed to update agent from stream evaluation:", err);
          }
        }

        return NextResponse.json({
          success: true,
          evaluation,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("Guardrails action error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while processing guardrails action." },
      { status: 500 }
    );
  }
}

