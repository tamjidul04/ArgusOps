"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The pupil drifts toward the pointer (Argus, the watcher, keeps an eye on things) and blinks now and then.
 * One shared pointer listener for every logo on the page; nothing runs under reduced motion.
 */
const pupils = new Set<SVGGElement>();
let listening = false;
let frame = 0;
let px = 0;
let py = 0;

function track() {
  frame = 0;
  pupils.forEach((g) => {
    const svg = g.ownerSVGElement;
    const eye = g.previousElementSibling as SVGGraphicsElement | null;
    if (!svg || !eye) return;
    const b = eye.getBoundingClientRect();
    if (!b.width) return;
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = Number(g.dataset.reach || 1.6) * Math.min(1, dist / 240);
    g.style.transform = `translate(${(dx / dist) * reach}px, ${(dy / dist) * reach}px)`;
  });
}

function usePupil() {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const g = ref.current;
    if (!g || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    pupils.add(g);
    if (!listening) {
      listening = true;
      window.addEventListener(
        "pointermove",
        (e) => {
          px = e.clientX;
          py = e.clientY;
          if (!frame) frame = requestAnimationFrame(track);
        },
        { passive: true }
      );
    }
    return () => {
      pupils.delete(g);
    };
  }, []);
  return ref;
}

/** The mark: a lowercase "a" whose bowl is an open eye. Works from 16px up. */
export function LogoMark({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const pupil = usePupil();
  const dark = tone === "dark";
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", dark ? "bg-white text-slate-900" : "bg-slate-900 text-white", className)}
    >
      <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="10.5" cy="12" r="6.5" />
        <g ref={pupil} data-reach="1.8" style={{ transition: "transform 120ms linear" }}>
          <circle className="eye-blink" cx="10.5" cy="12" r="2.6" fill="currentColor" stroke="none" />
        </g>
        <path d="M17 5.5V18.5" />
      </svg>
    </span>
  );
}

/*
 * Wordmark: eight hand-set monoline letters on a 10-unit x-height grid, every bowl the same circle so
 * a, g, o and p rhyme. The o is the eye. Advance widths are fixed so it never reflows.
 */
const W = 2.1; // stroke
const G = 4.6; // gap between letters
function letters() {
  let x = 0;
  const parts: React.ReactNode[] = [];
  const at = (w: number) => {
    const s = x;
    x += w + G;
    return s;
  };
  const bowl = (cx: number) => `M${cx + 5} 10a5 5 0 1 1-10 0a5 5 0 1 1 10 0`;
  const s = (o: number) =>
    `M${o + 7.6} 6.6C${o + 6.8} 5.5 ${o + 5.5} 5 ${o + 4} 5C${o + 1.9} 5 ${o + 0.4} 6.1 ${o + 0.4} 7.6C${o + 0.4} 9.3 ${o + 2} 9.8 ${o + 4} 10.1C${o + 6.2} 10.4 ${o + 7.8} 11 ${o + 7.8} 12.6C${o + 7.8} 14.1 ${o + 6.2} 15 ${o + 4} 15C${o + 2.3} 15 ${o + 1} 14.4 ${o + 0.2} 13.3`;

  const a = at(10);
  parts.push(<path key="a" d={`${bowl(a + 5)}M${a + 10} 5V15`} />);
  const r = at(6.5);
  parts.push(<path key="r" d={`M${r} 15V9.5A4.5 4.5 0 0 1 ${r + 4.5} 5H${r + 6.5}`} />);
  const g = at(10);
  parts.push(<path key="g" d={`${bowl(g + 5)}M${g + 10} 5V18A4 4 0 0 1 ${g + 6} 22H${g + 2.5}`} />);
  const u = at(10);
  parts.push(<path key="u" d={`M${u} 5V10A5 5 0 0 0 ${u + 10} 10M${u + 10} 5V15`} />);
  const s1 = at(8);
  parts.push(<path key="s1" d={s(s1)} />);
  const o = at(10);
  const p = at(10);
  parts.push(<path key="p" d={`M${p} 5V22${bowl(p + 5)}`} />);
  const s2 = at(8);
  parts.push(<path key="s2" d={s(s2)} />);
  return { parts, o, width: x - G };
}
const WORD = letters();

export function Wordmark({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const pupil = usePupil();
  return (
    <svg
      viewBox={`-1.5 2.5 ${WORD.width + 3} 21`}
      role="img"
      aria-label="ArgusOps"
      className={cn("h-[21px] w-auto translate-y-[2px]", tone === "dark" ? "text-white" : "text-slate-900", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={W}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {WORD.parts}
      <circle cx={WORD.o + 5} cy="10" r="5" />
      <g ref={pupil} data-reach="1.7" style={{ transition: "transform 120ms linear" }}>
        <circle className="eye-blink" cx={WORD.o + 5} cy="10" r="2.1" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

export function Logo({ className, tone = "light", mark = true }: { className?: string; tone?: "light" | "dark"; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark && <LogoMark tone={tone} className="h-7 w-7" />}
      <Wordmark tone={tone} />
    </span>
  );
}
