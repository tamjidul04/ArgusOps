import React from "react";
import { Metadata } from "next";
import { PublicNavbar, PublicFooter } from "@/components/layout";
import { FileText, Shield, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service | ArgusOps v1.1",
  description:
    "ArgusOps Enterprise Terms of Service, licensing for the local PC daemon, token usage terms, and 14-day refund policy.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicNavbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full space-y-12">
        {/* Header */}
        <div className="border-b border-slate-200 pb-8 space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-xs">
            <FileText className="h-3.5 w-3.5" />
            <span>Enterprise Terms of Service</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Terms of Service &amp; Licensing Agreement
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Last Updated: October 30, 2026 • Platform Version: v1.1 • Author / Owner: MD.Tamjidul Islam
          </p>
        </div>

        {/* Highlight Guarantee */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-2 shadow-xs">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <Shield className="h-4 w-4 text-emerald-600" />
            <span>Fair-Use, Predictable SLA &amp; 14-Day Refund Guarantee</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            By using ArgusOps (the &quot;Platform&quot;), including our cloud hypervisor and local PC background daemon (<code className="font-mono bg-slate-100 px-1 py-0.5 rounded">&lt;150MB RAM</code>),
            you agree to these Terms. If you are unsatisfied with your paid subscription within 14 days of upgrade, you are entitled to a full refund.
          </p>
        </div>

        {/* Content Clauses */}
        <div className="space-y-8 text-sm text-slate-600 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">1. License &amp; Local Daemon Usage</h2>
            <p className="text-xs">
              ArgusOps grants you a non-exclusive, revocable license to run our desktop daemon software on your workstations.
              The daemon operates under a Zero-Trust architecture, analyzing process handles, AST tokens, and local file mutexes.
              You retain 100% intellectual property ownership of all software code authored, debugged, or modified by your agents.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">2. Token Governance &amp; Wallet Balances</h2>
            <p className="text-xs">
              New accounts receive 50,000 initial free tokens. Paid plans provide monthly recurring token allowances as set forth on our Pricing page.
              Tokens represent hypervisor computational units used for task DAG decomposition, semantic loop inspection, and context caching.
              Unused free tokens do not expire, while paid quota refreshes every 30 days.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">3. Loop Circuit-Breaker Liability</h2>
            <p className="text-xs">
              While ArgusOps targets a &lt;100ms response time for infinite loop detection (with an average latency of 38ms),
              AI agent models and API endpoints operate stochastically. ArgusOps provides circuit-breaker intervention on a best-effort basis
              and is not liable for upstream third-party API provider downtime or billing errors.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">4. Admin Approval &amp; Cluster Right-Sizing</h2>
            <p className="text-xs">
              Enterprise and Pro Swarm upgrades may be subject to review via our Transaction Approval Queue to verify compute resource availability
              and prevent noisy-neighbor cluster contention. ArgusOps reserves the right to reject or refund requests that violate platform stability guidelines.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">5. 14-Day Money-Back Policy</h2>
            <p className="text-xs">
              If at any point within 14 days of your initial plan purchase or token injection you determine that ArgusOps does not meet your team&apos;s cost-saving
              expectations, submit a support ticket from your dashboard or email <strong className="text-slate-900">billing@argusops.dev</strong> for an immediate refund.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">6. Governing Law</h2>
            <p className="text-xs">
              These terms are governed by the laws of enterprise cloud software service agreements. Inquiries regarding custom master services agreements (MSA)
              can be directed to <strong className="text-slate-900">legal@argusops.dev</strong>.
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

