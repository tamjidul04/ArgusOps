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
import { Badge, DashHeader, EmptyState, Panel, buttonClasses } from "@/components/ui";

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
      <DashHeader
        title="Task Decomposition & Right-Sizing"
        description="Autonomous project decomposition, dynamic 100-to-30 concurrency right-sizing, and leaf-node model routing."
        badge={<Badge tone="green">Master Agentic AI</Badge>}
        actions={
          <button type="button" onClick={() => handleDecomposeSubmit()} disabled={isLoading} className={buttonClasses("primary", false, "disabled:opacity-60")}>
            <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
            <span>{isLoading ? "Decomposing DAG..." : "Submit Project Prompt"}</span>
          </button>
        }
      />

      {statusMsg && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-600/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span className="font-medium">{statusMsg}</span>
          </div>
          <button type="button" onClick={() => setStatusMsg("")} aria-label="Dismiss message" className="rounded-md px-1.5 text-lg leading-none text-emerald-800 hover:text-emerald-950">
            ×
          </button>
        </div>
      )}

      {/* ================= TOP ROW: ALLOCATION & PROMPT BOX ================= */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Dynamic Swarm Allocation" action={<Badge>{clusterSize}-agent cluster</Badge>} bodyClassName="space-y-4">
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-2xl">
              {activeAgents} Active / {hibernatedAgents} Hibernated
            </p>
            <p className="mt-1.5 text-sm text-slate-600">
              {clusterSize}-agent cluster right-sized ({Math.round((hibernatedAgents / clusterSize) * 100)}% saved)
            </p>
          </div>

          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="meter"
            aria-label="Active agents"
            aria-valuemin={0}
            aria-valuemax={clusterSize}
            aria-valuenow={activeAgents}
          >
            <div className="h-full rounded-full bg-slate-900 transition-[width] duration-200 ease-spring" style={{ width: `${Math.round((activeAgents / clusterSize) * 100)}%` }} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <span className="font-medium">Zero-Token Hibernation Pool:</span>
            <span className="font-mono text-xs font-semibold text-slate-900">{hibernatedAgents} Nodes (0 tok/s)</span>
          </div>
        </Panel>

        <Panel title="Active Project Prompt" action={<Badge>DAG Triage Active</Badge>} bodyClassName="space-y-4">
          <label htmlFor="project-prompt" className="sr-only">
            Project prompt
          </label>
          <textarea
            id="project-prompt"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md bg-white p-3.5 font-mono text-xs leading-relaxed text-slate-900 border border-slate-200 transition-shadow placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            placeholder="Enter complex multi-agent prompt or repository task..."
          />

          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-6">
              <div>
                <span className="block text-xs text-slate-600">Est. Run Cost:</span>
                <div className="font-mono text-xs">
                  <strong className="font-semibold text-slate-900">$108.00</strong> <span className="text-slate-600 line-through">(vs $420.00 unthrottled)</span>
                </div>
              </div>
              <div>
                <span className="block text-xs text-slate-600">Tokens:</span>
                <span className="font-mono text-xs font-semibold text-slate-900">34,700 Tokens</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleDecomposeSubmit()} className={buttonClasses("secondary", false, "px-4 py-2 text-xs")}>
                Re-Triage
              </button>
              <button type="button" onClick={() => handleDecomposeSubmit()} className={buttonClasses("primary", false, "px-4 py-2 text-xs")}>
                Auto-Rightsize Swarm
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* ================= MIDDLE ROW: 3 TELEMETRY CARDS ================= */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Panel title="Smart Model Router" action={<Badge tone="green">+64% routed</Badge>} bodyClassName="space-y-3">
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">64% Downgraded</p>
            <p className="mt-1.5 text-sm text-slate-600">Simple JSON, regex, and tests routed to fast/local models.</p>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 font-mono text-xs text-slate-600">
            <span>Frontier: 36%</span>
            <span>Downgraded: 64%</span>
          </div>
        </Panel>

        <Panel title="Shared Context Cache" action={<Badge>AST SHA256</Badge>} bodyClassName="space-y-3">
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">1.80M Cached</p>
            <p className="mt-1.5 text-sm text-slate-600">Single codebase read shared across swarm without redundant tokens.</p>
          </div>
          <div className="truncate border-t border-slate-200 pt-3 font-mono text-xs text-slate-600">
            <span className="truncate">Hash: {contextHash}</span>
          </div>
        </Panel>

        <Panel
          title="Quarantined Idle Swarm"
          action={
            <button type="button" onClick={handleWakePool} className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50">
              Wake Pool
            </button>
          }
          bodyClassName="space-y-3"
        >
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">Agents #31-#100</p>
            <p className="mt-1.5 text-sm text-slate-600">
              {hibernatedAgents} Nodes in hibernation • Target: <code className="font-mono text-xs text-slate-800">--hibernated (0 Tok)</code>
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
            <span>
              RAM Saved: <strong className="font-mono text-slate-900">5.60 GB Dormant</strong>
            </span>
            <span className="font-mono">Locked</span>
          </div>
        </Panel>
      </div>

      {/* ================= ACTIVE SUB-TASK EXECUTION MATRIX TABLE ================= */}
      <Panel
        title="Active Sub-Task Execution Matrix"
        action={
          <div className="flex items-center gap-2">
            <Badge>{subtasks.length} Sub-Tasks</Badge>
            <span className="text-xs text-slate-600">Real-time DAG Execution</span>
          </div>
        }
        bodyClassName="p-0 sm:p-0"
      >
        {subtasks.length === 0 ? (
          <EmptyState icon={Layers} title="No sub-tasks yet">
            Submit a project prompt and it is split into steps here, each routed to the right agent and model.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                  <th scope="col" className="px-5 py-3">Step</th>
                  <th scope="col" className="px-5 py-3">Sub-Task</th>
                  <th scope="col" className="px-5 py-3">Assigned Agent</th>
                  <th scope="col" className="px-5 py-3">Routed Model</th>
                  <th scope="col" className="px-5 py-3">Target Path</th>
                  <th scope="col" className="px-5 py-3">Tokens</th>
                  <th scope="col" className="px-5 py-3 text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/5">
                {subtasks.map((task) => (
                  <tr key={task.step} className="transition-colors hover:bg-slate-900/[0.02]">
                    <td className="px-5 py-2.5 font-mono text-xs font-medium text-slate-500">{task.step}</td>
                    <td className="px-5 py-2.5 font-medium text-slate-900">{task.subtask}</td>
                    <td className="px-5 py-2.5 text-slate-700">{task.assigned_agents}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={task.model_tier === "FRONTIER" ? "blue" : "neutral"}>{task.routed_model}</Badge>
                    </td>
                    <td className="max-w-[200px] truncate px-5 py-2.5 font-mono text-xs text-slate-600">{task.target_path}</td>
                    <td className="px-5 py-2.5 font-mono text-xs font-medium text-slate-900">{formatTokens(task.tokens, { compact: false })}</td>
                    <td className="px-5 py-2.5 text-right">
                      {task.state === "Done" && <Badge>Done</Badge>}
                      {task.state === "Run" && (
                        <Badge tone="green">
                          <span className="h-1.5 w-1.5 live-dot rounded-full bg-emerald-500" />
                          Run
                        </Badge>
                      )}
                      {task.state === "Queued" && <Badge>Queued</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ================= BOTTOM ROW: 3 TECHNICAL BREAKDOWN BOXES ================= */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Panel title="Model Tier Allocation (No-Graph Ledger)" bodyClassName="space-y-1">
          {[
            ["Tier 1: Sonnet 3.7", "10 Claude Nodes • 18.4k tok"],
            ["Tier 2: Haiku Router", "10 Antigravity Nodes • 12.1k tok"],
            ["Tier 3: Local LLM", "10 Hermes Nodes • 4.2k tok"],
          ].map(([tier, detail]) => (
            <div key={tier} className="flex flex-col gap-0.5 border-b border-slate-200 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-semibold text-slate-900">{tier}</span>
              <span className="font-mono text-xs text-slate-600">{detail}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Deduplicated Codebase Reads" bodyClassName="space-y-2.5">
          {[
            ["db/migrations/schema.sql", "Read 1x • Shared 10x"],
            ["src/rag/index.ts", "Read 1x • Shared 20x"],
          ].map(([file, note]) => (
            <div key={file} className="flex flex-col gap-0.5 rounded-md bg-slate-50 p-3.5 border border-slate-200 sm:flex-row sm:items-center sm:justify-between">
              <span className="truncate font-mono text-xs text-slate-800">{file}</span>
              <span className="font-mono text-xs font-semibold text-emerald-700">{note}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Triage Guardrails" bodyClassName="space-y-1">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 py-3 text-sm">
            <span className="text-slate-600">Concurrency Ceiling</span>
            <span className="font-mono text-xs font-semibold text-slate-900">30 / 100 Max</span>
          </div>
          <div className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-slate-600">Redundant Prompt Block</span>
            <Badge tone="green">Enabled</Badge>
          </div>
        </Panel>
      </div>
    </div>
  );
}

