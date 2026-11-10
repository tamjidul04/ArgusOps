import React from "react";
import { Check, Pause } from "lucide-react";

/**
 * Illustrative replay of ArgusOps catching a loop: the terminal lines arrive in order, and the token-spend line
 * climbs with each failed retry, then goes flat the moment the request is held. Plays once; under reduced
 * motion everything is simply shown. Decorative, described once for screen readers.
 */
const LINES: { t: string; tone: string; body: React.ReactNode }[] = [
  { t: "00:00", tone: "text-slate-400", body: <>claude  Running the tests to check the fix</> },
  { t: "00:14", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1</span></> },
  { t: "00:31", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1 · same error</span></> },
  { t: "00:47", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1 · same error</span></> },
  { t: "00:47", tone: "text-amber-300", body: <>argus   Loop: the same failing call, 3 times</> },
  { t: "00:47", tone: "text-emerald-300", body: <>argus   Next request held. Nothing sent</> },
];
const STEP = 420; // ms between lines

// Token spend: steady, a jump per retry, then flat once paused (x in 0..300, y in 0..90, lower = more).
const SPEND = "M0 84 C20 82 34 79 52 74 L60 62 C76 58 92 56 108 50 L116 36 C132 32 148 30 164 25 L172 12 L300 12";

export function HeroMock() {
  const pauseAt = LINES.length * STEP;
  return (
    <div className="relative">
      <div
        role="img"
        aria-label="Example: Claude Code ran the failing command npm test three times. ArgusOps paused the agent without sending the next request, token spend stopped rising, and a corrective instruction is suggested with Approve, Edit and Stop actions."
        className="on-dark overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-lift"
      >
        <div aria-hidden="true">
          <div className="flex h-10 items-center justify-between border-b border-white/10 px-4">
            <span className="font-mono text-[11px] text-slate-500">~/shop-api · argus run claude</span>
            <span
              className="fade-in inline-flex items-center gap-1.5 rounded bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
              style={{ animationDelay: `${pauseAt}ms` }}
            >
              <Pause className="h-3 w-3" /> Paused
            </span>
          </div>

          <div className="space-y-1 px-4 py-4 font-mono text-[12px] leading-relaxed">
            {LINES.map((l, i) => (
              <p key={i} className={`fade-in flex gap-4 ${l.tone}`} style={{ animationDelay: `${(i + 1) * STEP}ms` }}>
                <span className="w-9 shrink-0 text-slate-600">{l.t}</span>
                <span className="whitespace-pre">{l.body}</span>
              </p>
            ))}
          </div>

          {/* token spend */}
          <div className="border-t border-white/10 px-4 pb-3 pt-3">
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className="text-slate-500">tokens spent</span>
              <span className="fade-in text-emerald-300" style={{ animationDelay: `${pauseAt + 200}ms` }}>
                flat since pause
              </span>
            </div>
            <svg viewBox="0 0 300 96" className="mt-2 h-20 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="spend-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#f8fafc" stopOpacity="0.16" />
                  <stop offset="1" stopColor="#f8fafc" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[24, 48, 72].map((y) => (
                <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#334155" strokeDasharray="2 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <path d={`${SPEND} L300 96 L0 96 Z`} fill="url(#spend-fill)" className="fade-in" style={{ animationDelay: `${pauseAt - 600}ms` }} />
              <path
                d={SPEND}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="1.6"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="draw-line"
                style={{ ["--len" as string]: 1, animationDuration: `${pauseAt + 600}ms`, animationTimingFunction: "linear" }}
              />
              <line x1="172" x2="172" y1="0" y2="96" stroke="#fbbf24" strokeOpacity="0.6" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="fade-in" style={{ animationDelay: `${pauseAt}ms` }} />
            </svg>
          </div>

          <div className="fade-in border-t border-white/10 bg-white/[0.03] p-3" style={{ animationDelay: `${pauseAt + 350}ms` }}>
            <div className="rounded-md bg-white p-3.5 text-slate-900">
              <p className="text-[11px] font-medium text-slate-500">Suggested instruction</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-800">
                Stop re-running <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">npm test</code>. The error is a missing export in{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">src/utils.ts</code>. Fix that, then run the tests once.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white">
                  <Check className="h-3.5 w-3.5" /> Approve &amp; resume
                </span>
                <span className="inline-flex h-7 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700">Edit</span>
                <span className="inline-flex h-7 items-center rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700">Stop</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-right font-mono text-[11px] text-slate-400">Illustrative replay</p>
    </div>
  );
}
