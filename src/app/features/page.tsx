import React from "react";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { Bezel, ButtonLink, Container, Eyebrow, PageHeader } from "@/components/ui";
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
          <ButtonLink href="/how-it-works" variant="secondary">
            How it works
          </ButtonLink>
        </div>
      </PageHeader>

      <Container className="py-20 md:py-28">
        <div className="space-y-20 md:space-y-28">
          {FEATURES.map((f, i) => (
            <section key={f.id} id={f.id} aria-labelledby={`${f.id}-title`} className="reveal grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className={i % 2 ? "lg:order-2" : undefined}>
                <Eyebrow>{f.eyebrow}</Eyebrow>
                <h2 id={`${f.id}-title`} className="mt-4 text-balance text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 md:text-4xl">
                  {f.title}
                </h2>
                <p className="mt-4 text-pretty text-base leading-relaxed text-slate-600">{f.body}</p>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  {f.points.map((p) => (
                    <li key={p} className="flex gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Bezel tone={i % 2 ? "light" : "dark"} className={i % 2 ? "lg:order-1" : undefined}>
                <dl className="grid grid-cols-2 gap-6">
                  {f.aside.map((a) => (
                    <div key={a.label}>
                      <dt className={i % 2 ? "text-xs text-slate-500" : "text-xs text-slate-400"}>{a.label}</dt>
                      <dd className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </Bezel>
            </section>
          ))}
        </div>
      </Container>

      <CtaBand />
    </PublicShell>
  );
}
