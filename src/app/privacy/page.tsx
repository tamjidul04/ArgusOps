import React from "react";
import { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Container, PageHeader } from "@/components/ui";
import { CheckCircle2, Lock } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How ArgusOps handles your data.",
};

export default function PrivacyPage() {
  return (
    <PublicShell>
      <PageHeader eyebrow="Privacy" title="Your code stays on your machine." lead="Effective October 30, 2026 · Owner: MD.Tamjidul Islam" />
      <Container className="max-w-3xl py-16 md:py-24">
        <div className="space-y-12">
          <div className="rounded-lg ring-1 ring-emerald-600/20 bg-emerald-50/70 p-6 sm:p-8 space-y-3">
          <h2 className="text-base font-bold text-emerald-950 flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600" />
            <span>The ArgusOps Zero-Trust Core Principle</span>
          </h2>
          <p className="text-sm sm:text-sm text-emerald-900 leading-relaxed">
            The ArgusOps Desktop Daemon (<code className="font-mono bg-emerald-100/60 px-1 py-0.5 rounded">&lt;150MB RAM</code>) is designed with zero-knowledge telemetry.
            When you run multiple local PC agents like Claude, Antigravity, and Hermes, our daemon intercepts file locks and AST metrics on your local machine using standard OS IPC primitives.
            <strong> Under no circumstances is your raw proprietary source code, repository files, or database secrets uploaded to our servers.</strong>
          </p>
        </div>
          <div className="space-y-12 text-sm text-slate-600 leading-relaxed">
          <section data-reveal suppressHydrationWarning className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">1. Data We Do NOT Collect</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>No Source Code:</strong> We do not receive, store, or index your project files, Git commits, or documentation.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>No API Keys of Third Parties:</strong> Your OpenAI, Anthropic, or local model credentials stay strictly in your local configuration.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>No Environment Variables:</strong> The daemon does not scrape or transmit your <code className="font-mono">.env</code> files.</span>
              </li>
            </ul>
          </section>

          <section data-reveal suppressHydrationWarning className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">2. Telemetry Collected Exclusively for Governance</h2>
            <p className="text-sm">
              To provide real-time token savings calculations and loop circuit-breaker alerts on your dashboard, only the following anonymized numerical metrics are transmitted:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-600">
              <li>Raw token consumption count (e.g. 14,200 tokens used on task #3).</li>
              <li>Calculated sha256 hashes of repeated tool calls to detect exact loop recursion.</li>
              <li>Process resource metrics: RAM usage (MB) and CPU utilization (%) per agent PID.</li>
              <li>Response latency of the circuit-breaker interception hook (ms).</li>
            </ul>
          </section>

          <section data-reveal suppressHydrationWarning className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">3. Local File Mutex Isolation</h2>
            <p className="text-sm">
              The file-locking mutex runs entirely in user-space memory on your local PC via IPC Unix sockets or Named Pipes.
              File path strings (e.g. <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">src/app/page.tsx</code>) are held in memory solely to prevent Claude from overwriting Hermes and are never logged externally.
            </p>
          </section>

          <section data-reveal suppressHydrationWarning className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">4. SOC2 Type II &amp; Compliance Standards</h2>
            <p className="text-sm">
              ArgusOps cloud infrastructure is hosted in SOC2 Type II certified data centers with TLS 1.3 encryption for all transit telemetry and AES-256 for database storage at rest.
            </p>
          </section>

          <section data-reveal suppressHydrationWarning className="space-y-3">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">5. Contact &amp; Privacy Officer</h2>
            <p className="text-sm">
              For security inquiries, audit certifications, or data deletion requests, contact our engineering office at <strong className="text-slate-900">security@argusops.dev</strong>.
            </p>
          </section>
        </div>
        </div>
      </Container>
    </PublicShell>
  );
}
