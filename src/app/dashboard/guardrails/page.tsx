import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { GuardrailsClient } from "./GuardrailsClient";
import { prisma } from "@/lib/prisma";
import { GuardrailPolicy, StreamEvent } from "@/app/api/guardrails/route";

export const metadata: Metadata = {
  title: "Loop Detection & Resource Guardrails | ArgusOps v1.1",
  description:
    "Live loop detection stream inspector, human-in-the-loop nudge vs hard circuit breaker controls, and per-agent RAM & CPU governance.",
};

async function GuardrailsLoader() {
  const initialPolicy: GuardrailPolicy = {
    maxConsecutiveRetries: 3,
    semanticSimilarityThreshold: 0.88,
    nudgeCompletionThreshold: 80,
    maxRamPerAgentMb: 250,
    autoThrottleEnabled: true,
  };

  const initialStreamEvents: StreamEvent[] = [
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
      summary:
        "Tool call failed with identical ECONNRESET error 4x. Hard circuit breaker tripped at 38ms.",
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
      summary:
        "Cosine similarity 0.94 detected repeated reasoning cycle on migration alter statement. Task is 92% complete: Paused for human nudge.",
    },
    {
      id: "evt-03",
      timestamp: "10:12:15",
      agentId: "agent_cloud_active_12",
      agentName: "Cloud-Worker-12",
      eventType: "MEMORY_GOVERNANCE",
      latencyMs: 29,
      actionTaken: "THROTTLED",
      summary:
        "Resident memory reached 268MB (cap: 250MB). Memory bus governor throttled AST buffer down to 142MB in 29ms.",
    },
  ];

  let flaggedAgents: any[] = [];
  let activeAgents: any[] = [];

  try {
    flaggedAgents = await prisma.agent.findMany({
      where: {
        OR: [
          { status: "PAUSED_NUDGE" },
          { status: "KILLED_LOOP" },
          { loop_score: { gte: 0.5 } },
          { ram_usage: { gte: 180 } },
        ],
      },
      orderBy: { loop_score: "desc" },
    });

    activeAgents = await prisma.agent.findMany({
      where: { status: "ACTIVE" },
      take: 12,
      orderBy: { ram_usage: "desc" },
    });
  } catch (err) {
    console.error("Guardrails initial data fetch error:", err);
  }

  return (
    <GuardrailsClient
      initialPolicy={initialPolicy}
      initialStreamEvents={initialStreamEvents}
      initialFlaggedAgents={flaggedAgents}
      initialActiveAgents={activeAgents}
    />
  );
}

export default function GuardrailsPage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center font-mono text-xs text-slate-400 gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-400 animate-ping" />
            <span>Loading loop detection streams &amp; resource guardrails...</span>
          </div>
        }
      >
        <GuardrailsLoader />
      </Suspense>
    </DashboardShell>
  );
}

