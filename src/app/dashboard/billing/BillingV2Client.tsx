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
} from "lucide-react";
import { useDashboard } from "@/components/layout/DashboardContext";
import { cn, formatTokens } from "@/lib/utils";
import { Badge, DashHeader, EmptyState, Panel, buttonClasses } from "@/components/ui";
import { PLAN_FEATURES } from "@/lib/plan-features";

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
  }>({ tokens: 2000000, price: 50, label: "2,000,000 tokens (+$50)" });

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

  // The cards and limits come from the plan rows in the database.
  const planById = (id: string) => plans.find((p) => p.plan_id === id);
  const freePlan = planById("plan_free");
  const proPlan = planById("plan_pro");
  const entPlan = planById("plan_enterprise");
  const currentPlan = subscription ? planById(subscription.plan_id) : undefined;
  const currentPlanName = subscription?.plan_name || profile.planName || "Free";
  const planId = subscription?.plan_id ?? "";
  const isFreePlan = planId ? planId === "plan_free" : currentPlanName.toLowerCase().includes("free");
  const isPro = planId ? planId === "plan_pro" : currentPlanName.toLowerCase().includes("pro");
  const isEnterprise = planId ? planId === "plan_enterprise" : currentPlanName.toLowerCase().includes("enterprise");
  const purchaseStatus = (subscription?.purchase_status || "NONE").toUpperCase();
  const isPendingApproval = purchaseStatus === "PENDING";
  const pendingRequest = transactions.find((t) => t.admin_status === "PENDING" && !t.requested_plan.startsWith("Token Top-Up"));

  // Token allowance: what is left against what the current plan includes.
  const freeTokensCurrent = subscription?.free_tokens ?? profile.freeTokens ?? 0;
  const allowance = currentPlan?.included_tokens ?? 0;
  const freePercentage = allowance > 0 ? Math.min(100, Math.round((freeTokensCurrent / allowance) * 1000) / 10) : null;
  const paidTokensCurrent = subscription?.paid_tokens ?? profile.paidTokens ?? 0;
  const agentLimit = subscription?.max_agents ?? profile.maxAgents;

  const lastRequestAmount = transactions[0] ? `$${transactions[0].amount.toFixed(2)}` : "None yet";
  const price = (pl: PricingPlanItem) => (pl.price === 0 ? "$0" : `$${pl.price}`);
  const exact = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));
  const limitsOf = (pl: PricingPlanItem) => [`Up to ${pl.agent_limit} concurrent agents`, `${exact(pl.included_tokens)} tokens included`];

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          role="status"
          className={cn(
            "pop-in fixed bottom-6 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lift ring-1 sm:right-6",
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
        title="Plan & billing"
        description="Your plan, token balance and upgrade requests. An administrator approves upgrades and top-ups until card payments are connected."
        actions={
          transactions.length > 0 ? (
            <a href={"/api/billing/invoice"} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", false)}>
              <FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Latest receipt (PDF)
            </a>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ==================== LEFT COLUMN ==================== */}
        <div className="space-y-6">
          <Panel title="Token allowance">
            <div className="tabular text-2xl font-semibold tracking-[-0.02em] text-slate-900">
              {freeTokensCurrent.toLocaleString("en-US")}
              {allowance > 0 && <span className="text-slate-500"> / {allowance.toLocaleString("en-US")}</span>}
            </div>
            {freePercentage !== null && (
              <>
                <div
                  className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-200"
                  role="meter"
                  aria-label="Tokens remaining"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={freePercentage}
                >
                  <div className="h-full rounded-full bg-slate-900 transition-[width] duration-700 ease-out" style={{ width: `${freePercentage}%` }} />
                </div>
                <p className="mt-2.5 text-sm text-slate-600">{freePercentage}% of your {currentPlanName} plan&rsquo;s tokens left</p>
              </>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel bodyClassName="flex flex-col justify-between gap-5">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Paid token balance</span>
                <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-slate-900">{paidTokensCurrent.toLocaleString("en-US")}</div>
                <p className="mt-1 text-sm text-slate-600">Added when a top-up is approved</p>
              </div>
              <button onClick={() => setTopupModalOpen(true)} className={buttonClasses("secondary", false, "w-full")}>
                Request top-up
              </button>
            </Panel>

            <Panel bodyClassName="flex flex-col justify-between gap-5">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Upgrade request</span>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      isPendingApproval ? "bg-amber-500" : purchaseStatus === "APPROVED" ? "bg-emerald-500" : "bg-slate-700"
                    )}
                  />
                  <span className="text-base font-semibold text-slate-900">
                    {isPendingApproval ? "Waiting for review" : purchaseStatus === "APPROVED" ? "Approved" : "Nothing waiting"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{isPendingApproval ? `${pendingRequest?.requested_plan ?? "Upgrade"} request queued` : `${currentPlanName} plan active`}</p>
              </div>
              <div className="select-none rounded-md bg-slate-50 px-4 py-2.5 text-center text-xs font-medium text-slate-600 border border-slate-200">
                {isPendingApproval ? "An admin will review it" : "No request open"}
              </div>
            </Panel>
          </div>

          {freePlan && (
            <Panel
              title={`${freePlan.name} — ${price(freePlan)}`}
              description={freePlan.description}
              action={isFreePlan ? <Badge>Current plan</Badge> : undefined}
              bodyClassName="flex flex-col gap-6"
            >
              <ul className="space-y-3 text-sm text-slate-700">
                {[...limitsOf(freePlan), ...(PLAN_FEATURES.plan_free ?? [])].map((f) => (
                  <li key={f} className="flex items-center gap-3">
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {!freePlan && !proPlan && !entPlan && (
            <Panel>
              <EmptyState icon={AlertCircle} title="Plans are unavailable right now">
                Your balance and requests below are still correct. Try again in a moment.
              </EmptyState>
            </Panel>
          )}
        </div>

        {/* ==================== RIGHT COLUMN ==================== */}
        <div className="space-y-6">
          {proPlan && (
            <div className="on-dark rounded-lg border border-slate-800 bg-slate-950 p-6 text-white sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-semibold tracking-tight">
                    {proPlan.name} — {price(proPlan)}/mo
                  </h3>
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">Most popular</span>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-300">{proPlan.description}</p>

              <div className="my-6 grid grid-cols-1 gap-x-4 gap-y-3 text-sm text-slate-200 sm:grid-cols-2">
                {[...limitsOf(proPlan), ...(PLAN_FEATURES.plan_pro ?? [])].map((f) => (
                  <div key={f} className="flex items-center gap-3">
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              {isPro ? (
                <button disabled className="w-full cursor-default rounded-md bg-white/10 px-4 py-2.5 text-center text-sm font-medium text-slate-300">
                  Current plan
                </button>
              ) : isPendingApproval ? (
                <button disabled className="w-full cursor-not-allowed rounded-md bg-amber-400/10 px-4 py-2.5 text-center text-sm font-medium text-amber-300">
                  Request queued for review
                </button>
              ) : (
                <button
                  onClick={() => handleRequestUpgrade(proPlan.name, proPlan.price, proPlan.plan_id)}
                  disabled={submitting}
                  className={buttonClasses("inverse", false, "w-full disabled:opacity-60")}
                >
                  {submitting ? "Submitting…" : "Request upgrade"}
                </button>
              )}
              <p className="mt-3 text-center text-xs text-slate-400">An administrator approves upgrades until card payments are connected.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {entPlan && (
              <Panel title="Enterprise — Custom" description={entPlan.description} bodyClassName="flex flex-col justify-between gap-5">
                <ul className="space-y-2.5 text-sm text-slate-700">
                  {(PLAN_FEATURES.plan_enterprise ?? []).map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isEnterprise ? (
                  <button disabled className={buttonClasses("secondary", false, "w-full cursor-default opacity-70")}>
                    Current plan
                  </button>
                ) : isPendingApproval ? (
                  <button disabled className="w-full cursor-not-allowed rounded-md bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-800">
                    Request queued for review
                  </button>
                ) : (
                  <button
                    onClick={() => handleRequestUpgrade(entPlan.name, entPlan.price, entPlan.plan_id)}
                    disabled={submitting}
                    className={buttonClasses("secondary", false, "w-full disabled:opacity-60")}
                  >
                    {submitting ? "Submitting…" : "Request review"}
                  </button>
                )}
              </Panel>
            )}

            <Panel title="Account summary" bodyClassName="flex flex-col justify-between gap-5">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Plan</dt>
                  <dd className="font-medium text-slate-900">{currentPlanName}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Agent limit</dt>
                  <dd className="tabular font-mono text-xs font-medium text-slate-900">{agentLimit}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Last request</dt>
                  <dd className="font-mono text-xs font-medium text-slate-900">{lastRequestAmount}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-600">Payments</dt>
                  <dd className="font-medium text-slate-900">Admin-approved</dd>
                </div>
              </dl>
            </Panel>
          </div>
        </div>
      </div>

      {/* Invoice & Transaction Approval Queue History Table */}
      <Panel
        title="Requests and receipts"
        description="Plan upgrades and token top-ups, each with a receipt."
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
                      <EmptyState icon={FileText} title="No requests yet">
                        Upgrade and top-up requests will be listed here, with a receipt for each.
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
          className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onKeyDown={(e) => e.key === "Escape" && setTopupModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="topup-title"
            className="rise-in max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="topup-title" className="text-lg font-semibold tracking-tight text-slate-900">
                  Request a token top-up
                </h3>
                <p className="mt-0.5 text-sm text-slate-600">An administrator approves each request. The tokens are added to your paid balance once it is approved.</p>
              </div>
              <button onClick={() => setTopupModalOpen(false)} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div role="radiogroup" aria-label="Token pack" className="space-y-2.5">
              {[
                { tokens: 500000, price: 15, label: "500,000 tokens (+$15)" },
                { tokens: 2000000, price: 50, label: "2,000,000 tokens (+$50)" },
                { tokens: 10000000, price: 200, label: "10,000,000 tokens (+$200)" },
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
                {submitting ? "Submitting…" : `Request ${selectedTopupAmount.tokens.toLocaleString("en-US")} tokens`}
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

