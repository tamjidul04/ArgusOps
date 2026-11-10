"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "On this page" menu: numbered, button-sized links that highlight the section you are reading as you
 * scroll, and scroll smoothly to a section when clicked.
 */
export function SectionToc({ items, title = "On this page" }: { items: { id: string; label: string; hint?: string }[]; title?: string }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const onScroll = () => {
      // The active section is the last one whose top has passed a line a third of the way down the screen.
      const line = window.innerHeight * 0.33;
      let current = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // At the very bottom, the last section wins even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = els[els.length - 1].id;
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const smooth = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 96, behavior: smooth ? "smooth" : "auto" });
    history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <nav aria-label={title} className="sticky top-24">
      <p className="px-3 pb-2 text-xs font-medium text-slate-400">{title}</p>
      <ul className="space-y-0.5">
        {items.map((it, i) => {
          const on = it.id === active;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(it.id);
                }}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-[15px] transition-colors duration-150",
                  on ? "bg-white font-medium text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.06)] ring-1 ring-slate-200" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <span className={cn("font-mono text-[11px]", on ? "text-slate-900" : "text-slate-400")}>{String(i + 1).padStart(2, "0")}</span>
                {it.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
