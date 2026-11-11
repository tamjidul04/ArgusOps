import React from "react";
import Link from "next/link";
import { CodeBlock } from "@/components/ui";
import { DocsShell, type DocSection } from "./DocsShell";

const h3 = "mt-10 text-lg font-semibold tracking-[-0.01em] text-slate-900";
const p = "mt-4 text-pretty text-base leading-[1.75] text-slate-600";
const code = "rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800";

/** Documentation content. Rendered on the server; DocsShell shows one section at a time. */
const SECTIONS: DocSection[] = [
  {
    id: "overview",
    label: "Overview",
    group: "Get started",
    content: (
      <>
        <p className={p}>
          ArgusOps supervises the AI coding agents you run. It watches each model call through a small proxy on your machine, catches loops
          before they burn your tokens, pauses the agent, suggests a corrective instruction and alerts you. Claude Code is supported today.
        </p>
        <p className={p}>
          You bring your own model credentials. ArgusOps sees token counts and incident reports, never your prompts or code.
        </p>
      </>
    ),
  },
  {
    id: "getting-started",
    label: "Getting started",
    group: "Get started",
    content: (
      <>
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

        <h3 className={h3}>Using the Claude Code panel in VS Code</h3>
        <p className={p}>In your project folder, run one command and leave it open:</p>
        <CodeBlock className="mt-4" title="terminal" code={"argus ide"} />
        <p className={p}>
          It signs you in if needed and points that folder&apos;s panel at ArgusOps. Run <strong>Developer: Reload Window</strong> once in VS Code,
          then use Claude as normal. Ctrl+C stops it and undoes the setting. Sessions show up as one agent, <em>Claude Code (IDE)</em>; Stop
          refuses further requests with a clear error.
        </p>
      </>
    ),
  },
  {
    id: "cli",
    label: "CLI reference",
    group: "Use ArgusOps",
    content: (
      <>
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
                ["argus proxy [--port 47821]", "Supervises an agent you start yourself, such as the Claude Code panel in VS Code."],
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
        <ul className="mt-4 space-y-2.5 text-base leading-relaxed text-slate-600">
          <li>
            <code className={code}>ARGUS_API_URL</code> points the CLI at a deployed server (default <code className={code}>http://localhost:3000</code>).
          </li>
          <li>
            <code className={code}>ARGUS_NO_DESKTOP_NOTIFY=1</code> turns off desktop notifications.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "vscode",
    label: "VS Code extension",
    group: "Use ArgusOps",
    content: (
      <>
        <p className={p}>
          The extension adds an <strong>Overview</strong> panel to the ArgusOps sidebar (what needs you, agents running, tokens left, 7-day usage and your latest
          alerts), an Agents list with status and tokens, a status bar item that turns amber when an agent needs you, and alerts with Approve suggestion, Edit and Stop. Download it from the{" "}
          <Link href="/download" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
            download page
          </Link>{" "}
          and use <strong>Install from VSIX…</strong>.
        </p>
        <h3 className={h3}>Settings</h3>
        <ul className="mt-4 space-y-2.5 text-base leading-relaxed text-slate-600">
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
      </>
    ),
  },
  {
    id: "loops",
    label: "Loops and pausing",
    group: "Use ArgusOps",
    content: (
      <>
        <p className={p}>
          ArgusOps recognises exact repeats, ping-pong between two actions, longer cycles and paraphrased loops. Thresholds come from your guardrail policy.
          When one trips, the next model request is held, so nothing reaches the provider and no tokens are spent.
        </p>
        <p className={p}>
          The incident appears in <strong>Guardrails</strong> with a suggested instruction built from the repeated steps and the error. Approve it, edit it
          or stop the agent. Approving resumes the agent with that hint. Optional auto-resume acts once per 30 minutes per agent.
        </p>
      </>
    ),
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "Use ArgusOps",
    content: (
      <>
        <p className={p}>
          You are notified when an agent is paused or stopped, or your token allowance runs out: a bell and pop-up in the dashboard, optional browser
          alerts, a desktop pop-up from the CLI, VS Code alerts, and webhooks to Slack, Discord or any https endpoint. Email is not available yet.
        </p>
      </>
    ),
  },
  {
    id: "plans",
    label: "Plans and limits",
    group: "Account",
    content: (
      <>
        <p className={p}>
          Free supervises 2 agents at once, Pro 10, Enterprise is custom. The limit is checked when an agent starts. See{" "}
          <Link href="/pricing" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
            pricing
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    label: "Privacy",
    group: "Account",
    content: (
      <>
        <p className={p}>
          Model calls go from your machine to the provider with your own credentials. ArgusOps receives token counts and incident reports. Read the{" "}
          <Link href="/security" className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 transition-colors hover:decoration-slate-900">
            security page
          </Link>{" "}
          for details.
        </p>
      </>
    ),
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    group: "Account",
    content: (
      <>
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
      </>
    ),
  },
];

export function DocsClient() {
  return <DocsShell sections={SECTIONS} />;
}
