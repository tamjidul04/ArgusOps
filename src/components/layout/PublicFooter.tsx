import React from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
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
    <footer className="border-t border-slate-900/5 bg-white">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs space-y-4">
            <Link href="/" aria-label="ArgusOps home" className="inline-block rounded-lg">
              <Logo />
            </Link>
            <p className="text-sm leading-relaxed text-slate-600">
              A supervisor for AI coding agents. It catches loops, pauses the agent, and tells you before the tokens are gone.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{col.title}</p>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-slate-700 transition-colors hover:text-slate-950">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-2 border-t border-slate-900/5 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 ArgusOps. All rights reserved.</p>
          <p>Bring your own model key. ArgusOps never sees your prompts or code.</p>
        </div>
      </Container>
    </footer>
  );
}
