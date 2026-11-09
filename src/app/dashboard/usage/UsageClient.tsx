"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Coins, DatabaseZap, PauseCircle, Table2, BarChart3, Terminal } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import type { UsageSummary } from "@/lib/usage";
import type { UsageRange } from "@/lib/usage-core";

/** Categorical slots 1 and 2 of the validated palette (blue, orange): passes CVD, normal-vision and 3:1 contrast on white. */
const INPUT_COLOR = "#2a78d6";
const OUTPUT_COLOR = "#eb6834";

const RANGE_LABEL: Record<UsageRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const full = (n: number) => n.toLocaleString();

function bucketLabel(key: string, range: UsageRange, long = false): string {
  const d = new Date(key.length === 10 ? `${key}T00:00:00Z` : `${key.replace(" ", "T")}Z`);
  if (range === "24h") return d.toLocaleTimeString(undefined, { hour: "numeric", ...(long && { weekday: "short" }) });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(long && { weekday: "short" }), timeZone: "UTC" });
}

export function UsageClient({ initial }: { initial: UsageSummary }) {
  const [data, setData] = useState<UsageSummary>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function pick(range: UsageRange) {
    if (range === data.range || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/usage?range=${range}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError("Couldn't load that range. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const t = data.totals;
  const empty = t.calls === 0;
  const usedOfIncluded = data.allowance.included > 0 ? Math.max(0, data.allowance.included - data.allowance.remaining) : 0;
  const remainingPct = data.allowance.included > 0 ? Math.max(0, Math.min(100, (data.allowance.remaining / data.allowance.included) * 100)) : 0;

  return (
    <div className="space-y-6 pb-12">
      {/* header + the one filter row */}
      <div className="flex flex-col gap-3 border-b border-slate-900/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Usage &amp; Savings</h1>
          <p className="mt-1 text-sm text-slate-500">Measured from your agents&apos; real model calls. Costs are at list prices; your provider bills you directly.</p>
        </div>
        <div role="tablist" aria-label="Time range" className="flex w-fit items-center rounded-xl ring-1 ring-slate-900/[0.08] bg-slate-100 p-1">
          {(["24h", "7d", "30d"] as UsageRange[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={data.range === r}
              onClick={() => pick(r)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-all", data.range === r ? "bg-white font-semibold text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900")}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}

      <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
        {/* headline numbers */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Tile icon={Activity} label="Tokens" value={formatTokens(t.inputTokens + t.outputTokens)} sub={`${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out`} />
          <Tile icon={Coins} label="Model spend" value={usd(t.costUsd)} sub="Estimate at list prices" />
          <Tile icon={BarChart3} label="Model calls" value={full(t.calls)} sub={t.calls ? `${formatTokens(Math.round((t.inputTokens + t.outputTokens) / t.calls))} tokens per call` : "No calls yet"} />
          <Tile icon={PauseCircle} label="Loops caught" value={full(t.loopsCaught)} sub={t.loopsCaught ? "Paused before more tokens were spent" : "No stuck agents"} />
          <Tile icon={DatabaseZap} label="Saved by caching" value={usd(t.cacheSavingUsd)} sub={`${formatTokens(t.cachedTokens)} tokens served from cache`} />
        </div>

        {empty ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <Terminal className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-800">No model calls in the last {RANGE_LABEL[data.range]}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
              Run an agent with <span className="font-mono">argus run claude</span> and its real token usage shows up here within a few seconds.
            </p>
            <Link href="/dashboard/local-bridge" className="mt-4 inline-block text-xs font-semibold text-slate-900 underline underline-offset-4">
              Set up the CLI
            </Link>
          </div>
        ) : (
          <TokenChart data={data} />
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Breakdown
            title="By agent"
            rows={data.byAgent.map((a) => ({ key: a.agentId ?? a.name, name: a.name, tokens: a.inputTokens + a.outputTokens, cost: a.costUsd, calls: a.calls }))}
            emptyText="No agent has made a model call in this range."
          />
          <Breakdown
            title="By model"
            rows={data.byModel.map((m) => ({ key: m.model, name: m.model, tokens: m.inputTokens + m.outputTokens, cost: m.costUsd, calls: m.calls, mono: true }))}
            emptyText="No model calls in this range."
          />

          <section className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-5">
            <h2 className="text-sm font-semibold text-slate-900">Plan allowance</h2>
            <p className="mt-0.5 text-xs text-slate-500">{data.allowance.planName} plan, supervised tokens this period</p>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="font-mono text-2xl font-semibold tracking-tight text-slate-900">{formatTokens(data.allowance.remaining)}</span>
              <span className="text-xs text-slate-500">left of {formatTokens(data.allowance.included)}</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
              role="meter"
              aria-label="Allowance remaining"
              aria-valuemin={0}
              aria-valuemax={data.allowance.included}
              aria-valuenow={data.allowance.remaining}
            >
              <div className="h-full rounded-full bg-slate-900" style={{ width: `${remainingPct}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {data.allowance.remaining <= 0
                ? "Used up: agents are paused until you upgrade or top up."
                : `${formatTokens(usedOfIncluded)} used. Cached tokens don't count against it.`}
            </p>
            <Link href="/dashboard/billing" className="mt-3 inline-block text-xs font-semibold text-slate-900 underline underline-offset-4">
              Plans &amp; billing
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-500" /> {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 truncate text-[11px] text-slate-500" title={sub}>{sub}</div>
    </div>
  );
}

function Breakdown({ title, rows, emptyText }: { title: string; rows: Array<{ key: string; name: string; tokens: number; cost: number; calls: number; mono?: boolean }>; emptyText: string }) {
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-xs text-slate-500">{emptyText}</p>
      ) : (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 text-right font-medium">Tokens</th>
              <th className="pb-2 text-right font-medium">Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, 8).map((r) => (
              <tr key={r.key}>
                <td className="max-w-0 py-2 pr-2">
                  <div className={cn("truncate font-medium text-slate-800", r.mono && "font-mono text-[11px]")} title={r.name}>{r.name}</div>
                  <div className="mt-1 h-1 rounded-full bg-slate-100">
                    <div className="h-1 rounded-full bg-slate-400" style={{ width: `${(r.tokens / max) * 100}%` }} />
                  </div>
                </td>
                <td className="py-2 text-right font-mono text-slate-700">{formatTokens(r.tokens)}</td>
                <td className="py-2 pl-2 text-right font-mono text-slate-700">{usd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* --------------------------------- chart --------------------------------- */

const W = 760;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 26, left: 48 };
const GAP = 2; // surface gap between stacked segments

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Bar with only its far end rounded (4px), anchored to the baseline. */
function topRoundedBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function TokenChart({ data }: { data: UsageSummary }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const b = data.buckets;

  const geo = useMemo(() => {
    const max = niceMax(Math.max(...b.map((x) => x.inputTokens + x.outputTokens)));
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const slot = plotW / b.length;
    const barW = Math.max(3, Math.min(28, slot * 0.62));
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
    const labelEvery = data.range === "24h" ? 4 : data.range === "30d" ? 5 : 1;
    return { max, plotW, plotH, slot, barW, y, labelEvery };
  }, [b, data.range]);

  const ticks = [0, 0.5, 1].map((f) => f * geo.max);
  const hb = hover !== null ? b[hover] : null;

  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-900/5 shadow-soft p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Tokens per {data.range === "24h" ? "hour" : "day"}</h2>
          <p className="text-[11px] text-slate-500">Times in UTC</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[11px] text-slate-600" aria-label="Legend">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: INPUT_COLOR }} /> Input</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: OUTPUT_COLOR }} /> Output</span>
          </div>
          <button type="button" onClick={() => setAsTable((v) => !v)} className="inline-flex items-center gap-1 rounded-md ring-1 ring-slate-900/[0.08] px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
            {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="mt-4 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-[11px] text-slate-500">
              <tr>
                <th className="pb-2 font-medium">{data.range === "24h" ? "Hour" : "Day"}</th>
                <th className="pb-2 text-right font-medium">Input</th>
                <th className="pb-2 text-right font-medium">Output</th>
                <th className="pb-2 text-right font-medium">Calls</th>
                <th className="pb-2 text-right font-medium">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/5 font-mono text-slate-700">
              {[...b].reverse().map((r) => (
                <tr key={r.bucket}>
                  <td className="py-1.5 font-sans">{bucketLabel(r.bucket, data.range, true)}</td>
                  <td className="py-1.5 text-right">{full(r.inputTokens)}</td>
                  <td className="py-1.5 text-right">{full(r.outputTokens)}</td>
                  <td className="py-1.5 text-right">{full(r.calls)}</td>
                  <td className="py-1.5 text-right">{usd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Tokens per ${data.range === "24h" ? "hour" : "day"}, input and output stacked`}>
            {/* recessive grid and axis labels */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={v === 0 ? undefined : "3 4"} />
                <text x={PAD.left - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-400" fontSize={10}>
                  {formatTokens(v)}
                </text>
              </g>
            ))}

            {b.map((r, i) => {
              const cx = PAD.left + geo.slot * i + geo.slot / 2;
              const x = cx - geo.barW / 2;
              const base = geo.y(0);
              const inH = base - geo.y(r.inputTokens);
              const outH = base - geo.y(r.inputTokens + r.outputTokens) - inH;
              const outVisible = r.outputTokens > 0 && outH > 0.5;
              const inTop = base - inH;
              return (
                <g key={r.bucket} opacity={hover === null || hover === i ? 1 : 0.45}>
                  {r.inputTokens > 0 && inH > 0.5 && (
                    outVisible ? <rect x={x} y={inTop} width={geo.barW} height={inH} fill={INPUT_COLOR} /> : <path d={topRoundedBar(x, inTop, geo.barW, inH, 4)} fill={INPUT_COLOR} />
                  )}
                  {outVisible && <path d={topRoundedBar(x, inTop - outH, geo.barW, Math.max(0.5, outH - GAP), 4)} fill={OUTPUT_COLOR} />}
                  {i % geo.labelEvery === (b.length - 1) % geo.labelEvery && (
                    <text x={cx} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize={10}>
                      {bucketLabel(r.bucket, data.range)}
                    </text>
                  )}
                  {/* hit target: the whole column, bigger than the mark */}
                  <rect x={PAD.left + geo.slot * i} y={PAD.top} width={geo.slot} height={geo.plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${bucketLabel(r.bucket, data.range, true)}: ${full(r.inputTokens)} input, ${full(r.outputTokens)} output tokens`} />
                </g>
              );
            })}
          </svg>

          {hb && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-xl ring-1 ring-slate-900/[0.08] bg-white p-2.5 text-[11px] shadow-lg"
              style={{ left: `${((PAD.left + geo.slot * hover + geo.slot / 2) / W) * 100}%` }}
            >
              <div className="font-semibold text-slate-900">{bucketLabel(hb.bucket, data.range, true)}</div>
              <div className="mt-1.5 space-y-1 text-slate-600">
                <Row color={INPUT_COLOR} label="Input" value={full(hb.inputTokens)} />
                <Row color={OUTPUT_COLOR} label="Output" value={full(hb.outputTokens)} />
                <div className="flex justify-between border-t border-slate-900/5 pt-1"><span>Calls</span><span className="font-mono text-slate-900">{full(hb.calls)}</span></div>
                <div className="flex justify-between"><span>Spend</span><span className="font-mono text-slate-900">{usd(hb.costUsd)}</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: color }} />{label}</span>
      <span className="font-mono text-slate-900">{value}</span>
    </div>
  );
}
