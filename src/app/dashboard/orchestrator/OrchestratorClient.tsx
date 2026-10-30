"use client";

import React, { useState } from "react";
import {
  Sliders,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Layers,
  Cpu,
  Database,
  CheckCircle2,
  Clock,
  Zap,
  TrendingDown,
  Shield,
  FileCode,
  Lock,
  Play,
  Check,
  AlertCircle,
  Copy,
  FolderGit2,
} from "lucide-react";
import { cn, formatTokens, formatCurrency } from "@/lib/utils";
import { SubTaskItem } from "@/app/api/orchestrator/route";
import { useBrain } from "@/context/BrainContext";

interface OrchestratorClientProps {
  initialPrompt: string;
  initialSubtasks: SubTaskItem[];
  initialActiveAgents: number;
  initialHibernatedAgents: number;
  initialTokensSaved: number;
  initialContextCache: string;
}

export function OrchestratorClient({
  initialPrompt,
  initialSubtasks,
  initialActiveAgents,
  initialHibernatedAgents,
  initialTokensSaved,
  initialContextCache,
}: OrchestratorClientProps) {
  const { executeBrainAction } = useBrain();
  const [promptText, setPromptText] = useState(initialPrompt);
  const [clusterSize, setClusterSize] = useState(100);
  const [subtasks, setSubtasks] = useState<SubTaskItem[]>(initialSubtasks);
  const [activeAgents, setActiveAgents] = useState(initialActiveAgents);
  const [hibernatedAgents, setHibernatedAgents] = useState(initialHibernatedAgents);
  const [tokensSaved, setTokensSaved] = useState(initialTokensSaved);
  const [contextHash, setContextHash] = useState(initialContextCache);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const handleDecomposeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!promptText.trim()) return;

    setIsLoading(true);
    setStatusMsg("");

    try {
      const data = await executeBrainAction("DECOMPOSE_TASK", {
        prompt: promptText,
      });

      if (!data.success) {
        setStatusMsg(data.error || "Decomposition failed.");
        setIsLoading(false);
        return;
      }

      if (data.plan) {
        if (data.plan.subtasks) setSubtasks(data.plan.subtasks);
        if (data.plan.concurrency) {
          setActiveAgents(data.plan.concurrency.activeAgents);
          setHibernatedAgents(data.plan.concurrency.hibernatedAgents);
        }
        if (data.plan.savings) {
          setTokensSaved(data.plan.savings.totalTokensSaved);
        }
        if (data.plan.cachedContextHash) {
          setContextHash(data.plan.cachedContextHash);
        }
      }

      setStatusMsg(data.message || "Project task decomposed and cluster right-sized.");
    } catch (err) {
      console.error(err);
      setStatusMsg("Failed to communicate with Master Orchestrator.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleWakePool = () => {
    setStatusMsg("Manual override: Standby pool unlocked for emergency concurrency.");
  };

  return (
    <div className="space-y-6">
      {/* ================= PAGE TITLE & SUBMIT BAR ================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Task Decomposition &amp; Right-Sizing
            </h1>
            <span className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Master Agentic AI
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Autonomous project decomposition, dynamic 100-to-30 concurrency right-sizing, and leaf-node model routing.
          </p>
        </div>

        <button
          type="button"
          onClick={() => handleDecomposeSubmit()}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-60 shrink-0"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span>{isLoading ? "Decomposing DAG..." : "Submit Project Prompt"}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 flex items-center justify-between animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{statusMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMsg("")}
            className="text-emerald-700 hover:text-emerald-950 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* ================= TOP ROW: ALLOCATION & PROMPT BOX (Stitch Match) ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dynamic Swarm Allocation */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-slate-500 uppercase tracking-wider">
              Dynamic Swarm Allocation
            </span>
            <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-600 font-medium">
              {clusterSize}-agent cluster
            </span>
          </div>

          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {activeAgents} Active / {hibernatedAgents} Hibernated
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {clusterSize}-agent cluster right-sized ({Math.round((hibernatedAgents / clusterSize) * 100)}% saved)
            </p>
          </div>

          {/* Allocation Progress Bar */}
          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-slate-900 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.round((activeAgents / clusterSize) * 100)}%` }}
            />
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">Zero-Token Hibernation Pool:</span>
            <span className="font-mono font-bold text-slate-900">
              {hibernatedAgents} Nodes (0 tok/s)
            </span>
          </div>
        </div>

        {/* Active Project Prompt Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-slate-500 uppercase tracking-wider">
              Active Project Prompt
            </span>
            <span className="font-mono text-[10px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              DAG Triage Active
            </span>
          </div>

          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all resize-none shadow-2xs"
            placeholder="Enter complex multi-agent prompt or repository task..."
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs border-t border-slate-100 pt-3">
            <div>
              <span className="text-slate-500 block text-[11px]">Est. Run Cost:</span>
              <div className="font-mono">
                <strong className="text-slate-900 font-bold">$108.00</strong>{" "}
                <span className="text-slate-400 line-through">(vs $420.00 unthrottled)</span>
              </div>
            </div>

            <div className="text-right sm:text-left">
              <span className="text-slate-500 block text-[11px]">Tokens:</span>
              <span className="font-mono font-bold text-slate-900">34,700 Tokens</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDecomposeSubmit()}
                className="px-3 py-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
              >
                Re-Triage
              </button>
              <button
                type="button"
                onClick={() => handleDecomposeSubmit()}
                className="px-3.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors"
              >
                Auto-Rightsize Swarm
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= MIDDLE ROW: 3 TELEMETRY CARDS ================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Smart Model Router */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">Smart Model Router</span>
            <span className="font-mono text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              +64% routed
            </span>
          </div>
          <div>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
              64% Downgraded
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Simple JSON, regex, and tests routed to fast/local models.
            </p>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600 font-mono">
            <span>Frontier: 36%</span>
            <span>Downgraded: 64%</span>
          </div>
        </div>

        {/* Shared Context Cache */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">Shared Context Cache</span>
            <span className="font-mono text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-semibold">
              AST SHA256
            </span>
          </div>
          <div>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
              1.80M Cached
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Single codebase read shared across swarm without redundant tokens.
            </p>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono truncate">
            <span className="truncate">Hash: {contextHash}</span>
          </div>
        </div>

        {/* Quarantined Idle Swarm Pool */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">Quarantined Idle Swarm</span>
            <button
              type="button"
              onClick={handleWakePool}
              className="text-[11px] font-semibold text-slate-700 hover:text-slate-950 underline"
            >
              Wake Pool
            </button>
          </div>
          <div>
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
              Agents #31-#100
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {hibernatedAgents} Nodes in hibernation • Target: <code className="font-mono text-slate-700">--hibernated (0 Tok)</code>
            </p>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>RAM Saved: <strong className="font-mono text-slate-900">5.60 GB Dormant</strong></span>
            <span className="font-mono text-slate-400">Locked</span>
          </div>
        </div>
      </div>

      {/* ================= ACTIVE SUB-TASK EXECUTION MATRIX TABLE ================= */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
              Active Sub-Task Execution Matrix
            </h2>
            <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              {subtasks.length} Sub-Tasks
            </span>
          </div>
          <span className="text-xs text-slate-500 font-mono">Real-time DAG Execution</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Step</th>
                <th className="py-3 px-4">Sub-Task</th>
                <th className="py-3 px-4">Assigned Agent</th>
                <th className="py-3 px-4">Routed Model</th>
                <th className="py-3 px-4">Target Path</th>
                <th className="py-3 px-4">Tokens</th>
                <th className="py-3 px-4 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {subtasks.map((task) => (
                <tr key={task.step} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-400">{task.step}</td>
                  <td className="py-3 px-4 font-sans font-semibold text-slate-900">
                    {task.subtask}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{task.assigned_agents}</td>
                  <td className="py-3 px-4">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border",
                        task.model_tier === "FRONTIER"
                          ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      )}
                    >
                      {task.routed_model}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 truncate max-w-[180px]">
                    {task.target_path}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {formatTokens(task.tokens, { compact: false })}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {task.state === "Done" && (
                      <span className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        Done
                      </span>
                    )}
                    {task.state === "Run" && (
                      <span className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Run
                      </span>
                    )}
                    {task.state === "Queued" && (
                      <span className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                        Queued
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= BOTTOM ROW: 3 TECHNICAL BREAKDOWN BOXES ================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Box 1: Model Tier Allocation */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900">
            Model Tier Allocation (No-Graph Ledger)
          </h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
              <span className="font-semibold text-slate-800">Tier 1: Sonnet 3.7</span>
              <span className="text-slate-500">10 Claude Nodes • 18.4k tok</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
              <span className="font-semibold text-slate-800">Tier 2: Haiku Router</span>
              <span className="text-slate-500">10 Antigravity Nodes • 12.1k tok</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="font-semibold text-slate-800">Tier 3: Local LLM</span>
              <span className="text-slate-500">10 Hermes Nodes • 4.2k tok</span>
            </div>
          </div>
        </div>

        {/* Box 2: Deduplicated Codebase Reads */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900">
            Deduplicated Codebase Reads
          </h3>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 flex justify-between items-center">
              <span className="truncate text-slate-800 max-w-[140px]">db/migrations/schema.sql</span>
              <span className="text-emerald-700 font-semibold">Read 1x • Shared 10x</span>
            </div>
            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 flex justify-between items-center">
              <span className="truncate text-slate-800 max-w-[140px]">src/rag/index.ts</span>
              <span className="text-emerald-700 font-semibold">Read 1x • Shared 20x</span>
            </div>
          </div>
        </div>

        {/* Box 3: Triage Guardrails */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900">
            Triage Guardrails
          </h3>
          <div className="space-y-2.5 text-xs font-mono">
            <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Concurrency Ceiling</span>
              <span className="font-bold text-slate-900">30 / 100 Max</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-600">Redundant Prompt Block</span>
              <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Enabled
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

