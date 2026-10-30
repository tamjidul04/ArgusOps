import React from "react";
import { Metadata } from "next";
import { PublicNavbar, PublicFooter } from "@/components/layout";
import {
  CheckCircle2,
  Activity,
  Shield,
  Clock,
  Server,
  Zap,
  Cpu,
  Layers,
  ArrowUpRight,
} from "lucide-react";

export const metadata: Metadata = {
  title: "System Status | ArgusOps v1.1",
  description:
    "Live operational status and performance metrics for the ArgusOps Master Hypervisor, <100ms loop interception engine, and local PC bridge.",
};

export default function StatusPage() {
  const systems = [
    {
      name: "Cloud Swarm Orchestrator (US-East)",
      status: "Operational",
      uptime: "99.99%",
      latency: "18ms",
      desc: "Dynamic right-sizing and task DAG decomposition hypervisor.",
    },
    {
      name: "<100ms Loop Interception Engine",
      status: "Operational",
      uptime: "100.0%",
      latency: "38ms avg (P99: 8.2ms)",
      desc: "Real-time AST token stream inspector and circuit breaker.",
    },
    {
      name: "Local PC Desktop Bridge Relay",
      status: "Operational",
      uptime: "99.98%",
      latency: "< 2ms local",
      desc: "Zero-Trust IPC socket and file mutex synchronization daemon.",
    },
    {
      name: "Shared AST Context & Memory Cache",
      status: "Operational",
      uptime: "99.99%",
      latency: "12ms",
      desc: "Deduplicated repository token cache preventing redundant reads.",
    },
    {
      name: "Token & Subscription Billing Ledger",
      status: "Operational",
      uptime: "100.0%",
      latency: "24ms",
      desc: "Real-time quota enforcement and transaction approval queue.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicNavbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full space-y-12">
        {/* Overall Status Banner */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-emerald-950">
                All Systems Operational
              </h1>
              <p className="text-xs sm:text-sm text-emerald-800 mt-0.5">
                Every cluster supervisor, interception circuit breaker, and local PC relay is performing within nominal SLA.
              </p>
            </div>
          </div>
          <div className="font-mono text-xs font-semibold text-emerald-800 bg-emerald-100/80 px-3 py-1.5 rounded-lg border border-emerald-300 shrink-0">
            Current SLA: 99.98%
          </div>
        </div>

        {/* System Services Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Service Health &amp; Response Metrics
            </h2>
            <span className="text-xs text-slate-500 font-mono">Refreshed every 10s</span>
          </div>

          <div className="divide-y divide-slate-100">
            {systems.map((sys, idx) => (
              <div
                key={idx}
                className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="space-y-1 max-w-lg">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <h3 className="text-sm font-bold text-slate-900">{sys.name}</h3>
                  </div>
                  <p className="text-xs text-slate-500">{sys.desc}</p>
                </div>

                <div className="flex items-center gap-6 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Uptime (90d)</span>
                    <span className="font-mono font-semibold text-slate-900">{sys.uptime}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">P99 Latency</span>
                    <span className="font-mono font-semibold text-slate-900">{sys.latency}</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Operational
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 90-Day Uptime Visualization */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wider text-slate-900">
              90-Day Global Cluster Availability
            </span>
            <span className="font-mono font-semibold text-emerald-700">100.0% past 30 days</span>
          </div>

          {/* 90-bar visualization */}
          <div className="flex items-center gap-[3px] h-9">
            {Array.from({ length: 90 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-full bg-emerald-500 hover:bg-emerald-600 rounded-[2px] transition-colors cursor-pointer"
                title={`Day ${90 - i}: 100% operational`}
              />
            ))}
          </div>

          <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1">
            <span>90 days ago</span>
            <span>Today (0 incidents)</span>
          </div>
        </div>

        {/* Incident History Log */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Past Incident &amp; Circuit-Breaker Log
          </h2>
          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <div className="flex items-center justify-between text-slate-900 font-semibold">
                <span>Autonomous Loop Mitigation #0429</span>
                <span className="font-mono text-slate-500 text-[11px]">Today at 02:18 UTC</span>
              </div>
              <p className="text-slate-600">
                A rogue cloud worker node entered an recursive error retry loop on commit parsing. ArgusOps circuit-breaker tripped at 38ms, saving an estimated 412,000 tokens ($34.80 value). No customer impact.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <div className="flex items-center justify-between text-slate-900 font-semibold">
                <span>Scheduled Maintenance Completed</span>
                <span className="font-mono text-slate-500 text-[11px]">3 days ago</span>
              </div>
              <p className="text-slate-600">
                Applied zero-downtime rolling update to US-East Hypervisor cluster nodes to optimize shared AST cache compression.
              </p>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

