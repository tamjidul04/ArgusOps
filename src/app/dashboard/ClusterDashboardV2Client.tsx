"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Layers,
  Zap,
  CheckCircle2,
  AlertCircle,
  Unlock,
  X,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { useDashboard } from "@/components/layout";
import { useBrain } from "@/context/BrainContext";
import { Badge, DashHeader, EmptyState, Panel, Segmented, buttonClasses } from "@/components/ui";
import { WeekUsage } from "./WeekUsage";

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

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "neutral"; dot: string }> = {
  ACTIVE: { label: "Running", tone: "green", dot: "bg-emerald-500" },
  PAUSED_NUDGE: { label: "Paused", tone: "amber", dot: "bg-amber-500" },
  KILLED_LOOP: { label: "Stopped", tone: "red", dot: "bg-red-500" },
  HIBERNATED: { label: "Hibernated", tone: "neutral", dot: "bg-slate-400" },
};
const statusOf = (status: string) => STATUS[status] ?? { label: status, tone: "neutral" as const, dot: "bg-slate-400" };

function ago(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

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
  const { environment, profile } = useDashboard();
  const {
    hardware,
    cloudCluster: brainCloudCluster,
    localCluster: brainLocalCluster,
    interceptionLatencyMs,
    executeBrainAction,
    refreshBrain,
  } = useBrain();

  // State
  // Live data from the dashboard context, falling back to what the server rendered first.
  const cloudCluster = (brainCloudCluster as unknown as ClusterTelemetryData | null) ?? initialCloudCluster;
  const localCluster = (brainLocalCluster as unknown as ClusterTelemetryData | null) ?? initialLocalCluster;
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

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
  const totalCount = agents.length;
  const allocationPct = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;

  const tokensSaved = activeCluster?.cache_tokens_saved ?? 0;
  const freeTokens = profile?.freeTokens ?? 0;
  // Estimate at a $3 per million input-token list price; real per-request savings arrive with usage tracking.
  const costSaved = +((tokensSaved / 1_000_000) * 3).toFixed(2);
  const totalRamMb = agents.reduce((acc, a) => acc + (a.ram_usage || 0), 0);
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

  const pausedAgents = agents.filter((a) => a.status === "PAUSED_NUDGE");

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
        title="Overview"
        description="Your agents, token balance and what needs you."
        actions={
          <>
            <button
              onClick={async () => {
                await refreshBrain();
                setToastMessage({ type: "success", text: "Refreshed." });
              }}
              className={buttonClasses("secondary", false)}
            >
              Refresh
            </button>
            <Link href="/docs#getting-started" className={buttonClasses("primary", false)}>
              How to start an agent
            </Link>
          </>
        }
      />

      {/* Headline numbers: one large figure (the wallet), four supporting ones */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 lg:grid-cols-4 lg:grid-rows-2 [&>*]:bg-white">
        <div className="col-span-2 flex min-w-0 flex-col justify-between gap-6 p-5 lg:row-span-2 lg:p-6 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] 2xl:gap-8">
          <div className="flex min-w-0 flex-col justify-between">
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
          <div className="min-w-0 border-t border-slate-100 pt-5 2xl:border-l 2xl:border-t-0 2xl:pl-8 2xl:pt-0">
            <WeekUsage />
          </div>
        </div>
        <Cell label="Tokens saved" value={formatTokens(tokensSaved)} sub="served from the context cache" />
        <Cell label="Cost saved" value={`$${costSaved.toFixed(2)}`} sub="Estimate at list prices" />
        <Cell label="Agents" value={`${activeCount} active`} sub={`${hibernatedCount} hibernated · ${pausedCount} paused`}>
          {totalCount > 0 && (
            <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-label="Share of agents that are active" aria-valuemin={0} aria-valuemax={100} aria-valuenow={allocationPct}>
              <div className="h-full rounded-full bg-slate-900" style={{ width: `${allocationPct}%` }} />
            </div>
          )}
        </Cell>
        <Cell label="Agent memory" value={totalRamMb > 0 ? `${Math.round(totalRamMb).toLocaleString("en-US")} MB` : "—"} sub="reported by your agents" />
      </dl>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Agents"
          action={
            <Segmented
              label="Filter agents by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "ALL", label: "All" },
                { value: "ACTIVE", label: "Running" },
                { value: "PAUSED_NUDGE", label: "Paused" },
                { value: "HIBERNATED", label: "Hibernated" },
                { value: "KILLED_LOOP", label: "Stopped" },
              ]}
            />
          }
          bodyClassName="p-0 sm:p-0"
        >
          {filteredAgents.length === 0 ? (
            <EmptyState icon={Layers} title={agents.length === 0 ? "No agents yet" : "No agents match this filter"}>
              {agents.length === 0 ? (
                <>
                  Run an agent with <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">argus run claude</code> and it appears here.
                </>
              ) : (
                "Try another status."
              )}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                    <th scope="col" className="px-4 py-2">Agent</th>
                    <th scope="col" className="px-4 py-2">Status</th>
                    <th scope="col" className="px-4 py-2">Memory</th>
                    <th scope="col" className="px-4 py-2">Tokens used</th>
                    <th scope="col" className="px-4 py-2">Last seen</th>
                    <th scope="col" className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredAgents.map((a) => {
                    const st = statusOf(a.status);
                    return (
                      <tr key={a.agent_id} className={cn("transition-colors hover:bg-slate-50", a.status === "PAUSED_NUDGE" && "bg-amber-50/40")}>
                        <td className="px-4 py-2.5">
                          <button type="button" onClick={() => setSelectedAgent(a)} className="flex items-center gap-2 text-left" aria-label={`Inspect ${a.name}`}>
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", st.dot)} />
                            <span className="whitespace-nowrap font-medium text-slate-900">{a.name}</span>
                            <span className="font-mono text-xs text-slate-500">{a.agent_type}</span>
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-900">{a.ram_usage > 0 ? `${Math.round(a.ram_usage)} MB` : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-900">{a.tokens_used.toLocaleString("en-US")}</td>
                        <td className="px-4 py-2.5 text-slate-600" suppressHydrationWarning>{ago(a.last_heartbeat_at)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {a.status === "PAUSED_NUDGE" && (
                              <>
                                <button onClick={() => handleClusterAction("APPROVE_NUDGE", { agentId: a.agent_id })} className={rowBtn}>Resume</button>
                                <button onClick={() => handleClusterAction("KILL_AGENT", { agentId: a.agent_id })} className={rowBtnDark}>Stop</button>
                              </>
                            )}
                            {a.status === "ACTIVE" && (
                              <button onClick={() => handleClusterAction("KILL_AGENT", { agentId: a.agent_id })} className={rowBtn}>Stop</button>
                            )}
                            {a.status === "HIBERNATED" && (
                              <button onClick={() => handleClusterAction("TOGGLE_AGENT_STATUS", { agentId: a.agent_id, targetStatus: "ACTIVE" })} className={rowBtn}>Wake</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Needs you"
          action={pausedAgents.length > 0 ? <Badge tone="amber">{pausedAgents.length} paused</Badge> : undefined}
          className="h-full"
          bodyClassName="flex flex-col gap-3"
        >
          {pausedAgents.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing needs you" className="py-8">
              {interceptionLatencyMs > 0
                ? `Loops are checked in about ${Math.round(interceptionLatencyMs)} ms.`
                : "No loops caught yet. If an agent gets stuck, it shows up here."}
            </EmptyState>
          ) : (
            pausedAgents.slice(0, 3).map((a) => (
              <div key={a.agent_id} className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{a.name}</span>
                  {a.loop_score > 0 && a.loop_score <= 1 && <Badge tone="amber">{Math.round(a.loop_score * 100)}% similar</Badge>}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                  {a.current_task ? (a.current_task.length > 140 ? `${a.current_task.slice(0, 139)}…` : a.current_task) : "Paused because it looked stuck."}
                </p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => handleClusterAction("APPROVE_NUDGE", { agentId: a.agent_id })} className={rowBtn}>Resume</button>
                  <button onClick={() => handleClusterAction("KILL_AGENT", { agentId: a.agent_id })} className={rowBtnDark}>Stop</button>
                </div>
              </div>
            ))
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <Panel title="Hibernated agents" action={<Badge>{hibernatedCount}</Badge>} bodyClassName="space-y-2">
          {hibernatedCount === 0 ? (
            <EmptyState icon={Layers} title="None hibernated" className="py-6">
              Agents you put to sleep are listed here, and can be woken in one click.
            </EmptyState>
          ) : (
            agents
              .filter((a) => a.status === "HIBERNATED")
              .slice(0, 6)
              .map((a) => (
                <div key={a.agent_id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-900">{a.name}</span>
                  <button onClick={() => handleClusterAction("TOGGLE_AGENT_STATUS", { agentId: a.agent_id, targetStatus: "ACTIVE" })} className={rowBtn}>Wake</button>
                </div>
              ))
          )}
        </Panel>

        <Panel title="File locks" action={<span className="whitespace-nowrap font-mono text-xs text-slate-600">{mutexLocks.length} {mutexLocks.length === 1 ? "lock" : "locks"}</span>} bodyClassName="space-y-3">
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

        <Panel title="Context cache" bodyClassName="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <span className="text-slate-600">Tokens saved</span>
            <span className="tabular font-mono text-xs font-medium text-slate-900">{formatTokens(tokensSaved)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600">Cached context</span>
            <span className="font-mono text-xs font-medium text-slate-900">{activeCluster?.cached_context_hash ? activeCluster.cached_context_hash.slice(0, 12) : "none yet"}</span>
          </div>
        </Panel>

        <Panel title="Limits" bodyClassName="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <span className="text-slate-600">Agent slots in use</span>
            <span className="tabular font-mono text-xs font-medium text-slate-900">
              {profile.activeAgents} of {profile.maxAgents}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <span className="text-slate-600">Loop check time</span>
            <span className="tabular font-mono text-xs font-medium text-slate-900">{interceptionLatencyMs > 0 ? `${Math.round(interceptionLatencyMs)} ms` : "—"}</span>
          </div>
          {hardware && (
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <span className="text-slate-600">Daemon memory</span>
              <span className="tabular font-mono text-xs font-medium text-slate-900">{Math.round(hardware.daemonMemoryMb)} MB</span>
            </div>
          )}
          <Link href="/dashboard/guardrails" className="inline-block font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
            Edit loop thresholds
          </Link>
        </Panel>
      </div>

      {/* Agent Detail Modal (if clicked) */}
      {selectedAgent && (
        <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onKeyDown={(e) => e.key === "Escape" && setSelectedAgent(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="agent-title" className="rise-in max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200">
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

