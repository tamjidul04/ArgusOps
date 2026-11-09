import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { orchestrateProjectTask } from "@/lib/master-orchestrator";
import {
  acquireLock,
  applyHeartbeat,
  ensureLocalCluster,
  getLatencyStats,
  killAgent,
  listLocks,
  ownedAgent,
  releaseLocksFor,
  resumeAgent,
} from "@/lib/control-plane";

/**
 * Control-plane API used by the dashboard and the local daemon/CLI.
 * Everything is scoped to the authenticated user: clusters, agents, wallet and file locks.
 * (The previous demo actions that fabricated incidents and charged tokens were removed.)
 */

const REMOVED_ACTIONS = new Set([
  "TRIGGER_ROGUE_LOOP",
  "TRIGGER_HUMAN_NUDGE",
  "TEST_FILE_MUTEX",
  "THROTTLE_RAM_SPIKE",
]);

// ============================================================================
// GET /api/brain
// ============================================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const [cloudCluster, localCluster, wallet, locks, latency] = await Promise.all([
      prisma.clusterAndWorkspace.findFirst({
        where: { user_id: userId, environment: "CLOUD" },
        include: { agents: { orderBy: { agent_id: "asc" } }, tasks: { orderBy: { created_at: "desc" }, take: 10 } },
      }),
      prisma.clusterAndWorkspace.findFirst({
        where: { user_id: userId, environment: "LOCAL_PC" },
        include: { agents: { orderBy: { agent_id: "asc" } }, tasks: { orderBy: { created_at: "desc" }, take: 5 } },
      }),
      prisma.subscriptionAndWallet.findUnique({ where: { user_id: userId }, include: { plan: true } }),
      listLocks(userId),
      getLatencyStats(userId),
    ]);

    return NextResponse.json({
      success: true,
      // Host RAM/CPU belongs to the machine running the CLI, not this server; the CLI reports it per agent.
      hardware: null,
      cloudCluster,
      localCluster,
      wallet,
      interceptionLatencyMs: latency.avg,
      scanResult: { totalDetectedProcesses: 0, detectedProcesses: [] },
      activeLocks: locks,
      mutexRegistry: { activeLocksCount: locks.length, locks },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET /api/brain error:", error);
    return NextResponse.json({ error: "Failed to retrieve cluster state." }, { status: 500 });
  }
}

// ============================================================================
// POST /api/brain
// ============================================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const action: unknown = body.action;
    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "A valid 'action' parameter is required." }, { status: 400 });
    }

    if (REMOVED_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `'${action}' was a simulation and has been removed. Real incidents appear once an agent runs under argus.` },
        { status: 410 }
      );
    }

    const interactive = auth.via === "session";

    switch (action) {
      // Planning preview only: it analyses the prompt. It does not change any agent and costs no tokens.
      case "DECOMPOSE_TASK": {
        if (!interactive) return NextResponse.json({ error: "Sign in to use the orchestrator." }, { status: 403 });
        const prompt =
          typeof body.prompt === "string" && body.prompt.trim()
            ? body.prompt.trim().slice(0, 4000)
            : "Describe the project you want to build.";

        const cluster =
          (await prisma.clusterAndWorkspace.findFirst({ where: { user_id: userId }, orderBy: { created_at: "asc" } })) ??
          (await ensureLocalCluster(userId, auth.user.name));

        const plan = await orchestrateProjectTask(prompt, 100);
        const taskLog = await prisma.taskAndLog.create({
          data: {
            cluster_id: cluster.cluster_id,
            prompt_summary: plan.prompt.slice(0, 1000),
            complexity_score: plan.complexity.score,
            assigned_agents: plan.concurrency.activeAgents,
            hibernated_count: plan.concurrency.hibernatedAgents,
            tokens_saved: 0,
            loop_incidents: 0,
            interception_ms: 0,
            status: "RUNNING",
          },
        });

        return NextResponse.json({
          success: true,
          action,
          message: `Plan preview: ${plan.subtasks.length} modules. This is an estimate, nothing was started.`,
          plan,
          taskLog,
        });
      }

      case "RESOLVE_NUDGE": {
        if (!interactive) return NextResponse.json({ error: "Sign in to resolve a paused agent." }, { status: 403 });
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });

        const r =
          body.decision === "KILL"
            ? await killAgent(userId, agentId, "Terminated by operator during nudge review.")
            : await resumeAgent(userId, agentId, typeof body.hintText === "string" ? body.hintText : undefined);
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

        return NextResponse.json({
          success: true,
          action,
          decision: body.decision === "KILL" ? "KILL" : "RESUME",
          message:
            body.decision === "KILL"
              ? `${r.value.agent.name} was marked stopped.`
              : `${r.value.agent.name} will resume with your hint on its next sync.`,
          agent: r.value.agent,
        });
      }

      case "HEARTBEAT":
      case "DAEMON_HEARTBEAT": {
        const result = await applyHeartbeat(userId, auth.user.name, body.agents);
        return NextResponse.json({
          success: true,
          action: "HEARTBEAT",
          ...result,
          locks: await listLocks(userId),
          timestamp: new Date().toISOString(),
        });
      }

      case "ACQUIRE_FILE_MUTEX": {
        const targetFilePath = typeof body.targetFilePath === "string" ? body.targetFilePath : "";
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        if (!targetFilePath) return NextResponse.json({ error: "targetFilePath is required." }, { status: 400 });
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });

        const agent = await ownedAgent(userId, agentId);
        if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

        const result = await acquireLock(userId, targetFilePath, agent.name, {
          pid: typeof body.pid === "number" ? body.pid : undefined,
        });
        if (result.allowed) {
          await prisma.agent.update({
            where: { agent_id: agent.agent_id },
            data: { locked_file_path: result.lockedFilePath, last_heartbeat_at: new Date() },
          });
        }
        return NextResponse.json({
          success: result.allowed,
          action,
          mutexResult: result,
          targetFilePath,
        });
      }

      case "RELEASE_FILE_MUTEX": {
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        if (!agentId) return NextResponse.json({ error: "agentId is required." }, { status: 400 });
        const agent = await ownedAgent(userId, agentId);
        if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

        const released = await releaseLocksFor(userId, {
          holder: agent.name,
          filePath: typeof body.targetFilePath === "string" ? body.targetFilePath : undefined,
        });
        await prisma.agent.update({
          where: { agent_id: agent.agent_id },
          data: { locked_file_path: null, last_heartbeat_at: new Date() },
        });
        return NextResponse.json({ success: true, action, released });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown action '${action}'. Supported: DECOMPOSE_TASK, RESOLVE_NUDGE, HEARTBEAT, ACQUIRE_FILE_MUTEX, RELEASE_FILE_MUTEX.`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("POST /api/brain error:", error);
    return NextResponse.json({ error: "Internal server error while executing the action." }, { status: 500 });
  }
}
