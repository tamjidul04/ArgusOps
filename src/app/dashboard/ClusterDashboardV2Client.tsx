"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import {
  Activity,
  Layers,
  Shield,
  Zap,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Lock,
  Unlock,
  Check,
  X,
  FileCode,
  ArrowRight,
  RefreshCw,
  Clock,
  Laptop,
  Cloud,
  ChevronDown,
} from "lucide-react";
import { cn, formatTokens, formatCurrency } from "@/lib/utils";
import { useDashboard } from "@/components/layout";
import { useBrain } from "@/context/BrainContext";

export interface AgentRecord {
  agent_id: string;
  cluster_id: string;
  name: string;
  agent_type: string;
  status: "ACTIVE" | "HIBERNATED" | "PAUSED_NUDGE" | "KILLED_LOOP" | string;
  model_tier: string;
  ram_usage: number;
  cpu_usage: number;
  tokens_used: number;
  current_task: string | null;
  locked_file_path: string | null;
  loop_score: number;
  last_heartbeat_at: string;
}

export interface ClusterTelemetryData {
  cluster_id: string;
  name: string;
  environment: string;
  active_agents: number;
  hibernated_agents: number;
  cache_tokens_saved: number;
  cached_context_hash: string | null;
  agents: AgentRecord[];
}

interface ClusterDashboardV2ClientProps {
  initialCloudCluster: ClusterTelemetryData | null;
  initialLocalCluster: ClusterTelemetryData | null;
}

