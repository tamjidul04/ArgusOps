import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import {
  ClusterDashboardV2Client,
  ClusterTelemetryData,
} from "./ClusterDashboardV2Client";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Agent Cluster Telemetry & Loop Interception | ArgusOps v1.1",
  description:
    "Real-time supervisor orchestrating autonomous nodes, AST recursion traps, and memory bus quota.",
};

async function DashboardDataLoader() {
  let cloudCluster: ClusterTelemetryData | null = null;
  let localCluster: ClusterTelemetryData | null = null;

  try {
    // 1. Fetch Cloud Cluster and 100 agents
    const dbCloud = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "CLOUD" },
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
      where: { environment: "LOCAL_PC" },
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

  // Fallbacks if database had empty tables
  if (!cloudCluster) {
    cloudCluster = {
      cluster_id: "cluster_cloud_useast",
      name: "Enterprise Cloud Swarm us-east",
      environment: "CLOUD",
      active_agents: 2,
      hibernated_agents: 4,
      cache_tokens_saved: 1240000,
      cached_context_hash: "sha256:8f4b23a91e5d7c81f34a0293ebc451",
      agents: [
        {
          agent_id: "agent_01",
          cluster_id: "cluster_cloud_useast",
          name: "Agent #01 (Claude)",
          agent_type: "CLAUDE",
          status: "ACTIVE",
          model_tier: "FRONTIER",
          ram_usage: 320,
          cpu_usage: 12.4,
          tokens_used: 14200,
          current_task: "Compiling AST recursion trap",
          locked_file_path: "src/auth/jwt_session.ts",
          loop_score: 0.02,
          last_heartbeat_at: new Date().toISOString(),
        },
        {
          agent_id: "agent_02",
          cluster_id: "cluster_cloud_useast",
          name: "Agent #02 (Antigravity)",
          agent_type: "ANTIGRAVITY",
          status: "PAUSED_NUDGE",
          model_tier: "FRONTIER",
          ram_usage: 680,
          cpu_usage: 2.1,
          tokens_used: 42100,
          current_task: "fetch_vector_chunks repeated 14x in 8.2ms",
          locked_file_path: "prisma/schema.prisma",
          loop_score: 0.94,
          last_heartbeat_at: new Date().toISOString(),
        },
        {
          agent_id: "agent_03",
          cluster_id: "cluster_cloud_useast",
          name: "Agent #03 (Hermes)",
          agent_type: "HERMES",
          status: "HIBERNATED",
          model_tier: "DOWNGRADED_FAST",
          ram_usage: 45,
          cpu_usage: 0.0,
          tokens_used: 2800,
          current_task: "Standby in zero-token pool",
          locked_file_path: null,
          loop_score: 0.0,
          last_heartbeat_at: new Date().toISOString(),
        },
      ],
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
        fallback={
          <div className="space-y-6 animate-pulse">
            <div className="h-8 bg-slate-200 rounded w-1/3"></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-28 bg-slate-200 rounded-xl"></div>
                  <div className="h-28 bg-slate-200 rounded-xl"></div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="h-24 bg-slate-200 rounded-xl"></div>
                  <div className="h-24 bg-slate-200 rounded-xl"></div>
                  <div className="h-24 bg-slate-200 rounded-xl"></div>
                </div>
              </div>
              <div className="h-56 bg-slate-200 rounded-xl"></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 h-64 bg-slate-200 rounded-xl"></div>
              <div className="h-64 bg-slate-200 rounded-xl"></div>
            </div>
          </div>
        }
      >
        <DashboardDataLoader />
      </Suspense>
    </DashboardShell>
  );
}
