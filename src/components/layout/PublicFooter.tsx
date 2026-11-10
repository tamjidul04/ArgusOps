import React from "react";
import Link from "next/link";
import { Logo, Wordmark } from "@/components/ui/Logo";
import { Container } from "@/components/ui/Layout";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Getting started", href: "/docs#getting-started" },
      { label: "CLI reference", href: "/docs#cli" },
      { label: "VS Code extension", href: "/docs#vscode" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Security", href: "/security" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Log in", href: "/login" },
      { label: "Sign up", href: "/signup" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="overflow-hidden border-t border-slate-200 bg-white">
      <Container className="pt-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs space-y-3">
            <Link href="/" aria-label="ArgusOps home" className="inline-block rounded-md">
              <Logo />
            </Link>
            <p className="text-sm leading-relaxed text-slate-500">
              A supervisor for AI coding agents. It catches loops, pauses the agent, and tells you before the tokens are gone.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-[13px] font-medium text-slate-900">{col.title}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-slate-500 transition-colors hover:text-slate-900">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-slate-100 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 ArgusOps</p>
          <p>Bring your own model key. ArgusOps never sees your prompts or code.</p>
        </div>
      </Container>
      {/* The wordmark, set large and cropped by the page edge. */}
      <div aria-hidden="true" className="pointer-events-none mx-auto -mb-[3.2vw] max-w-6xl select-none px-4 sm:px-6 lg:px-8">
        <Wordmark className="h-auto w-full translate-y-0 text-slate-100" />
      </div>
    </footer>
  );
}
