import React from "react";
import Link from "next/link";
import { Triangle, ShieldCheck, PauseCircle, Wand2, Bell } from "lucide-react";

const POINTS = [
  { icon: ShieldCheck, title: "Catches loops in under 100ms", body: "Exact, ping-pong and semantic repeats are detected on the request path." },
  { icon: PauseCircle, title: "Pauses the real process", body: "argus run owns the agent, so pause and resume actually stop it." },
  { icon: Wand2, title: "Rewrites wasteful prompts", body: "Approve a tighter prompt, see the diff and the tokens saved." },
  { icon: Bell, title: "Tells you when it matters", body: "Email, webhook and VS Code alerts for pauses and approvals." },
];

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
    <div className="min-h-screen bg-white text-slate-900 antialiased lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-screen flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 shadow-sm">
            <Triangle className="h-4 w-4 fill-white text-white" />
          </span>
          <span className="text-base font-bold tracking-tight">ArgusOps</span>
        </Link>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-slate-500">{footer}</div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <Link href="/docs" className="hover:text-slate-700">Docs</Link>
          <Link href="/privacy" className="hover:text-slate-700">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-700">Terms</Link>
          <Link href="/status" className="hover:text-slate-700">Status</Link>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-slate-950 text-white lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative max-w-lg">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">Agent supervision</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
            Let your coding agents run.
            <br />
            Keep the bill and the loops in check.
          </h2>

          <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-slate-900/80 shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-2 font-mono text-[11px] text-slate-400">~/project</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-slate-300">
{`$ argus run claude
`}<span className="text-emerald-400">✔</span>{` supervising claude (pid 4121)
`}<span className="text-amber-400">!</span>{` loop detected: same failing test x4
`}<span className="text-amber-400">⏸</span>{` paused · rewrite ready (-38% tokens)
`}<span className="text-slate-500">$ argus approve rw_82f1</span>{`
`}<span className="text-emerald-400">▶</span>{` resumed with the tighter prompt`}
            </pre>
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <Icon className="h-4 w-4 text-emerald-400" />
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
        <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
          {label}
        </label>
        {hint}
      </div>
      <input
        id={id}
        {...input}
        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-2xs transition-shadow focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />
    </div>
  );
}
