import React from "react";
import {
  Bell,
  Eye,
  Gauge,
  KeyRound,
  LayoutDashboard,
  PauseCircle,
  Puzzle,
  Repeat,
  Sparkles,
  Terminal,
  Play,
  ShieldCheck,
} from "lucide-react";
import { PublicShell } from "@/components/layout";
import { Bezel, ButtonLink, CodeBlock, Container, Eyebrow, Section, SectionHeading } from "@/components/ui";
import { HeroMock } from "@/components/marketing/HeroMock";

const STEPS = [
  { icon: Eye, title: "Watch", body: "Run your agent through argus. A small proxy on your machine sees each model call and its real token usage." },
  { icon: Repeat, title: "Detect", body: "Exact repeats, ping-pong, longer cycles and paraphrased loops are caught in milliseconds, using thresholds you set." },
  { icon: PauseCircle, title: "Pause", body: "The next request is held. Nothing reaches the provider, so a stuck agent stops spending." },
  { icon: Play, title: "Resume", body: "Approve the suggested instruction, edit it, or stop the agent. It continues with your hint." },
];

const LOOP_KINDS = ["Exact repeat", "Ping-pong", "Cycle", "Paraphrased"];
const CHANNELS = ["Dashboard", "Desktop", "VS Code", "Slack", "Discord", "Webhook"];

