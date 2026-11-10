"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { formatTokens } from "@/lib/utils";
import type { BucketRow } from "@/lib/usage-core";

const W = 320;
const H = 96;

function dayLabel(key: string) {
  const d = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

/**
 * Tokens your agents used per day over the last 7 days, from provider-reported usage (same source as the
 * Usage page). A thin line over a soft fill, drawn once; hover a day for its total.
 */
export function WeekUsage() {
  const [rows, setRows] = useState<BucketRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");

  useEffect(() => {
    let alive = true;
    fetch("/api/usage?range=7d", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { buckets: BucketRow[] }) => alive && setRows(d.buckets ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const geo = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const vals = rows.map((r) => r.inputTokens + r.outputTokens);
    const max = Math.max(1, ...vals);
    const total = vals.reduce((a, b) => a + b, 0);
    const step = rows.length > 1 ? W / (rows.length - 1) : W;
    const pts = vals.map((v, i) => [i * step, H - 6 - (v / max) * (H - 18)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    return { vals, total, step, pts, line, area: `${line} L${W} ${H} L0 ${H} Z` };
  }, [rows]);

  if (failed) return <p className="text-xs text-slate-400">Usage is unavailable right now.</p>;
  if (!rows) return <div className="h-28 animate-pulse rounded-md bg-slate-50" aria-hidden="true" />;

  if (!geo || geo.total === 0) {
    return (
      <div className="flex h-28 flex-col items-center justify-center rounded-md border border-dashed border-slate-200 text-center">
        <p className="text-xs text-slate-500">No model calls in the last 7 days</p>
        <Link href="/dashboard/local-bridge" className="mt-1 text-xs font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900">
          Run an agent with argus
        </Link>
      </div>
    );
  }

  const h = hover !== null ? rows[hover] : null;
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Tokens used, last 7 days</span>
        <span className="tabular font-mono text-slate-900">{h ? `${dayLabel(h.bucket)} · ${formatTokens(h.inputTokens + h.outputTokens)}` : formatTokens(geo.total)}</span>
      </figcaption>
      <div className="relative mt-2" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full overflow-visible" role="img" aria-label={`Tokens used per day over the last 7 days, ${formatTokens(geo.total)} in total`}>
          <defs>
            <linearGradient id={`wk-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0f172a" stopOpacity="0.1" />
              <stop offset="1" stopColor="#0f172a" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.33, 0.66].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#e2e8f0" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={geo.area} fill={`url(#wk-${gid})`} className="fade-in" style={{ animationDelay: "500ms" }} />
          <path d={geo.line} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line" style={{ ["--len" as string]: 1 }} />
          {hover !== null && <line x1={geo.pts[hover][0]} x2={geo.pts[hover][0]} y1="0" y2={H} stroke="#cbd5e1" vectorEffect="non-scaling-stroke" />}
          {rows.map((r, i) => (
            <rect key={r.bucket} x={i * geo.step - geo.step / 2} y="0" width={geo.step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white bg-slate-900"
            style={{ left: `${(geo.pts[hover][0] / W) * 100}%`, top: `${(geo.pts[hover][1] / H) * 96}px` }}
          />
        )}
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400">
          {rows.map((r) => (
            <span key={r.bucket}>{dayLabel(r.bucket)}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}
