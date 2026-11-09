import React from "react";
import { cn } from "@/lib/utils";

/** The ArgusOps mark: an open eye (Argus, the watcher). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-900 text-white", className)}>
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Logo({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={tone === "dark" ? "bg-white text-slate-900" : undefined} />
      <span className={cn("text-[17px] font-semibold tracking-tight", tone === "dark" ? "text-white" : "text-slate-900")}>ArgusOps</span>
    </span>
  );
}
