"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * A looping, scripted demo of ArgusOps catching a loop, played like a short product video:
 * watch -> detect -> pause -> resume. Everything is derived from one clock (t, in ms), so any frame can be
 * rendered and the steps below the player can seek. Pauses when off screen; reduced motion shows the
 * finished frame and leaves play to the visitor.
 */

const TOTAL = 15000;
const CMD = "argus run claude";
const T = {
  typeEnd: 1300,
  start: 1600,
  fail1: 2600,
  fail2: 3700,
  fail3: 4800,
  loop: 5500,
  held: 6000,
  card: 6600,
  moveStart: 7500,
  moveEnd: 8500,
  click: 8700,
  resume: 9100,
  fixing: 9900,
  pass: 11200,
  fadeOut: 14400,
};
const STEPS = [
  { id: "watch", label: "Watch", at: 0 },
  { id: "detect", label: "Detect", at: T.fail1 },
  { id: "pause", label: "Pause", at: T.loop },
  { id: "resume", label: "Resume", at: T.resume },
];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

/** Tokens spent at time t: steady while working, a jump per failed retry, flat while paused. */
function tokens(t: number) {
  let v = 0;
  if (t > T.start) v += Math.min(t, T.loop) - T.start; // steady burn
  for (const f of [T.fail1, T.fail2, T.fail3]) if (t > f) v += 2600 * ease((t - f) / 300);
  if (t > T.resume) v += (Math.min(t, T.pass) - T.resume) * 0.45; // the fix, then done
  return Math.round(v * 2.1);
}
const MAX_TOKENS = tokens(TOTAL);
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

const W = 300;
const H = 80;
const tx = (t: number) => (t / T.fadeOut) * W;
const ty = (v: number) => H - 6 - (v / MAX_TOKENS) * (H - 16);

function linePath(upTo: number) {
  const end = Math.min(upTo, T.fadeOut);
  const pts: string[] = [];
  for (let t = 0; t <= end; t += 80) pts.push(`${tx(t).toFixed(1)} ${ty(tokens(t)).toFixed(1)}`);
  pts.push(`${tx(end).toFixed(1)} ${ty(tokens(end)).toFixed(1)}`);
  return "M" + pts.join(" L");
}

type Line = { at: number; t: string; tone: string; body: React.ReactNode };
const LINES: Line[] = [
  { at: T.start, t: "00:00", tone: "text-slate-400", body: <>claude  Running the tests to check the fix</> },
  { at: T.fail1, t: "00:14", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1</span></> },
  { at: T.fail2, t: "00:31", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1 · same error</span></> },
  { at: T.fail3, t: "00:47", tone: "text-slate-300", body: <><span className="text-red-400">✗</span> npm test  <span className="text-slate-500">exit 1 · same error</span></> },
  { at: T.loop, t: "00:47", tone: "text-amber-300", body: <>argus   Loop: the same failing call, 3 times</> },
  { at: T.held, t: "00:47", tone: "text-amber-300", body: <>argus   Next request held. Nothing sent</> },
  { at: T.resume, t: "01:02", tone: "text-emerald-300", body: <>argus   Resumed with your instruction</> },
  { at: T.fixing, t: "01:05", tone: "text-slate-400", body: <>claude  Adding the missing export in src/utils.ts</> },
  { at: T.pass, t: "01:19", tone: "text-emerald-300", body: <><span>✓</span> npm test  <span className="text-emerald-400/70">passed · 42 tests</span></> },
];

