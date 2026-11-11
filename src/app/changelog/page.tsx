import React from "react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Container, PageHeader } from "@/components/ui";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What has shipped in ArgusOps, newest first.",
};

const ENTRIES: { date: string; title: string; tag: string; items: string[] }[] = [
  {
    date: "2026-11-10",
    title: "VS Code extension and suggested instructions",
    tag: "Release",
    items: [
      "ArgusOps view in VS Code: agents with status and tokens, why a paused agent stopped, and its suggested instruction",
      "Status bar item that turns amber when an agent needs you; approve, edit, resume or stop from the editor",
      "Download the extension from the website, with click-through install steps",
      "Suggested instructions: a corrective note from the repeated steps and error, the real cost of the loop, optional auto-resume",
    ],
  },
  {
    date: "2026-11-09",
    title: "CLI, notifications and usage",
    tag: "Release",
    items: [
      "argus login and argus run claude: local proxy, pause by holding requests, resume with a hint, stop",
      "Notifications: dashboard bell, browser alerts, desktop pop-ups from the CLI, Slack, Discord and webhooks",
      "Usage & Savings page from provider-reported usage, by agent and model",
      "Device pairing page for approving the CLI in the browser",
    ],
  },
  {
    date: "2026-11-09",
    title: "Foundation",
    tag: "Platform",
    items: [
      "Real sessions, route guard and owner checks on every API route",
      "Google and GitHub sign-in, optional TOTP two-factor",
      "Database-backed policy, incidents, file locks and agent limits (Free 2, Pro 10)",
      "Dashboards show your account’s real data only",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <PublicShell>
      <PageHeader eyebrow="Changelog" title="What’s new." lead="ArgusOps is in early access. Here is what has shipped, newest first." />

      <Container className="py-20 md:py-28">
        <ol className="relative mx-auto max-w-3xl space-y-14 border-l border-slate-200 pl-8 md:pl-12">
          {ENTRIES.map((e) => (
            <li data-reveal suppressHydrationWarning key={e.title} className="relative">
              <span aria-hidden="true" className="absolute -left-[2.45rem] top-2 h-3 w-3 rounded-full bg-slate-900 ring-4 ring-slate-50 md:-left-[3.45rem]" />
              <div className="flex flex-wrap items-center gap-3">
                <time dateTime={e.date} className="font-mono text-xs text-slate-500">
                  {e.date}
                </time>
                <span className="rounded-md bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">{e.tag}</span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{e.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-600">
                {e.items.map((i) => (
                  <li key={i} className="flex gap-3">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    {i}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Container>

      <CtaBand />
    </PublicShell>
  );
}
