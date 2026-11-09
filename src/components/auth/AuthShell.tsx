import React from "react";
import Link from "next/link";
import { ShieldCheck, PauseCircle, Sparkles, Bell } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

const POINTS = [
  { icon: ShieldCheck, title: "Catches loops early", body: "Exact repeats, ping-pong and paraphrased loops are detected on the request path." },
  { icon: PauseCircle, title: "Pauses without spending", body: "The next request is held, so a stuck agent stops using tokens." },
  { icon: Sparkles, title: "Suggests the fix", body: "Approve, edit or dismiss a short corrective instruction." },
  { icon: Bell, title: "Tells you when it matters", body: "Dashboard, desktop, VS Code and webhook alerts." },
];

/** Shared button styles for auth forms. */
export const authPrimaryButton =
  "flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-soft transition-[transform,background-color] duration-500 ease-spring hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60";
export const authSecondaryButton =
  "flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-900/10 shadow-soft transition-[transform,background-color] duration-500 ease-spring hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60";

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
    <div className="min-h-dvh bg-slate-50 text-slate-900 antialiased lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="ArgusOps home" className="w-fit rounded-lg">
          <Logo />
        </Link>

        <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-slate-600">{footer}</div>
        </main>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
          <Link href="/docs" className="hover:text-slate-900">Docs</Link>
          <Link href="/security" className="hover:text-slate-900">Security</Link>
          <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-900">Terms</Link>
        </div>
      </div>

      <aside className="on-dark relative hidden overflow-hidden bg-slate-950 text-white lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_0%,rgba(148,163,184,0.18),transparent_70%)]"
        />
        <div className="relative max-w-lg">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Agent supervision</p>
          <h2 className="mt-4 text-balance text-4xl font-semibold leading-[1.08] tracking-tight">
            Let your coding agents run. Keep the loops in check.
          </h2>

          <div className="mt-8 overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10" role="img" aria-label="Example terminal: argus run claude, a loop is detected and the agent is paused">
            <div aria-hidden="true">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-[11px] text-slate-400">~/project</span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-slate-300">
{`$ argus run claude
`}<span className="text-emerald-400">✔</span>{` supervising claude
`}<span className="text-amber-400">!</span>{` loop detected: same failing call, 3 times
`}<span className="text-amber-400">⏸</span>{` paused · next request held
`}<span className="text-emerald-400">▶</span>{` resumed with your approved instruction`}
              </pre>
            </div>
          </div>

          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10">
                  <Icon className="h-4 w-4 text-slate-200" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{body}</span>
                </span>
              </li>
            ))}
          </ul>
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
        <label htmlFor={id} className="block text-xs font-semibold text-slate-900">
          {label}
        </label>
        {hint}
      </div>
      <input
        id={id}
        {...input}
        className="w-full rounded-xl bg-white px-4 py-3 text-sm text-slate-900 ring-1 ring-slate-900/10 placeholder:text-slate-400 transition-shadow focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
      />
    </div>
  );
}
