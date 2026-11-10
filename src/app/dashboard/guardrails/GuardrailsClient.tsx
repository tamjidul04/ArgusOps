"use client";

import React, { useEffect, useState } from "react";
import { useBrain } from "@/context/BrainContext";
import {
  Shield,
  AlertTriangle,
  Zap,
  Activity,
  Cpu,
  Sliders,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Sparkles,
  TrendingDown,
  Terminal,
  MessageSquare,
  Lock,
  RefreshCw,
  X,
  Send,
  AlertOctagon,
  Clock,
  ArrowRight,
} from "lucide-react";
import { cn, formatTokens, getStatusBadgeClasses, STATUS_STYLES, AgentStatus } from "@/lib/utils";
import type { GuardrailPolicy, StreamEvent } from "@/lib/control-plane-core";
import { Badge, DashHeader, EmptyState, Panel, buttonClasses } from "@/components/ui";

/** One labelled range input with its current value and a hint line. */
function PolicySlider({
  id, label, value, valueText, min, max, step, hint, onChange,
}: {
  id: string; label: string; value: number; valueText: string; min: string; max: string; step: string; hint: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-slate-900">{label}</label>
        <span className="shrink-0 font-mono text-xs font-semibold text-slate-900">{valueText}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
      />
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Event times arrive as ISO strings from the incident log. */
function formatEventTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

interface AgentData {
  agent_id: string;
  name: string;
  status: string;
  model_tier: string;
  ram_usage: number;
  cpu_usage: number;
  tokens_used: number;
  current_task: string | null;
  loop_score: number;
}

interface GuardrailsClientProps {
  initialPolicy: GuardrailPolicy;
  initialStreamEvents: StreamEvent[];
  initialFlaggedAgents: AgentData[];
  initialActiveAgents: AgentData[];
  initialLatency: { avg: number; p99: number };
}

export function GuardrailsClient({
  initialPolicy,
  initialStreamEvents,
  initialFlaggedAgents,
  initialActiveAgents,
  initialLatency,
}: GuardrailsClientProps) {
  const { cloudCluster } = useBrain();
  const [latency, setLatency] = useState(initialLatency);

  // State
  const [policy, setPolicy] = useState<GuardrailPolicy>(initialPolicy);
  const [events, setEvents] = useState<StreamEvent[]>(initialStreamEvents);
  const [flaggedAgents, setFlaggedAgents] = useState<AgentData[]>(initialFlaggedAgents);
  const [activeAgents, setActiveAgents] = useState<AgentData[]>(initialActiveAgents);

  // Compute live synchronized agents from BrainContext if available
  const displayedFlaggedAgents: AgentData[] =
    cloudCluster?.agents && cloudCluster.agents.some((a) => a.status === "PAUSED_NUDGE" || a.status === "KILLED_LOOP" || a.loop_score >= 0.5)
      ? cloudCluster.agents
          .filter(
            (a) =>
              a.status === "PAUSED_NUDGE" ||
              a.status === "KILLED_LOOP" ||
              a.loop_score >= 0.5 ||
              a.ram_usage >= 180
          )
          .map((a) => ({
            agent_id: a.agent_id,
            name: a.name,
            status: a.status,
            model_tier: a.model_tier,
            ram_usage: a.ram_usage,
            cpu_usage: a.cpu_usage,
            tokens_used: a.tokens_used,
            current_task: a.current_task,
            loop_score: a.loop_score,
          }))
      : flaggedAgents;

  const displayedActiveAgents: AgentData[] =
    cloudCluster?.agents && cloudCluster.agents.filter((a) => a.status === "ACTIVE").length > 0
      ? cloudCluster.agents
          .filter((a) => a.status === "ACTIVE")
          .slice(0, 12)
          .map((a) => ({
            agent_id: a.agent_id,
            name: a.name,
            status: a.status,
            model_tier: a.model_tier,
            ram_usage: a.ram_usage,
            cpu_usage: a.cpu_usage,
            tokens_used: a.tokens_used,
            current_task: a.current_task,
            loop_score: a.loop_score,
          }))
      : activeAgents;

  // Nudge Modal state
  const [nudgeModalAgent, setNudgeModalAgent] = useState<AgentData | null>(null);
  const [nudgeHintText, setNudgeHintText] = useState("");
  const [suggestion, setSuggestion] = useState<{
    id: string;
    text: string;
    observed: string;
    tokensBefore: number;
    tokensAfter: number;
    source: string;
  } | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);

  useEffect(() => {
    if (!nudgeModalAgent) return;
    let cancelled = false;
    (async () => {
      setSuggestionLoading(true);
      try {
        const res = await fetch(`/api/rewrites?agentId=${encodeURIComponent(nudgeModalAgent.agent_id)}`, { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setSuggestion(data?.suggestion ?? null);
        setNudgeHintText(data?.suggestion?.text ?? "");
      } catch {
        if (!cancelled) setSuggestion(null);
      } finally {
        if (!cancelled) setSuggestionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nudgeModalAgent]);

  // Feedback notifications
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Execute Guardrail Action
  const executeGuardrailAction = async (action: string, payload: Record<string, unknown> = {}) => {
    setFeedback({ type: "info", text: "Processing hypervisor guardrail action..." });

    try {
      // All guardrail actions go through /api/guardrails (scoped to the signed-in user)
      const res = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", text: data.error || "Action failed." });
        return;
      }

      setFeedback({ type: "success", text: data.message });

      // Refresh local state based on action
      if (data.policy) setPolicy(data.policy);

      if (data.agent) {
        // Update in lists
        setFlaggedAgents((prev) =>
          prev.map((a) => (a.agent_id === data.agent.agent_id ? { ...a, ...data.agent } : a))
        );
        setActiveAgents((prev) =>
          prev.map((a) => (a.agent_id === data.agent.agent_id ? { ...a, ...data.agent } : a))
        );
      }

      // Re-fetch current state to sync stream
      const getRes = await fetch("/api/guardrails");
      if (getRes.ok) {
        const fresh = await getRes.json();
        if (fresh.streamEvents) setEvents(fresh.streamEvents);
        if (fresh.flaggedAgents) setFlaggedAgents(fresh.flaggedAgents);
        if (fresh.activeAgents) setActiveAgents(fresh.activeAgents);
        if (typeof fresh.avgLatencyMs === "number") setLatency({ avg: fresh.avgLatencyMs, p99: fresh.p99LatencyMs ?? 0 });
      }
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", text: "Communication error with guardrails API." });
    }
  };

  const handleSavePolicy = () => {
    executeGuardrailAction("UPDATE_POLICY", { policy });
  };

  const handleConfirmNudge = async () => {
    if (!nudgeModalAgent) return;
    const agent = nudgeModalAgent;
    setNudgeModalAgent(null);
    if (!suggestion) {
      executeGuardrailAction("SEND_NUDGE", { agentId: agent.agent_id, agentName: agent.name, hintText: nudgeHintText });
      return;
    }
    try {
      const res = await fetch("/api/rewrites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", id: suggestion.id, text: nudgeHintText }),
      });
      const data = await res.json().catch(() => ({}));
      setFeedback({ type: res.ok ? "success" : "error", text: data.message || data.error || "Done." });
      const fresh = await fetch("/api/guardrails");
      if (fresh.ok) {
        const g = await fresh.json();
        if (g.streamEvents) setEvents(g.streamEvents);
        if (g.flaggedAgents) setFlaggedAgents(g.flaggedAgents);
        if (g.activeAgents) setActiveAgents(g.activeAgents);
      }
    } catch {
      setFeedback({ type: "error", text: "Couldn't reach the server." });
    }
  };

  const handleDismissSuggestion = async () => {
    if (!suggestion) return;
    await fetch("/api/rewrites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", id: suggestion.id }),
    }).catch(() => undefined);
    setSuggestion(null);
    setNudgeHintText("");
  };

  return (
    <div className="space-y-6">
      <DashHeader
        title="Loop detection & guardrails"
        description="Watch incidents as they happen, set when agents are paused, and review the ones that need you."
        actions={
          <>
            <Badge tone="green">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Latency: {latency.avg > 0 ? `${latency.avg}ms avg` : "no incidents yet"}
            </Badge>
            <Badge>P99: {latency.p99 > 0 ? `${latency.p99}ms` : "—"}</Badge>
          </>
        }
      />

      {/* Action Notification Toast */}
      {feedback && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between rounded-md px-4 py-3 text-sm ring-1",
            feedback.type === "success" && "bg-emerald-50 text-emerald-900 ring-emerald-600/20",
            feedback.type === "error" && "bg-red-50 text-red-900 ring-red-600/20",
            feedback.type === "info" && "bg-slate-50 text-slate-800 ring-slate-900/10"
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
            {feedback.type === "error" && <XCircle className="h-4 w-4 text-rose-600 shrink-0" />}
            {feedback.type === "info" && <RefreshCw className="h-4 w-4 text-slate-600 animate-spin shrink-0" />}
            <span className="font-medium">{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message" className="rounded-md p-1 text-slate-500 hover:text-slate-800">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ================= SECTION 1: LIVE STREAM INSPECTOR & POLICY SLIDERS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Live Stream Inspector */}
        <Panel
          className="lg:col-span-2"
          title="Live Loop Detection Stream Inspector"
          description="Every loop ArgusOps catches, newest first."
          action={<Badge tone="green"><span className="h-1.5 w-1.5 live-dot rounded-full bg-emerald-500" />Stream active</Badge>}
        >
          {events.length === 0 ? (
            <EmptyState icon={Activity} title="No loops caught yet">
              When an agent repeats itself, the incident shows up here with the pattern, the action taken and how fast it was caught.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {events.map((evt) => {
                const isExact = evt.eventType === "EXACT_TOOL_LOOP";
                const isSemantic = evt.eventType === "SEMANTIC_REASONING_LOOP";

                return (
                  <li
                    key={evt.id}
                    className={cn(
                      "space-y-2 rounded-md p-4 ring-1",
                      isExact && "bg-red-50/50 ring-red-600/15",
                      isSemantic && "bg-amber-50/50 ring-amber-600/20",
                      !isExact && !isSemantic && "bg-slate-900/[0.025] ring-slate-900/[0.07]"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <time className="font-mono text-xs text-slate-500">{formatEventTime(evt.timestamp)}</time>
                        <strong className="text-sm font-semibold text-slate-900">{evt.agentName}</strong>
                        <Badge tone={isExact ? "red" : isSemantic ? "amber" : "neutral"}>{evt.eventType.replace(/_/g, " ")}</Badge>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge tone="green">{evt.latencyMs}ms Latency</Badge>
                        <span
                          className={cn(
                            "rounded-md px-2.5 py-0.5 text-[11px] font-medium",
                            evt.actionTaken === "KILLED_LOOP" && "bg-red-700 text-white",
                            evt.actionTaken === "PAUSED_NUDGE" && "bg-amber-600 text-white",
                            evt.actionTaken === "THROTTLED" && "bg-slate-800 text-white",
                            evt.actionTaken === "FLAGGED" && "bg-slate-200 text-slate-800"
                          )}
                        >
                          {evt.actionTaken}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed text-slate-700">{evt.summary}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
                      {evt.toolName && (
                        <span>
                          Tool: <code className="font-mono font-semibold text-slate-900">{evt.toolName}</code>
                        </span>
                      )}
                      {evt.similarityScore !== undefined && (
                        <span>
                          Cosine Similarity: <strong className="font-semibold text-amber-800">{evt.similarityScore}</strong>
                        </span>
                      )}
                      {evt.retryCount !== undefined && (
                        <span>
                          Consecutive Errors: <strong className="font-semibold text-red-800">{evt.retryCount}x</strong>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Right Column (1/3): Configurable Policy Sliders */}
        <Panel title="Guardrail Policy" icon={Sliders} action={<Badge tone="green">Active</Badge>} bodyClassName="space-y-6">
          <PolicySlider
            id="policy-retries"
            label="Max Consecutive Retries"
            value={policy.maxConsecutiveRetries}
            valueText={`${policy.maxConsecutiveRetries} Retries`}
            min="1" max="8" step="1"
            hint="Trips circuit breaker on repeated tool failures."
            onChange={(v) => setPolicy({ ...policy, maxConsecutiveRetries: v })}
          />
          <PolicySlider
            id="policy-similarity"
            label="Semantic Similarity Cap"
            value={policy.semanticSimilarityThreshold}
            valueText={`${policy.semanticSimilarityThreshold} Cosine`}
            min="0.75" max="0.98" step="0.01"
            hint="Catches agents repeating identical thoughts in different phrasing."
            onChange={(v) => setPolicy({ ...policy, semanticSimilarityThreshold: v })}
          />
          <PolicySlider
            id="policy-nudge"
            label="Nudge vs. Kill Threshold"
            value={policy.nudgeCompletionThreshold}
            valueText={`>= ${policy.nudgeCompletionThreshold}% Task`}
            min="50" max="95" step="5"
            hint="Pauses instead of killing if task completion is high."
            onChange={(v) => setPolicy({ ...policy, nudgeCompletionThreshold: v })}
          />
          <PolicySlider
            id="policy-ram"
            label="Max RAM per Agent"
            value={policy.maxRamPerAgentMb}
            valueText={`${policy.maxRamPerAgentMb} MB`}
            min="100" max="400" step="10"
            hint="Cgroups clamp resident memory to prevent host OOM."
            onChange={(v) => setPolicy({ ...policy, maxRamPerAgentMb: v })}
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-md bg-slate-50 p-3.5 border border-slate-200">
            <input
              type="checkbox"
              checked={policy.autoApplyRewrites}
              onChange={(e) => setPolicy({ ...policy, autoApplyRewrites: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-slate-900"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">Auto-resume stuck agents</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                Resume with the suggested instruction instead of waiting for you. At most once per 30 minutes per agent; you are still notified.
              </span>
            </span>
          </label>

          <button type="button" onClick={handleSavePolicy} className={buttonClasses("primary", false, "w-full")}>
            Save Guardrail Policy
          </button>
        </Panel>
      </div>

      {/* ================= SECTION 2: FLAGGED AGENTS REVIEW QUEUE ================= */}
      <Panel
        title="Flagged Agents & Human-in-the-Loop Review Queue"
        icon={AlertOctagon}
        description="Take supervisory actions: supply hint, throttle model tier, or execute hard kill-switch."
        action={<Badge tone={displayedFlaggedAgents.length > 0 ? "amber" : "neutral"}>{displayedFlaggedAgents.length} Agents Flagged</Badge>}
        bodyClassName="p-0 sm:p-0"
      >
        {displayedFlaggedAgents.length === 0 ? (
          <EmptyState icon={Shield} title="Nothing needs your review">
            Agents that pause, loop or get stopped will queue up here so you can resume or stop them.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                  <th scope="col" className="px-5 py-3">Agent Node</th>
                  <th scope="col" className="px-5 py-3">Status</th>
                  <th scope="col" className="px-5 py-3">Loop Threat Score</th>
                  <th scope="col" className="px-5 py-3">RAM / CPU</th>
                  <th scope="col" className="px-5 py-3">Current Subtask</th>
                  <th scope="col" className="px-5 py-3 text-right">Supervisory Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/5">
                {displayedFlaggedAgents.map((agent) => {
                  const statusStyle = STATUS_STYLES[agent.status as AgentStatus] || STATUS_STYLES.HIBERNATED;

                  return (
                    <tr key={agent.agent_id} className="transition-colors hover:bg-slate-900/[0.02]">
                      <td className="px-5 py-3.5 font-semibold text-slate-900">
                        {agent.name}
                        <span className="block font-mono text-[11px] font-normal text-slate-500">{agent.agent_id}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn("inline-flex items-center rounded-md px-2.5 py-0.5 text-[11px] font-medium", statusStyle.badge)}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-semibold">
                        <span className={cn(agent.loop_score > 0.8 ? "text-red-700" : agent.loop_score > 0.5 ? "text-amber-700" : "text-emerald-700")}>
                          {agent.loop_score}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600">
                        {agent.ram_usage} MB • {agent.cpu_usage}%
                      </td>
                      <td className="max-w-xs truncate px-5 py-3.5 text-slate-600">{agent.current_task || "No active task"}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        {agent.status === "PAUSED_NUDGE" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setNudgeModalAgent(agent)}
                              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                            >
                              <Send className="h-3 w-3" aria-hidden="true" />
                              <span>Send Hint &amp; Resume</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => executeGuardrailAction("THROTTLE_DOWNGRADE", { agentId: agent.agent_id })}
                              className="inline-flex items-center rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 transition-colors hover:bg-slate-50"
                            >
                              Throttle Model
                            </button>
                            <button
                              type="button"
                              onClick={() => executeGuardrailAction("TRIGGER_KILL_SWITCH", { agentId: agent.agent_id })}
                              className="inline-flex items-center rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
                            >
                              Kill Switch
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setNudgeModalAgent(agent)}
                            className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 transition-colors hover:bg-slate-50"
                          >
                            Operator Action
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ================= SECTION 3: PER-AGENT RAM & CPU GOVERNANCE PANEL ================= */}
      <Panel
        title="Per-Agent RAM & CPU Governance Panel"
        icon={Cpu}
        description="Autonomous cgroup bus governors prevent low-complexity agent memory leaks from exhausting the host."
      >
        {displayedActiveAgents.length === 0 ? (
          <EmptyState icon={Cpu} title="No agents running">
            Start an agent with <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs">argus run claude</code> and its memory and CPU show up here.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayedActiveAgents.map((agent) => {
              const ramPct = Math.min(100, Math.round((agent.ram_usage / policy.maxRamPerAgentMb) * 100));
              const isNearCap = agent.ram_usage > policy.maxRamPerAgentMb * 0.8;

              return (
                <div key={agent.agent_id} className="space-y-3 rounded-md bg-slate-900/[0.025] p-4 text-sm border border-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900">{agent.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">{agent.model_tier}</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between font-mono text-xs">
                      <span className="text-slate-600">RAM</span>
                      <strong className={cn("font-semibold", isNearCap ? "text-red-700" : "text-slate-900")}>
                        {agent.ram_usage} MB / {policy.maxRamPerAgentMb} MB
                      </strong>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cn("h-full rounded-full transition-[width] duration-200 ease-spring", isNearCap ? "bg-red-500" : "bg-slate-800")}
                        style={{ width: `${ramPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between font-mono text-xs">
                      <span className="text-slate-600">CPU</span>
                      <span className="font-semibold text-slate-900">{agent.cpu_usage}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-spring"
                        style={{ width: `${Math.min(100, agent.cpu_usage * 3)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ================= SEND NUDGE MODAL ================= */}
      {nudgeModalAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onKeyDown={(e) => e.key === "Escape" && setNudgeModalAgent(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nudge-title"
            className="max-h-[90dvh] w-full max-w-lg space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 id="nudge-title" className="text-base font-semibold tracking-tight text-slate-900">
                    Resume with an instruction
                  </h3>
                  <p className="text-xs text-slate-600">
                    Target: <strong className="text-slate-900">{nudgeModalAgent.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNudgeModalAgent(null)}
                aria-label="Close"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {suggestionLoading && <p className="text-sm text-slate-600">Loading suggestion…</p>}
            {suggestion && (
              <div className="space-y-2 rounded-md bg-emerald-50/70 p-4 text-sm ring-1 ring-emerald-600/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-900">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Suggested instruction
                  </span>
                  <span className="text-xs font-medium text-emerald-800">
                    {suggestion.source === "AI" ? "Written by AI from the repeated steps" : "Written by ArgusOps rules from the repeated steps"}
                  </span>
                </div>
                <p className="text-slate-700">{suggestion.observed}</p>
                {suggestion.tokensBefore > 0 && (
                  <p className="text-xs text-slate-600">
                    The loop cost about {suggestion.tokensBefore.toLocaleString("en-US")} tokens; this instruction adds about {suggestion.tokensAfter.toLocaleString("en-US")}.
                  </p>
                )}
                <button type="button" onClick={handleDismissSuggestion} className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900">
                  Dismiss suggestion
                </button>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="nudge-text" className="block text-sm font-medium text-slate-900">
                {suggestion ? "Instruction to send (you can edit it)" : "Instruction to send"}
              </label>
              <textarea
                id="nudge-text"
                autoFocus
                value={nudgeHintText}
                onChange={(e) => setNudgeHintText(e.target.value)}
                rows={suggestion ? 6 : 3}
                className="w-full resize-none rounded-md bg-white p-3.5 text-sm text-slate-900 border border-slate-200 transition-shadow placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="e.g. Stop re-running the tests; read the error and fix the cause first."
              />
              <p className="text-xs text-slate-600">The agent resumes, and this text is added to its next request to the model.</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setNudgeModalAgent(null)} className={buttonClasses("secondary", false)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmNudge}
                className={buttonClasses("primary", false, "bg-emerald-700 hover:bg-emerald-800")}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{suggestion ? "Approve & resume" : "Send & resume"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

