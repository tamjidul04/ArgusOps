import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { getUsageSummary } from "@/lib/usage";
import { UsageClient } from "./UsageClient";

export const metadata: Metadata = {
  title: "Usage & Savings",
  description: "Real token usage, estimated cost, loops caught and cache savings for your supervised agents.",
};

async function UsageLoader() {
  const user = await requirePageUser();
  const initial = await getUsageSummary(user.id, "7d");
  return <UsageClient initial={initial} />;
}

export default function UsagePage() {
  return (
    <DashboardShell>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-md bg-slate-100" />}>
        <UsageLoader />
      </Suspense>
    </DashboardShell>
  );
}
