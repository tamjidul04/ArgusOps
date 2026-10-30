import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, clusterId, agentId, targetStatus } = body;

    const targetClusterId = clusterId || "cluster_cloud_useast";

    switch (action) {
      case "SIMULATE_ROGUE_LOOP": {
        // Find an active agent in this cluster
        let targetAgent = agentId
          ? await prisma.agent.findUnique({ where: { agent_id: agentId } })
          : await prisma.agent.findFirst({
              where: {
                cluster_id: targetClusterId,
                status: "ACTIVE",
              },
              orderBy: { agent_id: "desc" },
            });

        if (!targetAgent) {
          // If no active agent, find any non-killed agent
          targetAgent = await prisma.agent.findFirst({
            where: { cluster_id: targetClusterId },
          });
        }

        if (!targetAgent) {
          return NextResponse.json(
            { error: "No agent found in this cluster to simulate loop." },
            { status: 404 }
          );
        }

        // Trip circuit breaker
        const updatedAgent = await prisma.agent.update({
          where: { agent_id: targetAgent.agent_id },
          data: {
            status: "KILLED_LOOP",
            loop_score: 0.99,
            ram_usage: 0.0,
            cpu_usage: 0.0,
            current_task:
              "Scraping API endpoints (circuit breaker tripped in 38ms due to repeated tool error)",
            last_heartbeat_at: new Date(),
          },
        });

        // Recalculate counts
        const activeCount = await prisma.agent.count({
          where: { cluster_id: targetClusterId, status: "ACTIVE" },
        });
        const hibernatedCount = await prisma.agent.count({
          where: { cluster_id: targetClusterId, status: "HIBERNATED" },
        });

        await prisma.clusterAndWorkspace.update({
          where: { cluster_id: targetClusterId },
          data: {
            active_agents: activeCount,
            hibernated_agents: hibernatedCount,
          },
        });

        // Record incident in task logs
        await prisma.taskAndLog.create({
          data: {
            cluster_id: targetClusterId,
            prompt_summary: `Rogue infinite loop intercepted on ${targetAgent.name}. Tool call repeated 14x in 8.2ms.`,
            complexity_score: 95,
            assigned_agents: activeCount,
            hibernated_count: hibernatedCount,
            tokens_saved: 412000,
            loop_incidents: 1,
            interception_ms: 38,
            status: "KILLED_LOOP",
          },
        });

        return NextResponse.json({
          success: true,
          message: `Circuit breaker tripped! ${targetAgent.name} terminated at 38ms (412,000 tokens saved).`,
          agent: updatedAgent,
        });
      }

      case "APPROVE_NUDGE": {
        // Find paused agent
        const pausedAgent = agentId
          ? await prisma.agent.findUnique({ where: { agent_id: agentId } })
          : await prisma.agent.findFirst({
              where: {
                cluster_id: targetClusterId,
                status: "PAUSED_NUDGE",
              },
            });

        if (!pausedAgent) {
          return NextResponse.json(
            { error: "No agent is currently paused awaiting human confirmation." },
            { status: 404 }
          );
        }

        const resumedAgent = await prisma.agent.update({
          where: { agent_id: pausedAgent.agent_id },
          data: {
            status: "ACTIVE",
            loop_score: 0.04,
            ram_usage: 148.5,
            cpu_usage: 14.2,
            current_task:
              "Resumed after human confirmation: Database migration scripts completed successfully.",
            last_heartbeat_at: new Date(),
          },
        });

        const activeCount = await prisma.agent.count({
          where: { cluster_id: targetClusterId, status: "ACTIVE" },
        });

        await prisma.clusterAndWorkspace.update({
          where: { cluster_id: targetClusterId },
          data: { active_agents: activeCount },
        });

        return NextResponse.json({
          success: true,
          message: `Nudge approved: ${pausedAgent.name} resumed with active quota.`,
          agent: resumedAgent,
        });
      }

      case "KILL_PAUSED": {
        const pausedAgent = agentId
          ? await prisma.agent.findUnique({ where: { agent_id: agentId } })
          : await prisma.agent.findFirst({
              where: {
                cluster_id: targetClusterId,
                status: "PAUSED_NUDGE",
              },
            });

        if (!pausedAgent) {
          return NextResponse.json(
            { error: "No agent is currently paused awaiting human confirmation." },
            { status: 404 }
          );
        }

        const killedAgent = await prisma.agent.update({
          where: { agent_id: pausedAgent.agent_id },
          data: {
            status: "KILLED_LOOP",
            loop_score: 0.95,
            ram_usage: 0.0,
            cpu_usage: 0.0,
            current_task: "Terminated by operator from human review queue.",
            last_heartbeat_at: new Date(),
          },
        });

        return NextResponse.json({
          success: true,
          message: `Operator terminated ${pausedAgent.name}.`,
          agent: killedAgent,
        });
      }

      case "AUTO_RIGHT_SIZE": {
        // Reset and right-size the cluster
        if (targetClusterId === "cluster_cloud_useast") {
          const allAgents = await prisma.agent.findMany({
            where: { cluster_id: targetClusterId },
            orderBy: { agent_id: "asc" },
          });

          // Right size: 28 Active, 1 Paused, 1 Killed, 70 Hibernated
          for (let i = 0; i < allAgents.length; i++) {
            const agent = allAgents[i];
            let status = "HIBERNATED";
            let ram = 0.0;
            let cpu = 0.0;
            let task = "Hibernated in zero-token standby pool by Master Hypervisor";

            if (i < 28) {
              status = "ACTIVE";
              ram = +(120 + Math.sin(i + 1) * 35).toFixed(1);
              cpu = +(15 + Math.cos(i + 1) * 12).toFixed(1);
              task = "Executing right-sized subtask in active cluster";
            } else if (i === 28) {
              status = "PAUSED_NUDGE";
              ram = 198.4;
              cpu = 1.8;
              task =
                "Refactoring database migration scripts (92% complete, awaiting human confirmation)";
            } else if (i === 29) {
              status = "KILLED_LOOP";
              task =
                "Scraping API endpoints (circuit breaker tripped at 38ms due to repeated tool error)";
            }

            await prisma.agent.update({
              where: { agent_id: agent.agent_id },
              data: {
                status,
                ram_usage: ram,
                cpu_usage: cpu,
                current_task: task,
                loop_score: status === "KILLED_LOOP" ? 0.99 : status === "PAUSED_NUDGE" ? 0.68 : 0.03,
              },
            });
          }

          await prisma.clusterAndWorkspace.update({
            where: { cluster_id: targetClusterId },
            data: {
              active_agents: 28,
              hibernated_agents: 70,
              cache_tokens_saved: 4820000,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: "Cluster successfully right-sized: 28 Active, 70 Zero-Token Hibernated, 1 Paused, 1 Killed.",
        });
      }

      case "TOGGLE_AGENT_STATUS": {
        if (!agentId || !targetStatus) {
          return NextResponse.json(
            { error: "agentId and targetStatus are required." },
            { status: 400 }
          );
        }

        let ram = 0.0;
        let cpu = 0.0;
        let task = "Updated via cluster console";

        if (targetStatus === "ACTIVE") {
          ram = 145.0;
          cpu = 15.0;
          task = "Active worker processing cluster queue";
        } else if (targetStatus === "HIBERNATED") {
          task = "Hibernated in zero-token standby state";
        } else if (targetStatus === "PAUSED_NUDGE") {
          ram = 95.0;
          cpu = 1.0;
          task = "Paused for manual operator review";
        } else if (targetStatus === "KILLED_LOOP") {
          task = "Terminated by operator action";
        }

        const updated = await prisma.agent.update({
          where: { agent_id: agentId },
          data: {
            status: targetStatus,
            ram_usage: ram,
            cpu_usage: cpu,
            current_task: task,
            loop_score: targetStatus === "KILLED_LOOP" ? 0.99 : 0.02,
          },
        });

        const activeCount = await prisma.agent.count({
          where: { cluster_id: targetClusterId, status: "ACTIVE" },
        });
        const hibernatedCount = await prisma.agent.count({
          where: { cluster_id: targetClusterId, status: "HIBERNATED" },
        });

        await prisma.clusterAndWorkspace.update({
          where: { cluster_id: targetClusterId },
          data: {
            active_agents: activeCount,
            hibernated_agents: hibernatedCount,
          },
        });

        return NextResponse.json({
          success: true,
          message: `Agent ${agentId} status updated to ${targetStatus}`,
          agent: updated,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown cluster action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Cluster action error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while processing cluster action." },
      { status: 500 }
    );
  }
}