export function ClusterDashboardV2Client({
  initialCloudCluster,
  initialLocalCluster,
}: ClusterDashboardV2ClientProps) {
  const { environment, setEnvironment, persona, profile } = useDashboard();
  const {
    hardware,
    cloudCluster: brainCloudCluster,
    localCluster: brainLocalCluster,
    interceptionLatencyMs,
    executeBrainAction,
    refreshBrain,
  } = useBrain();
  const [isPending, startTransition] = useTransition();

  // State
  const [cloudCluster, setCloudCluster] =
    useState<ClusterTelemetryData | null>(initialCloudCluster);
  const [localCluster, setLocalCluster] =
    useState<ClusterTelemetryData | null>(initialLocalCluster);
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null);
  const [activeTab, setActiveTab] = useState<
    "matrix" | "all_nodes" | "incidents"
  >("matrix");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Sync state from BrainContext background polling
  React.useEffect(() => {
    if (brainCloudCluster) {
      setCloudCluster(brainCloudCluster as unknown as ClusterTelemetryData);
    }
    if (brainLocalCluster) {
      setLocalCluster(brainLocalCluster as unknown as ClusterTelemetryData);
    }
  }, [brainCloudCluster, brainLocalCluster]);

  // Mutex locks state
  const [mutexLocks, setMutexLocks] = useState([
    {
      id: "lck-01",
      path: "src/auth/jwt_session.ts",
      holder: "Claude",
      queued: "Hermes",
      status: "LOCKED",
    },
    {
      id: "lck-02",
      path: "prisma/schema.prisma",
      holder: "Antigravity",
      queued: null,
      status: "PAUSED_LOOP",
    },
  ]);

  // Toast / Status notification
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Auto-dismiss toast
  React.useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const activeCluster = environment === "LOCAL_PC" ? localCluster : cloudCluster;
  const agents = activeCluster?.agents || [];

  // Metrics
  const activeCount = agents.filter((a) => a.status === "ACTIVE").length || 2;
  const hibernatedCount =
    agents.filter((a) => a.status === "HIBERNATED").length || 4;
  const pausedCount = agents.filter((a) => a.status === "PAUSED_NUDGE").length;
  const killedCount = agents.filter((a) => a.status === "KILLED_LOOP").length;
  const totalCount = agents.length || 6;
  const allocationPct = Math.round((activeCount / totalCount) * 100) || 33;

  const tokensSaved = activeCluster?.cache_tokens_saved || 1240000;
  const freeTokens = profile?.freeTokens ?? 84520;
  const costSaved = 18.73;
  const totalRamMb = agents.reduce((acc, a) => acc + (a.ram_usage || 0), 0);
  const totalRamGb = hardware
    ? hardware.usedRamGb.toFixed(2)
    : (Math.max(1420, totalRamMb) / 1024).toFixed(2);

  // 1. Interactive action caller wired to BrainContext
  const handleClusterAction = async (
    action: string,
    payload: { agentId?: string; targetStatus?: string } = {}
  ) => {
    try {
      if (action === "SIMULATE_ROGUE_LOOP" || action === "TRIGGER_ROGUE_LOOP") {
        const res = await executeBrainAction("TRIGGER_ROGUE_LOOP", {
          agentId: payload.agentId,
        });
        setToastMessage({
          type: "success",
          text: res.message || "Circuit breaker tripped: Rogue agent terminated.",
        });
        return;
      }

      if (action === "APPROVE_NUDGE" || action === "TRIGGER_HUMAN_NUDGE") {
        const res = await executeBrainAction("TRIGGER_HUMAN_NUDGE", {
          agentId: payload.agentId,
        });
        setToastMessage({
          type: "success",
          text: res.message || "Human-in-the-Loop Nudge alert triggered (paused at 91%).",
        });
        return;
      }

      if (action === "AUTO_RIGHT_SIZE" || action === "DECOMPOSE_TASK") {
        const res = await executeBrainAction("DECOMPOSE_TASK");
        setToastMessage({
          type: "success",
          text: res.message || "Cluster auto-rightsized and decomposed into active modules.",
        });
        return;
      }

      // Fallback for custom status toggles
      const res = await fetch("/api/clusters/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          clusterId: activeCluster?.cluster_id,
          ...payload,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message || "Cluster state updated.",
        });
        await refreshBrain();
      } else {
        setToastMessage({
          type: "error",
          text: data.error || "Action failed.",
        });
      }
    } catch {
      setToastMessage({ type: "error", text: "Network error executing action." });
    }
  };

  // 2. Nudge & Pause action
  const handleNudgeAndPause = () => {
    handleClusterAction("APPROVE_NUDGE");
  };

  // 3. Kill Switch action
  const handleKillSwitch = () => {
    handleClusterAction("SIMULATE_ROGUE_LOOP");
  };

  // 4. Release Mutex Lock
  const handleReleaseLock = (id: string) => {
    setMutexLocks((prev) => prev.filter((l) => l.id !== id));
    setToastMessage({
      type: "info",
      text: "File-locking mutex released. Waiting agents unblocked cleanly.",
    });
  };

  // Filtered agents for table
  const filteredAgents =
    statusFilter === "ALL"
      ? agents
      : agents.filter((a) => a.status === statusFilter);

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium transition-all animate-in fade-in slide-in-from-bottom-2",
            toastMessage.type === "success" &&
              "bg-emerald-50 border-emerald-200 text-emerald-800",
            toastMessage.type === "error" &&
              "bg-rose-50 border-rose-200 text-rose-800",
            toastMessage.type === "info" &&
              "bg-slate-900 border-slate-800 text-white"
          )}
        >
          {toastMessage.type === "success" && (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          )}
          {toastMessage.type === "error" && (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          {toastMessage.type === "info" && (
            <Zap className="w-5 h-5 text-amber-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 hover:opacity-75 text-inherit"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header matching 03-dashboard-cluster-v2.png */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Agent cluster telemetry and loop interception
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time supervisor orchestrating autonomous nodes, AST recursion traps, and memory bus quota.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              await refreshBrain();
              setToastMessage({
                type: "success",
                text: "Live telemetry stream synchronized across cluster.",
              });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Sync Live
          </button>

          <button
            onClick={() => {
              handleClusterAction("AUTO_RIGHT_SIZE");
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-slate-800 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer"
          >
            Deploy Agent
          </button>
        </div>
      </div>

      {/* TOP SECTION: ASYMMETRIC METRIC & INTERCEPTION GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left 2 Cols: 5 KPI Cards arranged in 2 sub-rows */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sub-row 1: 2 Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Card 1: Active vs. Hibernated Allocation */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500">
                  Active vs. Hibernated Allocation
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
                  6 nodes pool
                </span>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
                  33%
                </div>
                <div className="text-xs text-slate-500 mt-1 font-mono">
                  (2 Active / 4 Hibernated &mdash; 0 tok/s idle)
                </div>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-slate-900 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: "33%" }}
                />
              </div>
            </div>

            {/* Card 2: Tokens Saved */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500">
                  Tokens Saved
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  +9.4x eff
                </span>
              </div>
              <div>
                <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
                  1.24M
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  AST Cache Traps Active
                </div>
                <div className="text-xs text-slate-400">
                  Deduplication Active
                </div>
              </div>
            </div>
          </div>

          {/* Sub-row 2: 3 Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Card 3: Free Token Balance */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">
                  Free Token Balance
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
                  100k cap
                </span>
              </div>
              <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono mt-1">
                84,520
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1 mt-2 overflow-hidden">
                <div className="bg-slate-900 h-1 rounded-full w-[84.5%]" />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                <span>84.5% remaining</span>
                <span>Resets in 18d</span>
              </div>
            </div>

            {/* Card 4: Cost Saved */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between">
              <div className="text-xs font-medium text-slate-500 mb-1">
                Cost Saved
              </div>
              <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono mt-1">
                $18.73
              </div>
              <div className="text-[11px] text-slate-400 mt-3 border-t border-slate-100 pt-2">
                <div>vs unmanaged</div>
                <div className="text-[10px]">Calculated rate</div>
              </div>
            </div>

            {/* Card 5: Memory */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between">
              <div className="text-xs font-medium text-slate-500 mb-1">
                Memory
              </div>
              <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono mt-1">
                1.42 GB
              </div>
              <div className="text-[11px] text-slate-400 mt-3 border-t border-slate-100 pt-2">
                <div>&lt;8.00 GB limit</div>
                <div className="text-[10px]">Pool headroom</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Loop Interception Panel matching 03-dashboard-cluster-v2.png */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-xs font-bold text-slate-900">
                  Loop Intercepted: Agent #02
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-rose-950 text-rose-300">
                94% SIMILARITY
              </span>
            </div>

            {/* Code Box */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-700 leading-relaxed mb-4">
              <span className="font-semibold text-slate-900">
                fetch_vector_chunks
              </span>{" "}
              repeated 14x in 8.2ms. AST circuit breaker tripped.
            </div>

            <div className="flex items-center justify-between text-xs text-slate-600 mb-4">
              <span>
                Intercept Latency: <strong className="text-slate-900">&lt; 8.2ms</strong>
              </span>
              <span className="text-emerald-700 font-medium text-[11px]">
                (0 overruns &bull; Healthy)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={handleNudgeAndPause}
              className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors text-center cursor-pointer"
            >
              Nudge &amp; Pause
            </button>
            <button
              onClick={handleKillSwitch}
              className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-black hover:bg-slate-800 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Kill Switch (Terminate)
            </button>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION: ACTIVE SWARM PROCESS MATRIX + HIBERNATED OVERVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (2 Cols): Active Swarm Process Matrix */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-slate-900">
                  Active Swarm Process Matrix
                </h2>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
                  <button
                    onClick={() => setActiveTab("matrix")}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md font-semibold transition-all",
                      activeTab === "matrix"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    Active Swarm
                  </button>
                  <button
                    onClick={() => setActiveTab("all_nodes")}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md font-semibold transition-all",
                      activeTab === "all_nodes"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    All Cluster Nodes (100)
                  </button>
                </div>
              </div>

              <span className="text-xs text-slate-400 font-mono">
                Daemon: v1.4.0 (Zero-Trust Local Code)
              </span>
            </div>

            {activeTab === "matrix" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                      <th className="py-3 px-5">Agent</th>
                      <th className="py-3 px-5">Process Path</th>
                      <th className="py-3 px-5">Status</th>
                      <th className="py-3 px-5">Memory</th>
                      <th className="py-3 px-5">Tokens Used</th>
                      <th className="py-3 px-5 text-right">Control</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                    {/* Row 1: Agent #01 (Claude) */}
                    <tr className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span className="font-bold text-slate-900">
                            Agent #01
                          </span>
                          <span className="text-slate-500 font-normal">
                            (Claude)
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-[11px] text-slate-500">
                        <div>pid:81204</div>
                        <div>/usr/bin/claude</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Running
                        </span>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-900">
                        320 MB
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-900">
                        14,200
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() =>
                            handleClusterAction("TOGGLE_AGENT_STATUS", {
                              agentId: "agent_local_claude",
                              targetStatus: "HIBERNATED",
                            })
                          }
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors shadow-2xs"
                        >
                          Pause
                        </button>
                      </td>
                    </tr>

                    {/* Row 2: Agent #02 (Antigravity) */}
                    <tr className="bg-rose-50/20 hover:bg-rose-50/40 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                          <span className="font-bold text-rose-900">
                            Agent #02
                          </span>
                          <span className="text-rose-700 font-medium">
                            (Antigravity)
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-[11px] text-slate-500">
                        <div>pid:84920</div>
                        <div>/opt/antigravity</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          Paused Loop
                        </span>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-rose-900 font-bold">
                        680 MB
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-900">
                        42,100
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={handleNudgeAndPause}
                            className="px-2 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors"
                          >
                            Nudge
                          </button>
                          <button
                            onClick={handleKillSwitch}
                            className="px-2 py-1 text-xs font-semibold text-white bg-black hover:bg-slate-800 rounded transition-colors"
                          >
                            Terminate
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Row 3: Agent #03 (Hermes) */}
                    <tr className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-slate-400" />
                          <span className="font-bold text-slate-900">
                            Agent #03
                          </span>
                          <span className="text-slate-500 font-normal">
                            (Hermes)
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-[11px] text-slate-500">
                        <div>pid:89011</div>
                        <div>/usr/local/hermes</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          Standby
                        </span>
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-900">
                        45 MB
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-900">
                        2,800
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() =>
                            handleClusterAction("TOGGLE_AGENT_STATUS", {
                              agentId: "agent_local_hermes",
                              targetStatus: "ACTIVE",
                            })
                          }
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors shadow-2xs"
                        >
                          Wake / Inspect
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              /* All 100 Cluster Nodes View */
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-100">
                  <span>Displaying 100-Agent Cloud Cluster Swarm</span>
                  <div className="flex items-center gap-2">
                    {["ALL", "ACTIVE", "HIBERNATED", "PAUSED_NUDGE", "KILLED_LOOP"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
                          statusFilter === st
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {filteredAgents.slice(0, 100).map((ag) => (
                    <div
                      key={ag.agent_id}
                      onClick={() => setSelectedAgent(ag)}
                      className="py-2 px-3 flex items-center justify-between text-xs hover:bg-slate-50 cursor-pointer rounded"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            ag.status === "ACTIVE"
                              ? "bg-emerald-500"
                              : ag.status === "PAUSED_NUDGE"
                              ? "bg-amber-500"
                              : ag.status === "KILLED_LOOP"
                              ? "bg-rose-500"
                              : "bg-slate-300"
                          )}
                        />
                        <span className="font-semibold text-slate-900">
                          {ag.name}
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {ag.agent_type}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 font-mono text-[11px]">
                        <span>{ag.ram_usage} MB</span>
                        <span>{ag.tokens_used.toLocaleString()} tok</span>
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded text-[10px] font-bold uppercase",
                            ag.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700"
                              : ag.status === "PAUSED_NUDGE"
                              ? "bg-amber-50 text-amber-700"
                              : ag.status === "KILLED_LOOP"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {ag.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col): Hibernated & Bridge Overview */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Hibernated &amp; Bridge Overview
              </h2>
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                Subsystems
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Hermes Pool (4 Workers) */}
              <div className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    Hermes Pool (4 Workers)
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    pid:89011..14 &bull; 0 MB &bull; 0 tok/s
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    Hibernated
                  </span>
                  <button
                    onClick={() =>
                      handleClusterAction("TOGGLE_AGENT_STATUS", {
                        agentId: "agent_local_hermes",
                        targetStatus: "ACTIVE",
                      })
                    }
                    className="px-2 py-0.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded"
                  >
                    Wake
                  </button>
                </div>
              </div>

              {/* Local PC Bridge */}
              <div className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Local PC Bridge
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    ipc:socket0 &bull; &lt;150MB RAM
                  </div>
                </div>

                <div>
                  <Link
                    href="/dashboard/local-bridge"
                    className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors inline-block"
                  >
                    Direct Sync
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400">Zero-Token Standby</span>
            <span className="font-semibold text-emerald-600">
              Auto-wake Ready
            </span>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: 3 CARDS SIDE-BY-SIDE matching 03-dashboard-cluster-v2.png */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Local PC File-Locking Mutex */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Local PC File-Locking Mutex
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {mutexLocks.length} Active Locks
              </span>
            </div>

            <div className="space-y-3">
              {mutexLocks.map((lock) => {
                const isPausedLoop = lock.status === "PAUSED_LOOP";

                return (
                  <div
                    key={lock.id}
                    className={cn(
                      "p-3 rounded-lg border text-xs flex items-center justify-between transition-all",
                      isPausedLoop
                        ? "bg-rose-50/30 border-rose-200"
                        : "bg-slate-50/70 border-slate-200"
                    )}
                  >
                    <div>
                      <div
                        className={cn(
                          "font-mono font-bold",
                          isPausedLoop ? "text-rose-900" : "text-slate-900"
                        )}
                      >
                        {lock.path}
                      </div>
                      <div
                        className={cn(
                          "text-[11px] mt-0.5",
                          isPausedLoop ? "text-rose-600" : "text-slate-500"
                        )}
                      >
                        {isPausedLoop
                          ? "Locked by Antigravity \u2022 Paused Loop"
                          : `Locked by ${lock.holder} \u2022 ${lock.queued} Queued`}
                      </div>
                    </div>

                    <div>
                      {isPausedLoop ? (
                        <button
                          onClick={() => handleReleaseLock(lock.id)}
                          className="px-3 py-1 text-xs font-semibold text-white bg-black hover:bg-slate-800 rounded transition-colors"
                        >
                          Unlock
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReleaseLock(lock.id)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors"
                        >
                          Release
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 2: Model Router & Shared Context Cache */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Model Router &amp; Shared Context Cache
              </h3>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                98.4% Hit
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    Shared AST Context Graph
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    1.80M tokens
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Zero duplicated tokens across concurrent agent sessions
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    Smart Model Downgrading
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    64% routed
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Fast/local models assigned for repetitive leaf executions
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Hardware & Quota Guardrails */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Hardware &amp; Quota Guardrails
              </h3>
              <span className="text-xs font-mono text-slate-400">
                Enforced
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-600">PC Daemon Ceiling</span>
                <span className="font-mono font-bold text-slate-900">
                  68 MB / 150 MB Max
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-slate-600">Loop Kill Threshold</span>
                <span className="font-mono font-bold text-rose-600">
                  &lt; 100ms / 14 retries
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600">Free Tier Agent Cap</span>
                <span className="font-mono font-bold text-slate-900">
                  2 / 3 Active Slots
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Detail Modal (if clicked) */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Agent Inspector: {selectedAgent.name}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  ID: {selectedAgent.agent_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <strong className="text-slate-900">{selectedAgent.status}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Model Tier:</span>
                <strong className="text-slate-900">{selectedAgent.model_tier}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RAM Usage:</span>
                <strong className="font-mono text-slate-900">{selectedAgent.ram_usage} MB</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tokens Used:</span>
                <strong className="font-mono text-slate-900">{selectedAgent.tokens_used.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Task:</span>
                <span className="text-slate-700 text-right max-w-[200px] truncate">{selectedAgent.current_task || "Idle"}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setSelectedAgent(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Close
              </button>
              <button
                onClick={() => {
                  handleClusterAction("SIMULATE_ROGUE_LOOP", { agentId: selectedAgent.agent_id });
                  setSelectedAgent(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                Simulate Rogue Loop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info Strip matching 03-dashboard-cluster-v2.png */}
      <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <span>Cluster ID: <span className="font-mono text-slate-700">us-east-cluster-09</span></span>
          <span>&bull;</span>
          <span>Daemon: <span className="text-slate-700">v1.4.0 (Zero-Trust Local Code)</span></span>
        </div>
        <div>
          <span>Owner: <strong className="text-slate-800">{profile?.name || "MD.Tamjidul Islam"}</strong></span>
        </div>
      </div>
    </div>
  );
}

