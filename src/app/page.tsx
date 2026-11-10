import React from "react";
import { ShieldCheck } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { ButtonLink, CodeBlock, Container, Eyebrow, Section, SectionHeading } from "@/components/ui";
import { HeroMock } from "@/components/marketing/HeroMock";
import { LoopCompare } from "@/components/marketing/LoopCompare";
import { PrivacyFlow } from "@/components/marketing/PrivacyFlow";

const STEPS = [
  { t: "Watch", body: "Run your agent through argus. A small proxy on your machine sees each model call and its real token usage." },
  { t: "Detect", body: "Exact repeats, ping-pong, longer cycles and paraphrased loops are caught in milliseconds, using thresholds you set." },
  { t: "Pause", body: "The next request is held. Nothing reaches the provider, so a stuck agent stops spending." },
  { t: "Resume", body: "Approve the suggested instruction, edit it, or stop the agent. It continues with your hint." },
];

const FEATURES: { tag: string; title: string; body: string; chips?: string[] }[] = [
  {
    tag: "detect",
    title: "Loop detection that reads between the lines",
    body: "Four patterns, tuned per user. Paraphrased loops, where the agent rewords the same failed attempt, are caught too.",
    chips: ["Exact repeat", "Ping-pong", "Cycle", "Paraphrased"],
  },
  { tag: "pause", title: "A pause that costs nothing", body: "ArgusOps holds the next request instead of sending it. A paused agent spends zero tokens until you decide." },
  {
    tag: "suggest",
    title: "Suggested instructions",
    body: "A short corrective note built from the steps the agent kept repeating and the error it kept hitting. Approve, edit or dismiss, or turn on auto-resume if you trust it.",
  },
  {
    tag: "alert",
    title: "Alerts where you already are",
    body: "Get told when an agent pauses, stops or your allowance runs out. No dashboard-watching required.",
    chips: ["Dashboard", "Desktop", "VS Code", "Slack", "Discord", "Webhook"],
  },
  { tag: "measure", title: "Real usage, real savings", body: "Tokens, estimated spend, loops caught and cache savings, by agent and model. Measured from provider data, never invented." },
  { tag: "byok", title: "Bring your own key", body: "Claude Code keeps using your Anthropic login. ArgusOps sells supervision, not tokens." },
];

const SURFACES = [
  { name: "argus CLI", body: "Wraps Claude Code with a local proxy. Sign in once in your browser, no pasted keys.", href: "/docs#cli", cta: "CLI reference" },
  {
    name: "VS Code extension",
    body: "A small dashboard in the sidebar, an agent list, a status bar that turns amber when an agent needs you, and approve, resume or stop without leaving the editor.",
    href: "/download",
    cta: "Get the extension",
  },
  { name: "Web dashboard", body: "Every agent, incident and rewrite in one place, with usage, guardrail policy, notifications and billing.", href: "/dashboard", cta: "Open dashboard" },
];

/** Splits a headline into words that rise out of a mask, one after another, once. */
function Rise({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <React.Fragment key={i}>
          <span className="rise-mask">
            <span className="rise" style={{ animationDelay: `${start + i * 55}ms` }}>
              {w}
            </span>
          </span>{" "}
        </React.Fragment>
      ))}
    </>
  );
}

