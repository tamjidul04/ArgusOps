"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Check,
  Zap,
  Shield,
  HelpCircle,
  ArrowRight,
  Sparkles,
  Laptop,
  Layers,
  Activity,
  ChevronDown,
} from "lucide-react";
import { cn, formatCurrency, formatTokens } from "@/lib/utils";

export interface PlanData {
  plan_id: string;
  name: string;
  price: number;
  agent_limit: number;
  included_tokens: number;
  is_public: boolean;
  requires_admin_approval: boolean;
  description: string;
}

interface PricingClientProps {
  plans: PlanData[];
}

export function PricingClient({ plans }: PricingClientProps) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const discountMultiplier = billingCycle === "annual" ? 0.8 : 1.0;

  const getFeatures = (planName: string) => {
    switch (planName) {
      case "Free Tier":
        return [
          "Up to 3 concurrent agents",
          "50,000 initial free tokens",
          "Lightweight local PC daemon (<150MB RAM)",
          "Antigravity, Claude Code & Hermes bridge",
          "Basic file-locking mutex",
          "Community Discord support",
        ];
      case "Pro Tier":
        return [
          "Up to 25 concurrent agents",
          "1,500,000 monthly tokens included",
          "24/7 <100ms semantic loop circuit breaker",
          "Hardware-enforced local PC file mutex",
          "Shared AST context & memory caching",
          "Smart leaf model router (save on Haiku/local)",
          "Self-serve & priority admin review",
        ];
      case "Enterprise":
        return [
          "100+ concurrent agent right-sizing",
          "15,000,000 monthly tokens included",
          "Zero-token hibernation state manager",
          "Dedicated hypervisor & cluster analytics",
          "Multi-tenant RBAC & approval queue",
          "Custom API keys, SSO & SLA guarantee (99.98%)",
          "Dedicated FinOps engineer & 24/7 hotline",
        ];
      default:
        return [
          "Full cluster access",
          "Token governance engine",
          "Loop prevention & RAM hypervisor",
        ];
    }
  };

  const faqs = [
    {
      q: "What is Zero-Token Hibernation?",
      a: "When a project task is decomposed, ArgusOps calculates the exact concurrency needed (e.g., 30 of your 100 available agents). The remaining 70 agents are placed into a frozen standby state consuming 0 RAM, 0 CPU, and 0 API tokens until summoned.",
    },
    {
      q: "How does the <100ms Loop Circuit Breaker work?",
      a: "ArgusOps inspects tool calls, stdout, and error streams as they occur. If an agent repeats identical commands or cycles in semantic reasoning loops, our engine detects it via vector similarity and either alerts a human via 'Nudge' or trips an instant kill switch in under 38 milliseconds.",
    },
    {
      q: "Does my source code get sent to ArgusOps cloud servers?",
      a: "No. Our local PC daemon operates on a strict Zero-Trust principle. AST token counters, hashes, and file mutex locks are evaluated entirely on your machine. Your proprietary code never leaves your workstation unless you explicitly enable cloud vector indexing.",
    },
    {
      q: "Why do Pro and Enterprise tiers show 'Requires Admin Approval'?",
      a: "Because massive agent swarms require enterprise token pool allocation and cloud hypervisor provisioning, an ArgusOps administrator verifies workspace capacity to guarantee 99.98% uptime without sudden noisy-neighbor degradation.",
    },
  ];

  return (
    <div className="space-y-16">
      {/* Billing Switcher */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={cn(
              "rounded-md px-4 py-2 text-xs font-semibold transition-all",
              billingCycle === "monthly"
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("annual")}
            className={cn(
              "rounded-md px-4 py-2 text-xs font-semibold transition-all flex items-center gap-1.5",
              billingCycle === "annual"
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <span>Annual Billing</span>
            <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 border border-emerald-200">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
        {plans.map((plan) => {
          const isPopular = plan.name === "Pro Tier";
          const isEnterprise = plan.name === "Enterprise";
          const computedPrice =
            plan.price === 0
              ? 0
              : Math.round(plan.price * discountMultiplier);

          return (
            <div
              key={plan.plan_id}
              className={cn(
                "rounded-2xl border flex flex-col justify-between p-8 transition-all bg-white relative",
                isPopular
                  ? "border-slate-900 shadow-xl ring-2 ring-slate-900"
                  : "border-slate-200 shadow-sm hover:shadow-md"
              )}
            >
              {isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-3.5 py-1 text-xs font-bold text-white uppercase tracking-wider shadow-sm flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-amber-400" />
                  <span>Most Popular</span>
                </div>
              )}

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
                    {plan.requires_admin_approval && (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                        Approval Gate
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed min-h-[36px]">
                    {plan.description}
                  </p>
                </div>

                {/* Price Display */}
                <div className="border-y border-slate-100 py-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                      ${computedPrice}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      / month {billingCycle === "annual" && plan.price > 0 ? "(billed annually)" : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600 font-medium">
                    <span className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-slate-400" />
                      <strong>{plan.agent_limit}</strong> max agents
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                      <strong>{formatTokens(plan.included_tokens)}</strong> tokens
                    </span>
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-900">
                    What&apos;s Included:
                  </p>
                  <ul className="space-y-2.5 text-xs text-slate-600">
                    {getFeatures(plan.name).map((feat, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-8 mt-6 border-t border-slate-100">
                <Link
                  href={
                    plan.name === "Free Tier"
                      ? "/signup"
                      : `/dashboard/billing?plan=${plan.plan_id}`
                  }
                  className={cn(
                    "w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-all active:scale-[0.98]",
                    isPopular
                      ? "bg-slate-900 text-white hover:bg-slate-800 shadow-md"
                      : isEnterprise
                      ? "bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200"
                      : "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <span>
                    {plan.name === "Free Tier"
                      ? "Start Free Forever"
                      : plan.requires_admin_approval
                      ? "Request Tier Access"
                      : "Upgrade to Pro"}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                {plan.requires_admin_approval && (
                  <p className="text-[11px] text-center text-slate-400 mt-2 font-mono">
                    Requires admin review & capacity approval
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Matrix */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h3 className="text-lg font-bold text-slate-900">
          Detailed Capability Breakdown
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3 pr-4">Feature</th>
                <th className="py-3 px-4">Free Tier</th>
                <th className="py-3 px-4">Pro Swarm</th>
                <th className="py-3 pl-4">Enterprise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-600">
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Target Concurrency Limit
                </td>
                <td className="py-3 px-4 font-mono">3 Agents</td>
                <td className="py-3 px-4 font-mono">25 Agents</td>
                <td className="py-3 pl-4 font-mono">100+ Custom</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Zero-Token Hibernation
                </td>
                <td className="py-3 px-4 text-slate-400">Manual Pause</td>
                <td className="py-3 px-4 text-slate-900">Automated (Up to 25)</td>
                <td className="py-3 pl-4 font-semibold text-emerald-700">Dynamic 100-to-30 Cluster</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Loop Interception Speed
                </td>
                <td className="py-3 px-4 font-mono">Standard</td>
                <td className="py-3 px-4 font-mono">&lt; 100ms</td>
                <td className="py-3 pl-4 font-mono font-bold text-emerald-700">&lt; 38ms avg (P99: 8.2ms)</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Local Desktop Daemon
                </td>
                <td className="py-3 px-4 text-emerald-600 font-semibold">&lt; 150MB RAM</td>
                <td className="py-3 px-4 text-emerald-600 font-semibold">&lt; 150MB RAM</td>
                <td className="py-3 pl-4 text-emerald-600 font-semibold">&lt; 150MB RAM</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Local File Mutex Protection
                </td>
                <td className="py-3 px-4 text-emerald-600">Included</td>
                <td className="py-3 px-4 text-emerald-600">Included</td>
                <td className="py-3 pl-4 text-emerald-600">Included (Cluster-wide)</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-semibold text-slate-900">
                  Approval Queue & RBAC
                </td>
                <td className="py-3 px-4 text-slate-400">—</td>
                <td className="py-3 px-4 text-slate-400">—</td>
                <td className="py-3 pl-4 text-emerald-600 font-semibold">Superuser Admin Console</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div className="space-y-6 max-w-4xl mx-auto pt-6">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold text-slate-900">
            Frequently Asked Questions
          </h3>
          <p className="text-xs text-slate-500">
            Everything you need to know about pricing, approvals, and token governance.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => {
            const isOpen = openFaq === i;
            return (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-white transition-all overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-slate-400 transition-transform duration-200",
                      isOpen && "rotate-180 text-slate-900"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

