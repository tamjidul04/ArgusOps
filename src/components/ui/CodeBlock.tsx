"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  /** Text copied to the clipboard and shown (one command per line; lines starting with # are comments). */
  code: string;
  title?: string;
  /** Prefix shown (not copied) before each command line, e.g. "$". */
  prompt?: string;
  className?: string;
}

/** Terminal-style code block with a keyboard-accessible copy button. */
export function CodeBlock({ code, title, prompt = "$", className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  }

  return (
    <div className={cn("on-dark overflow-hidden rounded-2xl bg-slate-950 ring-1 ring-slate-900/10 shadow-soft", className)}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
          </span>
          {title && <span className="ml-2 font-mono text-[11px] text-slate-400">{title}</span>}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-slate-100">
        <code>
          {lines.map((l, i) => (
            <span key={i} className="block whitespace-pre">
              {prompt && !l.startsWith("#") && l.trim() !== "" && <span className="mr-2 select-none text-slate-500">{prompt}</span>}
              <span className={l.startsWith("#") ? "text-slate-400" : undefined}>{l}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
