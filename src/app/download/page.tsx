import React from "react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Bezel, Eyebrow, CodeBlock, Container, PageHeader } from "@/components/ui";
import { VsCodeExtensionCard } from "@/components/VsCodeExtensionCard";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "Download",
  description: "Get the argus CLI and the ArgusOps VS Code extension.",
};

export default function DownloadPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Download"
        title="Two ways in. Use either, or both."
        lead="The CLI supervises the agent. The extension shows you what it is doing without leaving your editor."
      />

      <Container data-reveal className="space-y-6 py-20 md:py-28">
        <Bezel className="" innerClassName="sm:p-8">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <Eyebrow>CLI</Eyebrow>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">argus</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Runs Claude Code through a local proxy so ArgusOps can pause it when it loops. Requires Node 20 or newer and Claude Code. A
                published npm package is coming; for now build it from the repository.
              </p>
              <ul className="mt-5 space-y-1.5 text-sm text-slate-600">
                <li>Windows, macOS and Linux</li>
                <li>Desktop notifications included</li>
              </ul>
            </div>
            <CodeBlock
              title="terminal"
              code={"# from the repository root\nnpm install\nnpm run cli:build\nnode packages/cli/dist/argus.mjs login\nnode packages/cli/dist/argus.mjs run claude"}
            />
          </div>
        </Bezel>

        <div className="">
          <VsCodeExtensionCard />
        </div>
      </Container>

      <CtaBand title="Pair it, then forget about it." lead="Sign in once. ArgusOps stays quiet until an agent needs you." />
    </PublicShell>
  );
}
