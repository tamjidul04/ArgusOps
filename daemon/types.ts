export type LocalAgentType = "claude" | "antigravity" | "hermes" | "custom";

export type LocalAgentStatus =
  | "ACTIVE"
  | "HIBERNATED"
  | "PAUSED_NUDGE"
  | "KILLED_LOOP";

export interface LocalAgentProcess {
  id: string;
  name: string;
  type: LocalAgentType;
  pid: number;
  status: LocalAgentStatus;
  memoryUsageMb: number;
  cpuPercent: number;
  tokensConsumed: number;
  activeFilePath?: string;
  consecutiveIdenticalCalls: number;
  lastHeartbeat: number;
}

export interface FileLock {
  filePath: string;
  holderAgentId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface DaemonMetrics {
  totalMemoryMb: number;
  maxAllowedMemoryMb: number;
  activeAgentsCount: number;
  hibernatedAgentsCount: number;
  interceptLatencyMs: number;
  totalTokensSaved: number;
}

export interface InterceptDecision {
  allow: boolean;
  action: "PROCEED" | "THROTTLE" | "PAUSE_FOR_NUDGE" | "KILL_LOOP";
  reason?: string;
}

