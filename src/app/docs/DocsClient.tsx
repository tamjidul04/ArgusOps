"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Terminal,
  Copy,
  Check,
  Shield,
  Laptop,
  CheckCircle2,
  FileCode,
  Zap,
  ArrowRight,
  ChevronRight,
  BookOpen,
  Cpu,
  Key,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function DocsClient() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const navSections = [
    { id: "overview", label: "1. Overview & Footprint" },
    { id: "installation", label: "2. Daemon Installation" },
    { id: "authentication", label: "3. API Key Auth" },
    { id: "connecting-agents", label: "4. Connecting Agents" },
    { id: "file-mutex", label: "5. File-Locking Mutex" },
    { id: "loop-breaker", label: "6. Loop Circuit-Breaker" },
    { id: "zero-trust", label: "7. Zero-Trust Privacy" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Table of contents sidebar */}
      <aside className="hidden lg:block lg:col-span-1 space-y-4 sticky top-24 self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            <span>On This Page</span>
          </p>
          <nav className="space-y-1">
            {navSections.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                className="block text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 px-2 py-1.5 rounded transition-colors"
              >
                {sec.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-emerald-900">
            <Shield className="h-4 w-4 text-emerald-600" />
            <span>Hardware Guarantee</span>
          </div>
          <p className="text-emerald-800 leading-relaxed text-[11px]">
            The ArgusOps daemon is compiled with lightweight V8 isolates and strict cgroup caps: strictly &lt;150MB RAM and &lt;100ms response time.
          </p>
        </div>
      </aside>

      {/* Main Documentation Content */}
      <div className="lg:col-span-3 space-y-12">
        {/* Section 1: Overview */}
        <section id="overview" className="space-y-4 scroll-mt-24">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 01
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Overview & PC Daemon Architecture
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Individual developers building software locally with multiple AI agents (such as Claude Code,
            Antigravity, and Hermes) frequently encounter file edit conflicts, overwrites, and redundant token
            reads. The ArgusOps PC Daemon is a zero-dependency background supervisor that intercepts tool calls,
            enforces an atomic file mutex, and kills runaway retry loops locally.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3 rounded-lg border border-slate-200 bg-white">
              <div className="text-[11px] text-slate-500">RAM Limit</div>
              <div className="text-lg font-mono font-bold text-slate-900">&lt; 150MB</div>
              <div className="text-[10px] text-emerald-600 font-medium">Avg: 68MB in tests</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-white">
              <div className="text-[11px] text-slate-500">Interception Latency</div>
              <div className="text-lg font-mono font-bold text-slate-900">&lt; 100ms</div>
              <div className="text-[10px] text-emerald-600 font-medium">P99: 8.2ms</div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-white">
              <div className="text-[11px] text-slate-500">Privacy Scope</div>
              <div className="text-lg font-mono font-bold text-slate-900">Zero-Trust</div>
              <div className="text-[10px] text-slate-500">100% On-Device Parsing</div>
            </div>
          </div>
        </section>

        {/* Section 2: Installation */}
        <section id="installation" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 02
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Daemon Installation
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            You can run the daemon directly using NPX or install it globally via NPM/Yarn/PNPM:
          </p>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-white relative shadow-md">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-slate-400 text-[11px]">
              <span>Terminal (Quick Run)</span>
              <button
                type="button"
                onClick={() => copyCode("npx argusops-daemon init", 1)}
                className="hover:text-white flex items-center gap-1 transition-colors"
              >
                {copiedIndex === 1 ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedIndex === 1 ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <code>npx argusops-daemon init</code>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-white relative shadow-md">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-slate-400 text-[11px]">
              <span>Global CLI Installation</span>
              <button
                type="button"
                onClick={() => copyCode("npm install -g argusops-daemon", 2)}
                className="hover:text-white flex items-center gap-1 transition-colors"
              >
                {copiedIndex === 2 ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedIndex === 2 ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <code>npm install -g argusops-daemon</code>
          </div>
        </section>

        {/* Section 3: Authentication */}
        <section id="authentication" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 03
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Authentication with API Keys
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Generate an API key in your{" "}
            <Link href="/dashboard/local-bridge" className="text-slate-900 font-semibold underline underline-offset-2">
              Dashboard &gt; Local PC Bridge
            </Link>{" "}
            panel. Set it in your environment or pass it to the daemon:
          </p>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-white relative shadow-md">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-slate-400 text-[11px]">
              <span>.env or Shell Export</span>
              <button
                type="button"
                onClick={() => copyCode('export ARGUSOPS_API_KEY="argus_live_98f24a..."', 3)}
                className="hover:text-white flex items-center gap-1 transition-colors"
              >
                {copiedIndex === 3 ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedIndex === 3 ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <code>export ARGUSOPS_API_KEY=&quot;argus_live_98f24a081bc7e41a9...&quot;</code>
          </div>
        </section>

        {/* Section 4: Connecting Agents */}
        <section id="connecting-agents" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 04
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Connecting Local PC Agents (Claude, Antigravity, Hermes)
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            The daemon exposes an IPC Unix socket (on Linux/macOS) and a localhost REST/WebSocket bridge
            on port <code className="bg-slate-100 text-slate-900 px-1.5 py-0.5 rounded border border-slate-200">127.0.0.1:41829</code>.
          </p>

          <div className="space-y-3">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-800">
              A) Antigravity Agent Setup
            </h4>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3.5 font-mono text-xs text-white">
              <code>antigravity --bridge=http://127.0.0.1:41829 --mutex-enabled</code>
            </div>

            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-800 pt-2">
              B) Claude Code Setup
            </h4>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3.5 font-mono text-xs text-white">
              <code>claude --telemetry-supervisor=http://127.0.0.1:41829</code>
            </div>

            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-800 pt-2">
              C) Hermes Agent Setup
            </h4>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3.5 font-mono text-xs text-white">
              <code>hermes --agent-id=worker-03 --supervisor-port=41829</code>
            </div>
          </div>
        </section>

        {/* Section 5: Mutex Lock Demonstration */}
        <section id="file-mutex" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 05
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              File-Locking Mutex (Conflict Prevention)
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            When Claude is actively modifying <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-900 font-mono">src/app/dashboard/page.tsx</code>,
            ArgusOps locks that file path in memory. If Hermes attempts to apply an edit to the same file, the daemon suspends
            Hermes until Claude releases the lock:
          </p>

          {/* Terminal Mockup matching Stitch Screenshot */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 shadow-xl space-y-1.5">
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-800 text-slate-500 text-[11px]">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="ml-2 font-semibold text-slate-400">daemon-output.log</span>
            </div>
            <p className="text-slate-400">[08:12:01] <span className="text-sky-400">[ArgusOps v1.4.0]</span> Daemon initialized on 127.0.0.1:41829 (PID 81204)</p>
            <p className="text-slate-400">[08:12:02] <span className="text-emerald-400">[Memory]</span> Resident Set Size: 68.2 MB / 150 MB ceiling</p>
            <p className="text-slate-400">[08:12:05] <span className="text-indigo-400">[Mutex]</span> Claude acquired lock: <strong className="text-white font-semibold">src/app/dashboard/page.tsx</strong></p>
            <p className="text-amber-400">[08:12:09] [Mutex Conflict Intercepted] Hermes attempted concurrent write on locked file. Queued safely.</p>
            <p className="text-slate-400">[08:12:14] <span className="text-emerald-400">[Mutex]</span> Claude released lock. Hermes unblocked and cleanly applied patch.</p>
            <p className="text-emerald-400 font-bold">[Status] 0 corrupted files. 100% atomic code integrity.</p>
          </div>
        </section>

        {/* Section 6: Loop Circuit Breaker */}
        <section id="loop-breaker" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 06
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Loop Circuit-Breaker Configuration
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Configure circuit-breaker thresholds in your <code className="bg-slate-100 text-slate-900 px-1 py-0.5 rounded">.antigravityrules</code> or daemon config:
          </p>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-white">
            <pre className="text-slate-300">
{`{
  "max_consecutive_identical_calls": 3,
  "max_consecutive_errors": 4,
  "loop_check_window_seconds": 30,
  "cosine_similarity_threshold": 0.95,
  "action_on_loop": "PAUSE_FOR_NUDGE" // or "KILL_LOOP"
}`}
            </pre>
          </div>
        </section>

        {/* Section 7: Zero-Trust */}
        <section id="zero-trust" className="space-y-4 scroll-mt-24 border-t border-slate-200 pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Section 07
            </span>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Zero-Trust Code Privacy
            </h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            ArgusOps operates on a zero-knowledge boundary. The daemon calculates sha256 hashes of AST tokens
            to identify repeated tool calls and shared context snippets without ever transmitting your source files
            to external infrastructure.
          </p>
          <div className="p-4 rounded-lg border border-slate-200 bg-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-emerald-600" />
              <div>
                <h5 className="font-bold text-xs text-slate-900">SOC2 Type II Security Standard</h5>
                <p className="text-xs text-slate-500">Read our complete privacy whitepaper and code guarantees.</p>
              </div>
            </div>
            <Link
              href="/privacy"
              className="text-xs font-bold text-slate-900 underline underline-offset-2 hover:text-slate-700"
            >
              Privacy Policy
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

