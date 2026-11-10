"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Elements marked data-reveal rise in (their children one after another) the first time they scroll into
 * view, then stay put. Content is only hidden once this has run, so nothing is ever invisible without
 * JavaScript, and nothing moves under reduced motion.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    if (!("IntersectionObserver" in window) || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const root = document.documentElement;
    root.classList.add("reveal-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-revealed");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    const scan = () =>
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((el) => {
        // Anything already on screen when the page opens shows straight away.
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92 && r.bottom > 0) el.classList.add("is-revealed");
        else io.observe(el);
      });
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
