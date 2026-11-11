import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import {
  ClusterDashboardV2Client,
  ClusterTelemetryData,
} from "./ClusterDashboardV2Client";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "Your agents, token balance and what needs you.",
};

async function DashboardDataLoader() {
  const user = await requirePageUser();
  let cloudCluster: ClusterTelemetryData | null = null;
  let localCluster: ClusterTelemetryData | null = null;

  try {
    // 1. Fetch Cloud Cluster and 100 agents
    const dbCloud = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "CLOUD", user_id: user.id },
      include: {
        agents: {
          orderBy: { agent_id: "asc" },
        },
      },
    });

    if (dbCloud) {
      cloudCluster = {
        cluster_id: dbCloud.cluster_id,
        name: dbCloud.name,
        environment: dbCloud.environment,
        active_agents: dbCloud.active_agents,
        hibernated_agents: dbCloud.hibernated_agents,
        cache_tokens_saved: dbCloud.cache_tokens_saved,
        cached_context_hash: dbCloud.cached_context_hash,
        agents: dbCloud.agents.map((a) => ({
          agent_id: a.agent_id,
          cluster_id: a.cluster_id,
          name: a.name,
          agent_type: a.agent_type,
          status: a.status,
          model_tier: a.model_tier,
          ram_usage: a.ram_usage,
          cpu_usage: a.cpu_usage,
          tokens_used: a.tokens_used,
          current_task: a.current_task,
          locked_file_path: a.locked_file_path,
          loop_score: a.loop_score,
          last_heartbeat_at: a.last_heartbeat_at.toISOString(),
        })),
      };
    }

    // 2. Fetch Local PC Cluster and 3 agents
    const dbLocal = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "LOCAL_PC", user_id: user.id },
      include: {
        agents: {
          orderBy: { agent_id: "asc" },
        },
      },
    });

    if (dbLocal) {
      localCluster = {
        cluster_id: dbLocal.cluster_id,
        name: dbLocal.name,
        environment: dbLocal.environment,
        active_agents: dbLocal.active_agents,
        hibernated_agents: dbLocal.hibernated_agents,
        cache_tokens_saved: dbLocal.cache_tokens_saved,
        cached_context_hash: dbLocal.cached_context_hash,
        agents: dbLocal.agents.map((a) => ({
          agent_id: a.agent_id,
          cluster_id: a.cluster_id,
          name: a.name,
          agent_type: a.agent_type,
          status: a.status,
          model_tier: a.model_tier,
          ram_usage: a.ram_usage,
          cpu_usage: a.cpu_usage,
          tokens_used: a.tokens_used,
          current_task: a.current_task,
          locked_file_path: a.locked_file_path,
          loop_score: a.loop_score,
          last_heartbeat_at: a.last_heartbeat_at.toISOString(),
        })),
      };
    }
  } catch (error) {
    console.error("Dashboard data loader error:", error);
  }

  // Accounts without a cloud cluster get an honest empty one, never invented agents.
  if (!cloudCluster) {
    cloudCluster = {
      cluster_id: "",
      name: "No cloud cluster yet",
      environment: "CLOUD",
      active_agents: 0,
      hibernated_agents: 0,
      cache_tokens_saved: 0,
      cached_context_hash: null,
      agents: [],
    };
  }

  return (
    <ClusterDashboardV2Client
      initialCloudCluster={cloudCluster}
      initialLocalCluster={localCluster}
    />
  );
}

export default function DashboardPage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={<PageLoading label="Loading overview" />}
      >
        <DashboardDataLoader />
      </Suspense>
    </DashboardShell>
  );
}
