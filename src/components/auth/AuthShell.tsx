import React from "react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/ui/Logo";

const POINTS = [
  ["detect", "Exact repeats, ping-pong and paraphrased loops, caught on the request path."],
  ["pause", "The next request is held, so a stuck agent stops using tokens."],
  ["suggest", "A short corrective instruction to approve, edit or dismiss."],
  ["alert", "Dashboard, desktop, VS Code and webhook alerts."],
];

/** Shared button styles for auth forms. */
export const authPrimaryButton =
  "flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-[transform,background-color] duration-150 ease-out hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60";
export const authSecondaryButton =
  "flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 transition-[transform,background-color,border-color] duration-150 ease-out hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 antialiased lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-10">
        <Link href="/" aria-label="ArgusOps home" className="w-fit rounded-md">
          <Logo />
        </Link>

        <main id="main" className="mx-auto flex w-full max-w-[22rem] flex-1 flex-col justify-center py-12">
          <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-sm text-slate-500">{footer}</div>
        </main>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
          <Link href="/docs" className="hover:text-slate-900">Docs</Link>
          <Link href="/security" className="hover:text-slate-900">Security</Link>
          <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-900">Terms</Link>
        </div>
      </div>

      <aside className="on-dark relative hidden overflow-hidden border-l border-slate-800 bg-slate-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: "radial-gradient(rgb(148 163 184 / 0.22) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
          aria-hidden="true"
        />

        {/* The watcher: its eye follows your pointer. */}
        <div className="relative flex justify-end" aria-hidden="true">
          <LogoMark tone="dark" className="h-16 w-16 rounded-xl" />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.025em]">Let your coding agents run. Keep the loops in check.</h2>

          <div
            className="mt-8 overflow-hidden rounded-lg border border-white/10 bg-slate-900/60"
            role="img"
            aria-label="Example terminal: argus run claude, a loop is detected and the agent is paused"
          >
            <div aria-hidden="true">
              <div className="flex h-8 items-center border-b border-white/10 px-3 font-mono text-[11px] text-slate-500">~/project</div>
              <div className="space-y-0.5 p-3 font-mono text-[12px] leading-6 text-slate-300">
                {[
                  ["$", "argus run claude", "text-slate-500"],
                  ["✓", "supervising claude", "text-emerald-400"],
                  ["!", "loop: same failing call, 3 times", "text-amber-400"],
                  ["‖", "paused · next request held", "text-amber-400"],
                  ["▶", "resumed with your instruction", "text-emerald-400"],
                ].map(([g, t, c], i) => (
                  <p key={i} className="fade-in flex gap-3" style={{ animationDelay: `${200 + i * 260}ms` }}>
                    <span className={`w-3 ${c}`}>{g}</span>
                    {t}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <dl className="mt-8 divide-y divide-white/10 border-y border-white/10 text-sm">
            {POINTS.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[5rem_1fr] gap-3 py-2.5">
                <dt className="font-mono text-xs leading-5 text-slate-500">{k}</dt>
                <dd className="text-slate-300">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-[13px] font-medium text-slate-900">
          {label}
        </label>
        {hint}
      </div>
      <input
        id={id}
        {...input}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
      />
    </div>
  );
}
