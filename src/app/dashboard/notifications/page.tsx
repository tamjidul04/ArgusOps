import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Alerts when an agent is paused or stopped, and where they are delivered.",
};

async function NotificationsLoader() {
  const user = await requirePageUser();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { user_id: user.id }, orderBy: { created_at: "desc" }, take: 50 }),
    prisma.notification.count({ where: { user_id: user.id, read_at: null } }),
  ]);

  return (
    <NotificationsClient
      initialUnread={unread}
      initialItems={items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        level: n.level as "INFO" | "WARN" | "CRITICAL",
        read: n.read_at !== null,
        createdAt: n.created_at.toISOString(),
      }))}
    />
  );
}

export default function NotificationsPage() {
  return (
    <DashboardShell>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-slate-100" />}>
        <NotificationsLoader />
      </Suspense>
    </DashboardShell>
  );
}
