import React, { Suspense } from "react";
import { Metadata } from "next";
import { PublicNavbar, PublicFooter } from "@/components/layout";
import { PricingClient, PlanData } from "./PricingClient";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Pricing & Plans | ArgusOps v1.1",
  description:
    "Predictable, cost-saving pricing for AI agent cluster management. Compare Free Tier, Pro Swarm, and Enterprise hypervisor solutions.",
};

async function PricingPlansSection() {
  let plans: PlanData[] = [];

  try {
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
  } catch (error) {
    console.error("Error fetching pricing plans:", error);
    plans = [
      {
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
      {
        plan_id: "plan_pro",
        name: "Pro Tier",
        price: 49.0,
        agent_limit: 25,
        included_tokens: 1500000,
        is_public: true,
        requires_admin_approval: true,
        description:
          "Designed for power developers and small teams running distributed agent swarms with advanced loop circuit-breakers and shared memory cache.",
      },
      {
        plan_id: "plan_enterprise",
        name: "Enterprise",
        price: 299.0,
        agent_limit: 100,
        included_tokens: 15000000,
        is_public: true,
        requires_admin_approval: true,
        description:
          "Full-scale agentic hypervisor and cost governance cluster for enterprise cloud swarms with dedicated SLA, 24/7 loop prevention, and unlimited workspaces.",
      },
    ];
  }

  return <PricingClient plans={plans} />;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicNavbar />

      <main className="flex-1 py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-12">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 shadow-xs">
            <span>Transparent FinOps Pricing</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            Simple plans for rogue-free agent swarms
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Start completely free on your local PC or scale to an enterprise cloud cluster.
            All tiers include our &lt;100ms loop circuit breaker and Zero-Trust isolation.
          </p>
        </div>

        {/* Dynamic Interactive Pricing Grid with Suspense */}
        <Suspense
          fallback={
            <div className="text-center py-16 text-slate-400 font-mono text-xs flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-ping" />
              <span>Loading live pricing plans...</span>
            </div>
          }
        >
          <PricingPlansSection />
        </Suspense>
      </main>

      <PublicFooter />
    </div>
  );
}
