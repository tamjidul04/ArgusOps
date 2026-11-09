import { performance } from "node:perf_hooks";
import { prisma } from "@/lib/prisma";
import {
  agentLimitMessage,
  canActivateAgent,
  incidentToStreamEvent,
  latencyStats,
  normalizeLockPath,
  policyDtoToRowUpdate,
  policyRowToDto,
  relativeTime,
  type GuardrailPolicy,
  type Permissions,
  type StreamEvent,
} from "@/lib/control-plane-core";

/**
 * Database-backed control plane. Every function takes the owning userId and only ever touches
 * that user's rows: agent ids from a request are never trusted on their own.
 */

/* --------------------------------- policy --------------------------------- */

export function getPolicyRow(userId: string) {
  return prisma.policy.upsert({ where: { user_id: userId }, update: {}, create: { user_id: userId } });
}

export async function getPolicy(userId: string): Promise<GuardrailPolicy> {
  return policyRowToDto(await getPolicyRow(userId));
}

export async function updatePolicy(userId: string, dto: Partial<GuardrailPolicy>): Promise<GuardrailPolicy> {
  const data = policyDtoToRowUpdate(dto);
  const row = await prisma.policy.upsert({
    where: { user_id: userId },
    update: data,
    create: { user_id: userId, ...data },
  });
  return policyRowToDto(row);
}

export async function getPermissions(userId: string): Promise<Permissions> {
  const [row, cluster] = await Promise.all([
    getPolicyRow(userId),
    prisma.clusterAndWorkspace.findFirst({ where: { user_id: userId, environment: "LOCAL_PC" } }),
  ]);
  return {
    monitorProcesses: row.monitor_processes,
    enforceMutex: row.enforce_mutex,
    interceptRedundantApi: row.intercept_redundant_api,
    zeroTrustCodePrivacy: cluster?.zero_trust_local ?? true,
  };
}

export async function updatePermissions(userId: string, patch: Partial<Permissions>): Promise<Permissions> {
  await prisma.policy.upsert({
    where: { user_id: userId },
    update: {
      ...(patch.monitorProcesses !== undefined && { monitor_processes: patch.monitorProcesses }),
      ...(patch.enforceMutex !== undefined && { enforce_mutex: patch.enforceMutex }),
      ...(patch.interceptRedundantApi !== undefined && { intercept_redundant_api: patch.interceptRedundantApi }),
    },
    create: {
      user_id: userId,
      monitor_processes: patch.monitorProcesses ?? true,
      enforce_mutex: patch.enforceMutex ?? true,
      intercept_redundant_api: patch.interceptRedundantApi ?? true,
    },
  });
  if (patch.zeroTrustCodePrivacy !== undefined) {
    await prisma.clusterAndWorkspace.updateMany({
      where: { user_id: userId, environment: "LOCAL_PC" },
      data: { zero_trust_local: patch.zeroTrustCodePrivacy },
    });
  }
  return getPermissions(userId);
}

/* -------------------------------- incidents ------------------------------- */

export interface IncidentInput {
  userId: string;
  agentId?: string | null;
  agentName?: string | null;
  kind: "LOOP" | "WASTE" | "BAD_PROMPT" | "BUDGET" | "RAM" | "MUTEX";
  loopType?: "EXACT_TOOL_LOOP" | "SEMANTIC_REASONING_LOOP" | null;
  severity?: "INFO" | "WARN" | "CRITICAL";
  action?: "NONE" | "PAUSED" | "KILLED" | "THROTTLED" | "REWRITE_PROPOSED";
  score?: number;
  detail: string;
  interceptionMs?: number;
}

export function recordIncident(i: IncidentInput) {
  return prisma.incident.create({
    data: {
      user_id: i.userId,
      agent_id: i.agentId ?? null,
      agent_name: i.agentName?.slice(0, 120) ?? null,
      kind: i.kind,
      loop_type: i.loopType ?? null,
      severity: i.severity ?? "WARN",
      action: i.action ?? "NONE",
      score: i.score ?? 0,
      detail: i.detail.slice(0, 2000),
      interception_ms: Math.round(i.interceptionMs ?? 0),
    },
  });
}

