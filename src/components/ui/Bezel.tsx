import React from "react";
import { cn } from "@/lib/utils";

interface BezelProps {
  children: React.ReactNode;
  tone?: "light" | "dark";
  className?: string;
  innerClassName?: string;
  as?: "div" | "article" | "li";
}

/** A flat surface with a hairline border. (Name kept so existing pages keep working.) */
export function Bezel({ children, tone = "light", className, innerClassName, as: Tag = "div" }: BezelProps) {
  const dark = tone === "dark";
  return (
    <Tag
      className={cn(
        "rounded-lg border",
        dark ? "on-dark border-white/10 bg-slate-950 text-slate-100" : "border-slate-200 bg-white",
        className
      )}
    >
      <div className={cn("h-full p-6", innerClassName)}>{children}</div>
    </Tag>
  );
}
