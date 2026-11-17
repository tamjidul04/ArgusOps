import React from "react";
import { Metadata } from "next";
import { Activity, Info } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { Bezel, ButtonLink, Container, PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Status",
  description: "ArgusOps is in early access. This page explains what we publish about availability today.",
};

const PARTS = [
  { name: "Website and dashboard", note: "The pages you are using now." },
  { name: "Control plane API", note: "Agent registration, incidents, usage and policy." },
  { name: "CLI sync", note: "What argus reports and the commands it receives." },
  { name: "Notifications", note: "Dashboard, webhook and desktop alerts." },
];

export default function StatusPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Status"
        title="No live status feed yet."
        lead="ArgusOps is in early access. We do not publish uptime numbers or an incident history, because we would rather show none than make them up."
      />

      <Container data-reveal suppressHydrationWarning className="max-w-3xl space-y-6 py-16 md:py-24">
        <Bezel className="" innerClassName="sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white">
              <Activity className="h-5 w-5 text-slate-700" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">When an agent is affected, you will know</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Your own agents are always visible in the dashboard, with every pause, stop and incident. If the CLI cannot reach ArgusOps it keeps supervising on your
                machine, and you can run with <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em]">--offline</code> at any time.
              </p>
            </div>
          </div>
        </Bezel>

        <section aria-labelledby="parts-title" className="">
          <h2 id="parts-title" className="px-1 text-xs font-medium text-slate-500">
            What a future status page will cover
          </h2>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg bg-white border border-slate-200">
            {PARTS.map((p) => (
              <li key={p.name} className="flex flex-col gap-1 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                <span className="text-sm text-slate-600">{p.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-3 pt-4 sm:flex-row">
          <ButtonLink href="/dashboard/guardrails">See your agents</ButtonLink>
          <ButtonLink href="/changelog" variant="secondary">
            Read the changelog
          </ButtonLink>
        </div>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Info className="h-3.5 w-3.5" aria-hidden="true" /> Real-time provider outages are shown on your model provider&rsquo;s own status page.
        </p>
      </Container>
    </PublicShell>
  );
}