export async function listStreamEvents(userId: string, take = 50): Promise<StreamEvent[]> {
  const rows = await prisma.incident.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    take,
  });
  return rows.map(incidentToStreamEvent);
}

export async function getLatencyStats(userId: string) {
  const rows = await prisma.incident.findMany({
    where: { user_id: userId, interception_ms: { gt: 0 } },
    orderBy: { created_at: "desc" },
    take: 500,
    select: { interception_ms: true },
  });
  return latencyStats(rows.map((r) => r.interception_ms));
}

/* --------------------------------- agents --------------------------------- */

/** The agent only if it belongs to this user (through its cluster). */
export function ownedAgent(userId: string, agentId: string) {
  return prisma.agent.findFirst({ where: { agent_id: agentId, cluster: { user_id: userId } } });
}

/** An agent that has not checked in for this long no longer holds a plan slot (e.g. its CLI crashed). */
export const AGENT_STALE_MS = 2 * 60_000;

export function activeAgentCount(userId: string) {
  return prisma.agent.count({
    where: {
      status: "ACTIVE",
      cluster: { user_id: userId },
      last_heartbeat_at: { gte: new Date(Date.now() - AGENT_STALE_MS) },
    },
  });
}

export async function planLimits(userId: string) {
  const sub = await prisma.subscriptionAndWallet.findUnique({
    where: { user_id: userId },
    include: { plan: true },
  });
  return { maxAgents: sub?.max_agents ?? 2, planName: sub?.plan.name };
}

/** Is there a free concurrent-agent slot for this user right now? */
export async function checkAgentSlot(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const [{ maxAgents, planName }, active] = await Promise.all([planLimits(userId), activeAgentCount(userId)]);
  return canActivateAgent(active, maxAgents) ? { ok: true } : { ok: false, message: agentLimitMessage(maxAgents, planName) };
}

export async function ensureLocalCluster(userId: string, ownerName: string) {
  const existing = await prisma.clusterAndWorkspace.findFirst({
    where: { user_id: userId, environment: "LOCAL_PC" },
  });
  if (existing) return existing;
  return prisma.clusterAndWorkspace.create({
    data: {
      user_id: userId,
      name: `${ownerName}'s Workspace`,
      environment: "LOCAL_PC",
      zero_trust_local: true,
    },
  });
}

/* -------------------------------- file locks -------------------------------- */

export interface FileMutexLock {
  id: string;
  filePath: string;
  holderAgent: string;
  queuedAgent: string | null;
  status: "LOCKED" | "CONFLICT_QUEUED" | "RELEASED";
  acquiredAt: string;
  collisionInterceptMs?: number;
}

export const DEFAULT_LOCK_TTL_MS = 15 * 60_000;

async function purgeExpiredLocks(userId: string) {
  await prisma.fileLock.deleteMany({ where: { user_id: userId, expires_at: { lt: new Date() } } });
}

export async function listLocks(userId: string): Promise<FileMutexLock[]> {
  await purgeExpiredLocks(userId);
  const rows = await prisma.fileLock.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    filePath: r.file_path,
    holderAgent: r.holder,
    queuedAgent: r.queued_agent,
    status: r.queued_agent ? "CONFLICT_QUEUED" : "LOCKED",
    acquiredAt: relativeTime(r.created_at),
  }));
}

export type AcquireResult =
  | { allowed: true; lockedFilePath: string; interceptionMs: number }
  | { allowed: false; heldBy: string; fallbackFilePath: string; interceptionMs: number };

