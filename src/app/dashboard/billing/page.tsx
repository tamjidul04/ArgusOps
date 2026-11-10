import React, { Suspense } from "react";
import { Metadata } from "next";
import { DashboardShell } from "@/components/layout";
import { PageLoading } from "@/components/ui";
import {
  BillingV2Client,
  PricingPlanItem,
  TransactionItem,
  UserSubscriptionData,
} from "./BillingV2Client";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Plan & billing",
  description:
    "Your plan, token balance and upgrade requests.",
};

async function BillingDataLoader() {
  const user = await requirePageUser();
  let subscription: UserSubscriptionData | null = null;
  let plans: PricingPlanItem[] = [];
  let transactions: TransactionItem[] = [];

  try {
    // 1. The signed-in user's subscription and wallet
    const dbSub = await prisma.subscriptionAndWallet.findFirst({
      where: { user_id: user.id },
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
        user_name: dbSub.user?.name || user.name || "",
        user_email: dbSub.user?.email || user.email,
        plan_id: dbSub.plan_id,
        plan_name: dbSub.plan?.name || "Free",
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
      where: { user_id: user.id },
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

  // No invented fallbacks: if the database has no plans or no subscription row, the page says so.

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
        fallback={<PageLoading label="Loading billing" />}
      >
        <BillingDataLoader />
      </Suspense>
    </DashboardShell>
  );
}
