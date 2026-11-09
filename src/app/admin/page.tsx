import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import {
  AdminClient,
  QueueItem,
  PricingPlanItem,
  UserItem,
} from "./AdminClient";
import { prisma } from "@/lib/prisma";
import { requirePageAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin Control: Pricing, Approvals & User Access",
  description:
    "Superuser orchestration console for workspace quota, licensing gates, and security restrictions.",
};

async function AdminDataLoader() {
  await requirePageAdmin();
  let queue: QueueItem[] = [];
  let plans: PricingPlanItem[] = [];
  let users: UserItem[] = [];

  try {
    // 1. Fetch approval queue transactions
    const dbQueue = await prisma.transactionApprovalQueue.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            subscription: {
              include: {
                plan: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    queue = dbQueue.map((t) => ({
      tx_id: t.tx_id,
      user_id: t.user_id,
      user_email: t.user?.email || "user@argusops.dev",
      user_name: t.user?.name || "Workspace User",
      requested_plan: t.requested_plan,
      amount: t.amount,
      admin_status: t.admin_status,
      created_at: t.created_at.toISOString(),
      reviewed_at: t.reviewed_at?.toISOString() || null,
      current_plan: t.user?.subscription?.plan?.name || "Free Tier",
      current_max_agents: t.user?.subscription?.max_agents || 3,
    }));

    // 2. Fetch pricing plans
    const dbPlans = await prisma.pricingPlan.findMany({
      orderBy: { price: "asc" },
    });

    plans = dbPlans.map((p) => ({
      plan_id: p.plan_id,
      name: p.name,
      price: p.price,
      agent_limit: p.agent_limit,
      included_tokens: p.included_tokens,
      is_public: p.is_public,
      requires_admin_approval: p.requires_admin_approval,
      description: p.description,
    }));

    // 3. Fetch all users
    const dbUsers = await prisma.user.findMany({
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    users = dbUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      two_factor_enabled: u.two_factor_enabled,
      created_at: u.created_at.toISOString(),
      plan_name: u.subscription?.plan?.name || "Free Tier",
      plan_id: u.subscription?.plan_id || "plan_free",
      free_tokens: u.subscription?.free_tokens || 0,
      paid_tokens: u.subscription?.paid_tokens || 0,
      max_agents: u.subscription?.max_agents || 3,
      purchase_status: u.subscription?.purchase_status || "NONE",
    }));
  } catch (error) {
    console.error("Admin data loader error:", error);
  }

  // Fallback defaults if database was empty
  if (plans.length === 0) {
    plans = [
      {
        plan_id: "plan_free",
        name: "Free Tier",
        price: 0.0,
        agent_limit: 3,
        included_tokens: 50000,
        is_public: true,
        requires_admin_approval: false,
        description: "Core local agent experimentation",
      },
      {
        plan_id: "plan_pro",
        name: "Pro Swarm",
        price: 49.0,
        agent_limit: 25,
        included_tokens: 2000000,
        is_public: true,
        requires_admin_approval: false,
        description: "Autonomous multi-agent swarms",
      },
      {
        plan_id: "plan_enterprise",
        name: "Enterprise",
        price: 299.0,
        agent_limit: 100,
        included_tokens: 15000000,
        is_public: true,
        requires_admin_approval: true,
        description: "High-density distributed infra",
      },
    ];
  }

  return (
    <AdminClient
      initialQueue={queue}
      initialPlans={plans}
      initialUsers={users}
    />
  );
}

export default function AdminPage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={<PageLoading label="Loading admin" />}
      >
        <AdminDataLoader />
      </Suspense>
    </DashboardShell>
  );
}

