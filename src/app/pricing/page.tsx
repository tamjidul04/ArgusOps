import React, { Suspense } from "react";
import { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Container, PageHeader } from "@/components/ui";
import { CtaBand } from "@/components/marketing/CtaBand";
import { PricingClient, PlanData } from "./PricingClient";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free for two agents, Pro for ten. Pay for supervision; your model provider bills you for tokens.",
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
        name: "Free",
        price: 0,
        agent_limit: 2,
        included_tokens: 250_000,
        is_public: true,
        requires_admin_approval: false,
        description: "Supervise up to 2 concurrent coding agents with loop detection, auto-pause and prompt-rewrite suggestions.",
      },
      {
        plan_id: "plan_pro",
        name: "Pro",
        price: 29,
        agent_limit: 10,
        included_tokens: 1_250_000,
        is_public: true,
        requires_admin_approval: false,
        description: "5x the Free limits: 10 concurrent agents and more metered tokens, with priority support.",
      },
      {
        plan_id: "plan_enterprise",
        name: "Enterprise",
        price: 299,
        agent_limit: 50,
        included_tokens: 15_000_000,
        is_public: true,
        requires_admin_approval: true,
        description: "Custom limits and a dedicated support channel. Final terms are agreed per contract.",
      },
    ];
  }

  return <PricingClient plans={plans} />;
}

export default function PricingPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Pricing"
        title="Pay for supervision, not for tokens."
        lead="Your model provider bills you for tokens. ArgusOps charges for how many agents it watches at once. Start free."
      />
      <Container className="py-20 md:py-28">
        <Suspense fallback={<p className="py-16 text-center text-sm text-slate-500">Loading plans…</p>}>
          <PricingPlansSection />
        </Suspense>
      </Container>
      <CtaBand />
    </PublicShell>
  );
}
