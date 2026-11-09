import React from "react";
import { Download, PlugZap } from "lucide-react";
import extension from "../../packages/vscode/package.json";
import { Bezel } from "@/components/ui/Bezel";
import { buttonClasses } from "@/components/ui/Button";

const kbd = "rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-900/10";

/** Offers the VS Code extension for download with click-through install steps (no terminal needed). */
export function VsCodeExtensionCard({ variant = "bezel" }: { variant?: "bezel" | "panel" }) {
  const steps = [
    <>Download the file with the button on the right.</>,
    <>
      In VS Code open the Extensions panel (<kbd className={kbd}>Ctrl</kbd>+<kbd className={kbd}>Shift</kbd>+<kbd className={kbd}>X</kbd>, or the squares icon on
      the left).
    </>,
    <>
      Click the <strong>⋯</strong> menu at the top of that panel, choose <strong>Install from VSIX…</strong> and pick the file you downloaded.
    </>,
    <>If VS Code shows a <strong>Reload</strong> button, click it. A shield icon named <strong>ArgusOps</strong> appears in the left bar.</>,
    <>
      Open it, click <strong>Sign in to ArgusOps</strong> and approve the code in your browser.
    </>,
  ];

  const wrap = (children: React.ReactNode) =>
    variant === "panel" ? (
      <div className="rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-900/5 sm:p-6">{children}</div>
    ) : (
      <Bezel innerClassName="sm:p-8">{children}</Bezel>
    );

  return wrap(
      <section aria-labelledby="vscode-ext-title" id="vscode">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 id="vscode-ext-title" className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-900">
              <PlugZap className="h-5 w-5 text-slate-500" aria-hidden="true" /> VS Code extension
              <span className="rounded-full bg-slate-900/[0.05] px-2.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">{`v${extension.version}`}</span>
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
              See your agents, get alerted when one is stuck, and approve a suggested instruction, resume or stop it without leaving the editor.
            </p>
            <ol className="mt-6 space-y-3 text-sm text-slate-700">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{i + 1}</span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="shrink-0 lg:w-64">
            <a href="/downloads/argusops-vscode.vsix" download="argusops-vscode.vsix" className={buttonClasses("primary", true, "w-full justify-between")}>
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4" aria-hidden="true" /> Download extension
              </span>
            </a>
            <p className="mt-3 text-center text-xs text-slate-500">argusops-vscode.vsix · VS Code 1.85 or newer</p>
          </div>
        </div>
      </section>
  );
}
