import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  orchestrateProjectTask,
  SubTaskModule,
} from "@/lib/master-orchestrator";

export type SubTaskItem = SubTaskModule;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, totalClusterSize = 100, clusterId = "cluster_cloud_useast" } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "A software project or multi-agent prompt is required." },
        { status: 400 }
      );
    }

    const trimmedPrompt = prompt.trim();

    // Execute Master Orchestrator Brain (Section 4.1 & 5.1)
    const plan = await orchestrateProjectTask(trimmedPrompt, totalClusterSize);

    // Persist to SQLite Database via Prisma
    // 1. Update the cluster's active & hibernated counts and context cache
    await prisma.clusterAndWorkspace.updateMany({
      where: { cluster_id: clusterId },
      data: {
        active_agents: plan.concurrency.activeAgents,
        hibernated_agents: plan.concurrency.hibernatedAgents,
        cached_context_hash: plan.cachedContextHash,
        cache_tokens_saved: plan.savings.totalTokensSaved,
      },
    });

    // 2. Update agent statuses in cluster
    const allAgents = await prisma.agent.findMany({
      where: { cluster_id: clusterId },
      orderBy: { agent_id: "asc" },
    });

    if (allAgents.length > 0) {
      for (let i = 0; i < allAgents.length; i++) {
        const agent = allAgents[i];
        const updateData = plan.prismaPayload.agentBatchUpdates[i];
        if (updateData) {
          await prisma.agent.update({
            where: { agent_id: agent.agent_id },
            data: {
              status: updateData.status,
              model_tier: updateData.model_tier,
              ram_usage: updateData.ram_usage,
              cpu_usage: updateData.cpu_usage,
              current_task: updateData.current_task,
              locked_file_path: updateData.locked_file_path,
              loop_score: updateData.status === "ACTIVE" ? +(0.02 + (i % 4) * 0.01).toFixed(2) : 0.0,
            },
          });
        }
      }
    }

    // 3. Save into Tasks_And_Logs
    const taskLog = await prisma.taskAndLog.create({
      data: {
        cluster_id: clusterId,
        prompt_summary: plan.prismaPayload.taskLogCreate.prompt_summary,
        complexity_score: plan.prismaPayload.taskLogCreate.complexity_score,
        assigned_agents: plan.prismaPayload.taskLogCreate.assigned_agents,
        hibernated_count: plan.prismaPayload.taskLogCreate.hibernated_count,
        tokens_saved: plan.prismaPayload.taskLogCreate.tokens_saved,
        loop_incidents: plan.prismaPayload.taskLogCreate.loop_incidents,
        interception_ms: plan.prismaPayload.taskLogCreate.interception_ms,
        status: plan.prismaPayload.taskLogCreate.status,
      },
    });

    return NextResponse.json({
      success: true,
      taskId: taskLog.task_id,
      prompt: plan.prompt,
      complexity_score: plan.complexity.score,
      cluster_size: plan.concurrency.totalClusterAgents,
      active_agents: plan.concurrency.activeAgents,
      hibernated_agents: plan.concurrency.hibernatedAgents,
      savings_percentage: plan.savings.savingsPercentage,
      tokens_saved: plan.savings.totalTokensSaved,
      unthrottled_cost: plan.savings.unthrottledCostUsd,
      right_sized_cost: plan.savings.rightSizedCostUsd,
      cost_saved: plan.savings.costSavedUsd,
      context_cache_hash: plan.cachedContextHash,
      context_cache_tokens: plan.savings.tokensSavedByCache,
      downgraded_model_percentage: plan.savings.downgradedModelPercentage,
      subtasks: plan.subtasks,
      message: `Project decomposed into ${plan.subtasks.length} sub-tasks. ${plan.concurrency.activeAgents} agents activated, ${plan.concurrency.hibernatedAgents} placed into Zero-Token hibernation.`,
    });
  } catch (error) {
    console.error("Orchestrator decomposition error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while decomposing project task." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clusterId = searchParams.get("clusterId") || "cluster_cloud_useast";

    const cluster = await prisma.clusterAndWorkspace.findUnique({
      where: { cluster_id: clusterId },
      include: {
        tasks: {
          orderBy: { created_at: "desc" },
          take: 5,
        },
      },
    });

    return NextResponse.json({
      success: true,
      cluster,
    });
  } catch (error) {
    console.error("Orchestrator GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve orchestrator state." },
      { status: 500 }
    );
  }
}
