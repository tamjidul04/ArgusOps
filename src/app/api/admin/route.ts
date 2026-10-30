import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // 1. Fetch all transactions in the approval queue joined with User and Subscription
    const transactions = await prisma.transactionApprovalQueue.findMany({
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

    // 2. Fetch all pricing plans
    const plans = await prisma.pricingPlan.findMany({
      orderBy: { price: "asc" },
    });

    // 3. Fetch all users joined with their subscription and active plan
    const users = await prisma.user.findMany({
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    // 4. Calculate summary stats
    const pendingCount = transactions.filter(
      (t) => t.admin_status === "PENDING"
    ).length;
    const activeUsersCount = users.filter((u) => u.status === "ACTIVE").length;
    const bannedUsersCount = users.filter((u) => u.status === "BANNED").length;

    return NextResponse.json({
      success: true,
      approvalQueue: transactions.map((t) => ({
        tx_id: t.tx_id,
        user_id: t.user_id,
        user_email: t.user?.email || "unknown@user.com",
        user_name: t.user?.name || "Workspace User",
        requested_plan: t.requested_plan,
        amount: t.amount,
        admin_status: t.admin_status,
        created_at: t.created_at.toISOString(),
        reviewed_at: t.reviewed_at?.toISOString() || null,
        current_plan: t.user?.subscription?.plan?.name || "Free Tier",
        current_max_agents: t.user?.subscription?.max_agents || 3,
      })),
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
      users: users.map((u) => ({
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
      })),
      stats: {
        pendingApprovals: pendingCount,
        totalUsers: users.length,
        activeUsers: activeUsersCount,
        bannedUsers: bannedUsersCount,
        totalPlans: plans.length,
      },
    });
  } catch (error) {
    if ((error as any)?.digest?.startsWith("NEXT_")) {
      throw error;
    }
    console.error("Admin API GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load admin data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // -------------------------------------------------------------
    // 1. APPROVE UPGRADE / PURCHASE (Section 4.6.2)
    // -------------------------------------------------------------
    if (action === "approve_upgrade") {
      const { txId } = body;
      if (!txId) {
        return NextResponse.json(
          { success: false, error: "Missing txId" },
          { status: 400 }
        );
      }

      const tx = await prisma.transactionApprovalQueue.findUnique({
        where: { tx_id: txId },
        include: { user: true },
      });

      if (!tx) {
        return NextResponse.json(
          { success: false, error: "Transaction not found" },
          { status: 404 }
        );
      }

      // Determine the target plan
      const allPlans = await prisma.pricingPlan.findMany();
      let matchedPlan = allPlans.find(
        (p) =>
          tx.requested_plan.toLowerCase().includes(p.name.toLowerCase()) ||
          p.name.toLowerCase().includes(tx.requested_plan.toLowerCase())
      );

      // Fallback matching
      if (!matchedPlan) {
        if (tx.requested_plan.toLowerCase().includes("enterprise")) {
          matchedPlan = allPlans.find((p) => p.plan_id === "plan_enterprise");
        } else if (
          tx.requested_plan.toLowerCase().includes("pro") ||
          tx.requested_plan.toLowerCase().includes("swarm")
        ) {
          matchedPlan = allPlans.find((p) => p.plan_id === "plan_pro");
        } else {
          matchedPlan = allPlans[1] || allPlans[0];
        }
      }

      const planId = matchedPlan?.plan_id || "plan_pro";
      const agentLimit = matchedPlan?.agent_limit || 25;
      const tokensToAdd = matchedPlan?.included_tokens || 1500000;

      // 1. Update TransactionApprovalQueue
      const updatedTx = await prisma.transactionApprovalQueue.update({
        where: { tx_id: txId },
        data: {
          admin_status: "APPROVED",
          reviewed_at: new Date(),
        },
      });

      // 2. Update SubscriptionAndWallet
      const updatedSub = await prisma.subscriptionAndWallet.upsert({
        where: { user_id: tx.user_id },
        update: {
          plan_id: planId,
          max_agents: agentLimit,
          paid_tokens: {
            increment: tokensToAdd,
          },
          purchase_status: "APPROVED",
        },
        create: {
          user_id: tx.user_id,
          plan_id: planId,
          max_agents: agentLimit,
          free_tokens: 50000,
          paid_tokens: tokensToAdd,
          purchase_status: "APPROVED",
        },
        include: { plan: true },
      });

      return NextResponse.json({
        success: true,
        message: `Approved transaction ${txId}. Upgraded ${tx.user?.email || tx.user_id} to ${matchedPlan?.name} (${agentLimit} agents, +${tokensToAdd.toLocaleString()} tokens).`,
        transaction: updatedTx,
        subscription: updatedSub,
      });
    }

    // -------------------------------------------------------------
    // 2. REJECT UPGRADE / PURCHASE (Section 4.6.2)
    // -------------------------------------------------------------
    if (action === "reject_upgrade") {
      const { txId } = body;
      if (!txId) {
        return NextResponse.json(
          { success: false, error: "Missing txId" },
          { status: 400 }
        );
      }

      const tx = await prisma.transactionApprovalQueue.findUnique({
        where: { tx_id: txId },
      });

      if (!tx) {
        return NextResponse.json(
          { success: false, error: "Transaction not found" },
          { status: 404 }
        );
      }

      const updatedTx = await prisma.transactionApprovalQueue.update({
        where: { tx_id: txId },
        data: {
          admin_status: "REJECTED",
          reviewed_at: new Date(),
        },
      });

      await prisma.subscriptionAndWallet.updateMany({
        where: { user_id: tx.user_id },
        data: {
          purchase_status: "REJECTED",
        },
      });

      return NextResponse.json({
        success: true,
        message: `Rejected transaction ${txId}.`,
        transaction: updatedTx,
      });
    }

    // -------------------------------------------------------------
    // 3. TOGGLE PLAN APPROVAL GATE (Section 4.6.1)
    // -------------------------------------------------------------
    if (action === "toggle_plan_approval") {
      const { planId, requiresApproval } = body;
      if (!planId) {
        return NextResponse.json(
          { success: false, error: "Missing planId" },
          { status: 400 }
        );
      }

      const updatedPlan = await prisma.pricingPlan.update({
        where: { plan_id: planId },
        data: {
          requires_admin_approval: Boolean(requiresApproval),
        },
      });

      return NextResponse.json({
        success: true,
        message: `Updated approval requirement for ${updatedPlan.name} to ${updatedPlan.requires_admin_approval ? "Required" : "Auto-Provisioned"}.`,
        plan: updatedPlan,
      });
    }

    // -------------------------------------------------------------
    // 4. CREATE OR EDIT PRICING PLAN (Section 4.6.1)
    // -------------------------------------------------------------
    if (action === "save_plan") {
      const {
        plan_id,
        name,
        price,
        agent_limit,
        included_tokens,
        is_public = true,
        requires_admin_approval = false,
        description = "",
      } = body;

      if (!name || typeof price !== "number") {
        return NextResponse.json(
          { success: false, error: "Valid name and price are required." },
          { status: 400 }
        );
      }

      let plan;
      if (plan_id) {
        // Edit existing
        plan = await prisma.pricingPlan.update({
          where: { plan_id },
          data: {
            name,
            price: Number(price),
            agent_limit: Number(agent_limit),
            included_tokens: Number(included_tokens),
            is_public: Boolean(is_public),
            requires_admin_approval: Boolean(requires_admin_approval),
            description: description || `ArgusOps ${name} cluster plan`,
          },
        });
      } else {
        // Create new
        const newPlanId = `plan_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now().toString().slice(-4)}`;
        plan = await prisma.pricingPlan.create({
          data: {
            plan_id: newPlanId,
            name,
            price: Number(price),
            agent_limit: Number(agent_limit) || 10,
            included_tokens: Number(included_tokens) || 1000000,
            is_public: Boolean(is_public),
            requires_admin_approval: Boolean(requires_admin_approval),
            description: description || `ArgusOps ${name} cluster plan`,
          },
        });
      }

      return NextResponse.json({
        success: true,
        message: `Plan ${plan.name} saved successfully.`,
        plan,
      });
    }

    // -------------------------------------------------------------
    // 5. BAN / UNBAN USER ACCESS (Section 4.6.3)
    // -------------------------------------------------------------
    if (action === "toggle_user_ban") {
      const { userId, targetStatus } = body;
      if (!userId) {
        return NextResponse.json(
          { success: false, error: "Missing userId" },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }

      const newStatus =
        targetStatus || (user.status === "ACTIVE" ? "BANNED" : "ACTIVE");

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status: newStatus },
      });

      return NextResponse.json({
        success: true,
        message: `User ${updatedUser.email} status set to ${updatedUser.status}.`,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          status: updatedUser.status,
        },
      });
    }

    // -------------------------------------------------------------
    // 6. INJECT TOKENS & OVERRIDE CAPACITY (Section 4.6.3)
    // -------------------------------------------------------------
    if (action === "inject_tokens") {
      const {
        userId,
        freeTokens = 0,
        paidTokens = 0,
        maxAgents,
      } = body;

      if (!userId) {
        return NextResponse.json(
          { success: false, error: "Missing userId" },
          { status: 400 }
        );
      }

      const updateData: any = {};
      if (Number(freeTokens) !== 0) {
        updateData.free_tokens = { increment: Number(freeTokens) };
      }
      if (Number(paidTokens) !== 0) {
        updateData.paid_tokens = { increment: Number(paidTokens) };
      }
      if (maxAgents !== undefined && Number(maxAgents) > 0) {
        updateData.max_agents = Number(maxAgents);
      }

      const updatedSub = await prisma.subscriptionAndWallet.update({
        where: { user_id: userId },
        data: updateData,
        include: { user: true, plan: true },
      });

      return NextResponse.json({
        success: true,
        message: `Successfully credited quota to ${updatedSub.user?.email || userId}.`,
        subscription: {
          free_tokens: updatedSub.free_tokens,
          paid_tokens: updatedSub.paid_tokens,
          max_agents: updatedSub.max_agents,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    if ((error as any)?.digest?.startsWith("NEXT_")) {
      throw error;
    }
    console.error("Admin API POST error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error processing admin action" },
      { status: 500 }
    );
  }
}

