import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || "usr_tamjid_master";

    // 1. Fetch user subscription and wallet
    let subscription = await prisma.subscriptionAndWallet.findUnique({
      where: { user_id: userId },
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
    });

    // Fallback if user doesn't exist yet
    if (!subscription) {
      // Try finding tamjid as default
      subscription = await prisma.subscriptionAndWallet.findFirst({
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
      });
    }

    // 2. Fetch all public pricing plans
    const plans = await prisma.pricingPlan.findMany({
      where: { is_public: true },
      orderBy: { price: "asc" },
    });

    // 3. Fetch transaction history / approval queue for this user
    const transactions = await prisma.transactionApprovalQueue.findMany({
      where: userId ? { user_id: userId } : undefined,
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({
      success: true,
      subscription: subscription
        ? {
            id: subscription.id,
            user_id: subscription.user_id,
            user_name: subscription.user?.name || "Argus User",
            user_email: subscription.user?.email || "user@argusops.dev",
            plan_id: subscription.plan_id,
            plan_name: subscription.plan?.name || "Free Tier",
            plan_price: subscription.plan?.price ?? 0,
            free_tokens: subscription.free_tokens,
            paid_tokens: subscription.paid_tokens,
            max_agents: subscription.max_agents,
            purchase_status: subscription.purchase_status,
            updated_at: subscription.updated_at.toISOString(),
          }
        : null,
      plans: plans.map((p) => ({
        plan_id: p.plan_id,
        name: p.name,
        price: p.price,
        agent_limit: p.agent_limit,
        included_tokens: p.included_tokens,
        is_public: p.is_public,
        requires_admin_approval: p.requires_admin_approval,
        description: p.description,
      })),
      transactions: transactions.map((t) => ({
        tx_id: t.tx_id,
        user_id: t.user_id,
        requested_plan: t.requested_plan,
        amount: t.amount,
        admin_status: t.admin_status,
        created_at: t.created_at.toISOString(),
        reviewed_at: t.reviewed_at?.toISOString() || null,
      })),
    });
  } catch (error) {
    if ((error as any)?.digest?.startsWith("NEXT_")) {
      throw error;
    }
    console.error("Failed to fetch billing data:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error fetching billing information",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId = "usr_tamjid_master",
      planId,
      planName,
      amount,
      action = "request_upgrade",
    } = body;

    // Handle Cancel pending upgrade request
    if (action === "cancel_upgrade") {
      // Find the pending transaction
      const pendingTx = await prisma.transactionApprovalQueue.findFirst({
        where: {
          user_id: userId,
          admin_status: "PENDING",
        },
        orderBy: { created_at: "desc" },
      });

      if (pendingTx) {
        await prisma.transactionApprovalQueue.update({
          where: { tx_id: pendingTx.tx_id },
          data: {
            admin_status: "REJECTED",
            reviewed_at: new Date(),
          },
        });
      }

      await prisma.subscriptionAndWallet.update({
        where: { user_id: userId },
        data: { purchase_status: "NONE" },
      });

      return NextResponse.json({
        success: true,
        message: "Pending plan upgrade request was cancelled.",
        purchase_status: "NONE",
      });
    }

    // Handle Token Top-Up purchase
    if (action === "topup_tokens") {
      const tokenCount = Number(body.tokenCount) || 500000;
      const topupAmount = Number(amount) || 15.0;

      const tx = await prisma.transactionApprovalQueue.create({
        data: {
          tx_id: `tx_topup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          user_id: userId,
          requested_plan: `Token Top-Up (+${(tokenCount / 1000).toLocaleString()}k Tokens)`,
          amount: topupAmount,
          admin_status: "APPROVED",
          reviewed_at: new Date(),
        },
      });

      const updatedSub = await prisma.subscriptionAndWallet.update({
        where: { user_id: userId },
        data: {
          paid_tokens: {
            increment: tokenCount,
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: `Successfully credited ${tokenCount.toLocaleString()} paid tokens to your wallet.`,
        transaction: tx,
        paid_tokens: updatedSub.paid_tokens,
      });
    }

    // Validate upgrade target plan
    if (!planId && !planName) {
      return NextResponse.json(
        { success: false, error: "Target planId or planName is required" },
        { status: 400 }
      );
    }

    // Lookup plan in DB if planId passed
    let plan = null;
    if (planId) {
      plan = await prisma.pricingPlan.findUnique({
        where: { plan_id: planId },
      });
    }
    if (!plan && planName) {
      plan = await prisma.pricingPlan.findFirst({
        where: { name: planName },
      });
    }

    const targetPlanName = plan?.name || planName || "Pro Tier";
    const targetAmount =
      typeof amount === "number" ? amount : plan?.price ?? 49.0;

    // Check user's current subscription
    const userSub = await prisma.subscriptionAndWallet.findUnique({
      where: { user_id: userId },
    });

    if (!userSub) {
      return NextResponse.json(
        { success: false, error: "User subscription not found" },
        { status: 404 }
      );
    }

    // Create a new pending record in Transactions_Approval_Queue
    const newTx = await prisma.transactionApprovalQueue.create({
      data: {
        tx_id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        user_id: userId,
        requested_plan: targetPlanName,
        amount: targetAmount,
        admin_status: "PENDING",
        created_at: new Date(),
      },
    });

    // Update SubscriptionAndWallet purchase_status to PENDING
    const updatedSub = await prisma.subscriptionAndWallet.update({
      where: { user_id: userId },
      data: {
        purchase_status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      message: `Upgrade request for ${targetPlanName} ($${targetAmount.toFixed(2)}) submitted to Admin Approval Queue.`,
      transaction: {
        tx_id: newTx.tx_id,
        user_id: newTx.user_id,
        requested_plan: newTx.requested_plan,
        amount: newTx.amount,
        admin_status: newTx.admin_status,
        created_at: newTx.created_at.toISOString(),
      },
      purchase_status: updatedSub.purchase_status,
    });
  } catch (error) {
    console.error("Failed to submit upgrade request:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process plan upgrade request",
      },
      { status: 500 }
    );
  }
}
