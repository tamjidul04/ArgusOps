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

/** Full-width bar. A hairline appears once the page scrolls; on small screens a sheet drops down. */
export function PublicNavbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
        className="fixed left-4 top-3 z-50 -translate-y-20 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 border-b bg-slate-50/95 transition-[border-color,background-color] duration-200",
          scrolled || open ? "border-slate-200 bg-white" : "border-transparent"
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="ArgusOps home" className="rounded-md">
              <Logo />
            </Link>
            <nav aria-label="Main" className="hidden items-center md:flex">
              {NAV_LINKS.map((l) => {
                const active = pathname === l.href || pathname.startsWith(l.href + "/");
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative px-3 py-2 text-sm transition-colors duration-150",
                      active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
                    )}
                  >
                    {l.label}
                    {active && <span aria-hidden="true" className="absolute inset-x-3 -bottom-[11px] h-px bg-slate-900" />}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5">
            <Link href="/login" className={cn(buttonClasses("ghost", false), "hidden h-8 px-3 sm:inline-flex")}>
              Log in
            </Link>
            <Link href="/signup" className={cn(buttonClasses("primary", false), "hidden h-8 px-3 sm:inline-flex")}>
              Start free
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-900 hover:bg-slate-100 md:hidden"
            >
              <span className="relative block h-2.5 w-4" aria-hidden="true">
                <span
                  className={cn(
                    "absolute left-0 h-[1.5px] w-4 rounded bg-current transition-transform duration-200 ease-out",
                    open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0"
                  )}
                />
                <span
                  className={cn(
                    "absolute left-0 h-[1.5px] w-4 rounded bg-current transition-transform duration-200 ease-out",
                    open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0"
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
          "fixed inset-x-0 bottom-0 top-14 z-[45] flex flex-col bg-white px-4 pb-6 transition-[opacity,transform] duration-200 ease-out md:hidden",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
        )}
      >
        <nav aria-label="Mobile" className="flex flex-col">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="border-b border-slate-100 py-3.5 text-lg font-medium text-slate-900">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto grid gap-2">
          <Link href="/signup" className={cn(buttonClasses("primary", false), "w-full")}>
            Start free
          </Link>
          <Link href="/login" className={cn(buttonClasses("secondary", false), "w-full")}>
            Log in
          </Link>
        </div>
      </div>
    </>
  );
}
