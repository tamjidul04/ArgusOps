import React from "react";
import { cn } from "@/lib/utils";

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
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
        "py-20 md:py-32",
        tone === "white" && "bg-white",
        tone === "dark" && "on-dark bg-slate-950 text-slate-100",
        className
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, tone = "light", className }: { children: React.ReactNode; tone?: "light" | "dark"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] ring-1",
        tone === "dark" ? "bg-white/5 text-slate-300 ring-white/10" : "bg-slate-900/[0.04] text-slate-600 ring-slate-900/5",
        className
      )}
    >
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
    <div className={cn("reveal max-w-2xl space-y-4", align === "center" && "mx-auto text-center")}>
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2
        id={id}
        className={cn(
          "text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl md:text-5xl",
          tone === "dark" ? "text-white" : "text-slate-900"
        )}
      >
        {title}
      </h2>
      {lead && (
        <p className={cn("text-pretty text-base leading-relaxed sm:text-lg", tone === "dark" ? "text-slate-300" : "text-slate-600")}>
          {lead}
        </p>
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
    <header className="border-b border-slate-900/5 bg-white pb-16 pt-36 md:pb-24 md:pt-44">
      <Container>
        <div className="max-w-3xl space-y-5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
            {title}
          </h1>
          {lead && <p className="text-pretty text-lg leading-relaxed text-slate-600">{lead}</p>}
          {children}
        </div>
      </Container>
    </header>
  );
}
