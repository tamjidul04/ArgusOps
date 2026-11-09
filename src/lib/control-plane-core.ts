/**
 * Database-free logic for the control plane: policy shaping, incident -> UI event mapping,
 * agent-slot rules and small formatters. Kept pure so it is cheap to unit-test.
 */

/* --------------------------------- policy --------------------------------- */

/** The shape the Guardrails UI edits. Stored in the Policy table (see policyRowToDto). */
export interface GuardrailPolicy {
  maxConsecutiveRetries: number;
  semanticSimilarityThreshold: number;
  nudgeCompletionThreshold: number;
  maxRamPerAgentMb: number;
  autoThrottleEnabled: boolean;
  /** Resume a stuck agent automatically with the suggested instruction (at most once per 30 minutes per agent). */
  autoApplyRewrites: boolean;
}

export interface PolicyRow {
  loop_score_threshold: number;
  exact_repeat_limit: number;
  nudge_progress_pct: number;
  max_consecutive_retries: number;
  ram_soft_limit_mb: number;
  auto_downgrade_models: boolean;
  auto_apply_rewrites: boolean;
}

export interface Permissions {
  monitorProcesses: boolean;
  enforceMutex: boolean;
  interceptRedundantApi: boolean;
  zeroTrustCodePrivacy: boolean;
}

export const POLICY_LIMITS = {
  maxConsecutiveRetries: { min: 1, max: 10 },
  semanticSimilarityThreshold: { min: 0.5, max: 0.99 },
  nudgeCompletionThreshold: { min: 50, max: 99 },
  maxRamPerAgentMb: { min: 64, max: 4096 },
} as const;

export function policyRowToDto(row: PolicyRow): GuardrailPolicy {
  return {
    maxConsecutiveRetries: row.max_consecutive_retries,
    semanticSimilarityThreshold: row.loop_score_threshold,
    nudgeCompletionThreshold: row.nudge_progress_pct,
    maxRamPerAgentMb: row.ram_soft_limit_mb,
    autoThrottleEnabled: row.auto_downgrade_models,
    autoApplyRewrites: row.auto_apply_rewrites,
  };
}

function clampNumber(value: unknown, min: number, max: number, integer: boolean): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

/** Validates untrusted client input. Unknown keys are dropped; numbers are clamped to safe ranges. */
export function sanitizePolicyInput(input: unknown): Partial<GuardrailPolicy> {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: Partial<GuardrailPolicy> = {};
  const L = POLICY_LIMITS;

  const retries = clampNumber(src.maxConsecutiveRetries, L.maxConsecutiveRetries.min, L.maxConsecutiveRetries.max, true);
  if (retries !== undefined) out.maxConsecutiveRetries = retries;
  const sim = clampNumber(src.semanticSimilarityThreshold, L.semanticSimilarityThreshold.min, L.semanticSimilarityThreshold.max, false);
  if (sim !== undefined) out.semanticSimilarityThreshold = sim;
  const nudge = clampNumber(src.nudgeCompletionThreshold, L.nudgeCompletionThreshold.min, L.nudgeCompletionThreshold.max, true);
  if (nudge !== undefined) out.nudgeCompletionThreshold = nudge;
  const ram = clampNumber(src.maxRamPerAgentMb, L.maxRamPerAgentMb.min, L.maxRamPerAgentMb.max, true);
  if (ram !== undefined) out.maxRamPerAgentMb = ram;
  if (typeof src.autoThrottleEnabled === "boolean") out.autoThrottleEnabled = src.autoThrottleEnabled;
  if (typeof src.autoApplyRewrites === "boolean") out.autoApplyRewrites = src.autoApplyRewrites;
  return out;
}