export default function LandingPage() {
  return (
    <PublicShell>
      {/* Hero */}
      <section className="relative overflow-hidden pb-20 pt-36 md:pb-32 md:pt-44">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(60%_60%_at_70%_0%,rgba(148,163,184,0.28),transparent_70%)]"
        />
        <Container className="relative">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
            <div className="space-y-8">
              <Eyebrow>Early access &middot; v0.2</Eyebrow>
              <h1 className="text-balance text-[2.6rem] font-semibold leading-[1.02] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
                Stop your AI agent before it burns your tokens.
              </h1>
              <p className="max-w-xl text-pretty text-lg leading-relaxed text-slate-600">
                ArgusOps supervises the coding agents you already run. When one starts looping, it pauses the agent, writes a corrective
                instruction and alerts you. You bring your own model key.
              </p>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <ButtonLink href="/signup">Start free</ButtonLink>
                <ButtonLink href="/how-it-works" variant="secondary">
                  See how it works
                </ButtonLink>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Free for 2 agents
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Your key, your bill
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Prompts and code stay on your machine
                </li>
              </ul>
            </div>
            <HeroMock />
          </div>
        </Container>
      </section>

      {/* Supported surfaces strip */}
      <section aria-label="Where it works" className="border-y border-slate-900/5 bg-white">
        <Container className="flex flex-col items-start justify-between gap-4 py-6 text-sm text-slate-600 sm:flex-row sm:items-center">
          <p className="font-medium text-slate-900">Works with Claude Code today. Codex and Gemini are next.</p>
          <p>Website &middot; argus CLI &middot; VS Code extension</p>
        </Container>
      </section>

      {/* How it works */}
      <Section labelledBy="flow-title">
        <SectionHeading
          id="flow-title"
          eyebrow="How it works"
          title="Four steps between a stuck agent and your wallet."
          lead="Nothing changes about how you work. You start the agent with argus, and ArgusOps stays out of the way until it matters."
        />
        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Bezel as="li" key={s.title} className="reveal">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/[0.05] text-slate-900">
                <s.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-6 font-mono text-[11px] text-slate-500">0{i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </Bezel>
          ))}
        </ol>
        <div className="mt-10">
          <ButtonLink href="/how-it-works" variant="ghost">
            The full flow
          </ButtonLink>
        </div>
      </Section>

      {/* Bento features */}
      <Section tone="white" labelledBy="features-title">
        <SectionHeading
          id="features-title"
          eyebrow="Features"
          title="Built for the way agents actually fail."
          lead="Agents rarely crash. They repeat themselves politely while the meter runs. ArgusOps is made for that."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-12">
          <Bezel className="reveal md:col-span-7">
            <Repeat className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">Loop detection that reads between the lines</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              Four patterns, tuned per user. Paraphrased loops, where the agent rewords the same failed attempt, are caught too.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {LOOP_KINDS.map((k) => (
                <li key={k} className="rounded-full bg-slate-900/[0.04] px-3 py-1.5 font-mono text-xs text-slate-700 ring-1 ring-slate-900/5">
                  {k}
                </li>
              ))}
            </ul>
          </Bezel>

          <Bezel className="reveal md:col-span-5" tone="dark">
            <PauseCircle className="h-5 w-5 text-white" aria-hidden="true" />
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-white">Pause that costs nothing</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              ArgusOps holds the next request instead of sending it. A paused agent spends zero tokens until you decide.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-400/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Held, not sent
            </p>
          </Bezel>

          <Bezel className="reveal md:col-span-5">
            <Sparkles className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">Suggested instructions</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A short corrective note built from the steps the agent kept repeating and the error it kept hitting. Approve, edit or dismiss. Turn
              on auto-resume if you trust it.
            </p>
          </Bezel>

          <Bezel className="reveal md:col-span-7">
            <Bell className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">Alerts where you already are</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              Get told when an agent pauses, stops or your allowance runs out. No dashboard-watching required.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <li key={c} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-soft ring-1 ring-slate-900/[0.07]">
                  {c}
                </li>
              ))}
            </ul>
          </Bezel>

          <Bezel className="reveal md:col-span-4">
            <Gauge className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">Real usage, real savings</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Tokens, estimated spend, loops caught and cache savings, by agent and model. Measured from provider data, never invented.
            </p>
          </Bezel>

          <Bezel className="reveal md:col-span-4">
            <KeyRound className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">Bring your own key</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Claude Code keeps using your Anthropic login. ArgusOps sells supervision, not tokens.
            </p>
          </Bezel>

          <Bezel className="reveal md:col-span-4">
            <ShieldCheck className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">Private by design</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              We receive token counts and incident reports. Prompts and code never leave your machine.
            </p>
          </Bezel>
        </div>
        <div className="mt-10">
          <ButtonLink href="/features" variant="ghost">
            All features
          </ButtonLink>
        </div>
      </Section>

      {/* Three surfaces */}
      <Section labelledBy="surfaces-title">
        <SectionHeading
          id="surfaces-title"
          eyebrow="Three surfaces"
          title="Run it in the terminal. Watch it from the editor. Review it on the web."
        />
        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          <Bezel className="reveal">
            <Terminal className="h-5 w-5" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">argus CLI</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Wraps Claude Code with a local proxy. Sign in once in your browser, no pasted keys.</p>
            <CodeBlock className="mt-6" code={"argus login\nargus run claude"} />
          </Bezel>
          <Bezel className="reveal">
            <Puzzle className="h-5 w-5" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">VS Code extension</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              An Agents view, a status bar that turns amber when an agent needs you, and approve, resume or stop without leaving the editor.
            </p>
            <div className="mt-6">
              <ButtonLink href="/download" variant="secondary">
                Get the extension
              </ButtonLink>
            </div>
          </Bezel>
          <Bezel className="reveal">
            <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Web dashboard</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Every agent, incident and rewrite in one place, with usage and savings, guardrail policy, notifications and billing.
            </p>
            <div className="mt-6">
              <ButtonLink href="/dashboard" variant="secondary">
                Open dashboard
              </ButtonLink>
            </div>
          </Bezel>
        </div>
      </Section>

      {/* Privacy band */}
      <Section tone="dark" labelledBy="privacy-title">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <SectionHeading
            id="privacy-title"
            tone="dark"
            eyebrow="Privacy"
            title="We see token counts. We never see your code."
            lead="The proxy runs on 127.0.0.1 and forwards calls to Anthropic with your own credentials. Only usage numbers and incident reports are sent to ArgusOps."
          />
          <ul className="reveal space-y-3 text-sm text-slate-300">
            {[
              "Prompts and source code stay on your machine",
              "Session tokens and API keys are stored only as hashes",
              "Optional two-factor sign-in",
              "Device keys can resume or stop agents, never change billing or settings",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 ring-1 ring-white/10">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-10">
          <ButtonLink href="/security" variant="inverse">
            Read about security
          </ButtonLink>
        </div>
      </Section>

      {/* Pricing teaser + CTA */}
      <Section labelledBy="cta-title">
        <div className="reveal mx-auto max-w-3xl space-y-6 text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 id="cta-title" className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 md:text-6xl">
            Free for two agents. Ten on Pro.
          </h2>
          <p className="text-pretty text-lg leading-relaxed text-slate-600">
            Start free, supervise your first agent in minutes, and upgrade only when you need more of them running at once.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup">Start free</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary">
              Compare plans
            </ButtonLink>
          </div>
        </div>
      </Section>
    </PublicShell>
  );
}
