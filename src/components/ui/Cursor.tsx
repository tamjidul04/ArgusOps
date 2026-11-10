"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, summary, label, select, [role='button'], [role='menuitem'], [role='tab'], [role='switch'], [data-cursor='hover']";
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='submit']):not([type='button']), textarea, [contenteditable='true']";

/**
 * A real arrow pointer (tip exactly on the hotspot, so clicking feels native) with a small Argus eye that
 * trails a beat behind it, glances in the direction you move, widens over anything clickable and blinks
 * now and then: the watcher keeping an eye on your cursor. Flips to white over dark surfaces, steps aside
 * for the I-beam in text fields, and only runs on fine pointers with motion allowed.
 */
export function Cursor() {
  const arrow = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLDivElement>(null);
  const pupil = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!mq.matches || !arrow.current || !eye.current || !pupil.current) return;
    const a = arrow.current;
    const e = eye.current;
    const p = pupil.current;
    const root = document.documentElement;
    root.classList.add("has-cursor");

    let x = -100,
      y = -100,
      ex = -100,
      ey = -100,
      lx = 0,
      ly = 0,
      scale = 1,
      press = 1,
      raf = 0,
      visible = false,
      down = false,
      hover = false;

    const paint = () => {
      // the eye sits down-right of the tip and follows on a soft spring
      const tx = x + 20;
      const ty = y + 22;
      ex += (tx - ex) * 0.16;
      ey += (ty - ey) * 0.16;
      scale += ((hover ? 1.3 : 1) - scale) * 0.2;
      press += ((down ? 0.86 : 1) - press) * 0.35;

      // glance toward where the pointer is heading
      const dx = tx - ex;
      const dy = ty - ey;
      const d = Math.hypot(dx, dy);
      const look = Math.min(1, d / 24) * 1.7;
      lx += ((d ? (dx / d) * look : 0) - lx) * 0.3;
      ly += ((d ? (dy / d) * look : 0) - ly) * 0.3;

      a.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${press})`;
      e.style.transform = `translate3d(${ex}px, ${ey}px, 0) translate(-50%, -50%) scale(${scale})`;
      p.setAttribute("transform", `translate(${lx.toFixed(2)} ${ly.toFixed(2)})`);

      const settled = d < 0.1 && Math.abs((hover ? 1.3 : 1) - scale) < 0.001 && Math.abs((down ? 0.86 : 1) - press) < 0.001 && Math.abs(lx) + Math.abs(ly) < 0.01;
      raf = settled ? 0 : requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const setVisible = (v: boolean) => {
      if (v === visible) return;
      visible = v;
      a.style.opacity = e.style.opacity = v ? "1" : "0";
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      x = ev.clientX;
      y = ev.clientY;
      if (!visible) {
        ex = x + 20;
        ey = y + 22;
      }
      const el = ev.target instanceof Element ? ev.target : null;
      const inText = !!el?.closest(TEXT);
      hover = !inText && !!el?.closest(INTERACTIVE);
      const dark = !!el?.closest(".on-dark");
      a.dataset.dark = e.dataset.dark = dark ? "1" : "";
      e.dataset.hover = hover ? "1" : "";
      setVisible(!inText);
      kick();
    };
    const onDown = () => {
      down = true;
      kick();
    };
    const onUp = () => {
      down = false;
      kick();
    };
    const onLeave = () => setVisible(false);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <>
      {/* The eye companion */}
      <div
        ref={eye}
        aria-hidden="true"
        className="group pointer-events-none fixed left-0 top-0 z-[100] opacity-0 transition-opacity duration-200"
        style={{ willChange: "transform" }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 overflow-visible">
          <circle
            cx="8"
            cy="8"
            r="6.25"
            className="fill-white stroke-slate-900 transition-colors duration-200 group-data-[dark=1]:fill-slate-900 group-data-[dark=1]:stroke-white"
            strokeWidth="1.5"
          />
          <g className="eye-blink">
            <circle ref={pupil} cx="8" cy="8" r="2.6" className="fill-slate-900 transition-colors duration-200 group-data-[dark=1]:fill-white" />
          </g>
        </svg>
      </div>

      {/* The pointer: hotspot is the tip at (0, 0) */}
      <div
        ref={arrow}
        aria-hidden="true"
        className="group pointer-events-none fixed left-0 top-0 z-[101] origin-top-left opacity-0 transition-opacity duration-150"
        style={{ willChange: "transform" }}
      >
        <svg viewBox="0 0 20 22" className="-ml-[2px] -mt-[1.5px] h-[22px] w-5 drop-shadow-[0_1px_1.5px_rgb(15_23_42/0.25)]">
          <path
            d="M2 1.5 L2 17.6 L6.3 13.6 L9.1 19.9 L11.9 18.7 L9.2 12.5 L15 12.5 Z"
            strokeWidth="1.4"
            strokeLinejoin="round"
            className="fill-slate-900 stroke-white transition-colors duration-200 group-data-[dark=1]:fill-white group-data-[dark=1]:stroke-slate-900"
          />
        </svg>
      </div>
    </>
  );
}
