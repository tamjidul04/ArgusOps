import React from "react";
import { Metadata } from "next";
import { PublicNavbar, PublicFooter } from "@/components/layout";
import { DocsClient } from "./DocsClient";

export const metadata: Metadata = {
  title: "Documentation & Quick-Start | ArgusOps v1.1",
  description:
    "Complete developer guide to installing the ArgusOps local PC background daemon (<150MB RAM), setting up API keys, and linking Claude, Antigravity, and Hermes.",
};

export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicNavbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-10">
        <div className="border-b border-slate-200 pb-8 space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-xs">
            <span>Developer Documentation &amp; CLI Quick-Start</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            ArgusOps Desktop Bridge &amp; Daemon Setup
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-3xl leading-relaxed">
            Learn how to install our lightweight &lt;150MB background daemon, configure local agent bridges,
            and prevent destructive file conflicts across Claude, Antigravity, and Hermes.
          </p>
        </div>

        <DocsClient />
      </main>

      <PublicFooter />
    </div>
  );
}

