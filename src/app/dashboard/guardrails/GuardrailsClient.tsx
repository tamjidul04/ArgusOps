"use client";

import React, { useState } from "react";
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
import { GuardrailPolicy, StreamEvent } from "@/app/api/guardrails/route";

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
}

export function GuardrailsClient({
  initialPolicy,
  initialStreamEvents,
  initialFlaggedAgents,
  initialActiveAgents,
}: GuardrailsClientProps) {
  const { cloudCluster, interceptionLatencyMs, executeBrainAction } = useBrain();

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
  const [nudgeHintText, setNudgeHintText] = useState(
    "Skip foreign-key constraints in test environment and commit batch directly."
  );

  // Feedback notifications
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Execute Guardrail Action
  const executeGuardrailAction = async (action: string, payload: Record<string, unknown> = {}) => {
    setFeedback({ type: "info", text: "Processing hypervisor guardrail action..." });

    try {
      if (action === "TEST_MEMORY_SPIKE" || action === "THROTTLE_DOWNGRADE") {
        const res = await executeBrainAction("THROTTLE_RAM_SPIKE", {
          agentId: payload.agentId as string | undefined,
        });

        if (!res.success) {
          setFeedback({ type: "error", text: res.error || "Action failed." });
          return;
        }

        const msg = res.message || "Memory bus throttled agent to safe limits.";
        setFeedback({ type: "success", text: msg });
        setEvents((prev) => [
          {
            id: `evt-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            agentId: (payload.agentId as string) || "agent_governed",
            agentName: (payload.agentName as string) || "Cloud-Worker",
            eventType: "MEMORY_GOVERNANCE",
            latencyMs: interceptionLatencyMs || 28,
            actionTaken: "THROTTLED",
            summary: msg,
          },
          ...prev,
        ]);
        return;
      }

      if (action === "SEND_NUDGE") {
        const res = await executeBrainAction("RESOLVE_NUDGE", {
          agentId: payload.agentId as string,
          decision: "RESUME",
          hintText: payload.hintText as string,
        });

        if (!res.success) {
          setFeedback({ type: "error", text: res.error || "Action failed." });
          return;
        }

        const msg = res.message || `Human hint applied to ${payload.agentName || payload.agentId}. Resumed.`;
        setFeedback({ type: "success", text: msg });
        setEvents((prev) => [
          {
            id: `evt-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            agentId: payload.agentId as string,
            agentName: (payload.agentName as string) || (payload.agentId as string),
            eventType: "SEMANTIC_REASONING_LOOP",
            similarityScore: 0.89,
            latencyMs: interceptionLatencyMs || 34,
            actionTaken: "FLAGGED",
            summary: `Human operator supplied hint: "${payload.hintText}". Agent loop cleared and resumed.`,
          },
          ...prev,
        ]);
        return;
      }

      if (action === "TRIGGER_KILL_SWITCH") {
        const res = await executeBrainAction("RESOLVE_NUDGE", {
          agentId: payload.agentId as string,
          decision: "KILL",
        });

        if (!res.success) {
          setFeedback({ type: "error", text: res.error || "Action failed." });
          return;
        }

        const msg = res.message || "Agent terminated by operator kill switch.";
        setFeedback({ type: "success", text: msg });
        setEvents((prev) => [
          {
            id: `evt-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            agentId: payload.agentId as string,
            agentName: (payload.agentName as string) || (payload.agentId as string),
            eventType: "EXACT_TOOL_LOOP",
            latencyMs: interceptionLatencyMs || 14,
            actionTaken: "KILLED_LOOP",
            summary: `Manual kill switch triggered. Agent terminated with 0 token burn.`,
          },
          ...prev,
        ]);
        return;
      }

      // Default to /api/guardrails for policy updates and stream evaluations
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
      }
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", text: "Communication error with guardrails API." });
    }
  };

  const handleSavePolicy = () => {
    executeGuardrailAction("UPDATE_POLICY", { policy });
  };

  const handleConfirmNudge = () => {
    if (!nudgeModalAgent) return;
    executeGuardrailAction("SEND_NUDGE", {
      agentId: nudgeModalAgent.agent_id,
      agentName: nudgeModalAgent.name,
      hintText: nudgeHintText,
    });
    setNudgeModalAgent(null);
  };

  return (
    <div className="space-y-6">
      {/* ================= PAGE TITLE & SLA BANNER ================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              24/7 Loop Detection &amp; Resource Guardrails
            </h1>
            <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              Autonomous Hypervisor
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time AST stream inspection, cosine semantic reasoning loop detection, and RAM/CPU cgroup governance.
          </p>
        </div>

        {/* Live SLA Badges */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-slate-500">Latency:</span>
            <strong className="text-slate-900 font-bold">&lt; 100ms ({interceptionLatencyMs || 38}ms live)</strong>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs text-slate-700 font-semibold">
            P99: {interceptionLatencyMs ? (interceptionLatencyMs * 0.7).toFixed(1) : "8.2"}ms
          </div>
        </div>
      </div>

      {/* Action Notification Toast */}
      {feedback && (
        <div
          className={cn(
            "p-3 rounded-lg text-xs flex items-center justify-between border animate-in fade-in duration-150",
            feedback.type === "success" && "bg-emerald-50 text-emerald-900 border-emerald-200",
            feedback.type === "error" && "bg-rose-50 text-rose-900 border-rose-200",
            feedback.type === "info" && "bg-slate-100 text-slate-800 border-slate-200"
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
            {feedback.type === "error" && <XCircle className="h-4 w-4 text-rose-600 shrink-0" />}
            {feedback.type === "info" && <RefreshCw className="h-4 w-4 text-slate-600 animate-spin shrink-0" />}
            <span className="font-medium">{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ================= SECTION 1: LIVE STREAM INSPECTOR & POLICY SLIDERS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3): Live Stream Inspector */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
                Live Loop Detection Stream Inspector
              </h2>
            </div>
            <span className="font-mono text-[11px] text-slate-400">Stream Buffer: Active</span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            {events.map((evt) => {
              const isExact = evt.eventType === "EXACT_TOOL_LOOP";
              const isSemantic = evt.eventType === "SEMANTIC_REASONING_LOOP";

              return (
                <div
                  key={evt.id}
                  className={cn(
                    "p-3.5 rounded-lg border space-y-2 transition-colors",
                    isExact && "border-rose-200 bg-rose-50/40",
                    isSemantic && "border-amber-200 bg-amber-50/40",
                    !isExact && !isSemantic && "border-slate-200 bg-slate-50/60"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-normal">[{evt.timestamp}]</span>
                      <strong className="text-slate-900 font-bold">{evt.agentName}</strong>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold border",
                          isExact && "bg-rose-100 text-rose-800 border-rose-300",
                          isSemantic && "bg-amber-100 text-amber-800 border-amber-300",
                          !isExact && !isSemantic && "bg-slate-200 text-slate-700 border-slate-300"
                        )}
                      >
                        {evt.eventType.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        {evt.latencyMs}ms Latency
                      </span>
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold",
                          evt.actionTaken === "KILLED_LOOP" && "bg-rose-600 text-white",
                          evt.actionTaken === "PAUSED_NUDGE" && "bg-amber-600 text-white",
                          evt.actionTaken === "THROTTLED" && "bg-slate-800 text-white",
                          evt.actionTaken === "FLAGGED" && "bg-slate-200 text-slate-800"
                        )}
                      >
                        {evt.actionTaken}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] font-sans text-slate-700 leading-relaxed">
                    {evt.summary}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-500 border-t border-slate-200/50 pt-1.5">
                    {evt.toolName && (
                      <span>
                        Tool: <code className="text-slate-800 font-semibold">{evt.toolName}</code>
                      </span>
                    )}
                    {evt.similarityScore !== undefined && (
                      <span>
                        Cosine Similarity: <strong className="text-amber-800 font-bold">{evt.similarityScore}</strong>
                      </span>
                    )}
                    {evt.retryCount !== undefined && (
                      <span>
                        Consecutive Errors: <strong className="text-rose-800 font-bold">{evt.retryCount}x</strong>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (1/3): Configurable Policy Sliders */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-slate-600" />
              <span>Guardrail Policy</span>
            </h2>
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
              Active
            </span>
          </div>

          <div className="space-y-4 text-xs">
            {/* Slider 1: Max Retries */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-700 font-semibold">Max Consecutive Retries</label>
                <span className="font-mono font-bold text-slate-900">{policy.maxConsecutiveRetries} Retries</span>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={policy.maxConsecutiveRetries}
                onChange={(e) =>
                  setPolicy({ ...policy, maxConsecutiveRetries: Number(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
              />
              <span className="text-[10px] text-slate-400 block">Trips circuit breaker on repeated tool failures.</span>
            </div>

            {/* Slider 2: Semantic Similarity Threshold */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-700 font-semibold">Semantic Similarity Cap</label>
                <span className="font-mono font-bold text-slate-900">{policy.semanticSimilarityThreshold} Cosine</span>
              </div>
              <input
                type="range"
                min="0.75"
                max="0.98"
                step="0.01"
                value={policy.semanticSimilarityThreshold}
                onChange={(e) =>
                  setPolicy({ ...policy, semanticSimilarityThreshold: Number(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
              />
              <span className="text-[10px] text-slate-400 block">Catches agents repeating identical thoughts in different phrasing.</span>
            </div>

            {/* Slider 3: Human Nudge Threshold */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-700 font-semibold">Nudge vs. Kill Threshold</label>
                <span className="font-mono font-bold text-slate-900">&gt;= {policy.nudgeCompletionThreshold}% Task</span>
              </div>
              <input
                type="range"
                min="50"
                max="95"
                step="5"
                value={policy.nudgeCompletionThreshold}
                onChange={(e) =>
                  setPolicy({ ...policy, nudgeCompletionThreshold: Number(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
              />
              <span className="text-[10px] text-slate-400 block">Pauses instead of killing if task completion is high.</span>
            </div>

            {/* Slider 4: RAM Limit per Agent */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-700 font-semibold">Max RAM per Agent</label>
                <span className="font-mono font-bold text-slate-900">{policy.maxRamPerAgentMb} MB</span>
              </div>
              <input
                type="range"
                min="100"
                max="400"
                step="10"
                value={policy.maxRamPerAgentMb}
                onChange={(e) =>
                  setPolicy({ ...policy, maxRamPerAgentMb: Number(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
              />
              <span className="text-[10px] text-slate-400 block">Cgroups clamp resident memory to prevent host OOM.</span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSavePolicy}
                className="w-full rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-2xs"
              >
                Save Guardrail Policy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= SECTION 2: FLAGGED AGENTS REVIEW QUEUE ================= */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-amber-600" />
              <span>Flagged Agents &amp; Human-in-the-Loop Review Queue</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Take supervisory actions: supply hint, throttle model tier, or execute hard kill-switch.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold bg-amber-50 text-amber-800 px-2.5 py-1 rounded border border-amber-200">
            {displayedFlaggedAgents.length} Agents Flagged
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Agent Node</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Loop Threat Score</th>
                <th className="py-3 px-4">RAM / CPU</th>
                <th className="py-3 px-4">Current Subtask</th>
                <th className="py-3 px-4 text-right">Supervisory Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedFlaggedAgents.map((agent) => {
                const statusStyle = STATUS_STYLES[agent.status as AgentStatus] || STATUS_STYLES.HIBERNATED;

                return (
                  <tr key={agent.agent_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {agent.name}
                      <span className="block font-mono text-[10px] text-slate-400">{agent.agent_id}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border",
                          statusStyle.badge
                        )}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold">
                      <span
                        className={cn(
                          agent.loop_score > 0.8
                            ? "text-rose-600"
                            : agent.loop_score > 0.5
                            ? "text-amber-600"
                            : "text-emerald-700"
                        )}
                      >
                        {agent.loop_score}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {agent.ram_usage} MB • {agent.cpu_usage}%
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate font-mono text-[11px]">
                      {agent.current_task || "No active task"}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {agent.status === "PAUSED_NUDGE" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setNudgeModalAgent(agent)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 text-xs font-semibold shadow-2xs transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            <span>Send Hint &amp; Resume</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              executeGuardrailAction("THROTTLE_DOWNGRADE", { agentId: agent.agent_id })
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1 text-xs font-semibold shadow-2xs transition-colors"
                          >
                            <span>Throttle Model</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              executeGuardrailAction("TRIGGER_KILL_SWITCH", { agentId: agent.agent_id })
                            }
                            className="inline-flex items-center gap-1 rounded bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 text-xs font-semibold shadow-2xs transition-colors"
                          >
                            <span>Kill Switch</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNudgeModalAgent(agent)}
                          className="text-slate-600 hover:text-slate-900 underline font-medium"
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
      </div>

      {/* ================= SECTION 3: PER-AGENT RAM & CPU GOVERNANCE PANEL ================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Cpu className="h-4 w-4 text-indigo-600" />
              <span>Per-Agent RAM &amp; CPU Governance Panel</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Autonomous cgroup bus governors prevent low-complexity agent memory leaks from exhausting the host.
            </p>
          </div>

          <button
            type="button"
            onClick={() => executeGuardrailAction("TEST_MEMORY_SPIKE")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 px-3 py-1.5 text-xs font-semibold shadow-2xs transition-colors active:scale-95 shrink-0"
          >
            <Zap className="h-3.5 w-3.5 text-indigo-600" />
            <span>Test Memory Spike Governance</span>
          </button>
        </div>

        {/* Meters Grid for Active Agents */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayedActiveAgents.map((agent) => {
            const ramPct = Math.min(100, Math.round((agent.ram_usage / policy.maxRamPerAgentMb) * 100));
            const isNearCap = agent.ram_usage > policy.maxRamPerAgentMb * 0.8;

            return (
              <div
                key={agent.agent_id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 truncate">{agent.name}</span>
                  <span className="font-mono text-[10px] text-slate-500">{agent.model_tier}</span>
                </div>

                {/* RAM meter */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-slate-500">RAM:</span>
                    <strong className={cn(isNearCap ? "text-rose-600 font-bold" : "text-slate-800")}>
                      {agent.ram_usage} MB / {policy.maxRamPerAgentMb} MB
                    </strong>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        isNearCap ? "bg-rose-500" : "bg-indigo-500"
                      )}
                      style={{ width: `${ramPct}%` }}
                    />
                  </div>
                </div>

                {/* CPU meter */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-slate-500">CPU:</span>
                    <span className="text-slate-800 font-semibold">{agent.cpu_usage}%</span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, agent.cpu_usage * 3)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================= SEND NUDGE MODAL ================= */}
      {nudgeModalAgent && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Send Human Guidance Hint (Nudge)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Target: <strong className="text-slate-900">{nudgeModalAgent.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNudgeModalAgent(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <label className="font-semibold text-slate-800 block">
                Guidance Hint to Resolve Loop
              </label>
              <textarea
                value={nudgeHintText}
                onChange={(e) => setNudgeHintText(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all resize-none shadow-2xs"
                placeholder="Enter prompt guidance for agent..."
              />
              <p className="text-[11px] text-slate-500">
                This hint is injected directly into the agent&apos;s context window, clearing its loop recursion score and resuming execution.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setNudgeModalAgent(null)}
                className="px-4 py-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmNudge}
                className="px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-800 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Inject Hint &amp; Resume</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

