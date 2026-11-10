"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DocSection {
  id: string;
  label: string;
  group: string;
  content: React.ReactNode;
}

/**
 * Docs reader: one section at a time, picked from a sticky sidebar (desktop) or a sticky chip row (phone).
 * The section lives in the URL hash, so /docs#cli links, bookmarks and the back button all work.
 */
export function DocsShell({ sections }: { sections: DocSection[] }) {
  const [active, setActive] = useState(sections[0].id);
  const top = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);

  // Read the hash on load and whenever it changes (back/forward, in-page links).
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1);
      if (sections.some((s) => s.id === id)) setActive(id);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [sections]);

  // Keep the active chip in view on phones.
  useEffect(() => {
    // Scroll only the chip row (scrollIntoView would also nudge the page sideways).
    const row = chips.current;
    const chip = row?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (row && chip) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2 });
  }, [active]);

  const open = useCallback((id: string) => {
    setActive(id);
    history.pushState(null, "", `#${id}`);
    // Bring the start of the section into view if the reader had scrolled past it.
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 80 });
  }, []);

  const i = Math.max(0, sections.findIndex((s) => s.id === active));
  const current = sections[i];
  const prev = sections[i - 1];
  const next = sections[i + 1];
  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <div ref={top} className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Desktop: sticky sidebar */}
      <aside className="hidden lg:block">
        <nav aria-label="Documentation" className="sticky top-24 max-h-[calc(100dvh-7rem)] space-y-6 overflow-y-auto pb-6 pr-2">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-3 pb-1.5 text-xs font-medium text-slate-400">{g}</p>
              <ul className="space-y-0.5">
                {sections
                  .filter((s) => s.group === g)
                  .map((s) => {
                    const on = s.id === active;
                    return (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            open(s.id);
                          }}
                          aria-current={on ? "page" : undefined}
                          className={cn(
                            "flex h-10 items-center gap-3 rounded-md px-3 text-[15px] transition-colors duration-150",
                            on ? "bg-white font-medium text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.06)] ring-1 ring-slate-200" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          )}
                        >
                          <span className={cn("font-mono text-[11px]", on ? "text-slate-900" : "text-slate-400")}>{String(sections.indexOf(s) + 1).padStart(2, "0")}</span>
                          {s.label}
                        </a>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Phone/tablet: sticky chip row under the navbar */}
      <div className="sticky top-16 z-30 -mx-4 min-w-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:hidden">
        <div ref={chips} role="tablist" aria-label="Documentation sections" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => {
            const on = s.id === active;
            return (
              <button
                key={s.id}
                data-id={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => open(s.id)}
                className={cn(
                  "h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                  on ? "bg-slate-900 font-medium text-white" : "border border-slate-200 bg-white text-slate-600"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* key = section id, so switching sections replays the rise-in */}
      <article key={current.id} className="min-w-0 max-w-3xl" aria-labelledby={`${current.id}-title`}>
        <p className="rise-in font-mono text-xs text-slate-400">
          {current.group} · {String(i + 1).padStart(2, "0")} of {String(sections.length).padStart(2, "0")}
        </p>
        <h2
          id={`${current.id}-title`}
          className="rise-in mt-2 text-balance text-3xl font-semibold tracking-[-0.025em] text-slate-900 md:text-4xl"
          style={{ animationDelay: "30ms" }}
        >
          {current.label}
        </h2>
        <div className="docs-body rise-in-children mt-2">{current.content}</div>

        <nav aria-label="More documentation" className="rise-in mt-14 grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2" style={{ animationDelay: "320ms" }}>
          {prev ? (
            <button
              type="button"
              onClick={() => open(prev.id)}
              className="group flex flex-col items-start rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300"
            >
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden="true" /> Previous
              </span>
              <span className="mt-1 text-[15px] font-medium text-slate-900">{prev.label}</span>
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
          {next && (
            <button
              type="button"
              onClick={() => open(next.id)}
              className="group flex flex-col items-end rounded-lg border border-slate-200 bg-white p-4 text-right transition-colors hover:border-slate-300"
            >
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                Next <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="mt-1 text-[15px] font-medium text-slate-900">{next.label}</span>
            </button>
          )}
        </nav>
      </article>
    </div>
  );
}