export function HeroMock() {
  const [t, setT] = useState(T.pass + 800);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const approve = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState({ x: 80, y: 120 });

  // Autoplay unless the visitor prefers reduced motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      setT(0);
      setPlaying(true);
    }
  }, []);

  // Only run while on screen and the tab is visible.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // The clock.
  useEffect(() => {
    if (!playing || !visible) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = Math.min(64, now - last);
      last = now;
      setT((v) => (v + dt >= TOTAL ? 0 : v + dt));
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, visible]);

  // Where the demo cursor should land: the centre of "Approve & resume".
  useEffect(() => {
    const measure = () => {
      if (card.current && approve.current) {
        const c = card.current.getBoundingClientRect();
        const b = approve.current.getBoundingClientRect();
        setTarget({ x: b.left - c.left + b.width * 0.55, y: b.top - c.top + b.height * 0.6 });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const seek = (to: number) => {
    setT(to);
    if (!playing && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) setPlaying(true);
  };

  // Derived frame
  const typed = CMD.slice(0, Math.floor(clamp(t / T.typeEnd) * CMD.length));
  const paused = t >= T.loop && t < T.resume;
  const resumed = t >= T.resume;
  const cardIn = ease((t - T.card) / 450) * (1 - ease((t - T.resume) / 400));
  const showCard = t >= T.card && t < T.resume + 400;
  const move = ease((t - T.moveStart) / (T.moveEnd - T.moveStart));
  const cursorX = 18 + (target.x - 18) * move;
  const cursorY = -14 + (target.y + 14) * move;
  const pressing = t >= T.click && t < T.click + 220;
  const cursorOn = t >= T.moveStart - 200 && t < T.resume + 200;
  const fade = 1 - ease((t - T.fadeOut) / (TOTAL - T.fadeOut));
  const spent = tokens(t);
  const stepIndex = STEPS.reduce((acc, s, i) => (t >= s.at ? i : acc), 0);

  return (
    <div ref={root} className="relative">
      <div
        role="img"
        aria-label="Demo: Claude Code fails npm test three times. ArgusOps detects the loop, holds the next request so token spend goes flat, suggests an instruction, and after you approve it the agent fixes the bug and the tests pass."
        className="on-dark overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-lift"
      >
        <div aria-hidden="true" style={{ opacity: fade }}>
          {/* title bar */}
          <div className="flex h-10 items-center justify-between border-b border-white/10 px-4">
            <span className="font-mono text-[11px] text-slate-500">~/shop-api</span>
            <div className="flex items-center gap-2">
              <span className="tabular font-mono text-[11px] text-slate-400">
                tokens <span className={cn("text-slate-200", paused && "text-amber-300")}>{fmt(spent)}</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors duration-300",
                  paused ? "bg-amber-400/10 text-amber-300" : resumed ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-slate-400"
                )}
              >
                {paused ? <Pause className="h-3 w-3" /> : <span className={cn("h-1.5 w-1.5 rounded-full", t > T.start ? "bg-emerald-400" : "bg-slate-500")} />}
                {paused ? "Paused" : t > T.start ? "Running" : "Idle"}
              </span>
            </div>
          </div>

          {/* terminal */}
          <div className="h-[16.25rem] space-y-1 overflow-hidden px-4 py-3.5 font-mono text-[12px] leading-relaxed">
            <p className="text-slate-200">
              <span className="text-slate-600">$ </span>
              {typed}
              {t < T.start && <span className="caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-slate-300" />}
            </p>
            {LINES.filter((l) => t >= l.at).map((l, i) => (
              <p key={i} className={cn("flex gap-4", l.tone)} style={{ animation: "rise-in 0.35s var(--ease-out-quart) backwards" }}>
                <span className="w-9 shrink-0 text-slate-600">{l.t}</span>
                <span className="whitespace-pre">{l.body}</span>
              </p>
            ))}
          </div>

          {/* live token chart */}
          <div className="border-t border-white/10 px-4 pb-3 pt-2.5">
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className="text-slate-500">tokens spent</span>
              <span className={cn("transition-colors", paused ? "text-amber-300" : resumed ? "text-emerald-300" : "text-slate-500")}>
                {paused ? "paused · 0 tokens" : resumed ? "resumed with the fix" : "live"}
              </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 h-[4.5rem] w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="demo-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#f8fafc" stopOpacity="0.16" />
                  <stop offset="1" stopColor="#f8fafc" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[20, 40, 60].map((y) => (
                <line key={y} x1="0" x2={W} y1={y} y2={y} stroke="#334155" strokeDasharray="2 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {t >= T.loop && (
                <rect x={tx(T.loop)} y="0" width={Math.max(0, tx(Math.min(t, T.resume)) - tx(T.loop))} height={H} fill="#fbbf24" fillOpacity="0.08" />
              )}
              {t >= T.loop && <line x1={tx(T.loop)} x2={tx(T.loop)} y1="0" y2={H} stroke="#fbbf24" strokeOpacity="0.6" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
              {t >= T.resume && <line x1={tx(T.resume)} x2={tx(T.resume)} y1="0" y2={H} stroke="#34d399" strokeOpacity="0.6" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
              <path d={`${linePath(t)} L${tx(Math.min(t, T.fadeOut)).toFixed(1)} ${H} L0 ${H} Z`} fill="url(#demo-fill)" />
              <path d={linePath(t)} fill="none" stroke="#e2e8f0" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          {/* suggestion card */}
          <div className="relative h-[9.75rem] border-t border-white/10 bg-white/[0.03] p-3">
            {!showCard && !resumed && (
              <p className="flex h-full items-center justify-center font-mono text-[11px] text-slate-600">watching every model call</p>
            )}
            {!showCard && resumed && (
              <dl className="grid h-full grid-cols-3 items-center divide-x divide-white/10 text-center" style={{ animation: "rise-in 0.5s var(--ease-out-quart) backwards" }}>
                {[
                  ["loop caught", "after 3 tries", "text-amber-300"],
                  ["tokens while paused", "0", "text-slate-100"],
                  ["tests", t >= T.pass ? "passing" : "running…", t >= T.pass ? "text-emerald-300" : "text-slate-400"],
                ].map(([k, v, c]) => (
                  <div key={k} className="px-2">
                    <dt className="font-mono text-[10px] text-slate-500">{k}</dt>
                    <dd className={cn("mt-1 font-mono text-sm", c)}>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div
              ref={card}
              className={cn("relative rounded-md bg-white p-3.5 text-slate-900", !showCard && "pointer-events-none absolute inset-3 opacity-0")}
              style={showCard ? { opacity: cardIn, transform: `translateY(${(1 - cardIn) * 14}px)` } : undefined}
            >
              <p className="text-[11px] font-medium text-slate-500">Suggested instruction</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-800">
                Stop re-running <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">npm test</code>. The error is a missing export in{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">src/utils.ts</code>. Fix that, then run the tests once.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  ref={approve}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white transition-transform duration-100",
                    pressing && "scale-95 bg-slate-700"
                  )}
                >
                  <Check className="h-3.5 w-3.5" /> Approve &amp; resume
                </span>
                <span className="inline-flex h-7 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700">Edit</span>
                <span className="inline-flex h-7 items-center rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700">Stop</span>
              </div>

              {/* the demo cursor */}
              {cursorOn && showCard && (
                <svg
                  viewBox="0 0 20 22"
                  className="pointer-events-none absolute left-0 top-0 h-5 w-[18px] drop-shadow-[0_1px_1.5px_rgb(15_23_42/0.35)]"
                  style={{ transform: `translate(${cursorX}px, ${cursorY}px) scale(${pressing ? 0.85 : 1})`, transformOrigin: "top left" }}
                >
                  <path d="M2 1.5 L2 17.6 L6.3 13.6 L9.1 19.9 L11.9 18.7 L9.2 12.5 L15 12.5 Z" fill="#0f172a" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* video-style controls: play/pause and a seekable step timeline */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? "Pause demo" : "Play demo"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <ol className="grid flex-1 grid-cols-4 gap-1.5">
          {STEPS.map((s, i) => {
            const end = STEPS[i + 1]?.at ?? T.fadeOut;
            const p = clamp((t - s.at) / (end - s.at));
            return (
              <li key={s.id}>
                <button type="button" onClick={() => seek(s.at)} className="group block w-full text-left" aria-label={`Jump to ${s.label}`}>
                  <span className="block h-1 overflow-hidden rounded-full bg-slate-200">
                    <span className="block h-full rounded-full bg-slate-900" style={{ width: `${p * 100}%` }} />
                  </span>
                  <span className={cn("mt-1.5 block font-mono text-[11px] transition-colors", i === stepIndex ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600")}>
                    {String(i + 1).padStart(2, "0")} {s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
