import React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { CodeBlock } from "@/components/ui";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting started" },
  { id: "cli", label: "CLI reference" },
  { id: "vscode", label: "VS Code extension" },
  { id: "loops", label: "Loops and pausing" },
  { id: "notifications", label: "Notifications" },
  { id: "plans", label: "Plans and limits" },
  { id: "privacy", label: "Privacy" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const h2 = "scroll-mt-28 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl";
const h3 = "mt-8 text-base font-semibold text-slate-900";
const p = "mt-3 text-pretty leading-relaxed text-slate-600";
const code = "rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800";

function Toc({ className }: { className?: string }) {
  return (
    <nav aria-label="On this page" className={className}>
      <p className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> On this page
      </p>
      <ul className="space-y-0.5 border-l border-slate-200">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Documentation content. Server-rendered; only the code blocks are interactive. */
export function DocsClient() {
  return (
    <div className="grid gap-10 lg:grid-cols-[14rem_1fr] lg:gap-16">
      <aside className="hidden lg:block">
        <Toc className="sticky top-28" />
      </aside>

      <details className="rounded-lg bg-white px-4 py-3 border border-slate-200 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">On this page</summary>
        <Toc className="mt-4" />
      </details>

      <article className="min-w-0 max-w-3xl space-y-16">
        <section aria-labelledby="overview">
          <h2 id="overview" className={h2}>
            Overview
          </h2>
          <p className={p}>
            ArgusOps supervises the AI coding agents you run. It watches each model call through a small proxy on your machine, catches loops
            before they burn your tokens, pauses the agent, suggests a corrective instruction and alerts you. Claude Code is supported today.
          </p>
          <p className={p}>
            You bring your own model credentials. ArgusOps sees token counts and incident reports, never your prompts or code.
          </p>
        </section>

        <section aria-labelledby="getting-started">
          <h2 id="getting-started" className={h2}>
            Getting started
          </h2>
          <p className={p}>You need Node 20 or newer, Claude Code installed, and an ArgusOps account.</p>

          <h3 className={h3}>1. Create an account</h3>
          <p className={p}>
            <Link href="/signup" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
              Sign up
            </Link>{" "}
            with email, Google or GitHub. The Free plan supervises two agents at once.
          </p>

          <h3 className={h3}>2. Get the CLI</h3>
          <p className={p}>
            From the repository root, build the bundled CLI. A published npm package is planned. See <Link href="/download" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">Download</Link>. Until then, run{" "}
            <code className={code}>node packages/cli/dist/argus.mjs</code> wherever these docs say <code className={code}>argus</code>.
          </p>
          <CodeBlock className="mt-4" title="terminal" code={"npm install\nnpm run cli:build"} />

          <h3 className={h3}>3. Pair this machine</h3>
          <p className={p}>The CLI prints a code and opens the approval page. Approve it in your browser.</p>
          <CodeBlock className="mt-4" title="terminal" code={"argus login"} />

          <h3 className={h3}>4. Run your agent under supervision</h3>
          <CodeBlock className="mt-4" title="terminal" code={"argus run claude"} />
          <p className={p}>
            That starts a proxy on <code className={code}>127.0.0.1</code> and launches Claude Code through it. Everything after{" "}
            <code className={code}>claude</code> is passed to Claude Code, for example <code className={code}>argus run claude --resume</code>.
          </p>
        </section>

        <section aria-labelledby="cli">
          <h2 id="cli" className={h2}>
            CLI reference
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg bg-white border border-slate-200">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Command
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {[
                  ["argus login", "Pairs this machine with your account through the browser."],
                  ["argus run claude [args]", "Runs Claude Code under supervision. Arguments go to Claude Code."],
                  ["argus run --offline claude", "Supervises locally and reports nothing to ArgusOps."],
                  ["--upstream <url>", "Forwards to a different provider endpoint, for testing."],
                ].map(([c, d]) => (
                  <tr key={c}>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[13px] text-slate-900">{c}</td>
                    <td className="px-5 py-3">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className={h3}>Environment variables</h3>
          <ul className="mt-3 space-y-2 text-slate-600">
            <li>
              <code className={code}>ARGUS_API_URL</code> points the CLI at a deployed server (default <code className={code}>http://localhost:3000</code>).
            </li>
            <li>
              <code className={code}>ARGUS_NO_DESKTOP_NOTIFY=1</code> turns off desktop notifications.
            </li>
          </ul>
        </section>

        <section aria-labelledby="vscode">
          <h2 id="vscode" className={h2}>
            VS Code extension
          </h2>
          <p className={p}>
            The extension adds an <strong>ArgusOps</strong> view that lists your agents with status and tokens, a status bar item that turns amber when an
            agent needs you, and alerts with Approve suggestion, Edit and Stop. Download it from the{" "}
            <Link href="/download" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
              download page
            </Link>{" "}
            and use <strong>Install from VSIX…</strong>.
          </p>
          <h3 className={h3}>Settings</h3>
          <ul className="mt-3 space-y-2 text-slate-600">
            <li>
              <code className={code}>argusops.serverUrl</code> the ArgusOps server to talk to.
            </li>
            <li>
              <code className={code}>argusops.pollIntervalSeconds</code> how often to refresh.
            </li>
            <li>
              <code className={code}>argusops.notifications</code> turn editor alerts on or off.
            </li>
          </ul>
          <p className={p}>The key is kept in VS Code&rsquo;s secret storage and only sent to the server that issued it.</p>
        </section>

        <section aria-labelledby="loops">
          <h2 id="loops" className={h2}>
            Loops and pausing
          </h2>
          <p className={p}>
            ArgusOps recognises exact repeats, ping-pong between two actions, longer cycles and paraphrased loops. Thresholds come from your guardrail policy.
            When one trips, the next model request is held, so nothing reaches the provider and no tokens are spent.
          </p>
          <p className={p}>
            The incident appears in <strong>Guardrails</strong> with a suggested instruction built from the repeated steps and the error. Approve it, edit it
            or stop the agent. Approving resumes the agent with that hint. Optional auto-resume acts once per 30 minutes per agent.
          </p>
        </section>

        <section aria-labelledby="notifications">
          <h2 id="notifications" className={h2}>
            Notifications
          </h2>
          <p className={p}>
            You are notified when an agent is paused or stopped, or your token allowance runs out: a bell and pop-up in the dashboard, optional browser
            alerts, a desktop pop-up from the CLI, VS Code alerts, and webhooks to Slack, Discord or any https endpoint. Email is not available yet.
          </p>
        </section>

        <section aria-labelledby="plans">
          <h2 id="plans" className={h2}>
            Plans and limits
          </h2>
          <p className={p}>
            Free supervises 2 agents at once, Pro 10, Enterprise is custom. The limit is checked when an agent starts. See{" "}
            <Link href="/pricing" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
              pricing
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="privacy">
          <h2 id="privacy" className={h2}>
            Privacy
          </h2>
          <p className={p}>
            Model calls go from your machine to the provider with your own credentials. ArgusOps receives token counts and incident reports. Read the{" "}
            <Link href="/security" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
              security page
            </Link>{" "}
            for details.
          </p>
        </section>

        <section aria-labelledby="troubleshooting">
          <h2 id="troubleshooting" className={h2}>
            Troubleshooting
          </h2>
          <h3 className={h3}>The CLI cannot reach the server</h3>
          <p className={p}>
            Set <code className={code}>ARGUS_API_URL</code> to your deployed ArgusOps address, or run with <code className={code}>--offline</code> to supervise locally.
          </p>
          <h3 className={h3}>“Agent limit reached”</h3>
          <p className={p}>Your plan allows a fixed number of agents at once. Stop one, or upgrade from the billing page.</p>
          <h3 className={h3}>No desktop notification</h3>
          <p className={p}>
            Check that <code className={code}>ARGUS_NO_DESKTOP_NOTIFY</code> is not set and that your operating system allows notifications from the terminal.
          </p>
        </section>
      </article>
    </div>
  );
}
