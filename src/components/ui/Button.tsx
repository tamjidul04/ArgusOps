import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "inverse";

const base =
  "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
  "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
  inverse: "bg-white text-slate-900 hover:bg-slate-200",
};

/** Class string for anything that should look like a button (links, downloads, form submits). */
export function buttonClasses(variant: Variant = "primary", arrow = true, className?: string) {
  // Inside the dashboard (.dash) controls are one step denser than on marketing pages.
  return cn(base, variants[variant], arrow ? "h-10 pl-4 pr-3.5" : "h-10 px-4", "in-[.dash]:h-9 in-[.dash]:px-3 in-[.dash]:text-[13px]", className);
}

/** The trailing arrow: a plain glyph that steps forward on hover, no chip. */
export function ButtonArrow() {
  return (
    <ArrowRight
      aria-hidden="true"
      className="h-4 w-4 opacity-70 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100"
    />
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

/** Link styled as a button. Internal links use next/link. */
export function ButtonLink({ href, variant = "primary", arrow = true, className, children, download, external }: ButtonLinkProps) {
  const cls = buttonClasses(variant, arrow, className);
  const inner = (
    <>
      <span>{children}</span>
      {arrow && <ButtonArrow />}
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
