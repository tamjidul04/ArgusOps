"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";

export const NAV_LINKS = [
  { label: "Features", href: "/features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Download", href: "/download" },
];

const EASE = "ease-spring";

/** Floating glass-pill navigation. On small screens it opens a full-screen menu with staggered links. */
export function PublicNavbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Close the menu when the route changes (state adjusted during render, no effect needed).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <a
        href="#main"
        className="fixed left-4 top-4 z-50 -translate-y-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-4 sm:pt-6">
        <div className="pointer-events-auto flex w-full max-w-4xl items-center justify-between rounded-full bg-white/80 py-2 pl-4 pr-2 shadow-soft ring-1 ring-slate-900/[0.07] backdrop-blur-xl">
          <Link href="/" aria-label="ArgusOps home" className="rounded-full">
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
            {NAV_LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-sm font-medium transition-colors duration-300",
                    active ? "bg-slate-900/[0.06] text-slate-900" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1">
            <Link
              href="/login"
              className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:block"
            >
              Log in
            </Link>
            <Link href="/signup" className={cn(buttonClasses("primary", false), "hidden sm:inline-flex")}>
              Start free
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="relative z-50 flex h-10 w-10 items-center justify-center rounded-full text-slate-900 hover:bg-slate-900/5 md:hidden"
            >
              <span className="relative block h-3 w-5" aria-hidden="true">
                <span
                  className={cn(
                    "absolute left-0 h-[1.5px] w-5 rounded bg-current transition-transform duration-500",
                    EASE,
                    open ? "top-1/2 rotate-45" : "top-0"
                  )}
                />
                <span
                  className={cn(
                    "absolute left-0 h-[1.5px] w-5 rounded bg-current transition-transform duration-500",
                    EASE,
                    open ? "top-1/2 -rotate-45" : "bottom-0"
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      </header>

      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed inset-0 z-[45] flex flex-col bg-white/90 px-6 pb-8 pt-28 backdrop-blur-3xl transition-opacity duration-500 md:hidden",
          EASE,
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {NAV_LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              style={{ transitionDelay: open ? `${100 + i * 50}ms` : "0ms" }}
              className={cn(
                "border-b border-slate-900/5 py-4 text-3xl font-semibold tracking-tight text-slate-900 transition-[transform,opacity] duration-700",
                EASE,
                open ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div
          style={{ transitionDelay: open ? "380ms" : "0ms" }}
          className={cn(
            "mt-auto flex flex-col gap-3 transition-[transform,opacity] duration-700",
            EASE,
            open ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          )}
        >
          <Link href="/signup" className={cn(buttonClasses("primary", false), "w-full py-3.5")}>
            Start free
          </Link>
          <Link href="/login" className={cn(buttonClasses("secondary", false), "w-full py-3.5")}>
            Log in
          </Link>
        </div>
      </div>
    </>
  );
}
