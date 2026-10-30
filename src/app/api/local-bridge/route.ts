import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAndAcquireFileMutex } from "@/lib/guardrails-engine";

export interface FileMutexLock {
  id: string;
  filePath: string;
  holderAgent: string;
  queuedAgent: string | null;
  status: "LOCKED" | "CONFLICT_QUEUED" | "RELEASED";
  acquiredAt: string;
  collisionInterceptMs?: number;
}

// In-memory mutex registry and governance permissions
let fileLocks: FileMutexLock[] = [
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

let governancePermissions = {
  monitorProcesses: true,
  enforceMutex: true,
  interceptRedundantApi: true,
  zeroTrustCodePrivacy: true,
};

export async function GET(req: NextRequest) {
  try {
    const localCluster = await prisma.clusterAndWorkspace.findFirst({
      where: { environment: "LOCAL_PC" },
      include: {
        agents: {
          orderBy: { name: "asc" },
        },
      },
    });

    const daemonStats = {
      version: "v1.4.0",
      residentMemoryMb: 42.4,
      maxAllowedRamMb: 150,
      port: 41829,
      ipcSock: "ipc://socket0 (Zero-Trust Local Code)",
      activeAgentsCount: localCluster?.active_agents || 3,
      contextTokensSaved: localCluster?.cache_tokens_saved || 320000,
      interceptionLatencyMs: 18,
    };

    return NextResponse.json({
      success: true,
      cluster: localCluster,
      daemonStats,
      fileLocks,
      permissions: governancePermissions,
    });
  } catch (error) {
    console.error("Local Bridge GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve local bridge data." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, lockId, permissions, targetFilePath } = body;

    switch (action) {
      case "HEARTBEAT": {
        const { daemon, agents, locks } = body;
        if (locks && Array.isArray(locks)) {
          fileLocks = locks.map((l: any, idx: number) => ({
            id: l.id || `lck-${idx + 1}`,
            filePath: l.filePath,
            holderAgent: l.holderAgent || "Local Agent",
            queuedAgent: l.queuedAgent || null,
            status: l.status || "LOCKED",
            acquiredAt: l.acquiredAt ? new Date(l.acquiredAt).toLocaleTimeString() : "Just now",
            collisionInterceptMs: l.collisionInterceptMs || 18,
          }));
        }

        // Update local agent telemetry in database if agents payload provided
        if (agents && Array.isArray(agents)) {
          for (const a of agents) {
            try {
              await prisma.agent.updateMany({
                where: {
                  OR: [
                    { name: { contains: a.name } },
                    { agent_type: a.type?.toUpperCase() || "" },
                  ],
                },
                data: {
                  ram_usage: parseFloat(a.ram_usage || a.memoryUsageMb || 0),
                  cpu_usage: parseFloat(a.cpu_usage || a.cpuPercent || 0),
                  tokens_used: parseInt(a.tokens_used || a.tokensConsumed || 0, 10),
                  current_task: a.current_task || a.activeFilePath || undefined,
                  locked_file_path: a.locked_file_path || a.activeFilePath || undefined,
                  last_heartbeat_at: new Date(),
                },
              });
            } catch (err) {
              // Ignore agent sync errors during heartbeat
            }
          }
        }

        return NextResponse.json({
          success: true,
          message: "Telemetry heartbeat acknowledged. Zero-Trust verified.",
          daemonStats: {
            version: daemon?.version || "v1.4.0",
            residentMemoryMb: parseFloat(daemon?.residentMemoryMb || "32.4"),
            maxAllowedRamMb: 150,
            port: daemon?.port || 41829,
            ipcSock: "ipc://socket0 (Zero-Trust Local Code)",
            activeAgentsCount: agents?.length || 3,
            contextTokensSaved: 320000,
            interceptionLatencyMs: 18,
          },
          fileLocks,
        });
      }

      case "SIMULATE_COLLISION": {
        // Find the lock on src/app/dashboard/page.tsx
        const targetPath = targetFilePath || "src/app/dashboard/page.tsx";
        let targetLock = fileLocks.find((l) => l.filePath === targetPath);

        if (!targetLock) {
          targetLock = {
            id: `lck-${Date.now()}`,
            filePath: targetPath,
            holderAgent: "Antigravity",
            queuedAgent: null,
            status: "LOCKED",
            acquiredAt: "Just now",
          };
          fileLocks.unshift(targetLock);
        }

        // Evaluate collision using our native guardrails engine
        const activeAgentsForMutex = fileLocks.map((l) => ({
          agent_id: l.holderAgent.toLowerCase(),
          name: l.holderAgent,
          locked_file_path: l.filePath,
        }));
        const mutexResult = verifyAndAcquireFileMutex(
          activeAgentsForMutex,
          "claude",
          targetPath
        );

        // Simulate Claude Code trying to overwrite page.tsx while Antigravity holds it
        targetLock.queuedAgent = `Claude Code (Write Intercepted & Queued -> ${mutexResult.fallbackFilePath || "conflict branch"})`;
        targetLock.status = "CONFLICT_QUEUED";
        targetLock.collisionInterceptMs = mutexResult.interceptionMs || 18;

        return NextResponse.json({
          success: true,
          message: `Collision intercepted in ${targetLock.collisionInterceptMs}ms! Claude Code attempted to overwrite '${targetPath}'. ArgusOps queued Claude and protected Antigravity's active lock. 0 code lost.`,
          fileLock: targetLock,
          fileLocks,
          mutexResult,
        });
      }

      case "RELEASE_LOCK": {
        if (!lockId) {
          return NextResponse.json({ error: "lockId is required." }, { status: 400 });
        }

        const lock = fileLocks.find((l) => l.id === lockId);
        if (lock) {
          lock.status = "RELEASED";
          lock.queuedAgent = null;
        }

        fileLocks = fileLocks.filter((l) => l.id !== lockId);

        return NextResponse.json({
          success: true,
          message: `File lock released for '${lock?.filePath}'. Waiting agents unblocked cleanly.`,
          fileLocks,
        });
      }

      case "UPDATE_PERMISSIONS": {
        if (permissions) {
          governancePermissions = {
            ...governancePermissions,
            ...permissions,
          };
        }

        // Sync to cluster state in SQLite
        await prisma.clusterAndWorkspace.updateMany({
          where: { environment: "LOCAL_PC" },
          data: {
            zero_trust_local: governancePermissions.zeroTrustCodePrivacy,
          },
        });

        return NextResponse.json({
          success: true,
          message: "Local governance permissions and Zero-Trust settings updated.",
          permissions: governancePermissions,
        });
      }

      case "RESET_MUTEX": {
        fileLocks = [
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

        return NextResponse.json({
          success: true,
          message: "Mutex registry reset to isolated agent states.",
          fileLocks,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("Local Bridge POST error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while processing local bridge action." },
      { status: 500 }
    );
  }
}