export function policyDtoToRowUpdate(dto: Partial<GuardrailPolicy>) {
  const data: Partial<PolicyRow> & { max_consecutive_retries?: number } = {};
  if (dto.maxConsecutiveRetries !== undefined) {
    data.max_consecutive_retries = dto.maxConsecutiveRetries;
    data.exact_repeat_limit = Math.max(1, dto.maxConsecutiveRetries - 1);
  }
  if (dto.semanticSimilarityThreshold !== undefined) data.loop_score_threshold = dto.semanticSimilarityThreshold;
  if (dto.nudgeCompletionThreshold !== undefined) data.nudge_progress_pct = dto.nudgeCompletionThreshold;
  if (dto.maxRamPerAgentMb !== undefined) data.ram_soft_limit_mb = dto.maxRamPerAgentMb;
  if (dto.autoThrottleEnabled !== undefined) data.auto_downgrade_models = dto.autoThrottleEnabled;
  if (dto.autoApplyRewrites !== undefined) data.auto_apply_rewrites = dto.autoApplyRewrites;
  return data;
}

const PERMISSION_KEYS = ["monitorProcesses", "enforceMutex", "interceptRedundantApi", "zeroTrustCodePrivacy"] as const;

/** Keeps only known boolean permission flags from untrusted input. */
export function sanitizePermissions(input: unknown): Partial<Permissions> {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: Partial<Permissions> = {};
  for (const k of PERMISSION_KEYS) if (typeof src[k] === "boolean") out[k] = src[k] as boolean;
  return out;
}

/* ------------------------------ incident -> UI ----------------------------- */

export interface StreamEvent {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  eventType: "EXACT_TOOL_LOOP" | "SEMANTIC_REASONING_LOOP" | "MEMORY_GOVERNANCE";
  toolName?: string;
  similarityScore?: number;
  retryCount?: number;
  latencyMs: number;
  actionTaken: "KILLED_LOOP" | "PAUSED_NUDGE" | "THROTTLED" | "FLAGGED";
  summary: string;
}

export interface IncidentLike {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  loop_type: string | null;
  kind: string;
  action: string;
  score: number;
  detail: string;
  interception_ms: number;
  created_at: Date;
}

const ACTION_TO_UI: Record<string, StreamEvent["actionTaken"]> = {
  PAUSED: "PAUSED_NUDGE",
  KILLED: "KILLED_LOOP",
  THROTTLED: "THROTTLED",
};

export function incidentToStreamEvent(i: IncidentLike): StreamEvent {
  const eventType: StreamEvent["eventType"] =
    i.kind === "RAM" || i.kind === "BUDGET" || i.kind === "WASTE"
      ? "MEMORY_GOVERNANCE"
      : i.loop_type === "SEMANTIC_REASONING_LOOP"
        ? "SEMANTIC_REASONING_LOOP"
        : "EXACT_TOOL_LOOP";
  return {
    id: i.id,
    timestamp: i.created_at.toISOString(),
    agentId: i.agent_id ?? "",
    agentName: i.agent_name ?? i.agent_id ?? "Agent",
    eventType,
    similarityScore: eventType === "SEMANTIC_REASONING_LOOP" ? i.score : undefined,
    latencyMs: i.interception_ms,
    actionTaken: ACTION_TO_UI[i.action] ?? "FLAGGED",
    summary: i.detail,
  };
}

/** Real interception-latency stats from recorded incidents; zeros when there is no data yet. */
export function latencyStats(samplesMs: number[]): { avg: number; p99: number } {
  if (samplesMs.length === 0) return { avg: 0, p99: 0 };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  return { avg: Math.round(avg * 10) / 10, p99: sorted[idx] };
}

/* ------------------------------- agent slots ------------------------------- */

/** A new or resumed agent needs a free slot. Only ACTIVE agents count toward the plan limit. */
export function canActivateAgent(activeCount: number, maxAgents: number): boolean {
  return activeCount < Math.max(0, maxAgents);
}

export function agentLimitMessage(maxAgents: number, planName?: string): string {
  return `Your ${planName ?? "current"} plan allows ${maxAgents} concurrent agent${maxAgents === 1 ? "" : "s"}. Pause or stop one, or upgrade your plan.`;
}

/* -------------------------------- formatting ------------------------------- */

export function relativeTime(from: Date, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - from.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Normalises a file path from an agent so equal files compare equal (slashes, ./, case on Windows paths). */
export function normalizeLockPath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .slice(0, 500);
}
