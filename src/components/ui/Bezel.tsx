import React from "react";
import { cn } from "@/lib/utils";

interface BezelProps {
  children: React.ReactNode;
  tone?: "light" | "dark";
  className?: string;
  innerClassName?: string;
  as?: "div" | "article" | "li";
}

/** Double-bezel surface: an outer tray with a hairline ring, and an inner core with concentric radius. */
export function Bezel({ children, tone = "light", className, innerClassName, as: Tag = "div" }: BezelProps) {
  const dark = tone === "dark";
  return (
    <Tag
      className={cn(
        "rounded-[1.75rem] p-1.5 ring-1",
        dark ? "on-dark bg-white/[0.06] ring-white/10" : "bg-slate-900/[0.04] ring-slate-900/5",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-[calc(1.75rem-0.375rem)] p-6 sm:p-7",
          dark
            ? "bg-slate-950 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            : "bg-white shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-14px_rgba(15,23,42,0.14)]",
          innerClassName
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
