import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password } = body;

    // Validation
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = (name && typeof name === "string" ? name.trim() : "") || trimmedEmail.split("@")[0];

    // Check existing user
    const existingUser = await prisma.user.findUnique({
      where: { email: trimmedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email address already exists. Please sign in." },
        { status: 409 }
      );
    }

    // Ensure Free Tier plan exists
    let freePlan = await prisma.pricingPlan.findFirst({
      where: {
        OR: [{ plan_id: "plan_free" }, { name: "Free Tier" }],
      },
    });

    if (!freePlan) {
      freePlan = await prisma.pricingPlan.create({
        data: {
          plan_id: "plan_free",
          name: "Free Tier",
          price: 0.0,
          agent_limit: 3,
          included_tokens: 50000,
          is_public: true,
          requires_admin_approval: false,
          description:
            "Essential starter plan for individual developers and local agent coordination. Includes 3 concurrent agents and 50,000 free tokens.",
        },
      });
    }

    const passwordHash = hashPassword(password);

    // Atomically create User, Subscription & Wallet, and default Cluster with 3 local agents
    const newUser = await prisma.user.create({
      data: {
        email: trimmedEmail,
        name: trimmedName,
        password_hash: passwordHash,
        role: "USER",
        status: "ACTIVE",
        two_factor_enabled: false,
        subscription: {
          create: {
            plan_id: freePlan.plan_id,
            free_tokens: 50000,
            paid_tokens: 0,
            max_agents: 3,
            purchase_status: "NONE",
          },
        },
        clusters: {
          create: {
            name: `${trimmedName}'s Desktop Bridge`,
            environment: "LOCAL_PC",
            active_agents: 3,
            hibernated_agents: 0,
            cached_context_hash: `sha256:init_${Date.now()}`,
            cache_tokens_saved: 0,
            zero_trust_local: true,
            agents: {
              create: [
                {
                  name: "Antigravity Agent",
                  agent_type: "ANTIGRAVITY",
                  status: "ACTIVE",
                  model_tier: "FRONTIER",
                  ram_usage: 68.4,
                  cpu_usage: 12.5,
                  tokens_used: 0,
                  current_task: "Listening on local IPC bridge 127.0.0.1:41829",
                  locked_file_path: "src/app/page.tsx",
                  loop_score: 0.0,
                },
                {
                  name: "Claude Code Agent",
                  agent_type: "CLAUDE",
                  status: "ACTIVE",
                  model_tier: "FRONTIER",
                  ram_usage: 74.2,
                  cpu_usage: 9.8,
                  tokens_used: 0,
                  current_task: "Watching AST tool stream for syntax errors",
                  locked_file_path: "src/lib/utils.ts",
                  loop_score: 0.0,
                },
                {
                  name: "Hermes Agent",
                  agent_type: "HERMES",
                  status: "ACTIVE",
                  model_tier: "DOWNGRADED_FAST",
                  ram_usage: 42.0,
                  cpu_usage: 4.1,
                  tokens_used: 0,
                  current_task: "Standby for leaf task execution",
                  locked_file_path: null,
                  loop_score: 0.0,
                },
              ],
            },
          },
        },
      },
      include: {
        subscription: true,
        clusters: {
          include: {
            agents: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Free tier provisioned successfully with 50,000 initial tokens.",
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          free_tokens: newUser.subscription?.free_tokens ?? 50000,
          max_agents: newUser.subscription?.max_agents ?? 3,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("User registration error:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while provisioning your account." },
      { status: 500 }
    );
  }
}

