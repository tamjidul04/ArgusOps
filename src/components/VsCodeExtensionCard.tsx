import React from "react";
import { Download, PlugZap } from "lucide-react";
import extension from "../../packages/vscode/package.json";

/** Offers the VS Code extension for download with click-through install steps (no terminal needed). */
export function VsCodeExtensionCard() {
  const steps = [
    <>Download the file with the button on the right.</>,
    <>
      In VS Code open the Extensions panel (<kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[11px]">Ctrl</kbd>+
      <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[11px]">Shift</kbd>+
      <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono text-[11px]">X</kbd>, or the squares icon on the left).
    </>,
    <>
      Click the <strong>⋯</strong> menu at the top of that panel, choose <strong>Install from VSIX…</strong> and pick the file you downloaded.
    </>,
    <>If VS Code shows a <strong>Reload</strong> button, click it. A shield icon named <strong>ArgusOps</strong> appears in the left bar.</>,
    <>
      Open it, click <strong>Sign in to ArgusOps</strong> and approve the code in your browser.
    </>,
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby="vscode-ext-title">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 id="vscode-ext-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <PlugZap className="h-4 w-4 text-slate-500" /> VS Code extension
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[10px] font-medium text-slate-500">{`v${extension.version}`}</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">See your agents, get alerted when one is stuck, and approve a suggested instruction, resume or stop it without leaving the editor.</p>
          <ol className="mt-3 space-y-2 text-xs text-slate-700">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{i + 1}</span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="shrink-0 lg:w-56">
          <a
            href="/downloads/argusops-vscode.vsix"
            download="argusops-vscode.vsix"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/30"
          >
            <Download className="h-4 w-4" /> Download extension
          </a>
          <p className="mt-2 text-center text-[11px] text-slate-400">argusops-vscode.vsix · works with VS Code 1.85 or newer</p>
        </div>
      </div>
    </section>
  );
}
