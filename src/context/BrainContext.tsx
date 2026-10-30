"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface BrainHardware {
  totalRamGb: number;
  usedRamGb: number;
  freeRamGb: number;
  ramUsagePercent: number;
  cpuLoadPercent: number;
  daemonMemoryMb: number;
  daemonWithinBudget?: boolean;
  cpuCores?: number;
  cpuModel?: string;
  platform?: string;
  uptimeSeconds?: number;
}

export interface BrainAgent {
  agent_id: string;
  cluster_id: string;
  name: string;
  agent_type: string;
  status: "ACTIVE" | "HIBERNATED" | "PAUSED_NUDGE" | "KILLED_LOOP" | string;
  model_tier: "FRONTIER" | "DOWNGRADED_FAST" | string;
  ram_usage: number;
  cpu_usage: number;
  tokens_used: number;
  current_task: string | null;
  locked_file_path: string | null;
  loop_score: number;
  last_heartbeat_at: string | Date;
}

export interface BrainTask {
  task_id: string;
  cluster_id: string;
  prompt_summary: string;
  complexity_score: number;
  assigned_agents: number;
  hibernated_count: number;
  tokens_saved: number;
  loop_incidents: number;
  interception_ms: number;
  status: string;
  created_at: string | Date;
}

export interface BrainCluster {
  cluster_id: string;
  user_id: string;
  name: string;
  environment: "CLOUD" | "LOCAL_PC" | string;
  active_agents: number;
  hibernated_agents: number;
  cached_context_hash: string | null;
  cache_tokens_saved: number;
  zero_trust_local: boolean;
  agents: BrainAgent[];
  tasks: BrainTask[];
}

export interface BrainWallet {
  id: string;
  user_id: string;
  plan_id: string;
  free_tokens: number;
  paid_tokens: number;
  max_agents: number;
  purchase_status: string;
  plan?: {
    plan_id: string;
    name: string;
    price: number;
    agent_limit: number;
    included_tokens: number;
    description: string;
  };
}

export interface BrainActionResponse {
  success: boolean;
  action: string;
  message?: string;
  error?: string;
  plan?: any;
  agent?: BrainAgent;
  evaluation?: any;
  mutexResult?: any;
  governance?: any;
  tokensDeducted?: number;
  updatedWallet?: {
    free_tokens: number;
    paid_tokens: number;
  };
}

export interface BrainContextValue {
  hardware: BrainHardware | null;
  cloudCluster: BrainCluster | null;
  localCluster: BrainCluster | null;
  wallet: BrainWallet | null;
  interceptionLatencyMs: number;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refreshBrain: () => Promise<void>;
  executeBrainAction: (
    action: string,
    payload?: Record<string, unknown>
  ) => Promise<BrainActionResponse>;
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

const BrainContext = createContext<BrainContextValue | undefined>(undefined);

const POLLING_INTERVAL_MS = 3000;

export function BrainProvider({ children }: { children: React.ReactNode }) {
  const [hardware, setHardware] = useState<BrainHardware | null>(null);
  const [cloudCluster, setCloudCluster] = useState<BrainCluster | null>(null);
  const [localCluster, setLocalCluster] = useState<BrainCluster | null>(null);
  const [wallet, setWallet] = useState<BrainWallet | null>(null);
  const [interceptionLatencyMs, setInterceptionLatencyMs] = useState<number>(18);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const isFetchingRef = useRef<boolean>(false);

  // Poll /api/brain
  const refreshBrain = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const res = await fetch("/api/brain", {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch /api/brain: ${res.statusText}`);
      }

      const data = await res.json();

      if (isMountedRef.current && data.success) {
        if (data.hardware) setHardware(data.hardware);
        if (data.cloudCluster) setCloudCluster(data.cloudCluster);
        if (data.localCluster) setLocalCluster(data.localCluster);
        if (data.wallet) setWallet(data.wallet);
        if (typeof data.interceptionLatencyMs === "number") {
          setInterceptionLatencyMs(data.interceptionLatencyMs);
        }
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.warn("[BrainContext] Telemetry poll warning:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
      isFetchingRef.current = false;
    }
  }, []);

  // Execute action on /api/brain and immediately refresh state
  const executeBrainAction = useCallback(
    async (
      action: string,
      payload: Record<string, unknown> = {}
    ): Promise<BrainActionResponse> => {
      try {
        const res = await fetch("/api/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });

        const data: BrainActionResponse = await res.json();

        // Refresh state immediately after action to sync UI
        await refreshBrain();

        return data;
      } catch (err) {
        console.error(`[BrainContext] Action execution error (${action}):`, err);
        // Refresh anyway to restore consistent state
        await refreshBrain();
        throw err;
      }
    },
    [refreshBrain]
  );

  useEffect(() => {
    isMountedRef.current = true;
    // Initial fetch
    refreshBrain();

    // 3-second background polling
    const interval = setInterval(() => {
      refreshBrain();
    }, POLLING_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [refreshBrain]);

  return (
    <BrainContext.Provider
      value={{
        hardware,
        cloudCluster,
        localCluster,
        wallet,
        interceptionLatencyMs,
        isLoading,
        error,
        lastUpdated,
        refreshBrain,
        executeBrainAction,
      }}
    >
      {children}
    </BrainContext.Provider>
  );
}

/**
 * Access the shared ArgusOps Brain Context.
 */
export function useBrain(): BrainContextValue {
  const context = useContext(BrainContext);
  if (!context) {
    throw new Error("useBrain must be used within a BrainProvider");
  }
  return context;
}

