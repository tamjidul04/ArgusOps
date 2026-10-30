"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Download,
  Check,
  Coins,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
  FileText,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { useDashboard } from "@/components/layout/DashboardContext";
import { cn, formatTokens } from "@/lib/utils";

export interface PricingPlanItem {
  plan_id: string;
  name: string;
  price: number;
  agent_limit: number;
  included_tokens: number;
  is_public: boolean;
  requires_admin_approval: boolean;
  description: string;
}

export interface TransactionItem {
  tx_id: string;
  user_id: string;
  requested_plan: string;
  amount: number;
  admin_status: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface UserSubscriptionData {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  plan_id: string;
  plan_name: string;
  plan_price: number;
  free_tokens: number;
  paid_tokens: number;
  max_agents: number;
  purchase_status: string;
  updated_at: string;
}

interface BillingV2ClientProps {
  initialSubscription: UserSubscriptionData | null;
  initialPlans: PricingPlanItem[];
  initialTransactions: TransactionItem[];
}

export function BillingV2Client({
  initialSubscription,
  initialPlans,
  initialTransactions,
}: BillingV2ClientProps) {
  const { persona, profile } = useDashboard();

  const [subscription, setSubscription] = useState<UserSubscriptionData | null>(
    initialSubscription
  );
  const [plans, setPlans] = useState<PricingPlanItem[]>(initialPlans);
  const [transactions, setTransactions] =
    useState<TransactionItem[]>(initialTransactions);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Top Up Modal state
  const [topupModalOpen, setTopupModalOpen] = useState(false);
  const [selectedTopupAmount, setSelectedTopupAmount] = useState<{
    tokens: number;
    price: number;
    label: string;
  }>({ tokens: 2000000, price: 50, label: "2,000,000 Tokens (+$50)" });

  // History table collapse state
  const [showHistory, setShowHistory] = useState(true);

  // Sync state whenever persona profile changes
  useEffect(() => {
    async function loadUserData() {
      try {
        const res = await fetch(`/api/billing/upgrade?userId=${profile.id}`);
        const data = await res.json();
        if (data.success) {
          if (data.subscription) {
            setSubscription(data.subscription);
          } else {
            setSubscription({
              id: `sub_${profile.id}`,
              user_id: profile.id,
              user_name: profile.name,
              user_email: profile.email,
              plan_id: profile.planName.toLowerCase().includes("free")
                ? "plan_free"
                : "plan_enterprise",
              plan_name: profile.planName,
              plan_price: profile.planName.toLowerCase().includes("free")
                ? 0
                : 299,
              free_tokens: profile.freeTokens,
              paid_tokens: profile.paidTokens,
              max_agents: profile.maxAgents,
              purchase_status:
                profile.status === "PENDING" ? "PENDING" : "APPROVED",
              updated_at: new Date().toISOString(),
            });
          }
          if (data.plans?.length > 0) {
            setPlans(data.plans);
          }
          if (data.transactions) {
            setTransactions(data.transactions);
          }
        }
      } catch (err) {
        console.error("Failed to load user billing data:", err);
      }
    }

    loadUserData();
  }, [profile.id, profile.name, profile.email, profile.planName, profile.freeTokens, profile.paidTokens, profile.maxAgents, profile.status]);

  // Flash toast auto-dismiss
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Handle plan upgrade request
  const handleRequestUpgrade = async (planName: string, amount: number, planId?: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: profile.id,
          planId: planId || (planName.includes("Pro") ? "plan_pro" : "plan_enterprise"),
          planName,
          amount,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message || `Upgrade request for ${planName} submitted successfully!`,
        });

        // Update local state to PENDING
        setSubscription((prev) =>
          prev
            ? {
                ...prev,
                purchase_status: "PENDING",
              }
            : null
        );

