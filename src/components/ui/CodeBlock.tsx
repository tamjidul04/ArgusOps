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
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  }

  return (
    <div className={cn("on-dark overflow-hidden rounded-lg border border-slate-800 bg-slate-950", className)}>
      <div className="flex h-9 items-center justify-between border-b border-white/10 pl-4 pr-1.5">
        <span className="font-mono text-[11px] text-slate-500">{title ?? "terminal"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 text-slate-100">
        <code>
          {lines.map((l, i) => (
            <span key={i} className="block whitespace-pre">
              {prompt && !l.startsWith("#") && l.trim() !== "" && <span className="mr-2 select-none text-slate-600">{prompt}</span>}
              <span className={l.startsWith("#") ? "text-slate-500" : undefined}>{l}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
