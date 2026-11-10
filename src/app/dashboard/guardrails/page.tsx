import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import { GuardrailsClient } from "./GuardrailsClient";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { getLatencyStats, getPolicy, listStreamEvents } from "@/lib/control-plane";

export const metadata: Metadata = {
  title: "Loop Detection & Guardrails",
  description:
    "Loop detection incident stream, pause-versus-kill controls, and per-agent memory governance.",
};

async function GuardrailsLoader() {
  const user = await requirePageUser();
  const mine = { cluster: { user_id: user.id } };

  const [policy, events, latency, flaggedAgents, activeAgents] = await Promise.all([
    getPolicy(user.id),
    listStreamEvents(user.id),
    getLatencyStats(user.id),
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
  ]);

  return (
    <GuardrailsClient
      initialPolicy={policy}
      initialStreamEvents={events}
      initialFlaggedAgents={flaggedAgents}
      initialActiveAgents={activeAgents}
      initialLatency={latency}
    />
  );
}

export default function GuardrailsPage() {
  return (
    <DashboardShell>
      <Suspense fallback={<PageLoading label="Loading guardrails" />}>
        <GuardrailsLoader />
      </Suspense>
    </DashboardShell>
  );
}
