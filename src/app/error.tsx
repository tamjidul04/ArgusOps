"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";

/** Shown when something fails while rendering a page. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <Link href="/" aria-label="ArgusOps home" className="mb-10 rounded-lg">
        <Logo />
      </Link>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700 ring-1 ring-red-600/20">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Something went wrong</h1>
      <p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-slate-600">
        We couldn&apos;t load this page. Your agents are not affected. Try again, or head back to the dashboard.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <button type="button" onClick={() => retry()} className={buttonClasses("primary", false)}>
          Try again
        </button>
        <Link href="/dashboard" className={buttonClasses("secondary", false)}>
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
