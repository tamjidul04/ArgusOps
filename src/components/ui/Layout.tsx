import React from "react";
import { cn } from "@/lib/utils";

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[96rem] px-4 sm:px-6 lg:px-8 2xl:px-12", className)}>{children}</div>;
}

export function Section({
  children,
  className,
  id,
  tone = "default",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "default" | "white" | "dark";
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "border-t border-slate-200 py-20 md:py-28",
        tone === "white" && "bg-white",
        tone === "dark" && "on-dark border-slate-800 bg-slate-950 text-slate-100",
        className
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}

/** Section label: a short mono caption with a hairline tick, not a pill. */
export function Eyebrow({ children, tone = "light", className }: { children: React.ReactNode; tone?: "light" | "dark"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-xs", tone === "dark" ? "text-slate-400" : "text-slate-500", className)}>
      <span aria-hidden="true" className={cn("h-px w-4", tone === "dark" ? "bg-slate-600" : "bg-slate-300")} />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  align = "left",
  tone = "light",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  id?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
}) {
  return (
    <div className={cn("max-w-2xl space-y-3", align === "center" && "mx-auto text-center")}>
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2
        id={id}
        className={cn(
          "text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-4xl 2xl:text-5xl",
          tone === "dark" ? "text-white" : "text-slate-900"
        )}
      >
        {title}
      </h2>
      {lead && (
        <p className={cn("text-pretty text-base leading-relaxed sm:text-[17px]", tone === "dark" ? "text-slate-400" : "text-slate-500")}>{lead}</p>
      )}
    </div>
  );
}

/** Page title block for inner pages. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="dot-grid border-b border-slate-200 pb-14 pt-32 md:pb-20 md:pt-40">
      <Container>
        <div className="max-w-3xl space-y-4">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-slate-900 sm:text-5xl 2xl:text-6xl">{title}</h1>
          {lead && <p className="max-w-2xl text-pretty text-lg leading-relaxed text-slate-500">{lead}</p>}
          {children}
        </div>
      </Container>
    </header>
  );
}
