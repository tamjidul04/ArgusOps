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
import { Badge, DashHeader, EmptyState, Panel, buttonClasses } from "@/components/ui";

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
  const { profile } = useDashboard();

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
        const res = await fetch("/api/billing/upgrade", { cache: "no-store" });
        const data = await res.json();
        if (data.success) {
          if (data.subscription) {
            setSubscription(data.subscription);
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
  }, [profile.id]);

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
          action: "topup_tokens",
          pack:
            selectedTopupAmount.tokens >= 10000000
              ? "large"
              : selectedTopupAmount.tokens >= 2000000
                ? "medium"
                : "small",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message,
        });
        if (data.transaction) {
          setTransactions((prev) => [data.transaction, ...prev]);
        }
        setTopupModalOpen(false);
      } else {
        setToastMessage({ type: "error", text: data.error || "Top-up request failed." });
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
          role="status"
          className={cn(
            "fixed bottom-6 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lift ring-1 sm:right-6",
            toastMessage.type === "success" && "bg-emerald-50 text-emerald-900 ring-emerald-600/20",
            toastMessage.type === "error" && "bg-red-50 text-red-900 ring-red-600/20",
            toastMessage.type === "info" && "on-dark bg-slate-900 text-white ring-slate-900"
          )}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />}
          {toastMessage.type === "error" && <AlertCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />}
          {toastMessage.type === "info" && <Coins className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} aria-label="Dismiss message" className="ml-1 rounded-md p-1 text-inherit hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DashHeader
        title="Billing, Token Wallet & Plan Quota"
        actions={
          <a href={"/api/billing/invoice"} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", false)}>
            <FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Download Invoices (PDF)
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ==================== LEFT COLUMN ==================== */}
        <div className="space-y-6">
          <Panel title="Free Token Allowance" action={<Badge>Auto-Reset</Badge>}>
            <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-slate-900 sm:text-2xl">
              {freeTokensCurrent.toLocaleString("en-US")} / {freeTokensMax.toLocaleString("en-US")}
            </div>
            <div
              className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
              role="meter"
              aria-label="Free tokens remaining"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={freePercentage}
            >
              <div className="h-full rounded-full bg-slate-900 transition-[width] duration-200 ease-spring" style={{ width: `${freePercentage}%` }} />
            </div>
            <div className="mt-2.5 flex items-center justify-between text-sm text-slate-600">
              <span>{freePercentage}% remaining</span>
              <span>resets in 18 days</span>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel bodyClassName="flex flex-col justify-between gap-5">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Paid Token Balance</span>
                <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-slate-900">{paidTokensCurrent.toLocaleString("en-US")}</div>
                <p className="mt-1 text-sm text-slate-600">Unmetered pay-as-you-go</p>
              </div>
              <button onClick={() => setTopupModalOpen(true)} className={buttonClasses("secondary", false, "w-full")}>
                + Top Up
              </button>
            </Panel>

            <Panel bodyClassName="flex flex-col justify-between gap-5">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Upgrade Approval Status</span>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      isPendingApproval ? "animate-pulse bg-amber-500" : purchaseStatus === "APPROVED" ? "bg-emerald-500" : "bg-slate-700"
                    )}
                  />
                  <span className="text-base font-semibold text-slate-900">
                    {isPendingApproval ? "Pending Approval" : purchaseStatus === "APPROVED" ? "Approved" : "Standard Quota"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{isPendingApproval ? "Pro Swarm ($49/mo) queued" : `${currentPlanName} active`}</p>
              </div>
              <div className="select-none rounded-md bg-slate-50 px-4 py-2.5 text-center text-xs font-medium text-slate-600 border border-slate-200">
                {isPendingApproval ? "Admin Review Active" : "No Review Required"}
              </div>
            </Panel>
          </div>

          <Panel
            title="Free Tier — $0"
            description="Core local agent experimentation"
            action={isFreePlan ? <Badge>Current Plan</Badge> : undefined}
            bodyClassName="flex flex-col gap-6"
          >
            <div className="text-sm font-semibold text-slate-900">Continue</div>
            <ul className="space-y-3 text-sm text-slate-700">
              {["Up to 3 concurrent agents", "100,000 free initial tokens", "24/7 loop circuit-breaker", "Local PC daemon included"].map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button disabled className={buttonClasses("secondary", false, "w-full cursor-default opacity-70")}>
              Current Plan
            </button>
          </Panel>
        </div>

        {/* ==================== RIGHT COLUMN ==================== */}
        <div className="space-y-6">
          <div className="on-dark rounded-lg bg-slate-950 p-6 text-white shadow-lift ring-1 ring-slate-900 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold tracking-tight">Pro Swarm — $49/mo</h3>
                <span className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10">POPULAR</span>
              </div>
              <span className="text-sm text-slate-400">Billed monthly</span>
            </div>
            <p className="mt-1 text-sm text-slate-300">Autonomous multi-agent swarms</p>

            <div className="my-6 grid grid-cols-1 gap-x-4 gap-y-3 text-sm text-slate-200 sm:grid-cols-2">
              {["Up to 25 concurrent agents", "2,000,000 monthly tokens", "File-locking mutex for PC agents", "Semantic vector loop detection"].map((f) => (
                <div key={f} className="flex items-center gap-3">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {isPro ? (
              <button disabled className="w-full cursor-default rounded-md bg-white/10 px-4 py-3 text-center text-sm font-semibold text-slate-300 ring-1 ring-white/10">
                Current Plan
              </button>
            ) : isPendingApproval ? (
              <button disabled className="w-full cursor-not-allowed rounded-md bg-amber-400/10 px-4 py-3 text-center text-sm font-semibold text-amber-300 ring-1 ring-amber-400/20">
                Upgrade Request Queued (Pending Approval)
              </button>
            ) : (
              <button
                onClick={() => handleRequestUpgrade("Pro Tier", 49.0, "plan_pro")}
                disabled={submitting}
                className={buttonClasses("inverse", false, "w-full py-3 disabled:opacity-60")}
              >
                {submitting ? "Submitting..." : "Upgrade via Stripe / PayPal"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Enterprise — Custom" description="High-density distributed infra" bodyClassName="flex flex-col justify-between gap-5">
              <ul className="space-y-2.5 text-sm text-slate-700">
                {["100+ agents (dynamic scaling)", "Custom token budget enforcement", "Dedicated 99.9% uptime SLA"].map((f) => (
                  <li key={f} className="flex items-center gap-3">
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {isEnterprise ? (
                <button disabled className={buttonClasses("secondary", false, "w-full cursor-default opacity-70")}>
                  Current Plan
                </button>
              ) : isPendingApproval ? (
                <button disabled className="w-full cursor-not-allowed rounded-md bg-amber-50 px-4 py-2.5 text-center text-sm font-semibold text-amber-800 ring-1 ring-amber-600/25">
                  Pending Review
                </button>
              ) : (
                <button
                  onClick={() => handleRequestUpgrade("Enterprise", 299.0, "plan_enterprise")}
                  disabled={submitting}
                  className={buttonClasses("secondary", false, "w-full disabled:opacity-60")}
                >
                  {submitting ? "Submitting..." : "Request Admin Approval"}
                </button>
              )}
            </Panel>

            <Panel title="Ledger Stats" action={<Badge>ACTIVE</Badge>} bodyClassName="flex flex-col justify-between gap-5">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Saved via Hibernation</dt>
                  <dd className="font-mono text-xs font-semibold text-slate-900">&mdash;</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Last Invoice</dt>
                  <dd className="font-mono text-xs font-semibold text-slate-900">{lastInvoiceAmount}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Payment Gateways</dt>
                  <dd className="font-semibold text-slate-900">Stripe / PayPal</dd>
                </div>
              </dl>
              <div className="select-none rounded-md bg-slate-50 px-3 py-2 text-center font-mono text-[11px] text-slate-600 border border-slate-200">
                PCI-DSS Level 1 Compliant
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Invoice & Transaction Approval Queue History Table */}
      <Panel
        title="Billing Ledger & Transaction Approval History"
        description="Audited transaction queue for plan upgrades, token allocations, and enterprise receipts."
        action={
          <button
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
            className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
          >
            {showHistory ? "Hide Records" : "Show Records"}
          </button>
        }
        bodyClassName="p-0 sm:p-0"
      >
        {showHistory && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                  <th scope="col" className="px-6 py-3">Transaction ID</th>
                  <th scope="col" className="px-6 py-3">Requested Tier / Item</th>
                  <th scope="col" className="px-6 py-3">Amount</th>
                  <th scope="col" className="px-6 py-3">Status</th>
                  <th scope="col" className="px-6 py-3">Date Requested</th>
                  <th scope="col" className="px-6 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState icon={FileText} title="No billing records found in workspace ledger.">
                        Upgrades and token top-ups will be listed here, with a receipt for each.
                      </EmptyState>
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.tx_id} className="transition-colors hover:bg-slate-900/[0.02]">
                      <td className="px-6 py-2.5 font-mono text-xs font-medium text-slate-900">{tx.tx_id.startsWith("tx_") ? tx.tx_id : `INV-${tx.tx_id}`}</td>
                      <td className="px-6 py-2.5 font-medium text-slate-900">{tx.requested_plan}</td>
                      <td className="px-6 py-2.5 font-mono text-xs font-medium text-slate-900">${tx.amount.toFixed(2)}</td>
                      <td className="px-6 py-2.5">
                        {tx.admin_status === "APPROVED" ? (
                          <Badge tone="green">
                            <Check className="h-3 w-3" aria-hidden="true" /> Approved
                          </Badge>
                        ) : tx.admin_status === "PENDING" ? (
                          <Badge tone="amber">
                            <Clock className="h-3 w-3" aria-hidden="true" /> Pending Admin
                          </Badge>
                        ) : (
                          <Badge tone="red">
                            <X className="h-3 w-3" aria-hidden="true" /> Declined
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-2.5 text-slate-600">
                        {new Date(tx.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                      <td className="px-6 py-2.5 text-right">
                        <a
                          href={`/api/billing/invoice?txId=${tx.tx_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3 text-slate-500" aria-hidden="true" />
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
      </Panel>

      {/* Token Top-Up Modal */}
      {topupModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onKeyDown={(e) => e.key === "Escape" && setTopupModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="topup-title"
            className="max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="topup-title" className="text-lg font-semibold tracking-tight text-slate-900">
                  Instant Token Top-Up
                </h3>
                <p className="mt-0.5 text-sm text-slate-600">Tokens never expire and remain valid across all local and cloud cluster swarms.</p>
              </div>
              <button onClick={() => setTopupModalOpen(false)} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div role="radiogroup" aria-label="Token pack" className="space-y-2.5">
              {[
                { tokens: 500000, price: 15, label: "500,000 Tokens (+$15)" },
                { tokens: 2000000, price: 50, label: "2,000,000 Tokens (+$50) — Popular" },
                { tokens: 10000000, price: 200, label: "10,000,000 Tokens (+$200) — Best Value" },
              ].map((pack) => (
                <button
                  key={pack.tokens}
                  type="button"
                  role="radio"
                  aria-checked={selectedTopupAmount.tokens === pack.tokens}
                  onClick={() => setSelectedTopupAmount(pack)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md p-4 text-left text-sm font-medium transition-colors",
                    selectedTopupAmount.tokens === pack.tokens
                      ? "bg-slate-50 font-semibold text-slate-900 ring-2 ring-slate-900"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Coins className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <span>{pack.label}</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-slate-900">${pack.price}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setTopupModalOpen(false)} className={buttonClasses("secondary", false)}>
                Cancel
              </button>
              <button type="button" disabled={submitting} onClick={handleTopupTokens} className={buttonClasses("primary", false, "disabled:opacity-60")}>
                {submitting ? "Purchasing..." : `Purchase ${selectedTopupAmount.tokens.toLocaleString("en-US")} Tokens`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Owner strip */}
      <div className="flex flex-col items-start justify-between gap-2 border-t border-slate-200 pt-6 text-xs text-slate-600 sm:flex-row sm:items-center">
        <div>
          <span>
            Owner: <strong className="text-slate-900">{profile.name}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

