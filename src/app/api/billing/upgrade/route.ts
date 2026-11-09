import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** Token top-up packs. Prices are fixed server-side; the client only picks a pack. */
const TOPUP_PACKS: Record<string, { tokens: number; amount: number }> = {
  small: { tokens: 500_000, amount: 15 },
  medium: { tokens: 2_000_000, amount: 50 },
  large: { tokens: 10_000_000, amount: 200 },
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  try {
    const subscription = await prisma.subscriptionAndWallet.findUnique({
      where: { user_id: userId },
      include: { plan: true, user: { select: { id: true, name: true, email: true, role: true } } },
    });

    const plans = await prisma.pricingPlan.findMany({
      where: { is_public: true },
      orderBy: { price: "asc" },
    });

    const transactions = await prisma.transactionApprovalQueue.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({
      success: true,
      subscription: subscription
        ? {
            id: subscription.id,
            user_id: subscription.user_id,
            user_name: subscription.user.name,
            user_email: subscription.user.email,
            plan_id: subscription.plan_id,
            plan_name: subscription.plan.name,
            plan_price: subscription.plan.price,
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
      topup_packs: TOPUP_PACKS,
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
    console.error("Failed to fetch billing data:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error fetching billing information" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session") {
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 403 });
  }
  const userId = auth.user.id;

  try {
    const body = await request.json().catch(() => ({}));
    const action: string = body.action ?? "request_upgrade";

    const userSub = await prisma.subscriptionAndWallet.findUnique({ where: { user_id: userId } });
    if (!userSub) {
      return NextResponse.json(
        { success: false, error: "User subscription not found" },
        { status: 404 }
      );
    }

    if (action === "cancel_upgrade") {
      const pendingTx = await prisma.transactionApprovalQueue.findFirst({
        where: { user_id: userId, admin_status: "PENDING" },
        orderBy: { created_at: "desc" },
      });
      if (pendingTx) {
        await prisma.transactionApprovalQueue.update({
          where: { tx_id: pendingTx.tx_id },
          data: { admin_status: "REJECTED", reviewed_at: new Date() },
        });
      }
      await prisma.subscriptionAndWallet.update({
        where: { user_id: userId },
        data: { purchase_status: "NONE" },
      });
      return NextResponse.json({
        success: true,
        message: "Pending request was cancelled.",
        purchase_status: "NONE",
      });
    }

    // Token top-up: queued for admin approval until the payment gateway is connected.
    // Tokens are NEVER credited here; only an admin approval (or a verified payment webhook) credits them.
    if (action === "topup_tokens") {
      const pack = TOPUP_PACKS[String(body.pack)] ?? null;
      if (!pack) {
        return NextResponse.json(
          { success: false, error: "Choose a valid top-up pack: small, medium or large." },
          { status: 400 }
        );
      }
      const tx = await prisma.transactionApprovalQueue.create({
        data: {
          user_id: userId,
          requested_plan: `Token Top-Up (+${pack.tokens / 1000}k tokens)`,
          amount: pack.amount,
          admin_status: "PENDING",
        },
      });
      return NextResponse.json({
        success: true,
        message: "Top-up request submitted. Tokens are credited once payment is confirmed.",
        transaction: tx,
      });
    }

    // Plan upgrade request. The plan and its price come from the database, never from the client.
    const planId: string | undefined = typeof body.planId === "string" ? body.planId : undefined;
    const planName: string | undefined = typeof body.planName === "string" ? body.planName : undefined;
    if (!planId && !planName) {
      return NextResponse.json(
        { success: false, error: "Target planId or planName is required" },
        { status: 400 }
      );
    }

    const plan = planId
      ? await prisma.pricingPlan.findUnique({ where: { plan_id: planId } })
      : await prisma.pricingPlan.findUnique({ where: { name: planName! } });
    if (!plan || !plan.is_public) {
      return NextResponse.json({ success: false, error: "Unknown plan." }, { status: 404 });
    }
    if (plan.plan_id === userSub.plan_id) {
      return NextResponse.json(
        { success: false, error: "You are already on this plan." },
        { status: 400 }
      );
    }

    const existingPending = await prisma.transactionApprovalQueue.findFirst({
      where: { user_id: userId, admin_status: "PENDING" },
    });
    if (existingPending) {
      return NextResponse.json(
        { success: false, error: "You already have a pending request. Cancel it first." },
        { status: 409 }
      );
    }

    const newTx = await prisma.transactionApprovalQueue.create({
      data: {
        user_id: userId,
        requested_plan: plan.name,
        amount: plan.price,
        admin_status: "PENDING",
      },
    });
    const updatedSub = await prisma.subscriptionAndWallet.update({
      where: { user_id: userId },
      data: { purchase_status: "PENDING" },
    });

    return NextResponse.json({
      success: true,
      message: `Upgrade request for ${plan.name} ($${plan.price.toFixed(2)}) submitted for approval.`,
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
    console.error("Failed to process billing request:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process request" },
      { status: 500 }
    );
  }
}
