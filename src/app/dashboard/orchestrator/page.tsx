import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { OrchestratorClient } from "./OrchestratorClient";
import { prisma } from "@/lib/prisma";
import { SubTaskItem } from "@/app/api/orchestrator/route";

export const metadata: Metadata = {
  title: "Master Orchestrator & Task Decomposition | ArgusOps v1.1",
  description:
    "Master Agentic AI task triage, dynamic 100-to-30 concurrency right-sizing, leaf model router, and AST memory caching.",
};

async function OrchestratorLoader() {
  let prompt = "Migrate auth service to multi-tenant schema, index workspace vectors, and write e2e tests.";
  let activeAgents = 30;
  let hibernatedAgents = 70;
  let tokensSaved = 11000000;
  let contextHash = "sha256:8f4b23a91e5d7c81f";

  try {
    const cluster = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "CLOUD" },
      include: {
        tasks: {
          orderBy: { created_at: "desc" },
          take: 1,
        },
      },
    });

    if (cluster) {
      activeAgents = cluster.active_agents || 30;
      hibernatedAgents = cluster.hibernated_agents || 70;
      tokensSaved = cluster.cache_tokens_saved || 11000000;
      if (cluster.cached_context_hash) contextHash = cluster.cached_context_hash;
      if (cluster.tasks.length > 0) {
        prompt = cluster.tasks[0].prompt_summary;
      }
    }
  } catch (err) {
    console.error("Orchestrator initial data error:", err);
  }

  const initialSubtasks: SubTaskItem[] = [
    {
      step: "01",
      subtask: "Database Schema Migration",
      assigned_agents: "Claude (#01-#10)",
      agent_count: 10,
      routed_model: "Sonnet 3.7",
      model_tier: "FRONTIER",
      target_path: "db/migrations/schema.sql",
      tokens: 18400,
      state: "Done",
    },
    {
      step: "02",
      subtask: "Vector RAG Indexing",
      assigned_agents: "Antigravity (#11-#20)",
      agent_count: 10,
      routed_model: "Haiku (Downgraded)",
      model_tier: "DOWNGRADED_FAST",
      target_path: "src/rag/index.ts",
      tokens: 12100,
      state: "Run",
    },
    {
      step: "03",
      subtask: "Unit & E2E Test Suite",
      assigned_agents: "Hermes (#21-#30)",
      agent_count: 10,
      routed_model: "Local LLM (Router)",
      model_tier: "DOWNGRADED_FAST",
      target_path: "tests/auth.spec.ts",
      tokens: 4200,
      state: "Run",
    },
  ];

  return (
    <OrchestratorClient
      initialPrompt={prompt}
      initialSubtasks={initialSubtasks}
      initialActiveAgents={activeAgents}
      initialHibernatedAgents={hibernatedAgents}
      initialTokensSaved={tokensSaved}
      initialContextCache={contextHash}
    />
  );
}

export default function OrchestratorPage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center font-mono text-xs text-slate-400 gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-400 animate-ping" />
            <span>Loading Master Orchestrator &amp; Task Triage DAG...</span>
          </div>
        }
      >
        <OrchestratorLoader />
      </Suspense>
    </DashboardShell>
  );
}

