import React from "react";
import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { Bezel, ButtonLink, CodeBlock, Container, PageHeader, SectionHeading } from "@/components/ui";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "How it works",
  description: "A local proxy watches each model call, holds the next one when your agent loops, and waits for you. What runs where, and what leaves your machine.",
};

const STEPS: { title: string; body: string; code?: string; codeTitle?: string }[] = [
  {
    title: "Sign in once",
    body: "The CLI prints a short code. Approve it in your browser and the machine is paired. No keys to copy and paste.",
    code: "argus login",
    codeTitle: "terminal",
  },
  {
    title: "Start your agent through argus",
    body: "argus starts a small proxy on 127.0.0.1 and launches Claude Code pointed at it. Everything after “claude” goes to Claude Code as usual.",
    code: "argus run claude\nargus run claude --resume",
    codeTitle: "terminal",
  },
  {
    title: "Calls pass through with your own credentials",
    body: "Each model call is forwarded to Anthropic using your key or login. ArgusOps reads the token usage from the reply and checks the pattern of calls.",
  },
  {
    title: "A loop is caught, the next request is held",
    body: "If the agent repeats the same failing call, ArgusOps holds its next request. Nothing is sent, so nothing is spent. You get an alert and an incident appears in the dashboard.",
  },
  {
    title: "You decide",
    body: "Approve the suggested instruction, edit it, or stop the agent. Approving resumes the agent with that hint added to its next request. Do it from the dashboard, the VS Code extension, or let auto-resume handle it.",
  },
];

const SENT = ["Token counts per model call", "Incident reports: which pattern, how many repeats, the repeated step names", "Agent name, status and heartbeat"];
const NEVER = ["Your prompts", "Your source code", "Your Anthropic key", "Model replies"];

export default function HowItWorksPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="How it works"
        title="A proxy on your machine, and a person in the loop."
        lead="ArgusOps does not run your agent and does not need your code. It watches the conversation between the agent and the model, and steps in when it goes in circles."
      />

      <Container className="py-20 md:py-28">
        <ol className="space-y-6">
          {STEPS.map((s, i) => (
            <li data-reveal suppressHydrationWarning key={s.title} className="grid gap-6 md:grid-cols-[4rem_1fr] md:gap-10">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-500">{i + 1}</span>
              <div className="grid gap-6 border-b border-slate-200 pb-10 lg:grid-cols-2 lg:gap-10">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">{s.title}</h2>
                  <p className="mt-2 text-pretty leading-relaxed text-slate-600">{s.body}</p>
                </div>
                {s.code && <CodeBlock code={s.code} title={s.codeTitle} />}
              </div>
            </li>
          ))}
        </ol>
      </Container>

      <section className="bg-white py-20 md:py-28" aria-labelledby="data-title">
        <Container data-reveal suppressHydrationWarning>
          <SectionHeading
            id="data-title"
            eyebrow="Data"
            title="What leaves your machine, and what never does."
            lead="The split is the product. ArgusOps needs numbers, not content."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <Bezel className="">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">Sent to ArgusOps</h3>
              <ul className="mt-5 space-y-3 text-sm text-slate-700">
                {SENT.map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </Bezel>
            <Bezel className="" tone="dark">
              <h3 className="text-lg font-semibold tracking-tight text-white">Never sent</h3>
              <ul className="mt-5 space-y-3 text-sm text-slate-300">
                {NEVER.map((t) => (
                  <li key={t} className="flex gap-3">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </Bezel>
          </div>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/docs#getting-started">Follow the setup guide</ButtonLink>
            <ButtonLink href="/security" variant="secondary">
              Security details
            </ButtonLink>
          </div>
        </Container>
      </section>

      <div className="pt-20 md:pt-32">
        <CtaBand />
      </div>
    </PublicShell>
  );
}
