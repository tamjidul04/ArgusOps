import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "inverse";

const base =
  "group relative inline-flex items-center justify-center gap-3 rounded-full text-sm font-semibold " +
  "transition-[transform,background-color,box-shadow,color] duration-500 ease-spring active:scale-[0.98] select-none";

const variants: Record<Variant, string> = {
  primary: "bg-slate-900 text-white shadow-soft hover:bg-slate-800",
  secondary: "bg-white text-slate-900 ring-1 ring-slate-900/10 shadow-soft hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-900/5 hover:text-slate-900",
  inverse: "bg-white text-slate-900 hover:bg-slate-100",
};

const chip: Record<Variant, string> = {
  primary: "bg-white/15 text-white",
  secondary: "bg-slate-900/5 text-slate-900",
  ghost: "bg-slate-900/5 text-slate-900",
  inverse: "bg-slate-900/10 text-slate-900",
};

export function buttonClasses(variant: Variant = "primary", arrow = true, className?: string) {
  return cn(base, variants[variant], arrow ? "py-2 pl-6 pr-2" : "px-5 py-2.5", className);
}

function Chip({ variant }: { variant: Variant }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-500 ease-spring",
        "group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105",
        chip[variant]
      )}
    >
      <ArrowUpRight className="h-4 w-4" />
    </span>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  arrow?: boolean;
  className?: string;
  children: React.ReactNode;
  download?: string;
  external?: boolean;
}

/** Pill link-button with the trailing arrow chip. Internal links use next/link. */
export function ButtonLink({ href, variant = "primary", arrow = true, className, children, download, external }: ButtonLinkProps) {
  const cls = buttonClasses(variant, arrow, className);
  const inner = (
    <>
      <span>{children}</span>
      {arrow && <Chip variant={variant} />}
    </>
  );
  if (download || external || /^https?:/.test(href)) {
    return (
      <a href={href} className={cls} download={download} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
