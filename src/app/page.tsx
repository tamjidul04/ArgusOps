"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Triangle,
  ArrowRight,
  Shield,
  Sliders,
  Cpu,
  Laptop,
  Activity,
  Terminal,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  TrendingDown,
  Layers,
  FileCode,
  Lock,
  ExternalLink,
  ChevronRight,
  Database,
} from "lucide-react";
import { PublicNavbar, PublicFooter } from "@/components/layout";
import { formatTokens, formatCurrency } from "@/lib/utils";

export default function LandingPage() {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [activeTab, setActiveTab] = useState<"comparison" | "metrics">("comparison");
  const [concurrencyRatio, setConcurrencyRatio] = useState(30); // 30 active / 70 hibernated out of 100

  const handleCopyCmd = () => {
    navigator.clipboard.writeText("npx argusops-daemon init");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const calculatedTokensSaved = Math.round(((100 - concurrencyRatio) / 100) * 14.8 * 10) / 10;
  const calculatedSavingsPct = Math.round(((100 - concurrencyRatio) / 100) * 78);
  const calculatedMonthlyCost = Math.round(1180 + (concurrencyRatio - 30) * 45);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-slate-900 selection:text-white">
      <PublicNavbar />

      <main className="flex-1">
        {/* ================= HERO SECTION ================= */}
        <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-28 border-b border-slate-200 bg-white">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-40 pointer-events-none" />

          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-4xl mx-auto space-y-6">
              {/* Release Pill */}
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1 text-xs font-medium text-slate-700 shadow-xs">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-semibold text-slate-900">ArgusOps v1.1 Live:</span>
                <span>The Master Hypervisor for Agent Clusters & Local PC Workflows</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              </div>

              {/* Headline matching PRD Section 4.4 */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
                Orchestrate AI agent swarms. <br className="hidden sm:inline" />
                <span className="bg-gradient-to-r from-slate-950 via-slate-800 to-slate-600 bg-clip-text text-transparent">
                  Eliminate infinite loops and token waste.
                </span>
              </h1>

              {/* Sub-headline */}
              <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
                24/7 loop circuit-breaker, dynamic 100-to-30 agent right-sizing, and local PC
                multi-agent coordination for Claude, Antigravity, and Hermes.
              </p>

              {/* Primary CTAs */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <Link
                  href="/dashboard"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-slate-800 active:scale-[0.98] transition-all"
                >
                  <span>Launch Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <div className="w-full sm:w-auto flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-xs text-slate-700 shadow-xs hover:border-slate-300 transition-colors">
                  <span className="text-slate-400 mr-2">$</span>
                  <span className="mr-3 font-semibold select-all">npx argusops-daemon init</span>
                  <button
                    type="button"
                    onClick={handleCopyCmd}
                    className="p-1 hover:text-slate-900 text-slate-400 transition-colors"
                    title="Copy command"
                    aria-label="Copy installation command"
                  >
                    {copiedCmd ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs text-slate-500 font-medium">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Free Tier: 3 Agents + 50k Tokens</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Zero-Trust Local Code Privacy</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>&lt;150MB RAM Desktop Daemon</span>
                </div>
              </div>
            </div>

            {/* ================= INTERACTIVE HERO PREVIEW CARD ================= */}
            {/* Matches Stitch Screenshot 01-landing.png & 03-dashboard-cluster.png */}
            <div className="mt-12 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl max-w-5xl mx-auto">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <h3 className="font-bold text-slate-900 text-base">
                      Interactive Swarm Hypervisor Preview
                    </h3>
                    <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                      sys.daemon.v1.1
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Simulate how ArgusOps right-sizes an enterprise 100-agent cluster to eliminate wasted tokens and prevent runaway loops.
                  </p>
                </div>

                {/* Concurrency slider */}
                <div className="w-full lg:w-72 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-slate-600 font-medium">Active Concurrency:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {concurrencyRatio} Active / {100 - concurrencyRatio} Hibernated
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={concurrencyRatio}
                    onChange={(e) => setConcurrencyRatio(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900"
                    aria-label="Active Concurrency"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                    <span>10 (Max Savings)</span>
                    <span>100 (Unmonitored)</span>
                  </div>
                </div>
              </div>

              {/* 3-Column Preview Grid (Matches 01-landing.png) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Column 1: Cluster Orchestration Table */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-900">
                      Cluster Orchestration
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Node Matrix</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Master Agentic AI decomposes tasks and dynamically governs RAM & CPU.
                  </p>

                  <div className="space-y-2 pt-2 text-xs font-mono">
                    <div className="flex items-center justify-between p-2 rounded bg-white border border-slate-200">
                      <div>
                        <span className="font-semibold text-slate-900">Claude</span>{" "}
                        <span className="text-slate-400">(PID 4091)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Running
                        </span>
                        <span className="text-slate-600">18ms</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-white border border-slate-200">
                      <div>
                        <span className="font-semibold text-slate-900">Antigravity</span>{" "}
                        <span className="text-slate-400">(PID 4092)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Running
                        </span>
                        <span className="text-slate-600">24ms</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-white border border-slate-200">
                      <div>
                        <span className="font-semibold text-slate-900">Hermes</span>{" "}
                        <span className="text-slate-400">({100 - concurrencyRatio} Standby)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          Hibernated
                        </span>
                        <span className="text-slate-400">0 tok/s</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">PC Bridge RAM:</span>
                    <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      &lt; 150MB RAM
                    </span>
                  </div>
                </div>

                {/* Column 2: 100-Agent Swarm Benchmark */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-900">
                      100-Agent Benchmark
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">N=1,400 runs</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Empirical data from 24-hour enterprise stress execution.
                  </p>

                  <div className="space-y-3 pt-1">
                    <div className="p-2.5 rounded bg-white border border-slate-200 space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-900">
                        <span>Without ArgusOps (100 Active)</span>
                        <span className="text-rose-600 font-mono">$420 / run</span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-rose-500 h-full w-full" />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Failure: 3 Infinite Loops</span>
                        <span className="font-mono">14.8M Tokens</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-white border border-slate-200 space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-900">
                        <span>With ArgusOps ({concurrencyRatio} Active, {100 - concurrencyRatio} Sleep)</span>
                        <span className="text-emerald-700 font-mono font-bold">
                          ${Math.round(420 * (concurrencyRatio / 100) + 18)} / run
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-300"
                          style={{ width: `${Math.max(15, concurrencyRatio)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span className="text-emerald-700 font-semibold">
                          0 Loops ({calculatedSavingsPct}% Saved)
                        </span>
                        <span className="font-mono font-bold text-slate-900">
                          {calculatedTokensSaved}M Tokens
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-1.5 rounded bg-white border border-slate-200">
                      <div className="text-[10px] text-slate-500">P99 Loop Latency</div>
                      <div className="font-mono font-bold text-slate-900">&lt; 8.2ms</div>
                    </div>
                    <div className="p-1.5 rounded bg-white border border-slate-200">
                      <div className="text-[10px] text-slate-500">Hibernated Pool</div>
                      <div className="font-mono font-bold text-slate-900">
                        {100 - concurrencyRatio} Nodes
                      </div>
                    </div>
                  </div>
                </div>

                {/* Column 3: Live FinOps & Circuit Breaker */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-900">
                      FinOps & Loop Guard
                    </span>
                    <span className="font-mono text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Circuit-breaker intercepts runaway retry cycles in under 38 milliseconds.
                  </p>

                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-rose-900 flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        Loop Caught: Node #30
                      </span>
                      <span className="font-mono text-[10px] bg-rose-200/70 text-rose-900 px-1.5 py-0.2 rounded font-semibold">
                        98% Semantic Match
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-rose-800 leading-tight">
                      fetch_vector_chunks repeated 14x in 8.2ms. Auto-halted before budget depletion.
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-rose-700 font-semibold pt-1">
                      <span>Tokens Saved: 412,000</span>
                      <span className="font-mono">Tripped at: 38ms</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-200 pt-3">
                    <Link
                      href="/dashboard"
                      className="w-full flex items-center justify-center gap-2 rounded bg-slate-900 text-white py-2 text-xs font-semibold hover:bg-slate-800 transition-colors"
                    >
                      <span>Explore Live Cluster Console</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* Bottom Card Footer */}
              <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-700">Zero-Trust Local Code:</span>
                  <span>Code never leaves PC without explicit user consent</span>
                </div>
                <div>
                  <a
                    href="https://arxiv.org/abs/2410.0891"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-slate-800 hover:text-slate-950 font-semibold underline underline-offset-2"
                  >
                    Read Peer-Reviewed Whitepaper (arXiv:2410.0891)
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= SECTION 2: ABOUT US & WHAT WE DO (#architecture) ================= */}
        {/* Matches PRD Section 4.1, 4.2, 4.3, 5.1 */}
        <section id="architecture" className="py-20 border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-800">
                <Sliders className="h-3.5 w-3.5" />
                <span>Architecture & Core Engine</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                How ArgusOps Hypervises AI Swarms
              </h2>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                Operating as an overarching Master Agentic AI, ArgusOps sits between your AI models,
                cloud workers, and local developer workstations to enforce strict operational discipline.
              </p>
            </div>

            {/* 3-Column Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Pillar 1 */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow space-y-4">
                <div className="h-12 w-12 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <Sliders className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  1. Master Task Decomposition & Dynamic Right-Sizing
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  When you submit complex prompts or enterprise repositories, our Master Agent
                  deconstructs the task into an execution DAG. If 100 agents exist in your cluster,
                  it allocates only the necessary workers (e.g., 30 agents) and suspends the remaining
                  70 in a zero-token hibernation state.
                </p>
                <ul className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Eliminates redundant 100-agent concurrency</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Dynamic leaf-node model downgrading to Haiku/local</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>68.4% average reduction in monthly API bills</span>
                  </li>
                </ul>
              </div>

              {/* Pillar 2 */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow space-y-4">
                <div className="h-12 w-12 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700">
                  <Shield className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  2. 24/7 &lt;100ms Semantic & Exact Loop Circuit Breaker
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Autonomous agents frequently get stuck in reasoning loops, consecutive failed tool calls,
                  or infinite syntax retry spirals. ArgusOps monitors agent I/O streams in real-time,
                  detecting loop patterns and tripping an automated kill switch in under 38 milliseconds.
                </p>
                <ul className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Cosine vector semantic loop detection</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Human-in-the-loop "Nudge" before hard termination</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>RAM & CPU governance prevents OOM crashes</span>
                  </li>
                </ul>
              </div>

              {/* Pillar 3 */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow space-y-4">
                <div className="h-12 w-12 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
                  <Laptop className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  3. Local PC Multi-Agent Coordinator & Mutex Bridge
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  For individual developers running multiple local IDE agents simultaneously (Claude,
                  Antigravity, Hermes), our &lt;150MB desktop daemon provides a central coordinator.
                  It enforces file-level mutex locks so agents never overwrite each other’s code.
                </p>
                <ul className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>File mutex prevents destructive concurrent edits</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Shared context cache saves redundant project reads</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Zero-Trust: Code stays on your local workstation</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ================= SECTION 3: RESEARCH & BENCHMARKS (#benchmarks) ================= */}
        {/* Matches PRD Section 4.4 & Stitch 01-landing.png */}
        <section id="benchmarks" className="py-20 border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="text-center max-w-3xl mx-auto space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-800 border border-slate-200">
                <Activity className="h-3.5 w-3.5 text-emerald-600" />
                <span>Empirical Benchmarks</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                With ArgusOps vs. Without ArgusOps
              </h2>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                We ran a 24-hour continuous stress test across 1,400 complex software engineering
                tasks with both unmonitored agent swarms and ArgusOps-governed clusters.
              </p>
            </div>

            {/* Side-by-Side Comparison Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Without ArgusOps */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-rose-200 pb-4">
                  <div className="space-y-1">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-700">
                      Standard Setup
                    </span>
                    <h3 className="text-xl font-bold text-slate-900">
                      Without ArgusOps (Unmonitored)
                    </h3>
                  </div>
                  <span className="rounded-full bg-rose-100 border border-rose-300 px-2.5 py-1 text-xs font-bold text-rose-800">
                    High Risk & Waste
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-white border border-rose-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Monthly Token Burn</div>
                      <div className="text-2xl font-mono font-bold text-rose-700">$4,200.00</div>
                    </div>
                    <span className="text-xs text-rose-600 font-medium">All 100 agents full-throttle</span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-rose-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Runaway Infinite Loops</div>
                      <div className="text-2xl font-mono font-bold text-rose-700">14 Incidents</div>
                    </div>
                    <span className="text-xs text-rose-600 font-medium">Ran overnight until budget cap</span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-rose-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">System RAM Consumption</div>
                      <div className="text-2xl font-mono font-bold text-rose-700">18.4 GB RAM</div>
                    </div>
                    <span className="text-xs text-rose-600 font-medium">Frequent OS paging & slowdown</span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-rose-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Local PC File Conflicts</div>
                      <div className="text-2xl font-mono font-bold text-rose-700">42 Overwrite Clashes</div>
                    </div>
                    <span className="text-xs text-rose-600 font-medium">Claude overwritten by Hermes</span>
                  </div>
                </div>
              </div>

              {/* With ArgusOps */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-6 space-y-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-4">
                  <div className="space-y-1">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700">
                      Hypervisor Governed
                    </span>
                    <h3 className="text-xl font-bold text-slate-900">
                      With ArgusOps v1.1
                    </h3>
                  </div>
                  <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    -71.9% Cost Reduction
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="p-3.5 rounded-lg bg-white border border-emerald-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Monthly Token Burn</div>
                      <div className="text-2xl font-mono font-bold text-emerald-700">$1,180.00</div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      $3,020 Saved / mo
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-emerald-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Runaway Infinite Loops</div>
                      <div className="text-2xl font-mono font-bold text-emerald-700">0 Escaped</div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Circuit Breaker: 38ms
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-emerald-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">System RAM Consumption</div>
                      <div className="text-2xl font-mono font-bold text-emerald-700">4.1 GB RAM</div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      -77.7% RAM Governed
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white border border-emerald-200 flex justify-between items-center">
                    <div>
                      <div className="text-xs text-slate-500 font-medium">Local PC File Conflicts</div>
                      <div className="text-2xl font-mono font-bold text-emerald-700">0 Conflicts</div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Hardware File Mutex
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Benchmarking Citation */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-500" />
                <span>
                  Source: <em>"Autonomous Multi-Agent Telemetry, Loop Interception and Concurrency Right-Sizing in Cloud Hypervisors"</em> (ArgusOps Research Lab, 2026).
                </span>
              </div>
              <a
                href="https://arxiv.org/abs/2410.0891"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-slate-900 font-semibold underline underline-offset-4 hover:text-slate-700 shrink-0"
              >
                Download PDF (arXiv:2410.0891)
              </a>
            </div>
          </div>
        </section>

        {/* ================= SECTION 4: CALL TO ACTION ================= */}
        <section className="py-20 bg-slate-900 text-white relative overflow-hidden">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center space-y-8 relative z-10">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
              Ready to tame your AI agent clusters?
            </h2>
            <p className="text-slate-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
              Start free with 3 agents and 50,000 tokens. Install our lightweight PC daemon in 10 seconds or link your cloud API keys.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-3.5 text-sm font-bold text-slate-900 hover:bg-slate-100 transition-all shadow-lg active:scale-95"
              >
                <span>Get Started Free</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 px-8 py-3.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
              >
                Compare Plans & Pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
