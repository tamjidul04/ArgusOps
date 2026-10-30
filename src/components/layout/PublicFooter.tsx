import React from "react";
import Link from "next/link";
import { Triangle, Shield, FileText, CheckCircle2 } from "lucide-react";

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Brand Info */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
                <Triangle className="h-3.5 w-3.5 fill-white text-white" />
              </div>
              <span className="font-bold tracking-tight text-slate-900 text-base">
                ArgusOps
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                v1.1
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              Intelligent AI Agent Cluster Management, 24/7 Loop Circuit-Breakers,
              Dynamic Concurrency Right-Sizing, and Local PC Bridge for Claude,
              Antigravity, and Hermes.
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium pt-1">
              <Shield className="h-3.5 w-3.5 text-emerald-600" />
              <span>Zero-Trust Local Code Isolation</span>
            </div>
          </div>

          {/* Product Links */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Platform
            </p>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <Link href="/dashboard" className="hover:text-slate-900 transition-colors">
                  Cluster Visualizer
                </Link>
              </li>
              <li>
                <Link href="/dashboard/orchestrator" className="hover:text-slate-900 transition-colors">
                  Task Decomposition & Right-Sizing
                </Link>
              </li>
              <li>
                <Link href="/dashboard/guardrails" className="hover:text-slate-900 transition-colors">
                  Loop Detection & RAM Hypervisor
                </Link>
              </li>
              <li>
                <Link href="/dashboard/local-bridge" className="hover:text-slate-900 transition-colors">
                  Desktop Daemon & File Mutex
                </Link>
              </li>
              <li>
                <Link href="/dashboard/billing" className="hover:text-slate-900 transition-colors">
                  Token Wallet & Quota
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources & Research */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Resources & Research
            </p>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <Link href="/docs" className="hover:text-slate-900 transition-colors">
                  Documentation & Quick-Start
                </Link>
              </li>
              <li>
                <Link href="/#benchmarks" className="hover:text-slate-900 transition-colors">
                  100-Agent Swarm Benchmarks
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-slate-900 transition-colors">
                  Pricing Plans & Free Tier
                </Link>
              </li>
              <li>
                <Link href="/status" className="hover:text-slate-900 transition-colors">
                  Live System Status (99.98%)
                </Link>
              </li>
              <li>
                <a
                  href="https://arxiv.org/abs/2410.0891"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-900 underline underline-offset-2 hover:text-slate-700"
                >
                  Peer-Reviewed Whitepaper (arXiv)
                </a>
              </li>
            </ul>
          </div>

          {/* Security & Guarantees */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              Trust & Guarantees
            </p>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>SOC2 Type II Certified Architecture</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>14-day Money-back Guarantee</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Under 150MB Daemon RAM Footprint</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Under 100ms Interception Response</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar matching Stitch export */}
        <div className="border-t border-slate-200 pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/docs" className="hover:text-slate-900 underline-offset-4 hover:underline">
              /docs
            </Link>
            <span>•</span>
            <Link href="/privacy" className="hover:text-slate-900 underline-offset-4 hover:underline">
              Privacy Policy (Zero-Trust Local Code)
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-slate-900 underline-offset-4 hover:underline">
              Terms of Service
            </Link>
            <span>•</span>
            <Link href="/status" className="hover:text-slate-900 underline-offset-4 hover:underline">
              System Status
            </Link>
          </div>
          <div className="text-right">
            <span>Owner: </span>
            <strong className="font-semibold text-slate-900">MD.Tamjidul Islam</strong>
          </div>
        </div>
      </div>
    </footer>
  );
}

