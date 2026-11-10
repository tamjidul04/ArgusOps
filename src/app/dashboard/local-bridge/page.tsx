import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import { LocalBridgeClient } from "./LocalBridgeClient";
import { VsCodeExtensionCard } from "@/components/VsCodeExtensionCard";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";
import { getPermissions, listLocks } from "@/lib/control-plane";

export const metadata: Metadata = {
  title: "Local PC Bridge & API Keys",
  description:
    "Pair your machine, manage API keys, and control file locks and permissions for locally supervised agents.",
};

async function LocalBridgeLoader() {
  const user = await requirePageUser();

  const [cluster, locks, permissions, keys] = await Promise.all([
    prisma.clusterAndWorkspace.findFirst({
      where: { environment: "LOCAL_PC", user_id: user.id },
      include: { agents: { orderBy: { name: "asc" } } },
    }),
    listLocks(user.id),
    getPermissions(user.id),
    prisma.apiKey.findMany({
      where: { user_id: user.id, revoked_at: null },
      orderBy: { created_at: "desc" },
    }),
  ]);

  const localAgents = (cluster?.agents ?? []).map((a) => ({
    agent_id: a.agent_id,
    name: a.name,
    agent_type: a.agent_type,
    status: a.status,
    model_tier: a.model_tier,
    ram_usage: a.ram_usage,
    cpu_usage: a.cpu_usage,
    tokens_used: a.tokens_used,
    current_task: a.current_task,
    locked_file_path: a.locked_file_path,
  }));

  const apiKeys = keys.map((k) => ({
    id: k.id,
    label: k.label,
    key_prefix: k.key_prefix,
    masked_key: `${k.key_prefix}••••••••••••${k.key_hash.slice(-4)}`,
    last_used_at: k.last_used_at?.toISOString() || null,
    created_at: k.created_at.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <LocalBridgeClient
        initialAgents={localAgents}
        initialLocks={locks}
        initialKeys={apiKeys}
        initialPermissions={permissions}
      />
      <VsCodeExtensionCard variant="panel" />
    </div>
  );
}

export default function LocalBridgePage() {
  return (
    <DashboardShell>
      <Suspense fallback={<PageLoading label="Loading local bridge" />}>
        <LocalBridgeLoader />
      </Suspense>
    </DashboardShell>
  );
}
