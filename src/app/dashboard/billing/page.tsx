import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import {
  BillingV2Client,
  PricingPlanItem,
  TransactionItem,
  UserSubscriptionData,
} from "./BillingV2Client";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Billing, Token Wallet & Plan Quota | ArgusOps v1.1",
  description:
    "Master AI cluster quota, unmetered token balances, and self-serve tier upgrades.",
};

async function BillingDataLoader() {
  let subscription: UserSubscriptionData | null = null;
  let plans: PricingPlanItem[] = [];
  let transactions: TransactionItem[] = [];

  try {
    // 1. Fetch user subscription and wallet (defaults to main active demo user)
    const dbSub = await prisma.subscriptionAndWallet.findFirst({
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { updated_at: "desc" },
    });

    if (dbSub) {
      subscription = {
        id: dbSub.id,
        user_id: dbSub.user_id,
        user_name: dbSub.user?.name || "Tamjidul Islam",
        user_email: dbSub.user?.email || "tamjid@argusops.dev",
        plan_id: dbSub.plan_id,
        plan_name: dbSub.plan?.name || "Free Tier",
        plan_price: dbSub.plan?.price ?? 0.0,
        free_tokens: dbSub.free_tokens,
        paid_tokens: dbSub.paid_tokens,
        max_agents: dbSub.max_agents,
        purchase_status: dbSub.purchase_status,
        updated_at: dbSub.updated_at.toISOString(),
      };
    }

    // 2. Fetch all public pricing plans
    const dbPlans = await prisma.pricingPlan.findMany({
      where: { is_public: true },
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

    // 3. Fetch transaction approval queue
    const dbTx = await prisma.transactionApprovalQueue.findMany({
      orderBy: { created_at: "desc" },
      take: 25,
    });

    transactions = dbTx.map((t) => ({
      tx_id: t.tx_id,
      user_id: t.user_id,
      requested_plan: t.requested_plan,
      amount: t.amount,
      admin_status: t.admin_status,
      created_at: t.created_at.toISOString(),
      reviewed_at: t.reviewed_at?.toISOString() || null,
    }));
  } catch (error) {
    console.error("Error loading billing data from database:", error);
  }

  // Fallbacks if database had empty tables
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
        requires_admin_approval: true,
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

  if (!subscription) {
    subscription = {
      id: "sub_dev_free",
      user_id: "usr_dev_indie",
      user_name: "Alex Rivera",
      user_email: "dev@localbridge.io",
      plan_id: "plan_free",
      plan_name: "Free Tier",
      plan_price: 0.0,
      free_tokens: 84520,
      paid_tokens: 0,
      max_agents: 3,
      purchase_status: "PENDING",
      updated_at: new Date().toISOString(),
    };
  }

  return (
    <BillingV2Client
      initialSubscription={subscription}
      initialPlans={plans}
      initialTransactions={transactions}
    />
  );
}

export default function BillingPage() {
  return (
    <DashboardShell>
      <Suspense
        fallback={
          <div className="space-y-6 animate-pulse">
            <div className="h-8 bg-slate-200 rounded w-1/4"></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="h-32 bg-slate-200 rounded-xl"></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-28 bg-slate-200 rounded-xl"></div>
                  <div className="h-28 bg-slate-200 rounded-xl"></div>
                </div>
                <div className="h-64 bg-slate-200 rounded-xl"></div>
              </div>
              <div className="space-y-6">
                <div className="h-60 bg-slate-200 rounded-xl"></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-44 bg-slate-200 rounded-xl"></div>
                  <div className="h-44 bg-slate-200 rounded-xl"></div>
                </div>
              </div>
            </div>
          </div>
        }
      >
        <BillingDataLoader />
      </Suspense>
    </DashboardShell>
  );
}
