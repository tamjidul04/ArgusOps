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
import { Badge, DashHeader, EmptyState, Panel, Segmented, buttonClasses } from "@/components/ui";

/** One figure in the headline strip. */
function Cell({ label, value, sub, badge, className, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; badge?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <dt className="text-xs text-slate-500">{label}</dt>
        {badge}
      </div>
      <dd className="tabular mt-1.5 truncate text-2xl font-semibold tracking-[-0.02em] text-slate-900">{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-slate-400">{sub}</dd>}
      {children}
    </div>
  );
}

const rowBtn = "inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]";
const rowBtnDark = "inline-flex h-7 items-center rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.98]";

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
  const { environment, setEnvironment, profile } = useDashboard();
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

  // File locks held by this account's agents (from the database)
  interface LockRow {
    id: string;
    path: string;
    holder: string;
    queued: string | null;
    status: string;
  }
  const [mutexLocks, setMutexLocks] = useState<LockRow[]>([]);
  const toLockRows = (rows: Array<{ id: string; filePath: string; holderAgent: string; queuedAgent: string | null; status: string }>): LockRow[] =>
    rows.map((l) => ({ id: l.id, path: l.filePath, holder: l.holderAgent, queued: l.queuedAgent, status: l.status }));

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/local-bridge", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.fileLocks)) setMutexLocks(toLockRows(d.fileLocks));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainLocalCluster]);

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
  const activeCount = agents.filter((a) => a.status === "ACTIVE").length;
  const hibernatedCount = agents.filter((a) => a.status === "HIBERNATED").length;
  const pausedCount = agents.filter((a) => a.status === "PAUSED_NUDGE").length;
  const killedCount = agents.filter((a) => a.status === "KILLED_LOOP").length;
  const totalCount = agents.length;
  const allocationPct = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;

  const tokensSaved = activeCluster?.cache_tokens_saved ?? 0;
  const freeTokens = profile?.freeTokens ?? 0;
  // Estimate at a $3 per million input-token list price; real per-request savings arrive with usage tracking.
  const costSaved = +((tokensSaved / 1_000_000) * 3).toFixed(2);
  const totalRamMb = agents.reduce((acc, a) => acc + (a.ram_usage || 0), 0);
  const totalRamGb = hardware
    ? hardware.usedRamGb.toFixed(2)
    : (Math.max(1420, totalRamMb) / 1024).toFixed(2);

  // 1. Interactive action caller wired to BrainContext
  const handleClusterAction = async (
    action: string,
    payload: { agentId?: string; targetStatus?: string } = {}
  ) => {
    const callGuardrail = async (guardAction: string, body: Record<string, unknown>) => {
      const res = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: guardAction, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      setToastMessage({
        type: res.ok ? "success" : "error",
        text: data.message || data.error || (res.ok ? "Done." : "Action failed."),
      });
      if (res.ok) await refreshBrain();
    };
    const pausedAgentId = agents.find((a) => a.status === "PAUSED_NUDGE")?.agent_id;

    try {
      // Stop an agent: the selected one, or the one waiting on review.
      if (action === "SIMULATE_ROGUE_LOOP" || action === "TRIGGER_ROGUE_LOOP" || action === "KILL_AGENT") {
        const agentId = payload.agentId ?? pausedAgentId;
        if (!agentId) {
          setToastMessage({ type: "info", text: "Pick an agent to stop first." });
          return;
        }
        await callGuardrail("TRIGGER_KILL_SWITCH", { agentId });
        return;
      }

      // Resume a paused agent.
      if (action === "APPROVE_NUDGE" || action === "TRIGGER_HUMAN_NUDGE" || action === "RESUME_AGENT") {
        const agentId = payload.agentId ?? pausedAgentId;
        if (!agentId) {
          setToastMessage({ type: "info", text: "No agent is waiting for review right now." });
          return;
        }
        await callGuardrail("SEND_NUDGE", { agentId });
        return;
      }

      // Planning preview (analysis only; changes nothing).
      if (action === "AUTO_RIGHT_SIZE" || action === "DECOMPOSE_TASK") {
        const res = await executeBrainAction("DECOMPOSE_TASK");
        setToastMessage({
          type: res.success ? "success" : "error",
          text: res.message || res.error || "Plan preview ready.",
        });
        return;
      }

      // Hibernate / wake an agent
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

  // 4. Release a file lock (server-side, owner only)
  const handleReleaseLock = async (id: string) => {
    try {
      const res = await fetch("/api/local-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RELEASE_LOCK", lockId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.fileLocks)) {
        setMutexLocks(toLockRows(data.fileLocks));
        setToastMessage({ type: "success", text: data.message || "File lock released." });
      } else {
        setToastMessage({ type: "error", text: data.error || "Could not release the lock." });
      }
    } catch {
      setToastMessage({ type: "error", text: "Network error releasing the lock." });
    }
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
          role="status"
          className={cn(
            "pop-in fixed bottom-5 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-[13px] font-medium shadow-lift sm:right-6",
            toastMessage.type === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
            toastMessage.type === "error" && "border-red-200 bg-red-50 text-red-900",
            toastMessage.type === "info" && "on-dark border-slate-800 bg-slate-900 text-white"
          )}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />}
          {toastMessage.type === "error" && <AlertCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />}
          {toastMessage.type === "info" && <Zap className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} aria-label="Dismiss message" className="ml-1 rounded-md p-1 text-inherit hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DashHeader
        title="Agent cluster telemetry and loop interception"
        description="Real-time supervisor orchestrating autonomous nodes, AST recursion traps, and memory bus quota."
        actions={
          <>
            <button
              onClick={async () => {
                await refreshBrain();
                setToastMessage({
                  type: "success",
                  text: "Live telemetry stream synchronized across cluster.",
                });
              }}
              className={buttonClasses("secondary", false)}
            >
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Sync Live
            </button>
            <button onClick={() => handleClusterAction("AUTO_RIGHT_SIZE")} className={buttonClasses("primary", false)}>
              Deploy Agent
            </button>
          </>
        }
      />

      {/* Headline numbers: one large figure (the wallet), four supporting ones */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 lg:grid-cols-4 lg:grid-rows-2 [&>*]:bg-white">
        <div className="col-span-2 flex min-w-0 flex-col justify-between p-5 lg:row-span-2 lg:p-6">
          <div>
            <div className="flex items-start justify-between gap-2">
              <dt className="text-xs text-slate-500">Free token balance</dt>
              <Badge>{profile.planName}</Badge>
            </div>
            <dd className="tabular mt-3 truncate text-5xl font-semibold tracking-[-0.035em] text-slate-900 lg:text-6xl">{freeTokens.toLocaleString("en-US")}</dd>
            <dd className="mt-1.5 text-[13px] text-slate-500">
              tokens left · paid balance <span className="tabular font-mono text-slate-900">{profile.paidTokens.toLocaleString("en-US")}</span>
            </dd>
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Agent slots</span>
              <span className="tabular font-mono text-slate-900">
                {profile.activeAgents}/{profile.maxAgents}
              </span>
            </div>
            <div className="mt-2 flex gap-1" role="meter" aria-label="Agent slots in use" aria-valuemin={0} aria-valuemax={profile.maxAgents} aria-valuenow={profile.activeAgents}>
              {Array.from({ length: Math.max(1, Math.min(profile.maxAgents, 20)) }, (_, i) => (
                <span
                  key={i}
                  className={cn("h-1.5 flex-1 rounded-full", i < profile.activeAgents ? "bg-slate-900" : "bg-slate-100")}
                  style={{ transition: `background-color 300ms ${i * 40}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
        <Cell label="Tokens saved" value="1.24M" sub="Cache traps and dedup" badge={<Badge tone="green">+9.4x</Badge>} />
        <Cell label="Cost saved" value={`$${costSaved.toFixed(2)}`} sub="Cached context, list price" />
        <Cell label="Active vs. hibernated" value="33%" sub="2 active · 4 hibernated">
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-label="Active share of pool" aria-valuemin={0} aria-valuemax={100} aria-valuenow={33}>
            <div className="h-full rounded-full bg-slate-900" style={{ width: "33%" }} />
          </div>
        </Cell>
        <Cell label="Memory" value="1.42 GB" sub="of 8.00 GB limit" />
      </dl>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Active Swarm Process Matrix"
          action={
            <Segmented
              label="Matrix view"
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: "matrix", label: "Active Swarm" },
                { value: "all_nodes", label: "All Cluster Nodes (100)" },
              ]}
            />
          }
          bodyClassName="p-0 sm:p-0"
        >
          {activeTab === "matrix" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                    <th scope="col" className="px-4 py-2">Agent</th>
                    <th scope="col" className="hidden px-4 py-3 2xl:table-cell">Process Path</th>
                    <th scope="col" className="px-4 py-2">Status</th>
                    <th scope="col" className="px-4 py-2">Memory</th>
                    <th scope="col" className="px-4 py-2">Tokens Used</th>
                    <th scope="col" className="px-4 py-2 text-right">Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="whitespace-nowrap font-medium text-slate-900">Agent #01</span>
                        <span className="whitespace-nowrap text-slate-600">(Claude)</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-600 2xl:table-cell">
                      <div>pid:81204</div>
                      <div>/usr/bin/claude</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone="green">Running</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-900">320 MB</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-900">14,200</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleClusterAction("TOGGLE_AGENT_STATUS", { agentId: "agent_local_claude", targetStatus: "HIBERNATED" })}
                        className={rowBtn}
                      >
                        Pause
                      </button>
                    </td>
                  </tr>

                  <tr className="bg-amber-50/40 transition-colors hover:bg-amber-50/70">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                        <span className="whitespace-nowrap font-medium text-slate-900">Agent #02</span>
                        <span className="whitespace-nowrap text-slate-600">(Antigravity)</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-600 2xl:table-cell">
                      <div>pid:84920</div>
                      <div>/opt/antigravity</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone="amber">Paused Loop</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-amber-900">680 MB</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-900">42,100</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={handleNudgeAndPause} className={rowBtn}>
                          Nudge
                        </button>
                        <button onClick={handleKillSwitch} className={rowBtnDark}>
                          Terminate
                        </button>
                      </div>
                    </td>
                  </tr>

                  <tr className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <span className="whitespace-nowrap font-medium text-slate-900">Agent #03</span>
                        <span className="whitespace-nowrap text-slate-600">(Hermes)</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-600 2xl:table-cell">
                      <div>pid:89011</div>
                      <div>/usr/local/hermes</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge>Standby</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-900">45 MB</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-900">2,800</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleClusterAction("TOGGLE_AGENT_STATUS", { agentId: "agent_local_hermes", targetStatus: "ACTIVE" })}
                        className={rowBtn}
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
            <div className="space-y-3 p-5">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>Displaying 100-Agent Cloud Cluster Swarm</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["ALL", "ACTIVE", "HIBERNATED", "PAUSED_NUDGE", "KILLED_LOOP"].map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      aria-pressed={statusFilter === st}
                      className={cn(
                        "rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
                        statusFilter === st ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-900/10"
                      )}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {filteredAgents.length === 0 ? (
                <EmptyState icon={Layers} title="No agents match this filter">
                  Run an agent with <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs">argus run claude</code> and it appears here.
                </EmptyState>
              ) : (
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {filteredAgents.slice(0, 100).map((ag) => (
                    <li key={ag.agent_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedAgent(ag)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              ag.status === "ACTIVE" ? "bg-emerald-500" : ag.status === "PAUSED_NUDGE" ? "bg-amber-500" : ag.status === "KILLED_LOOP" ? "bg-red-500" : "bg-slate-300"
                            )}
                          />
                          <span className="truncate font-semibold text-slate-900">{ag.name}</span>
                          <span className="hidden font-mono text-xs text-slate-600 sm:inline">{ag.agent_type}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-slate-700">
                          <span className="hidden sm:inline">{ag.ram_usage} MB</span>
                          <span className="hidden sm:inline">{ag.tokens_used.toLocaleString("en-US")} tok</span>
                          <Badge tone={ag.status === "ACTIVE" ? "green" : ag.status === "PAUSED_NUDGE" ? "amber" : ag.status === "KILLED_LOOP" ? "red" : "neutral"}>{ag.status}</Badge>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>

        <Panel
          title="Loop Intercepted: Agent #02"
          action={<Badge tone="amber">94% SIMILARITY</Badge>}
          className="h-full xl:col-span-1"
          bodyClassName="flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div className="rounded-md bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-700 border border-slate-200">
              <span className="font-semibold text-slate-900">fetch_vector_chunks</span> repeated 14x in 8.2ms. AST circuit breaker tripped.
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                Intercept Latency: <strong className="text-slate-900">&lt; 8.2ms</strong>
              </span>
              <span className="text-xs font-medium text-emerald-700">(0 overruns &bull; Healthy)</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <button onClick={handleNudgeAndPause} className={buttonClasses("secondary", false, "flex-1")}>
              Nudge &amp; Pause
            </button>
            <button onClick={handleKillSwitch} className={buttonClasses("primary", false, "flex-1 bg-red-700 hover:bg-red-800")}>
              Kill Switch (Terminate)
            </button>
          </div>
        </Panel>
      </div>


      {/* Subsystems */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <Panel title="Hibernated & Bridge Overview" action={<Badge>Subsystems</Badge>} bodyClassName="flex flex-col p-0 sm:p-0">
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  Hermes Pool (4 Workers)
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-600">pid:89011..14 &bull; 0 MB &bull; 0 tok/s</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge>Hibernated</Badge>
                <button
                  onClick={() => handleClusterAction("TOGGLE_AGENT_STATUS", { agentId: "agent_local_hermes", targetStatus: "ACTIVE" })}
                  className={rowBtn}
                >
                  Wake
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Local PC Bridge
                </div>
                <div className="mt-0.5 font-mono text-xs text-slate-600">ipc:socket0 &bull; &lt;150MB RAM</div>
              </div>
              <Link href="/dashboard/local-bridge" className="inline-flex h-7 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100">
                Direct Sync
              </Link>
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 text-xs">
            <span className="text-slate-600">Zero-Token Standby</span>
            <span className="font-semibold text-emerald-700">Auto-wake Ready</span>
          </div>
        </Panel>

        <Panel title="Local PC File-Locking Mutex" action={<span className="whitespace-nowrap font-mono text-xs text-slate-600">{mutexLocks.length} Active Locks</span>} bodyClassName="space-y-3">
          {mutexLocks.length === 0 ? (
            <EmptyState icon={Unlock} title="No files are locked" className="py-6">
              Files agents are editing are locked here so none overwrite another.
            </EmptyState>
          ) : (
            mutexLocks.map((lock) => {
              const isPausedLoop = lock.status === "PAUSED_LOOP";

              return (
                <div
                  key={lock.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md p-3.5 text-sm ring-1",
                    isPausedLoop ? "bg-amber-50/50 ring-amber-600/20" : "bg-slate-50 ring-slate-900/[0.07]"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-semibold text-slate-900">{lock.path}</div>
                    <div className={cn("mt-0.5 text-xs", isPausedLoop ? "text-amber-800" : "text-slate-600")}>
                      {isPausedLoop
                        ? "Locked by Antigravity \u2022 Paused Loop"
                        : lock.queued
                          ? `Locked by ${lock.holder} \u2022 ${lock.queued} waiting`
                          : `Locked by ${lock.holder}`}
                    </div>
                  </div>
                  <button onClick={() => handleReleaseLock(lock.id)} className={cn("shrink-0", isPausedLoop ? rowBtnDark : rowBtn)}>
                    {isPausedLoop ? "Unlock" : "Release"}
                  </button>
                </div>
              );
            })
          )}
        </Panel>

        <Panel title="Model Router & Shared Context Cache" action={<Badge tone="green">98.4% Hit</Badge>} bodyClassName="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-slate-900">Shared AST Context Graph</span>
              <span className="font-mono text-xs font-semibold text-slate-900">1.80M tokens</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">Zero duplicated tokens across concurrent agent sessions</p>
          </div>
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-slate-900">Smart Model Downgrading</span>
              <span className="font-mono text-xs font-semibold text-slate-900">64% routed</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">Fast/local models assigned for repetitive leaf executions</p>
          </div>
        </Panel>

        <Panel title="Hardware & Quota Guardrails" action={<Badge tone="green">Enforced</Badge>} bodyClassName="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <span className="text-slate-600">PC Daemon Ceiling</span>
            <span className="font-mono text-xs font-semibold text-slate-900">68 MB / 150 MB Max</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <span className="text-slate-600">Loop Kill Threshold</span>
            <span className="font-mono text-xs font-semibold text-red-700">&lt; 100ms / 14 retries</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">Free Tier Agent Cap</span>
            <span className="font-mono text-xs font-semibold text-slate-900">2 / 3 Active Slots</span>
          </div>
        </Panel>
      </div>

      {/* Agent Detail Modal (if clicked) */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onKeyDown={(e) => e.key === "Escape" && setSelectedAgent(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="agent-title" className="max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="agent-title" className="text-lg font-semibold tracking-tight text-slate-900">
                  Agent Inspector: {selectedAgent.name}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-slate-600">ID: {selectedAgent.agent_id}</p>
              </div>
              <button onClick={() => setSelectedAgent(null)} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <dl className="space-y-3 rounded-md bg-slate-50 p-4 text-sm border border-slate-200">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Status:</dt>
                <dd className="font-semibold text-slate-900">{selectedAgent.status}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Model Tier:</dt>
                <dd className="font-semibold text-slate-900">{selectedAgent.model_tier}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">RAM Usage:</dt>
                <dd className="font-mono text-xs font-semibold text-slate-900">{selectedAgent.ram_usage} MB</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Tokens Used:</dt>
                <dd className="font-mono text-xs font-semibold text-slate-900">{selectedAgent.tokens_used.toLocaleString("en-US")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Current Task:</dt>
                <dd className="max-w-[200px] truncate text-right text-slate-800">{selectedAgent.current_task || "Idle"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => setSelectedAgent(null)} className={buttonClasses("secondary", false)}>
                Close
              </button>
              <button
                onClick={() => {
                  handleClusterAction("SIMULATE_ROGUE_LOOP", { agentId: selectedAgent.agent_id });
                  setSelectedAgent(null);
                }}
                className={buttonClasses("primary", false, "bg-red-700 hover:bg-red-800")}
              >
                Stop agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer info strip */}
      <div className="flex flex-col items-start justify-between gap-2 border-t border-slate-200 pt-6 text-xs text-slate-600 sm:flex-row sm:items-center">
        <span>
          Plan: <span className="font-mono text-slate-800">{profile.planName}</span>
        </span>
        <span>
          Owner: <strong className="text-slate-900">{profile?.name}</strong>
        </span>
      </div>
    </div>
  );
}

