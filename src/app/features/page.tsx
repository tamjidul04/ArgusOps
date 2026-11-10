import React from "react";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { ButtonLink, Container, Eyebrow, PageHeader } from "@/components/ui";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "Features",
  description: "Loop detection, pause without spending, suggested instructions, alerts and real usage numbers for the AI coding agents you run.",
};

const FEATURES: { id: string; eyebrow: string; title: string; body: string; points: string[]; aside: { label: string; value: string }[] }[] = [
  {
    id: "loops",
    eyebrow: "Detection",
    title: "Loop detection tuned to how agents fail",
    body: "Coding agents rarely crash. They retry the same thing, bounce between two fixes, or reword a failed attempt. ArgusOps recognises each pattern and applies thresholds from your own policy.",
    points: ["Exact repeats of the same call", "Ping-pong between two actions", "Longer cycles of steps", "Paraphrased loops, where the wording changes but the attempt does not", "Typically decided in a few milliseconds"],
    aside: [
      { label: "Patterns", value: "4" },
      { label: "Decision time", value: "A few ms" },
    ],
  },
  {
    id: "pause",
    eyebrow: "Control",
    title: "Pause by holding the request",
    body: "The CLI runs a proxy on your machine. When a loop is detected, the next model call is held instead of forwarded, so a stuck agent stops spending at once. Resume with a hint, or stop it.",
    points: ["Nothing is sent to the provider while paused", "Resume with an optional hint added to the next request", "Stop ends the agent process", "Plan limits are enforced when an agent starts"],
    aside: [
      { label: "Tokens while paused", value: "0" },
      { label: "Agents on Free / Pro", value: "2 / 10" },
    ],
  },
  {
    id: "rewrite",
    eyebrow: "Recovery",
    title: "Suggested instructions, not just alarms",
    body: "When an agent loops, ArgusOps writes a short corrective instruction from the steps it kept repeating and the error it kept hitting. It also shows what the loop really cost.",
    points: ["Approve, edit or dismiss in the dashboard or in VS Code", "Approving resumes the agent with the instruction", "Optional auto-resume, once per 30 minutes per agent", "Optional wording polish by a small model, sending only the repeated steps"],
    aside: [
      { label: "Auto-resume cooldown", value: "30 min" },
      { label: "Needs your approval", value: "By default" },
    ],
  },
  {
    id: "alerts",
    eyebrow: "Awareness",
    title: "Alerts where you already are",
    body: "Hear about it when an agent pauses or stops, or when your token allowance runs out, without keeping a dashboard open.",
    points: ["Dashboard bell and pop-up", "Browser alerts", "Desktop notification from the CLI on Windows, macOS and Linux", "VS Code status bar and alerts", "Slack, Discord or any https webhook"],
    aside: [
      { label: "Channels", value: "6" },
      { label: "Email", value: "Soon" },
    ],
  },
  {
    id: "usage",
    eyebrow: "Visibility",
    title: "Usage and savings you can trust",
    body: "Numbers come from provider-reported usage, not guesses. Spend is estimated at list prices, and savings from prompt caching are labelled as an estimate.",
    points: ["Tokens, estimated spend, model calls and loops caught", "By agent and by model", "Per hour or day over 24 hours, 7 days or 30 days", "Your plan allowance alongside"],
    aside: [
      { label: "Ranges", value: "24h · 7d · 30d" },
      { label: "Source", value: "provider data" },
    ],
  },
  {
    id: "guardrails",
    eyebrow: "Policy",
    title: "Guardrails that are yours to set",
    body: "Loop thresholds, file locks and permissions are stored per account, so what counts as stuck is your call.",
    points: ["Per-user loop thresholds", "File locks with expiry so agents do not overwrite each other", "Pause, resume and stop state kept in one place", "Incident log for every intervention"],
    aside: [
      { label: "Scope", value: "per account" },
      { label: "Audit", value: "incident log" },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Features"
        title="Everything between “stuck” and “handled”."
        lead="ArgusOps is a supervisor, not another agent. It sits beside the tools you already use and acts when they go wrong."
      >
        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <ButtonLink href="/signup">Start free</ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary" arrow={false}>
            How it works
          </ButtonLink>
        </div>
      </PageHeader>

      <Container className="py-16 md:py-24">
        <div className="grid gap-12 lg:grid-cols-[13rem_1fr] lg:gap-16">
          {/* On this page */}
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-24">
              <p className="text-xs font-medium text-slate-900">On this page</p>
              <ul className="mt-3 space-y-0.5 border-l border-slate-200 text-sm">
                {FEATURES.map((f) => (
                  <li key={f.id}>
                    <a href={`#${f.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-slate-500 transition-colors hover:border-slate-900 hover:text-slate-900">
                      {f.eyebrow}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="divide-y divide-slate-200">
            {FEATURES.map((f) => (
              <section key={f.id} id={f.id} aria-labelledby={`${f.id}-title`} className="py-12 first:pt-0 last:pb-0">
                <Eyebrow>{f.eyebrow}</Eyebrow>
                <h2 id={`${f.id}-title`} className="mt-3 text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-slate-900 md:text-3xl">
                  {f.title}
                </h2>
                <p className="mt-3 max-w-2xl text-pretty text-[17px] leading-relaxed text-slate-500">{f.body}</p>
                <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
                  {f.aside.map((a) => (
                    <div key={a.label}>
                      <dt className="text-xs text-slate-400">{a.label}</dt>
                      <dd className="mt-0.5 font-mono text-sm text-slate-900">{a.value}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-6 grid gap-x-8 gap-y-2.5 text-[15px] text-slate-700 sm:grid-cols-2">
                  {f.points.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </Container>

      <CtaBand />
    </PublicShell>
  );
}
