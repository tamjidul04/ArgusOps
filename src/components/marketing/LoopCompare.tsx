"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * With vs without ArgusOps, for one agent stuck in a loop for 30 minutes (illustrative numbers).
 * Without: every retry keeps spending. With: the loop is caught at minute 4 and the agent is held, so the
 * line goes flat. Lines draw in when the chart scrolls into view.
 */
const MIN = 30;
const CAUGHT = 4;
const W = 520;
const H = 200;
const PAD = { l: 8, r: 8, t: 14, b: 26 };

// cumulative tokens (k) at minute m while looping: ~13.6k per minute with small retry steps
const loop = (m: number) => m * 13.2 + Math.floor(m / 1.5) * 0.9;
const WITHOUT = loop(MIN);
const WITH = loop(CAUGHT);
const MAX = Math.ceil(WITHOUT / 50) * 50;

const x = (m: number) => PAD.l + (m / MIN) * (W - PAD.l - PAD.r);
const y = (k: number) => H - PAD.b - (k / MAX) * (H - PAD.t - PAD.b);

function path(f: (m: number) => number) {
  const pts: string[] = [];
  for (let m = 0; m <= MIN; m += 0.5) pts.push(`${x(m).toFixed(1)} ${y(f(m)).toFixed(1)}`);
  return "M" + pts.join(" L");
}
const withoutPath = path(loop);
const withPath = path((m) => loop(Math.min(m, CAUGHT)));
const savedArea = `${withoutPath} L${x(MIN)} ${y(WITH)} L${x(CAUGHT)} ${y(WITH)} Z`;

export function LoopCompare() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches || !("IntersectionObserver" in window)) {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const saved = Math.round(((WITHOUT - WITH) / WITHOUT) * 100);

  return (
    <figure ref={ref} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">One agent stuck in a loop for 30 minutes</span>
        <span className="font-mono text-[11px] text-slate-400">illustrative example</span>
      </figcaption>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600" aria-hidden="true">
        <span className="flex items-center gap-2">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Without ArgusOps
        </span>
        <span className="flex items-center gap-2">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" stroke="#0f172a" strokeWidth="2" />
          </svg>
          With ArgusOps
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-3 rounded-sm bg-emerald-500/15 ring-1 ring-emerald-500/30" />
          Tokens saved
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 h-auto w-full overflow-visible"
        role="img"
        aria-label={`Without ArgusOps the agent spends about ${Math.round(WITHOUT)}k tokens over 30 minutes. With ArgusOps the loop is caught at minute ${CAUGHT} and spending stops at about ${Math.round(WITH)}k tokens, ${saved}% less.`}
      >
        {[100, 200, 300, 400].filter((k) => k <= MAX).map((k) => (
          <g key={k}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(k)} y2={y(k)} stroke="#e2e8f0" strokeDasharray="3 4" />
            <text x={W - PAD.r} y={y(k) - 4} textAnchor="end" className="fill-slate-400 font-mono" fontSize="10">
              {k}k
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
        {[0, 10, 20, 30].map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor={m === 0 ? "start" : m === MIN ? "end" : "middle"} className="fill-slate-400 font-mono" fontSize="10">
            {m} min
          </text>
        ))}

        {/* saved area between the lines */}
        <path d={savedArea} fill="#10b981" className={cn("transition-opacity duration-700", on ? "opacity-[0.12]" : "opacity-0")} style={{ transitionDelay: "1100ms" }} />

        {/* without: keeps climbing */}
        <path
          d={withoutPath}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeDasharray="5 4"
          className={cn("transition-[clip-path] duration-[1600ms] ease-out")}
          style={{ clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}
        />
        {/* with: caught and held */}
        <path
          d={withPath}
          fill="none"
          stroke="#0f172a"
          strokeWidth="2.25"
          strokeLinejoin="round"
          className="transition-[clip-path] duration-[1600ms] ease-out"
          style={{ clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)", transitionDelay: "150ms" }}
        />

        {/* the moment it was caught */}
        <g className={cn("transition-opacity duration-500", on ? "opacity-100" : "opacity-0")} style={{ transitionDelay: "500ms" }}>
          <line x1={x(CAUGHT)} x2={x(CAUGHT)} y1={PAD.t} y2={y(0)} stroke="#f59e0b" strokeDasharray="3 3" />
          <circle cx={x(CAUGHT)} cy={y(WITH)} r="4" fill="#fff" stroke="#0f172a" strokeWidth="2" />
          <text x={x(CAUGHT) + 8} y={PAD.t + 10} className="fill-amber-700" fontSize="11" fontWeight="500">
            loop caught · agent paused
          </text>
        </g>
        <g className={cn("transition-opacity duration-500", on ? "opacity-100" : "opacity-0")} style={{ transitionDelay: "1500ms" }}>
          <circle cx={x(MIN)} cy={y(WITHOUT)} r="3.5" fill="#94a3b8" />
        </g>
      </svg>

      <dl className="mt-5 grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-200 pt-4 text-center">
        <div className="px-2">
          <dt className="text-xs text-slate-500">Without</dt>
          <dd className="tabular mt-0.5 font-mono text-lg text-slate-500">{Math.round(WITHOUT)}k</dd>
        </div>
        <div className="px-2">
          <dt className="text-xs text-slate-500">With ArgusOps</dt>
          <dd className="tabular mt-0.5 font-mono text-lg text-slate-900">{Math.round(WITH)}k</dd>
        </div>
        <div className="px-2">
          <dt className="text-xs text-slate-500">Saved</dt>
          <dd className="tabular mt-0.5 font-mono text-lg text-emerald-700">{saved}%</dd>
        </div>
      </dl>
    </figure>
  );
}