        if (data.transaction) {
          setTransactions((prev) => [data.transaction, ...prev]);
        }
      } else {
        setToastMessage({
          type: "error",
          text: data.error || "Failed to submit plan upgrade request.",
        });
      }
    } catch (err) {
      console.error("Upgrade error:", err);
      setToastMessage({
        type: "error",
        text: "Network error submitting plan upgrade.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Token Top-up
  const handleTopupTokens = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: profile.id,
          action: "topup_tokens",
          tokenCount: selectedTopupAmount.tokens,
          amount: selectedTopupAmount.price,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message,
        });
        setSubscription((prev) =>
          prev ? { ...prev, paid_tokens: data.paid_tokens } : null
        );
        if (data.transaction) {
          setTransactions((prev) => [data.transaction, ...prev]);
        }
        setTopupModalOpen(false);
      }
    } catch (err) {
      console.error("Topup error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Determine current active plan
  const currentPlanName = subscription?.plan_name || profile.planName || "Free Tier";
  const isFreePlan = currentPlanName.toLowerCase().includes("free");
  const isPro = currentPlanName.toLowerCase().includes("pro");
  const isEnterprise = currentPlanName.toLowerCase().includes("enterprise");
  const purchaseStatus = (subscription?.purchase_status || "NONE").toUpperCase();
  const isPendingApproval = purchaseStatus === "PENDING";

  // Free token balance calculation
  const freeTokensCurrent = subscription?.free_tokens ?? 84520;
  const freeTokensMax = isFreePlan ? 100000 : 50000;
  const freePercentage = Math.min(
    100,
    parseFloat(((freeTokensCurrent / freeTokensMax) * 100).toFixed(1))
  );

  const paidTokensCurrent = subscription?.paid_tokens ?? profile.paidTokens ?? 0;

  // Last transaction amount
  const lastInvoiceAmount = transactions[0]?.amount
    ? `$${transactions[0].amount.toFixed(2)}`
    : "$0.00";

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium transition-all animate-in fade-in slide-in-from-bottom-2",
            toastMessage.type === "success" &&
              "bg-emerald-50 border-emerald-200 text-emerald-800",
            toastMessage.type === "error" &&
              "bg-rose-50 border-rose-200 text-rose-800",
            toastMessage.type === "info" &&
              "bg-slate-900 border-slate-800 text-white"
          )}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
          {toastMessage.type === "error" && <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />}
          {toastMessage.type === "info" && <Coins className="w-5 h-5 text-amber-400 shrink-0" />}
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 hover:opacity-75 text-inherit"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Row matching 06-billing-v2.png */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Billing, Token Wallet &amp; Plan Quota
          </h1>
        </div>

        <div>
          <a
            href={`/api/billing/invoice?userId=${profile.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 shadow-xs transition-colors"
          >
            <FileText className="w-4 h-4 text-slate-500" />
            Download Invoices (PDF)
          </a>
        </div>
      </div>

      {/* Main 2-Column Grid Geometry matching 06-billing-v2.png */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ==================== LEFT COLUMN ==================== */}
        <div className="space-y-6">
          {/* 1. Free Token Allowance Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">
                Free Token Allowance
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                Auto-Reset
              </span>
            </div>

            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
              {freeTokensCurrent.toLocaleString()} / {freeTokensMax.toLocaleString()}
            </div>

            {/* Thick black progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2 mt-4 overflow-hidden">
              <div
                className="bg-slate-900 h-2 rounded-full transition-all duration-500"
                style={{ width: `${freePercentage}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
              <span>{freePercentage}% remaining</span>
              <span>resets in 18 days</span>
            </div>
          </div>

          {/* 2. Middle Row: Paid Token Balance + Upgrade Approval Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Paid Token Balance */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-medium text-slate-500 block mb-1">
                  Paid Token Balance
                </span>
                <div className="text-2xl font-bold text-slate-900 font-mono">
                  {paidTokensCurrent.toLocaleString()}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Unmetered pay-as-you-go
                </p>
              </div>

              <div className="mt-4 pt-2">
                <button
                  onClick={() => setTopupModalOpen(true)}
                  className="w-full py-2 px-3 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors text-center"
                >
                  + Top Up
                </button>
              </div>
            </div>

            {/* Upgrade Approval Status */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-medium text-slate-500 block mb-1">
                  Upgrade Approval Status
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0",
                      isPendingApproval
                        ? "bg-amber-500 animate-pulse"
                        : purchaseStatus === "APPROVED"
                        ? "bg-emerald-500"
                        : "bg-slate-700"
                    )}
                  />
                  <span className="text-sm font-bold text-slate-900">
                    {isPendingApproval ? "Pending Approval" : purchaseStatus === "APPROVED" ? "Approved" : "Standard Quota"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {isPendingApproval
                    ? "Pro Swarm ($49/mo) queued"
                    : `${currentPlanName} active`}
                </p>
              </div>

              <div className="mt-4 pt-2">
                <div className="w-full py-2 px-3 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg text-center select-none">
                  {isPendingApproval ? "Admin Review Active" : "No Review Required"}
                </div>
              </div>
            </div>
          </div>

          {/* 3. Free Tier — $0 Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-900">
                  Free Tier — $0
                </h3>
                {isFreePlan && (
                  <span className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    Current Plan
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Core local agent experimentation
              </p>
              <div className="text-xs font-semibold text-slate-800 mt-2">
                Continue
              </div>

              <ul className="space-y-2.5 text-xs text-slate-600 mt-4">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>Up to 3 concurrent agents</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>100,000 free initial tokens</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>24/7 loop circuit-breaker</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>Local PC daemon included</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-2">
              <button
                disabled
                className="w-full py-2.5 px-4 text-center rounded-lg text-xs font-semibold bg-slate-100 text-slate-400 border border-slate-200 cursor-default"
              >
                Current Plan
              </button>
            </div>
          </div>
        </div>

        {/* ==================== RIGHT COLUMN ==================== */}
        <div className="space-y-6">
          {/* 1. Pro Swarm — $49/mo (Prominent 2px Black Border) */}
          <div className="bg-white border-2 border-slate-900 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900">
                    Pro Swarm — $49/mo
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-slate-900 text-white tracking-wider">
                    POPULAR
                  </span>
                </div>
                <span className="text-xs text-slate-500">Billed monthly</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Autonomous multi-agent swarms
              </p>

              {/* 2-Column feature checklist matching 06-billing-v2.png */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 my-5 text-xs text-slate-700 font-medium">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-900 shrink-0 font-bold" />
                  <span>Up to 25 concurrent agents</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-900 shrink-0 font-bold" />
                  <span>2,000,000 monthly tokens</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-900 shrink-0 font-bold" />
                  <span>File-locking mutex for PC agents</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-slate-900 shrink-0 font-bold" />
                  <span>Semantic vector loop detection</span>
                </div>
              </div>
            </div>

            <div className="mt-2 pt-2">
              {isPro ? (
                <button
                  disabled
                  className="w-full py-3 px-4 text-center rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200 cursor-default"
                >
                  Current Plan
                </button>
              ) : isPendingApproval ? (
                <button
                  disabled
                  className="w-full py-3 px-4 text-center rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed"
                >
                  Upgrade Request Queued (Pending Approval)
                </button>
              ) : (
                <button
                  onClick={() => handleRequestUpgrade("Pro Tier", 49.0, "plan_pro")}
                  disabled={submitting}
                  className="w-full py-3 px-4 text-center rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                >
                  {submitting ? "Submitting..." : "Upgrade via Stripe / PayPal"}
                </button>
              )}
            </div>
          </div>

          {/* 2. Bottom Row: Enterprise — Custom + Ledger Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Enterprise — Custom */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Enterprise — Custom
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  High-density distributed infra
                </p>

                <ul className="space-y-2 text-xs text-slate-600 mt-4">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                    <span>100+ agents (dynamic scaling)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                    <span>Custom token budget enforcement</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                    <span>Dedicated 99.9% uptime SLA</span>
                  </li>
                </ul>
              </div>

              <div className="mt-5 pt-2">
                {isEnterprise ? (
                  <button
                    disabled
                    className="w-full py-2.5 px-3 text-center rounded-lg text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200 cursor-default"
                  >
                    Current Plan
                  </button>
                ) : isPendingApproval ? (
                  <button
                    disabled
                    className="w-full py-2.5 px-3 text-center rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed"
                  >
                    Pending Review
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      handleRequestUpgrade("Enterprise", 299.0, "plan_enterprise")
                    }
                    disabled={submitting}
                    className="w-full py-2.5 px-3 text-center rounded-lg text-xs font-semibold bg-white border border-slate-900 text-slate-900 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs"
                  >
                    {submitting ? "Submitting..." : "Request Admin Approval"}
                  </button>
                )}
              </div>
            </div>

            {/* Ledger Stats */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-900">
                    Ledger Stats
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                    ACTIVE
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Saved via Hibernation</span>
                    <span className="font-mono font-bold text-slate-900">$18.73</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Last Invoice</span>
                    <span className="font-mono font-bold text-slate-900">
                      {lastInvoiceAmount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Payment Gateways</span>
                    <span className="font-semibold text-slate-900">
                      Stripe / PayPal
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-2">
                <div className="w-full py-1.5 px-2 bg-slate-50 border border-slate-200 text-[11px] text-slate-500 rounded-md font-mono text-center select-none">
                  PCI-DSS Level 1 Compliant
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice & Transaction Approval Queue History Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden mt-8">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Billing Ledger &amp; Transaction Approval History
            </h2>
            <p className="text-xs text-slate-500">
              Audited transaction queue for plan upgrades, token allocations, and enterprise receipts.
            </p>
          </div>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            {showHistory ? "Hide Records" : "Show Records"}
          </button>
        </div>

        {showHistory && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="py-3 px-6">Transaction ID</th>
                  <th className="py-3 px-6">Requested Tier / Item</th>
                  <th className="py-3 px-6">Amount</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6">Date Requested</th>
                  <th className="py-3 px-6 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-400">
                      No billing records found in workspace ledger.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.tx_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-6 font-mono text-slate-900 font-semibold">
                        {tx.tx_id.startsWith("tx_") ? tx.tx_id : `INV-${tx.tx_id}`}
                      </td>
                      <td className="py-3.5 px-6 text-slate-900">
                        <div className="font-semibold">{tx.requested_plan}</div>
                      </td>
                      <td className="py-3.5 px-6 font-mono font-semibold text-slate-900">
                        ${tx.amount.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-6">
                        {tx.admin_status === "APPROVED" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Check className="w-3 h-3" /> Approved
                          </span>
                        ) : tx.admin_status === "PENDING" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" /> Pending Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            <X className="w-3 h-3" /> Declined
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-slate-500">
                        {new Date(tx.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <a
                          href={`/api/billing/invoice?txId=${tx.tx_id}&userId=${profile.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-semibold text-[11px] px-2.5 py-1 rounded border border-slate-200 hover:bg-white bg-slate-50 shadow-2xs"
                        >
                          <Download className="w-3 h-3 text-slate-500" />
                          PDF
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Token Top-Up Modal */}
      {topupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Instant Token Top-Up
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tokens never expire and remain valid across all local and cloud cluster swarms.
                </p>
              </div>
              <button
                onClick={() => setTopupModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {[
                { tokens: 500000, price: 15, label: "500,000 Tokens (+$15)" },
                { tokens: 2000000, price: 50, label: "2,000,000 Tokens (+$50) — Popular" },
                { tokens: 10000000, price: 200, label: "10,000,000 Tokens (+$200) — Best Value" },
              ].map((pack) => (
                <button
                  key={pack.tokens}
                  type="button"
                  onClick={() => setSelectedTopupAmount(pack)}
                  className={cn(
                    "w-full flex items-center justify-between p-3.5 rounded-lg border text-left text-xs font-medium transition-all",
                    selectedTopupAmount.tokens === pack.tokens
                      ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900 font-semibold text-slate-900"
                      : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Coins className="w-4 h-4 text-amber-500" />
                    <span>{pack.label}</span>
                  </div>
                  <span className="font-mono font-bold text-slate-900">${pack.price}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTopupModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleTopupTokens}
                className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
              >
                {submitting ? "Purchasing..." : `Purchase ${selectedTopupAmount.tokens.toLocaleString()} Tokens`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Footer Info Strip matching 06-billing-v2.png */}
      <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <span>Cluster ID: <span className="font-mono text-slate-700">us-east-cluster-09</span></span>
          <span>&bull;</span>
          <span>Daemon: <span className="text-slate-700">v1.4.0 (Zero-Trust Local Code)</span></span>
        </div>
        <div>
          <span>Owner: <strong className="text-slate-800">{profile.name}</strong></span>
        </div>
      </div>
    </div>
  );
}

