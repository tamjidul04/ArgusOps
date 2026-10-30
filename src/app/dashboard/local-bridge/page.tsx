import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { LocalBridgeClient } from "./LocalBridgeClient";
import { prisma } from "@/lib/prisma";
import { FileMutexLock } from "@/app/api/local-bridge/route";

export const metadata: Metadata = {
  title: "Local PC Bridge & Mutex SDK | ArgusOps v1.1",
  description:
    "Multi-agent local desktop coordinator for Claude, Antigravity, and Hermes with file-locking mutex and zero-trust privacy.",
};

async function LocalBridgeLoader() {
  let localAgents: any[] = [];
  let apiKeys: any[] = [];

  try {
    const cluster = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "LOCAL_PC" },
      include: {
        agents: {
          orderBy: { name: "asc" },
        },
      },
    });

    if (cluster) {
      localAgents = cluster.agents.map((a) => ({
        agent_id: a.agent_id,
        name: a.name,
        agent_type: a.agent_type,
        status: a.status,
        model_tier: a.model_tier,
        ram_usage: a.ram_usage,
        cpu_usage: a.cpu_usage,
        tokens_used: a.tokens_used,
        current_task: a.current_task,
        locked_file_path: a.locked_file_path,
      }));
    }

    const dbKeys = await prisma.apiKey.findMany({
      orderBy: { created_at: "desc" },
    });

    apiKeys = dbKeys.map((k) => ({
      id: k.id,
      label: k.label,
      key_prefix: k.key_prefix,
      masked_key: `${k.key_prefix}••••••••••••${k.key_hash.slice(-4)}`,
      last_used_at: k.last_used_at?.toISOString() || null,
      created_at: k.created_at.toISOString(),
    }));
  } catch (err) {
    console.error("Local bridge initial data error:", err);
  }

  // Fallback defaults
  if (localAgents.length === 0) {
    localAgents = [
      {
        agent_id: "agent_local_antigravity",
        name: "Antigravity Agent",
        agent_type: "ANTIGRAVITY",
        status: "ACTIVE",
        model_tier: "FRONTIER",
        ram_usage: 84.5,
        cpu_usage: 18.2,
        tokens_used: 128500,
        current_task: "Implementing strict dashboard shell geometry and stats visualizer",
        locked_file_path: "src/app/dashboard/page.tsx",
      },
      {
        agent_id: "agent_local_claude",
        name: "Claude Code CLI",
        agent_type: "CLAUDE",
        status: "ACTIVE",
        model_tier: "FRONTIER",
        ram_usage: 92.1,
        cpu_usage: 14.7,
        tokens_used: 94200,
        current_task: "Optimizing low-latency AST interception and semantic loop detector",
        locked_file_path: "src/lib/loop-detector.ts",
      },
      {
        agent_id: "agent_local_hermes",
        name: "Hermes Local Runner",
        agent_type: "HERMES",
        status: "ACTIVE",
        model_tier: "DOWNGRADED_FAST",
        ram_usage: 45.3,
        cpu_usage: 8.4,
        tokens_used: 41200,
        current_task: "Writing integration test suite for subscription upgrades and billing approval queue",
        locked_file_path: "src/tests/billing.spec.ts",
      },
    ];
  }

  const initialLocks: FileMutexLock[] = [
    {
      id: "lck-01",
      filePath: "src/app/dashboard/page.tsx",
      holderAgent: "Antigravity",
      queuedAgent: null,
      status: "LOCKED",
      acquiredAt: "00:01:14 ago",
    },
    {
      id: "lck-02",
      filePath: "src/lib/loop-detector.ts",
      holderAgent: "Claude",
      queuedAgent: null,
      status: "LOCKED",
      acquiredAt: "00:00:42 ago",
    },
    {
      id: "lck-03",
      filePath: "src/tests/billing.spec.ts",
      holderAgent: "Hermes",
      queuedAgent: null,
      status: "LOCKED",
      acquiredAt: "00:02:08 ago",
    },
  ];

  const initialPermissions = {
    monitorProcesses: true,
    enforceMutex: true,
    interceptRedundantApi: true,
    zeroTrustCodePrivacy: true,
  };

  return (
    <LocalBridgeClient
      initialAgents={localAgents}
      initialLocks={initialLocks}
      initialKeys={apiKeys}
      initialPermissions={initialPermissions}
    />
  );
}

export default function LocalBridgePage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center font-mono text-xs text-slate-400 gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-400 animate-ping" />
            <span>Connecting to local PC daemon and mutex registry...</span>
          </div>
        }
      >
        <LocalBridgeLoader />
      </Suspense>
    </DashboardShell>
  );
}

