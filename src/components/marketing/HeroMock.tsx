import React from "react";
import { Check, Pause } from "lucide-react";
import { Bezel } from "@/components/ui/Bezel";

/**
 * Static, illustrative picture of ArgusOps catching a loop. Decorative: described once for screen readers.
 */
export function HeroMock() {
  return (
    <div className="relative">
      <div
        role="img"
        aria-label="Example: Claude Code ran the failing command npm test three times. ArgusOps paused the agent without sending the next request, and suggests a corrective instruction with Approve, Edit and Stop actions."
      >
        <Bezel tone="dark" className="shadow-lift" innerClassName="p-0 sm:p-0 overflow-hidden">
          <div aria-hidden="true">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
                  <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
                  <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
                </span>
                <span className="ml-2 font-mono text-[11px] text-slate-400">argus run claude</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-400/20">
                <Pause className="h-3 w-3" /> Paused
              </span>
            </div>

            <div className="space-y-1.5 px-5 py-5 font-mono text-[12.5px] leading-relaxed">
              <p className="text-slate-400">
                <span className="text-slate-500">claude</span> Running the tests again to check the fix
              </p>
              {[1, 2, 3].map((n) => (
                <p key={n} className="text-slate-300">
                  <span className="text-red-400">✗</span> npm test <span className="text-slate-500">exit 1 · attempt {n}</span>
                </p>
              ))}
              <p className="pt-2 text-amber-300">
                <span className="text-slate-500">argus</span> Loop detected: the same failing call, 3 times
              </p>
              <p className="text-emerald-300">
                <span className="text-slate-500">argus</span> Next request held. Nothing was sent to the provider
                <span className="caret ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 bg-emerald-300" />
              </p>
            </div>

            <div className="border-t border-white/10 bg-white/[0.03] p-4 sm:p-5">
              <div className="rounded-2xl bg-white p-4 text-slate-900 shadow-[inset_0_1px_0_#fff]">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">Suggested instruction</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">
                  Stop re-running <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">npm test</code>. The error is a missing
                  export in <code className="rounded bg-slate-100 px-1 font-mono text-[12px]">src/utils.ts</code>. Fix that first, then run
                  the tests once.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white">
                    <Check className="h-3.5 w-3.5" /> Approve &amp; resume
                  </span>
                  <span className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/10">Edit</span>
                  <span className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-600/20">Stop</span>
                </div>
              </div>
            </div>
          </div>
        </Bezel>
      </div>

      <span className="float-slow absolute -top-3 right-4 rounded-full bg-white px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-600 shadow-soft ring-1 ring-slate-900/10 sm:right-8">
        Illustrative example
      </span>
    </div>
  );
}
