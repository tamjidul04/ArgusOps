"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, summary, label, select, [role='button'], [role='menuitem'], [role='tab'], [role='switch'], [data-cursor='hover']";
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='submit']):not([type='button']), textarea, [contenteditable='true']";

/**
 * A precise dot that sits exactly on the pointer, and a hairline ring that trails it with a short spring.
 * The ring widens over anything clickable, tightens on press, flips to white over dark surfaces and steps
 * aside for the real I-beam in text fields. Only on fine pointers with motion allowed; touch and
 * reduced-motion users keep their system cursor.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!mq.matches || !dot.current || !ring.current) return;
    const d = dot.current;
    const r = ring.current;
    const root = document.documentElement;
    root.classList.add("has-cursor");

    let x = -100,
      y = -100,
      rx = -100,
      ry = -100,
      scale = 1,
      target = 1,
      raf = 0,
      visible = false,
      down = false,
      hover = false;

    const paint = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      target = down ? 0.8 : hover ? 1.6 : 1;
      scale += (target - scale) * 0.22;
      d.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${hover ? 0 : 1})`;
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${scale})`;
      const settled = Math.abs(x - rx) < 0.1 && Math.abs(y - ry) < 0.1 && Math.abs(target - scale) < 0.001;
      raf = settled ? 0 : requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const setVisible = (v: boolean) => {
      if (v === visible) return;
      visible = v;
      d.style.opacity = r.style.opacity = v ? "1" : "0";
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        rx = x;
        ry = y;
      }
      const el = e.target instanceof Element ? e.target : null;
      const inText = !!el?.closest(TEXT);
      hover = !inText && !!el?.closest(INTERACTIVE);
      const dark = !!el?.closest(".on-dark");
      r.dataset.hover = hover ? "1" : "";
      r.dataset.dark = d.dataset.dark = dark ? "1" : "";
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
      <div
        ref={ring}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[100] h-7 w-7 rounded-full border border-slate-900/40 opacity-0 transition-[opacity,background-color,border-color] duration-200 data-[dark=1]:border-white/50 data-[hover=1]:border-slate-900/25 data-[hover=1]:bg-slate-900/[0.06] data-[dark=1]:data-[hover=1]:bg-white/10"
        style={{ willChange: "transform" }}
      />
      <div
        ref={dot}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[100] h-1.5 w-1.5 rounded-full bg-slate-900 opacity-0 transition-opacity duration-200 data-[dark=1]:bg-white"
        style={{ willChange: "transform" }}
      />
    </>
  );
}
