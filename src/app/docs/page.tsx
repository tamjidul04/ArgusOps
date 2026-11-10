import React from "react";
import { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Container, PageHeader } from "@/components/ui";
import { DocsClient } from "./DocsClient";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Install the argus CLI, pair your machine, run Claude Code under supervision and use the VS Code extension.",
};

export default function DocsPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Documentation"
        title="From install to your first caught loop."
        lead="Everything you need to supervise an agent: setup, the CLI, the editor extension and how pausing works."
      />
      <Container className="py-10 md:py-14">
        <DocsClient />
      </Container>
    </PublicShell>
  );
}
