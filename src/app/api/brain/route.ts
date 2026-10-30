import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getHostHardwareTelemetry,
  scanLocalCodingProcesses,
  checkRamGovernance,
} from "@/lib/hardware-monitor";
import {
  orchestrateProjectTask,
} from "@/lib/master-orchestrator";
import {
  evaluateAgentStreamForLoops,
  verifyAndAcquireFileMutex,
} from "@/lib/guardrails-engine";

/**
 * ArgusOps Central Brain API Route
 * 
 * Step 4 of Core Backend Brain:
 * Direct Prisma database bridge connecting hardware-monitor.ts,
 * master-orchestrator.ts, and guardrails-engine.ts.
 */

// ============================================================================
// GET /api/brain
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    // 1. Collect real host PC hardware metrics
    const hardware = getHostHardwareTelemetry();

    // 2. Scan host PC for real running coding processes (Antigravity, Code, node, claude, hermes)
    const scanResult = await scanLocalCodingProcesses();

    // 3. Update the LOCAL_PC cluster's agents in Prisma with the real host PC telemetry
    const localClusterRecord = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "LOCAL_PC" },
    });

    if (localClusterRecord) {
      for (const slot of scanResult.agents) {
        await prisma.agent.updateMany({
          where: {
            cluster_id: localClusterRecord.cluster_id,
            agent_type: slot.agent_type,
          },
          data: {
            ram_usage: slot.ram_usage,
            cpu_usage: slot.cpu_usage,
            status: slot.status,
            current_task: slot.current_task,
            locked_file_path: slot.locked_file_path,
            last_heartbeat_at: new Date(),
          },
        });
      }
    }

    // 4. Fetch complete database entities: Cloud & Local Clusters, Tasks, and User Wallet
    const [cloudCluster, localCluster, activeUser] = await Promise.all([
      prisma.clusterAndWorkspace.findFirst({
        where: { environment: "CLOUD" },
        include: {
          agents: {
            orderBy: { agent_id: "asc" },
          },
          tasks: {
            orderBy: { created_at: "desc" },
            take: 10,
          },
        },
      }),
      prisma.clusterAndWorkspace.findFirst({
        where: { environment: "LOCAL_PC" },
        include: {
          agents: {
            orderBy: { agent_id: "asc" },
          },
          tasks: {
            orderBy: { created_at: "desc" },
            take: 5,
          },
        },
      }),
      prisma.user.findFirst({
        where: { role: "USER" },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      }),
    ]);

    // 5. Measure live guardrails engine interception latency
    const liveBench = evaluateAgentStreamForLoops(
      [
        "Hypervisor telemetry heartbeat poll",
        "AST symbol tree cache synchronized with zero-trust IPC socket",
      ],
      100
    );

    return NextResponse.json({
      success: true,
      hardware: {
        totalRamGb: hardware.totalRamGb,
        usedRamGb: hardware.usedRamGb,
        freeRamGb: hardware.freeRamGb,
        ramUsagePercent: hardware.ramUsagePercent,
        cpuLoadPercent: hardware.cpuLoadPercent,
        daemonMemoryMb: hardware.daemonMemoryMb,
        daemonWithinBudget: hardware.daemonWithinBudget,
        cpuCores: hardware.cpuCores,
        cpuModel: hardware.cpuModel,
        platform: hardware.platform,
        uptimeSeconds: hardware.uptimeSeconds,
      },
      cloudCluster,
      localCluster,
      wallet: activeUser?.subscription || null,
      interceptionLatencyMs: liveBench.interceptionMs,
      scanResult: {
        totalDetectedProcesses: scanResult.totalDetectedProcesses,
        detectedProcesses: scanResult.detectedProcesses.slice(0, 10),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET /api/brain error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve brain telemetry and cluster state." },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/brain
// ============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      return NextResponse.json(
        { error: "A valid 'action' parameter is required in request body." },
        { status: 400 }
      );
    }

    switch (action) {
      // ----------------------------------------------------------------------
      // Action 1: DECOMPOSE_TASK
      // ----------------------------------------------------------------------
      case "DECOMPOSE_TASK": {
        const prompt = typeof body.prompt === "string" && body.prompt.trim().length > 0
          ? body.prompt.trim()
          : "Architect and orchestrate enterprise microservice cluster with OAuth2, PostgreSQL, and test suite";

        const cloudCluster = await prisma.clusterAndWorkspace.findFirst({
          where: { environment: "CLOUD" },
        });

        if (!cloudCluster) {
          return NextResponse.json({ error: "Cloud cluster not found." }, { status: 404 });
        }

        // 1. Run master orchestrator brain
        const plan = await orchestrateProjectTask(prompt, 100);

        // 2. Update Cloud Cluster's active & hibernated counts and context cache
        await prisma.clusterAndWorkspace.update({
          where: { cluster_id: cloudCluster.cluster_id },
          data: {
            active_agents: plan.concurrency.activeAgents,
            hibernated_agents: plan.concurrency.hibernatedAgents,
            cached_context_hash: plan.cachedContextHash,
            cache_tokens_saved: plan.savings.totalTokensSaved,
          },
        });

        // 3. Update the 100 Agent rows in Cloud cluster
        const cloudAgents = await prisma.agent.findMany({
          where: { cluster_id: cloudCluster.cluster_id },
          orderBy: { agent_id: "asc" },
        });

        for (let i = 0; i < cloudAgents.length; i++) {
          const updateData = plan.prismaPayload.agentBatchUpdates[i];
          if (updateData) {
            await prisma.agent.update({
              where: { agent_id: cloudAgents[i].agent_id },
              data: {
                status: updateData.status,
                model_tier: updateData.model_tier,
                ram_usage: updateData.ram_usage,
                cpu_usage: updateData.cpu_usage,
                current_task: updateData.current_task,
                locked_file_path: updateData.locked_file_path,
                loop_score: updateData.status === "ACTIVE" ? +(0.02 + (i % 4) * 0.01).toFixed(2) : 0.0,
                last_heartbeat_at: new Date(),
              },
            });
          }
        }

        // 4. Deduct realistic token amount from user's wallet
        const activeUser = await prisma.user.findFirst({
          where: { role: "USER" },
          include: { subscription: true },
        });

        const tokensToDeduct = 18500;
        let newFreeTokens = 0;
        let newPaidTokens = 0;

        if (activeUser?.subscription) {
          const currentFree = activeUser.subscription.free_tokens;
          const currentPaid = activeUser.subscription.paid_tokens;

          if (currentFree >= tokensToDeduct) {
            newFreeTokens = currentFree - tokensToDeduct;
            newPaidTokens = currentPaid;
          } else {
            const remainder = tokensToDeduct - currentFree;
            newFreeTokens = 0;
            newPaidTokens = Math.max(0, currentPaid - remainder);
          }

          await prisma.subscriptionAndWallet.update({
            where: { id: activeUser.subscription.id },
            data: {
              free_tokens: newFreeTokens,
              paid_tokens: newPaidTokens,
            },
          });
        }

        // 5. Save task log into Tasks_And_Logs
        const taskLog = await prisma.taskAndLog.create({
          data: {
            cluster_id: cloudCluster.cluster_id,
            prompt_summary: plan.prompt,
            complexity_score: plan.complexity.score,
            assigned_agents: plan.concurrency.activeAgents,
            hibernated_count: plan.concurrency.hibernatedAgents,
            tokens_saved: plan.savings.totalTokensSaved,
            loop_incidents: 0,
            interception_ms: 28,
            status: "RUNNING",
          },
        });

        return NextResponse.json({
          success: true,
          action: "DECOMPOSE_TASK",
          message: `Task decomposed into ${plan.subtasks.length} modules. ${plan.concurrency.activeAgents} active agents provisioned, ${plan.concurrency.hibernatedAgents} placed in Zero-Token hibernation. ${tokensToDeduct.toLocaleString()} tokens deducted from wallet.`,
          plan,
          taskLog,
          tokensDeducted: tokensToDeduct,
          updatedWallet: {
            free_tokens: newFreeTokens,
            paid_tokens: newPaidTokens,
          },
        });
      }

      // ----------------------------------------------------------------------
      // Action 2: TRIGGER_ROGUE_LOOP
      // ----------------------------------------------------------------------
      case "TRIGGER_ROGUE_LOOP": {
        // Pick an active agent (or specified agentId)
        let targetAgent = null;
        if (body.agentId) {
          targetAgent = await prisma.agent.findUnique({ where: { agent_id: body.agentId } });
        }
        if (!targetAgent) {
          targetAgent = await prisma.agent.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { ram_usage: "desc" },
          });
        }

        if (!targetAgent) {
          return NextResponse.json({ error: "No active agent found to simulate loop on." }, { status: 404 });
        }

        // Feed repeating tool error logs into loop detector at 42% progress (<80%)
        const rogueLogs = [
          "Parsing OpenAPI service boundary...",
          "fetch_vector_chunks(offset=2048): ECONNRESET connection reset by peer",
          "fetch_vector_chunks(offset=2048): ECONNRESET connection reset by peer",
          "fetch_vector_chunks(offset=2048): ECONNRESET connection reset by peer",
        ];
        const evalResult = evaluateAgentStreamForLoops(rogueLogs, 42);

        // Trip the circuit breaker in Prisma
        const killedAgent = await prisma.agent.update({
          where: { agent_id: targetAgent.agent_id },
          data: {
            status: "KILLED_LOOP",
            ram_usage: 0.0,
            cpu_usage: 0.0,
            loop_score: 0.98,
            current_task: `Circuit breaker tripped at ${evalResult.interceptionMs}ms due to repeated tool errors. Terminated to zero token burn.`,
            locked_file_path: null,
            last_heartbeat_at: new Date(),
          },
        });

        // Increment loop incidents on the latest cluster task
        const latestTask = await prisma.taskAndLog.findFirst({
          where: { cluster_id: targetAgent.cluster_id },
          orderBy: { created_at: "desc" },
        });

        if (latestTask) {
          await prisma.taskAndLog.update({
            where: { task_id: latestTask.task_id },
            data: {
              loop_incidents: { increment: 1 },
            },
          });
        }

        return NextResponse.json({
          success: true,
          action: "TRIGGER_ROGUE_LOOP",
          message: `Circuit breaker tripped in ${evalResult.interceptionMs}ms! ${killedAgent.name} terminated (0 RAM, 0 CPU). Loop incident incremented.`,
          agent: killedAgent,
          evaluation: evalResult,
        });
      }

      // ----------------------------------------------------------------------
      // Action 3: TRIGGER_HUMAN_NUDGE
      // ----------------------------------------------------------------------
      case "TRIGGER_HUMAN_NUDGE": {
        let targetAgent = null;
        if (body.agentId) {
          targetAgent = await prisma.agent.findUnique({ where: { agent_id: body.agentId } });
        }
        if (!targetAgent) {
          targetAgent = await prisma.agent.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { agent_id: "asc" },
          });
        }

        if (!targetAgent) {
          return NextResponse.json({ error: "No active agent found to nudge." }, { status: 404 });
        }

        // Simulate agent at 91% completion hitting a semantic paraphrasing loop
        const reasoningLogs = [
          "I need to alter the database schema to drop the foreign key constraint before committing.",
          "Attempting to alter the database schema to drop the foreign key constraint before committing.",
        ];
        const evalResult = evaluateAgentStreamForLoops(reasoningLogs, 91);

        // Update agent to PAUSED_NUDGE in Prisma
        const nudgedAgent = await prisma.agent.update({
          where: { agent_id: targetAgent.agent_id },
          data: {
            status: "PAUSED_NUDGE",
            loop_score: 0.89,
            ram_usage: 198.4,
            cpu_usage: 1.8,
            current_task: "Refactoring database migration scripts (91% complete, awaiting human confirmation)",
            locked_file_path: "prisma/migrations/20261030_tenant_schema.sql",
            last_heartbeat_at: new Date(),
          },
        });

        return NextResponse.json({
          success: true,
          action: "TRIGGER_HUMAN_NUDGE",
          message: `Human-in-the-Loop Nudge alert triggered in ${evalResult.interceptionMs}ms! ${nudgedAgent.name} is 91% complete: Paused with amber status for operator confirmation.`,
          agent: nudgedAgent,
          evaluation: evalResult,
        });
      }

      // ----------------------------------------------------------------------
      // Action 4: RESOLVE_NUDGE
      // ----------------------------------------------------------------------
      case "RESOLVE_NUDGE": {
        const { agentId, decision = "RESUME", hintText } = body;

        let agent = null;
        if (agentId) {
          agent = await prisma.agent.findUnique({ where: { agent_id: agentId } });
        }
        if (!agent) {
          agent = await prisma.agent.findFirst({
            where: { status: "PAUSED_NUDGE" },
          });
        }

        if (!agent) {
          return NextResponse.json({ error: "No agent in PAUSED_NUDGE status found to resolve." }, { status: 404 });
        }

        let updatedAgent = null;
        if (decision === "KILL") {
          updatedAgent = await prisma.agent.update({
            where: { agent_id: agent.agent_id },
            data: {
              status: "KILLED_LOOP",
              loop_score: 0.99,
              ram_usage: 0.0,
              cpu_usage: 0.0,
              current_task: "Terminated by operator decision during human nudge review.",
              locked_file_path: null,
              last_heartbeat_at: new Date(),
            },
          });
        } else {
          // Default: RESUME
          const hint = hintText || "Commit without foreign-key check and finalize step";
          updatedAgent = await prisma.agent.update({
            where: { agent_id: agent.agent_id },
            data: {
              status: "ACTIVE",
              loop_score: 0.05,
              ram_usage: 142.5,
              cpu_usage: 12.0,
              current_task: `Resumed via Human Nudge: "${hint}"`,
              last_heartbeat_at: new Date(),
            },
          });
        }

        return NextResponse.json({
          success: true,
          action: "RESOLVE_NUDGE",
          decision,
          message: decision === "KILL"
            ? `${agent.name} terminated by operator command.`
            : `${agent.name} resumed with cleared loop score (0.05). Execution in progress.`,
          agent: updatedAgent,
        });
      }

      // ----------------------------------------------------------------------
      // Action 5: TEST_FILE_MUTEX
      // ----------------------------------------------------------------------
      case "TEST_FILE_MUTEX": {
        const targetPath = body.targetFilePath || "src/app/dashboard/page.tsx";

        // Query active agents in database to form active mutex records
        const allActiveAgents = await prisma.agent.findMany({
          where: {
            OR: [
              { agent_type: "ANTIGRAVITY" },
              { agent_type: "CLAUDE" },
              { agent_type: "HERMES" },
            ],
          },
        });

        const antigravity = allActiveAgents.find((a) => a.agent_type === "ANTIGRAVITY");
        const claude = allActiveAgents.find((a) => a.agent_type === "CLAUDE");

        // Ensure Antigravity currently holds the target lock
        if (antigravity) {
          await prisma.agent.update({
            where: { agent_id: antigravity.agent_id },
            data: {
              locked_file_path: targetPath,
              current_task: `Holding exclusive write lock on ${targetPath}`,
            },
          });
        }

        // Run mutex verification: Claude attempts to edit the locked file
        const mutexAgents = [
          {
            agent_id: antigravity?.agent_id || "agent_local_antigravity",
            name: antigravity?.name || "Antigravity Agent",
            locked_file_path: targetPath,
          },
          {
            agent_id: claude?.agent_id || "agent_local_claude",
            name: claude?.name || "Claude Agent",
            locked_file_path: null,
          },
        ];

        const mutexResult = verifyAndAcquireFileMutex(
          mutexAgents,
          claude?.agent_id || "agent_local_claude",
          targetPath
        );

        // Automatically reroute Claude to an unlocked module file
        const reroutedFilePath = "src/lib/loop-detector.ts";
        let updatedClaude = null;

        if (claude) {
          updatedClaude = await prisma.agent.update({
            where: { agent_id: claude.agent_id },
            data: {
              locked_file_path: reroutedFilePath,
              current_task: `Write collision on '${targetPath}' blocked in ${mutexResult.interceptionMs}ms! Rerouted to unlocked module: ${reroutedFilePath}`,
              last_heartbeat_at: new Date(),
            },
          });
        }

        return NextResponse.json({
          success: true,
          action: "TEST_FILE_MUTEX",
          message: `Collision intercepted in ${mutexResult.interceptionMs}ms! Claude attempted to overwrite '${targetPath}'. Mutex blocked collision and rerouted Claude to '${reroutedFilePath}'. 0 code lost.`,
          mutexResult,
          reroutedAgent: updatedClaude,
          lockedHolder: antigravity?.name || "Antigravity Agent",
          lockedFilePath: targetPath,
        });
      }

      // ----------------------------------------------------------------------
      // Action 6: THROTTLE_RAM_SPIKE
      // ----------------------------------------------------------------------
      case "THROTTLE_RAM_SPIKE": {
        // Run checkRamGovernance on an agent with elevated memory
        let spikeAgent = await prisma.agent.findFirst({
          where: {
            status: "ACTIVE",
            ram_usage: { gte: 250 },
          },
        });

        if (!spikeAgent) {
          // Select highest RAM active agent and simulate elevated memory to test governance
          spikeAgent = await prisma.agent.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { ram_usage: "desc" },
          });
        }

        if (!spikeAgent) {
          return NextResponse.json({ error: "No active agent found to govern." }, { status: 404 });
        }

        const simulatedSpikeMb = 340.0;
        const taskComplexity = 30; // Low complexity task (<40)
        const governance = checkRamGovernance(simulatedSpikeMb, taskComplexity);

        // Throttle ram_usage back down to 64MB and downgrade to DOWNGRADED_FAST
        const throttledAgent = await prisma.agent.update({
          where: { agent_id: spikeAgent.agent_id },
          data: {
            ram_usage: 64.0,
            cpu_usage: 6.5,
            model_tier: "DOWNGRADED_FAST",
            current_task: `Auto-governed: Memory spiked to ${simulatedSpikeMb}MB (cap: 250MB). Clamped to 64MB and downgraded to DOWNGRADED_FAST.`,
            last_heartbeat_at: new Date(),
          },
        });

        return NextResponse.json({
          success: true,
          action: "THROTTLE_RAM_SPIKE",
          message: `Memory spike governed! ${throttledAgent.name} spiked to ${simulatedSpikeMb}MB (cap: 250MB). Hypervisor clamped RAM to 64MB and downgraded model to DOWNGRADED_FAST.`,
          governance,
          agent: throttledAgent,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown brain action: '${action}'. Supported actions: DECOMPOSE_TASK, TRIGGER_ROGUE_LOOP, TRIGGER_HUMAN_NUDGE, RESOLVE_NUDGE, TEST_FILE_MUTEX, THROTTLE_RAM_SPIKE.` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("POST /api/brain error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while executing brain action." },
      { status: 500 }
    );
  }
}

