import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { hashPassword } from "../src/lib/auth-core";

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === "production";
const reset = process.argv.includes("--reset");

/**
 * Plan limits (see .gsd/SPEC.md): Free = 2 concurrent agents, Pro = 5x (10 agents, 5x tokens),
 * Enterprise = custom (placeholder values, negotiated per contract).
 */
const PLANS = [
  {
    plan_id: "plan_free",
    name: "Free",
    price: 0,
    agent_limit: 2,
    included_tokens: 250_000,
    requires_admin_approval: false,
    description:
      "Supervise up to 2 concurrent coding agents with loop detection, auto-pause and prompt-rewrite suggestions. 250K metered tokens per month.",
  },
  {
    plan_id: "plan_pro",
    name: "Pro",
    price: 29,
    agent_limit: 10,
    included_tokens: 1_250_000,
    requires_admin_approval: false,
    description:
      "5x the Free limits: 10 concurrent agents and 1.25M metered tokens per month, auto-applied rewrites, webhooks and priority support.",
  },
  {
    plan_id: "plan_enterprise",
    name: "Enterprise",
    price: 299,
    agent_limit: 50,
    included_tokens: 15_000_000,
    requires_admin_approval: true,
    description:
      "Custom limits, SSO, audit export and a dedicated support channel. Starting point shown here; final limits are agreed per contract.",
  },
];

/**
 * USD per million tokens. Matched by longest model-name prefix (see src/lib/pricing.ts).
 * These are list-price estimates for cost accounting; admins can edit them in the database.
 */
const PRICES = [
  { model: "claude-opus", provider: "anthropic", input_per_mtok: 15, output_per_mtok: 75 },
  { model: "claude-sonnet", provider: "anthropic", input_per_mtok: 3, output_per_mtok: 15 },
  { model: "claude-haiku", provider: "anthropic", input_per_mtok: 0.8, output_per_mtok: 4 },
  { model: "gpt-5", provider: "openai", input_per_mtok: 1.25, output_per_mtok: 10 },
  { model: "gpt-4o-mini", provider: "openai", input_per_mtok: 0.15, output_per_mtok: 0.6 },
  { model: "gpt-4o", provider: "openai", input_per_mtok: 2.5, output_per_mtok: 10 },
  { model: "o3", provider: "openai", input_per_mtok: 2, output_per_mtok: 8 },
  { model: "gemini-2.5-pro", provider: "google", input_per_mtok: 1.25, output_per_mtok: 10 },
  { model: "gemini-2.5-flash", provider: "google", input_per_mtok: 0.3, output_per_mtok: 2.5 },
];

function secret(envName: string, fallbackDev: string): string {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  if (isProd) {
    const generated = crypto.randomBytes(12).toString("base64url") + "9";
    console.log(`   ${envName} not set, generated one-time password: ${generated}`);
    return generated;
  }
  return fallbackDev;
}

async function main() {
  if (reset) {
    if (isProd) throw new Error("Refusing --reset in production.");
    console.log("Clearing existing records...");
    await prisma.promptRewrite.deleteMany();
    await prisma.incident.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.notificationChannel.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.fileLock.deleteMany();
    await prisma.cliDevice.deleteMany();
    await prisma.session.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.taskAndLog.deleteMany();
    await prisma.transactionApprovalQueue.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.clusterAndWorkspace.deleteMany();
    await prisma.subscriptionAndWallet.deleteMany();
    await prisma.user.deleteMany();
    await prisma.pricingPlan.deleteMany();
  }

  console.log("Seeding plans...");
  for (const p of PLANS) {
    await prisma.pricingPlan.upsert({
      where: { plan_id: p.plan_id },
      update: { ...p, is_public: true },
      create: { ...p, is_public: true },
    });
  }

  console.log("Seeding model prices...");
  for (const p of PRICES) {
    await prisma.modelPrice.upsert({ where: { model: p.model }, update: p, create: p });
  }

  console.log("Seeding accounts...");
  const adminPw = secret("SEED_ADMIN_PASSWORD", "ArgusOps-admin-2026");
  await upsertUser("admin@argusops.dev", "ArgusOps Admin", adminPw, "ADMIN", "plan_enterprise", 50_000_000);

  if (!isProd) {
    const demoPw = secret("SEED_DEMO_PASSWORD", "ArgusOps-demo-2026");
    await upsertUser("demo@argusops.dev", "Demo Developer", demoPw, "USER", "plan_free", 250_000);
    console.log("\nDev logins (local only):");
    console.log(`  admin@argusops.dev / ${adminPw}`);
    console.log(`  demo@argusops.dev  / ${demoPw}`);
  }

  console.log("\nSeed completed.");
}

async function upsertUser(
  email: string,
  name: string,
  password: string,
  role: "USER" | "ADMIN",
  planId: string,
  tokens: number
) {
  const plan = await prisma.pricingPlan.findUniqueOrThrow({ where: { plan_id: planId } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { password_hash: hashPassword(password), role, name },
    });
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      name,
      password_hash: hashPassword(password),
      role,
      status: "ACTIVE",
      subscription: {
        create: {
          plan_id: plan.plan_id,
          free_tokens: tokens,
          paid_tokens: 0,
          max_agents: plan.agent_limit,
          purchase_status: "NONE",
        },
      },
      policy: { create: {} },
      clusters: {
        create: { name: `${name}'s Workspace`, environment: "LOCAL_PC", zero_trust_local: true },
      },
    },
  });
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