export default function LandingPage() {
  return (
    <PublicShell>
      {/* Hero */}
      <section className="dot-grid relative border-b border-slate-200 pb-16 pt-28 md:pb-24 md:pt-36">
        <Container>
          <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div className="pt-2 lg:pt-8">
              <Eyebrow>Early access · v0.2</Eyebrow>
              <h1 className="mt-5 text-balance text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-slate-900 sm:text-6xl 2xl:text-7xl">
                <Rise text="Stop your AI agent before it burns your tokens." />
              </h1>
              <p className="fade-in mt-6 max-w-lg text-pretty text-lg leading-relaxed text-slate-500 2xl:max-w-xl 2xl:text-xl" style={{ animationDelay: "450ms" }}>
                ArgusOps supervises the coding agents you already run. When one starts looping, it pauses the agent, writes a corrective
                instruction and tells you. You bring your own model key.
              </p>
              <div className="fade-in mt-8 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center" style={{ animationDelay: "550ms" }}>
                <ButtonLink href="/signup">Start free</ButtonLink>
                <ButtonLink href="/how-it-works" variant="secondary" arrow={false}>
                  See how it works
                </ButtonLink>
              </div>
              <dl className="fade-in mt-10 grid max-w-md grid-cols-3 divide-x divide-slate-200 border-y border-slate-200 text-sm" style={{ animationDelay: "650ms" }}>
                {[
                  ["2", "agents free"],
                  ["<100ms", "loop check"],
                  ["0", "prompts sent to us"],
                ].map(([v, l]) => (
                  <div key={l} className="py-3 pl-3 first:pl-0">
                    <dt className="sr-only">{l}</dt>
                    <dd className="tabular font-mono text-base text-slate-900">{v}</dd>
                    <dd className="text-xs text-slate-500">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <HeroMock />
          </div>
        </Container>
      </section>

      <section aria-label="Where it works" className="bg-white">
        <Container className="flex flex-col items-start justify-between gap-2 py-5 text-sm sm:flex-row sm:items-center">
          <p className="text-slate-900">Works with Claude Code today. Codex and Gemini are next.</p>
          <p className="font-mono text-xs text-slate-500">website · argus CLI · VS Code</p>
        </Container>
      </section>

      {/* How it works: a timeline, not a card grid */}
      <Section labelledBy="flow-title">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <SectionHeading
            id="flow-title"
            eyebrow="How it works"
            title="Four steps between a stuck agent and your wallet."
            lead="Nothing changes about how you work. You start the agent with argus, and ArgusOps stays out of the way until it matters."
          />
          <ol className="relative border-l border-slate-200">
            {STEPS.map((s, i) => (
              <li key={s.t} className="group relative pb-10 pl-8 last:pb-0">
                <span
                  aria-hidden="true"
                  className="absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border border-slate-300 bg-slate-50 transition-colors duration-200 group-hover:border-slate-900 group-hover:bg-slate-900"
                />
                <p className="font-mono text-xs text-slate-400">0{i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold tracking-[-0.01em] text-slate-900">{s.t}</h3>
                <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-slate-500">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Features: an index, not a bento */}
      <Section tone="white" labelledBy="features-title">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <SectionHeading
              id="features-title"
              eyebrow="Features"
              title="Built for the way agents actually fail."
              lead="Agents rarely crash. They repeat themselves politely while the meter runs. ArgusOps is made for that."
            />
            <div className="mt-6">
              <ButtonLink href="/features" variant="secondary" arrow={false}>
                All features
              </ButtonLink>
            </div>
          </div>
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {FEATURES.map((f) => (
              <li key={f.tag} className="grid gap-2 py-6 sm:grid-cols-[7rem_1fr] sm:gap-6">
                <span className="font-mono text-xs leading-7 text-slate-400">{f.tag}</span>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-500">{f.body}</p>
                  {f.chips && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {f.chips.map((c) => (
                        <li key={c} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Three surfaces, split by hairlines */}
      <Section labelledBy="surfaces-title">
        <SectionHeading id="surfaces-title" eyebrow="Three surfaces" title="Run it in the terminal. Watch it from the editor. Review it on the web." />
        <div className="mt-12 grid border-y border-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-slate-200">
          {SURFACES.map((s, i) => (
            <div key={s.name} className="flex flex-col border-b border-slate-200 py-8 last:border-b-0 lg:border-b-0 lg:px-8 lg:first:pl-0 lg:last:pr-0">
              <p className="font-mono text-xs text-slate-400">0{i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">{s.name}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-slate-500">{s.body}</p>
              {i === 0 && <CodeBlock className="mt-5" code={"argus login\nargus run claude"} />}
              <div className="mt-auto pt-6">
                <ButtonLink href={s.href} variant="ghost" className="-ml-3">
                  {s.cta}
                </ButtonLink>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Privacy band */}
      <Section tone="dark" labelledBy="privacy-title" background={<PrivacyFlow />}>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              id="privacy-title"
              tone="dark"
              eyebrow="Privacy"
              title="We see token counts. We never see your code."
              lead="The proxy runs on 127.0.0.1 and forwards calls to Anthropic with your own credentials. Only usage numbers and incident reports reach ArgusOps."
            />
            <div className="mt-8">
              <ButtonLink href="/security" variant="inverse" arrow={false}>
                Read about security
              </ButtonLink>
            </div>
          </div>
          <ul className="divide-y divide-white/10 border-y border-white/10 text-[15px] text-slate-300">
            {[
              "Prompts and source code stay on your machine",
              "Session tokens and API keys are stored only as hashes",
              "Optional two-factor sign-in",
              "Device keys can resume or stop agents, never change billing or settings",
            ].map((t) => (
              <li key={t} className="flex gap-3 py-4">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Pricing teaser */}
      <Section labelledBy="cta-title">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="max-w-xl space-y-3">
            <Eyebrow>Pricing</Eyebrow>
            <h2 id="cta-title" className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-slate-900 md:text-5xl">
              Free for two agents. Ten on Pro.
            </h2>
            <p className="text-pretty text-[17px] leading-relaxed text-slate-500">
              Start free, supervise your first agent in minutes, and upgrade only when you need more of them running at once.
            </p>
            <div className="flex flex-col gap-2.5 pt-4 sm:flex-row">
              <ButtonLink href="/signup">Start free</ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" arrow={false}>
                Compare plans
              </ButtonLink>
            </div>
          </div>
          <LoopCompare />
        </div>
      </Section>
    </PublicShell>
  );
}