/** Atomic per (user, file): the unique index decides races, so two agents can never both hold a file. */
export async function acquireLock(
  userId: string,
  rawPath: string,
  holder: string,
  opts: { pid?: number; ttlMs?: number } = {}
): Promise<AcquireResult> {
  const t0 = performance.now();
  const filePath = normalizeLockPath(rawPath);
  const expires = new Date(Date.now() + (opts.ttlMs ?? DEFAULT_LOCK_TTL_MS));
  await purgeExpiredLocks(userId);

  const conflict = async (): Promise<AcquireResult> => {
    const current = await prisma.fileLock.findUnique({
      where: { user_id_file_path: { user_id: userId, file_path: filePath } },
    });
    if (current && current.holder === holder) {
      await prisma.fileLock.update({ where: { id: current.id }, data: { expires_at: expires } });
      return { allowed: true, lockedFilePath: filePath, interceptionMs: Math.round(performance.now() - t0) };
    }
    if (current) {
      await prisma.fileLock.update({ where: { id: current.id }, data: { queued_agent: holder.slice(0, 255) } });
    }
    const slug = holder.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "agent";
    return {
      allowed: false,
      heldBy: current?.holder ?? "another agent",
      fallbackFilePath: `${filePath}.conflict-${slug}`,
      interceptionMs: Math.round(performance.now() - t0),
    };
  };

  // The unique (user_id, file_path) index decides races; skipDuplicates turns the loser into count 0.
  const created = await prisma.fileLock.createMany({
    data: [
      {
        user_id: userId,
        file_path: filePath,
        holder: holder.slice(0, 120),
        holder_pid: opts.pid ?? null,
        expires_at: expires,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { allowed: true, lockedFilePath: filePath, interceptionMs: Math.round(performance.now() - t0) };
  }
  return conflict();
}

export async function releaseLockById(userId: string, lockId: string) {
  const lock = await prisma.fileLock.findFirst({ where: { id: lockId, user_id: userId } });
  if (!lock) return null;
  await prisma.fileLock.delete({ where: { id: lock.id } });
  return lock;
}

export async function releaseLocksFor(userId: string, opts: { filePath?: string; holder?: string }) {
  const where: { user_id: string; file_path?: string; holder?: string } = { user_id: userId };
  if (opts.filePath) where.file_path = normalizeLockPath(opts.filePath);
  if (opts.holder) where.holder = opts.holder;
  if (!opts.filePath && !opts.holder) return 0;
  return (await prisma.fileLock.deleteMany({ where })).count;
}

/* ------------------------- agent actions (shared) ------------------------- */

export async function resumeAgent(userId: string, agentId: string, hint?: string) {
  const agent = await ownedAgent(userId, agentId);
  if (!agent) return { ok: false, status: 404, error: "Agent not found." } as const;
  if (agent.status !== "PAUSED_NUDGE") {
    return { ok: false, status: 409, error: "Only a paused agent can be resumed with a hint." } as const;
  }
  const slot = await checkAgentSlot(userId);
  if (!slot.ok) return { ok: false, status: 403, error: slot.message } as const;

  const cleanHint = hint?.trim()
    ? hint.trim().slice(0, 1000)
    : "Resume and finish the current step without repeating the failed action.";
  const updated = await prisma.agent.update({
    where: { agent_id: agent.agent_id },
    data: { status: "ACTIVE", loop_score: 0, pending_hint: cleanHint, last_heartbeat_at: new Date() },
  });
  await recordIncident({
    userId,
    agentId: agent.agent_id,
    agentName: agent.name,
    kind: "LOOP",
    severity: "INFO",
    action: "NONE",
    detail: `Operator resumed ${agent.name} with hint: "${cleanHint}"`,
  });
  return { ok: true, value: { agent: updated, hint: cleanHint } } as const;
}

export async function killAgent(userId: string, agentId: string, reason = "Stopped by operator.") {
  const agent = await ownedAgent(userId, agentId);
  if (!agent) return { ok: false, status: 404, error: "Agent not found." } as const;

  const killed = await prisma.agent.update({
    where: { agent_id: agent.agent_id },
    data: {
      status: "KILLED_LOOP",
      ram_usage: 0,
      cpu_usage: 0,
      locked_file_path: null,
      current_task: reason.slice(0, 500),
      last_heartbeat_at: new Date(),
    },
  });
  await releaseLocksFor(userId, { holder: agent.name });
  await recordIncident({
    userId,
    agentId: agent.agent_id,
    agentName: agent.name,
    kind: "LOOP",
    severity: "CRITICAL",
    action: "KILLED",
    detail: `${reason} (${agent.name})`,
  });
  return { ok: true, value: { agent: killed } } as const;
}

/* ------------------------------ daemon heartbeat ----------------------------- */

const MAX_HEARTBEAT_AGENTS = 50;
const AGENT_TYPE_RE = /^[A-Z][A-Z0-9_]{1,29}$/;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export interface HeartbeatResult {
  updated: number;
  created: number;
  rejected: { name: string; reason: string }[];
}

/**
 * Applies a telemetry heartbeat from the user's local daemon/CLI.
 * - Only this user's local cluster is touched.
 * - PAUSED_NUDGE / KILLED_LOOP are owned by the control plane: a daemon cannot overwrite them.
 * - New or reactivated agents need a free slot on the plan (Free = 2, Pro = 10).
 */
export async function applyHeartbeat(userId: string, ownerName: string, agents: unknown): Promise<HeartbeatResult> {
  const result: HeartbeatResult = { updated: 0, created: 0, rejected: [] };
  if (!Array.isArray(agents)) return result;

  const cluster = await ensureLocalCluster(userId, ownerName);
  const existing = await prisma.agent.findMany({ where: { cluster_id: cluster.cluster_id } });

  for (const raw of agents.slice(0, MAX_HEARTBEAT_AGENTS)) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const type = (str(a.type ?? a.agent_type, 30) ?? "AGENT").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const name = str(a.name, 120) ?? type;
    if (!AGENT_TYPE_RE.test(type)) {
      result.rejected.push({ name, reason: "Invalid agent type." });
      continue;
    }

    const wantedId = str(a.id ?? a.agent_id, 60);
    const match =
      (wantedId && existing.find((e) => e.agent_id === wantedId)) ||
      existing.find((e) => e.name.toLowerCase() === name.toLowerCase());

    const requested = a.status === "HIBERNATED" ? "HIBERNATED" : "ACTIVE";
    const telemetry = {
      ram_usage: num(a.ram_usage ?? a.memoryUsageMb, match?.ram_usage ?? 0, 0, 1_000_000),
      cpu_usage: num(a.cpu_usage ?? a.cpuPercent, match?.cpu_usage ?? 0, 0, 10_000),
      tokens_used: Math.round(num(a.tokens_used ?? a.tokensConsumed, match?.tokens_used ?? 0, 0, 2_000_000_000)),
      current_task: str(a.current_task ?? a.activeFilePath, 500) ?? match?.current_task ?? null,
      locked_file_path: str(a.locked_file_path ?? a.lockedFilePath, 512) ?? match?.locked_file_path ?? null,
      last_heartbeat_at: new Date(),
    };

    if (match) {
      const governed = match.status === "KILLED_LOOP" || match.status === "PAUSED_NUDGE";
      let status = match.status;
      if (!governed) {
        if (requested === "ACTIVE" && match.status !== "ACTIVE") {
          const slot = await checkAgentSlot(userId);
          if (!slot.ok) {
            result.rejected.push({ name, reason: slot.message });
            continue;
          }
        }
        status = requested;
      }
      await prisma.agent.update({
        where: { agent_id: match.agent_id },
        data: {
          ...telemetry,
          status,
          ...(governed && match.status === "KILLED_LOOP" && { ram_usage: 0, cpu_usage: 0, locked_file_path: null }),
        },
      });
      result.updated++;
      continue;
    }

    if (requested === "ACTIVE") {
      const slot = await checkAgentSlot(userId);
      if (!slot.ok) {
        result.rejected.push({ name, reason: slot.message });
        continue;
      }
    }
    const created = await prisma.agent.create({
      data: { cluster_id: cluster.cluster_id, name, agent_type: type, status: requested, ...telemetry },
    });
    existing.push(created);
    result.created++;
  }

  await prisma.clusterAndWorkspace.update({
    where: { cluster_id: cluster.cluster_id },
    data: {
      active_agents: await prisma.agent.count({ where: { cluster_id: cluster.cluster_id, status: "ACTIVE" } }),
      hibernated_agents: await prisma.agent.count({ where: { cluster_id: cluster.cluster_id, status: "HIBERNATED" } }),
    },
  });
  return result;
}
