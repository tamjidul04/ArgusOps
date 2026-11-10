"use client";

import React, { useState, useEffect } from "react";
import {
  Shield,
  Check,
  X,
  Clock,
  Coins,
  Ban,
  UserCheck,
  PlusCircle,
  Edit,
  Save,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Bot,
  Settings,
  Layers,
  ArrowRight,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useDashboard } from "@/components/layout/DashboardContext";
import { cn, formatTokens } from "@/lib/utils";
import { Badge, DashHeader, EmptyState, Panel, buttonClasses, inputClass } from "@/components/ui";

/** Centered dialog with a labelled title, Escape to close, and scroll on small screens. */
function Dialog({ id, title, description, onClose, children }: { id: string; title: string; description?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="rise-in max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-lg bg-white p-6 shadow-lift border border-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={id} className="text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h3>
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A label tied to its control. */
function FormField({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

export interface QueueItem {
  tx_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  requested_plan: string;
  amount: number;
  admin_status: string; // "PENDING" | "APPROVED" | "REJECTED"
  created_at: string;
  reviewed_at: string | null;
  current_plan: string;
  current_max_agents: number;
}

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

export interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string; // "ACTIVE" | "BANNED"
  two_factor_enabled: boolean;
  created_at: string;
  plan_name: string;
  plan_id: string;
  free_tokens: number;
  paid_tokens: number;
  max_agents: number;
  purchase_status: string;
}

interface AdminClientProps {
  initialQueue: QueueItem[];
  initialPlans: PricingPlanItem[];
  initialUsers: UserItem[];
}

export function AdminClient({
  initialQueue,
  initialPlans,
  initialUsers,
}: AdminClientProps) {
  const { profile } = useDashboard();

  // State
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [plans, setPlans] = useState<PricingPlanItem[]>(initialPlans);
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Modal States
  const [injectModalUser, setInjectModalUser] = useState<UserItem | null>(null);
  const [injectFreeAmount, setInjectFreeAmount] = useState<number>(100000);
  const [injectPaidAmount, setInjectPaidAmount] = useState<number>(0);
  const [injectMaxAgents, setInjectMaxAgents] = useState<number>(0);

  const [editPlanModal, setEditPlanModal] = useState<PricingPlanItem | null>(null);
  const [planForm, setPlanForm] = useState<Partial<PricingPlanItem>>({});

  // Auto-dismiss toast
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Refresh live data from API
  const refreshData = async () => {
    try {
      const res = await fetch("/api/admin");
      const data = await res.json();
      if (data.success) {
        setQueue(data.approvalQueue || []);
        setPlans(data.plans || []);
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to refresh admin data:", err);
    }
  };

  // 1. APPROVE UPGRADE
  const handleApprove = async (txId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_upgrade", txId }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message || `Transaction ${txId} approved!`,
        });
        // Optimistically update queue
        setQueue((prev) =>
          prev.map((item) =>
            item.tx_id === txId
              ? { ...item, admin_status: "APPROVED", reviewed_at: new Date().toISOString() }
              : item
          )
        );
        refreshData();
      } else {
        setToastMessage({ type: "error", text: data.error || "Failed to approve transaction." });
      }
    } catch {
      setToastMessage({ type: "error", text: "Network error approving transaction." });
    } finally {
      setSubmitting(false);
    }
  };

  // 2. REJECT UPGRADE
  const handleReject = async (txId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject_upgrade", txId }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "info",
          text: data.message || `Transaction ${txId} rejected.`,
        });
        setQueue((prev) =>
          prev.map((item) =>
            item.tx_id === txId
              ? { ...item, admin_status: "REJECTED", reviewed_at: new Date().toISOString() }
              : item
          )
        );
        refreshData();
      } else {
        setToastMessage({ type: "error", text: data.error || "Failed to reject transaction." });
      }
    } catch {
      setToastMessage({ type: "error", text: "Network error rejecting transaction." });
    } finally {
      setSubmitting(false);
    }
  };

  // 3. TOGGLE APPROVAL GATE
  const handleToggleApprovalGate = async (plan: PricingPlanItem) => {
    const newApprovalValue = !plan.requires_admin_approval;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_plan_approval",
          planId: plan.plan_id,
          requiresApproval: newApprovalValue,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPlans((prev) =>
          prev.map((p) =>
            p.plan_id === plan.plan_id
              ? { ...p, requires_admin_approval: newApprovalValue }
              : p
          )
        );
        setToastMessage({
          type: "success",
          text: `Approval gate for ${plan.name} set to ${newApprovalValue ? "ON" : "OFF"}.`,
        });
      }
    } catch (err) {
      console.error("Error toggling approval gate:", err);
    }
  };

  // 4. SAVE PRICING PLAN (CRUD)
  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_plan",
          ...planForm,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: data.message || "Plan updated successfully.",
        });
        setEditPlanModal(null);
        refreshData();
      } else {
        setToastMessage({ type: "error", text: data.error || "Failed to save plan." });
      }
    } catch {
      setToastMessage({ type: "error", text: "Error saving plan." });
    } finally {
      setSubmitting(false);
    }
  };

  // 5. BAN / UNBAN USER
  const handleToggleBan = async (user: UserItem) => {
    const targetStatus = user.status === "ACTIVE" ? "BANNED" : "ACTIVE";
    const promptConfirm = confirm(
      `Are you sure you want to set account status for ${user.email} to ${targetStatus}?`
    );
    if (!promptConfirm) return;

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_user_ban",
          userId: user.id,
          targetStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, status: targetStatus } : u))
        );
        setToastMessage({
          type: targetStatus === "BANNED" ? "error" : "success",
          text: `User ${user.email} is now ${targetStatus}.`,
        });
      }
    } catch (err) {
      console.error("Ban toggle error:", err);
    }
  };

  // 6. INJECT TOKENS
  const handleInjectTokens = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!injectModalUser) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inject_tokens",
          userId: injectModalUser.id,
          freeTokens: injectFreeAmount,
          paidTokens: injectPaidAmount,
          maxAgents: injectMaxAgents > 0 ? injectMaxAgents : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setToastMessage({
          type: "success",
          text: `Successfully injected tokens into ${injectModalUser.email}'s wallet.`,
        });
        setInjectModalUser(null);
        refreshData();
      } else {
        setToastMessage({ type: "error", text: data.error || "Token injection failed." });
      }
    } catch {
      setToastMessage({ type: "error", text: "Error injecting tokens." });
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate pending transactions count
  const pendingCount = queue.filter((t) => t.admin_status === "PENDING").length;

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
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
          {toastMessage.type === "info" && <Shield className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />}
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} aria-label="Dismiss message" className="ml-1 rounded-md p-1 text-inherit hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DashHeader
        title="Admin Control: Pricing, Approvals & User Access"
        description="Superuser orchestration console for workspace quota, licensing gates, and security restrictions."
        actions={
          <button
            onClick={() => {
              setToastMessage({
                type: "success",
                text: "Platform configuration synced across US-East cluster (instant propagation).",
              });
            }}
            className={buttonClasses("primary", false)}
          >
            Save Configuration
          </button>
        }
      />

      {/* SECTION 1: PURCHASE & UPGRADE APPROVAL QUEUE */}
      <Panel
        title="Purchase & Upgrade Approval Queue"
        action={
          <div className="flex items-center gap-3">
            <Badge tone={pendingCount > 0 ? "amber" : "neutral"}>{pendingCount} Pending</Badge>
            <span className="hidden text-xs text-slate-600 sm:inline">Automatic circuit-breaker: Zero manual bypass</span>
          </div>
        }
        bodyClassName="p-0 sm:p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                <th scope="col" className="px-4 py-3">Transaction ID</th>
                <th scope="col" className="px-4 py-3">User Email</th>
                <th scope="col" className="px-4 py-3">Requested Tier</th>
                <th scope="col" className="px-4 py-3">Amount</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon={Check} title="No transactions currently in queue.">
                      Upgrade and top-up requests that need approval will appear here.
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                queue.map((tx) => (
                  <tr key={tx.tx_id} className="transition-colors hover:bg-slate-900/[0.02]">
                    <td className="max-w-[9rem] truncate px-4 py-2.5 font-mono text-xs font-medium text-slate-900" title={tx.tx_id}>{tx.tx_id}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{tx.user_email}</td>
                    <td className="px-4 py-2.5 text-slate-900">{tx.requested_plan}</td>
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900">${tx.amount.toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      {tx.admin_status === "PENDING" ? (
                        <Badge tone="amber">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Pending Approval
                        </Badge>
                      ) : tx.admin_status === "APPROVED" ? (
                        <Badge tone="green">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Approved
                        </Badge>
                      ) : (
                        <Badge tone="red">
                          <X className="h-3 w-3" aria-hidden="true" />
                          Rejected
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {tx.admin_status === "PENDING" ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleApprove(tx.tx_id)} disabled={submitting} className={buttonClasses("primary", false, "px-4 py-1.5 text-xs disabled:opacity-60")}>
                            Approve
                          </button>
                          <button onClick={() => handleReject(tx.tx_id)} disabled={submitting} className={buttonClasses("secondary", false, "px-4 py-1.5 text-xs disabled:opacity-60")}>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-slate-600">{tx.admin_status.toLowerCase()}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* BOTTOM 2-COLUMN GRID */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ==================== LEFT CARD: PRICING & TIER PARAMETERS ==================== */}
        <Panel
          title="Pricing & Tier Parameters"
          description="Configure plan capacity, billing rates, and gated checkout thresholds."
          action={
            <button
              onClick={() => {
                setPlanForm({
                  name: "Enterprise Pro",
                  price: 149,
                  agent_limit: 50,
                  included_tokens: 5000000,
                  is_public: true,
                  requires_admin_approval: true,
                });
                setEditPlanModal({
                  plan_id: "",
                  name: "Enterprise Pro",
                  price: 149,
                  agent_limit: 50,
                  included_tokens: 5000000,
                  is_public: true,
                  requires_admin_approval: true,
                  description: "",
                });
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
            >
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" /> Add Tier
            </button>
          }
          bodyClassName="p-0 sm:p-0 flex flex-col"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                  <th scope="col" className="px-5 py-3">Tier</th>
                  <th scope="col" className="px-5 py-3">Price</th>
                  <th scope="col" className="px-5 py-3">Agent Cap</th>
                  <th scope="col" className="px-5 py-3">Approval Gate</th>
                  <th scope="col" className="px-5 py-3 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {plans.map((plan) => {
                  const isFree = plan.price === 0;

                  return (
                    <tr key={plan.plan_id} className="transition-colors hover:bg-slate-900/[0.02]">
                      <td className="px-5 py-2.5 font-medium text-slate-900">{plan.name}</td>
                      <td className="px-5 py-2.5 font-medium text-slate-900">
                        {isFree ? "$0" : plan.name.toLowerCase().includes("enterprise") ? "Custom" : `$${plan.price}`}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-slate-800">{plan.agent_limit} Agents</td>
                      <td className="px-5 py-2.5">
                        {isFree ? (
                          <span className="text-slate-600">Auto-Provisioned (100k Tokens)</span>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="text-slate-700">{plan.requires_admin_approval ? "Require Approval (On)" : "Require Approval (Off)"}</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={plan.requires_admin_approval}
                              aria-label={`Require approval for ${plan.name}`}
                              onClick={() => handleToggleApprovalGate(plan)}
                              className={cn(
                                "relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-300",
                                plan.requires_admin_approval ? "bg-slate-900" : "bg-slate-300"
                              )}
                            >
                              <span className={cn("block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-spring", plan.requires_admin_approval && "translate-x-5")} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => {
                            setPlanForm(plan);
                            setEditPlanModal(plan);
                          }}
                          aria-label={`Edit ${plan.name}`}
                          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 text-xs text-slate-600">
            <span>Active plan registry synced across US-East cluster</span>
            <span className="font-mono">sync: instant</span>
          </div>
        </Panel>

        {/* ==================== RIGHT CARD: USER GOVERNANCE & TOKEN INJECTION ==================== */}
        <Panel
          title="User Governance & Token Injection"
          description="Inspect tenant identity, inject emergency quotas, or clamp execution access."
          bodyClassName="p-0 sm:p-0 flex flex-col"
        >
          {users.length === 0 ? (
            <EmptyState icon={UserCheck} title="No users yet">
              Accounts show up here once people sign up.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-900/5">
              {users.map((user) => {
                const isBanned = user.status === "BANNED";
                // Generate friendly PID like 81204
                const pid = user.id.replace(/\D/g, "").slice(-5) || "81204";

                let statusSubtitle = `${user.plan_name} Active`;
                if (user.purchase_status === "PENDING") {
                  statusSubtitle = "Enterprise Requested";
                } else if (user.plan_name.toLowerCase().includes("free")) {
                  statusSubtitle = `Free Tier (${(user.free_tokens / 1000).toFixed(0)}k left)`;
                }

                return (
                  <li key={user.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-900/[0.02] sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{user.email}</span>
                        {isBanned && <Badge tone="red">BANNED</Badge>}
                        {user.role === "ADMIN" && <Badge tone="dark">ADMIN</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600">
                        PID: {pid} &bull; {statusSubtitle}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          setInjectModalUser(user);
                          setInjectFreeAmount(100000);
                          setInjectPaidAmount(0);
                          setInjectMaxAgents(user.max_agents);
                        }}
                        className={buttonClasses("secondary", false, "in-[.dash]:h-8 in-[.dash]:px-2.5 in-[.dash]:text-xs")}
                      >
                        Inject Free Tokens
                      </button>

                      <button
                        onClick={() => handleToggleBan(user)}
                        className={cn(
                          buttonClasses("ghost", false, "in-[.dash]:h-8 in-[.dash]:px-2.5 in-[.dash]:text-xs"),
                          isBanned && "border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                        )}
                      >
                        {isBanned ? "Unban User" : "Restrict / Ban"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 text-xs text-slate-600">
            <span>Token injections bypass billing ledger directly</span>
            <span className="font-mono">zero-trust: verified</span>
          </div>
        </Panel>
      </div>

      {/* MODAL 1: TOKEN INJECTION & CAPACITY OVERRIDE */}
      {injectModalUser && (
        <Dialog
          id="inject-title"
          title="Manual Token & Quota Injection"
          description={
            <>
              Target Tenant: <strong className="text-slate-900">{injectModalUser.email}</strong>
            </>
          }
          onClose={() => setInjectModalUser(null)}
        >
          <form onSubmit={handleInjectTokens} className="space-y-4">
            <FormField id="inject-free" label="Inject Free Tokens Allowance (+Amount):">
              <div className="mb-2 grid grid-cols-3 gap-2">
                {[50000, 100000, 500000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setInjectFreeAmount(amt)}
                    aria-pressed={injectFreeAmount === amt}
                    className={cn(
                      "rounded-md px-2 py-2 text-center text-xs font-semibold transition-colors",
                      injectFreeAmount === amt ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    +{(amt / 1000).toLocaleString("en-US")}k
                  </button>
                ))}
              </div>
              <input id="inject-free" type="number" value={injectFreeAmount} onChange={(e) => setInjectFreeAmount(Number(e.target.value))} className={cn(inputClass, "font-mono")} />
            </FormField>

            <FormField id="inject-paid" label="Inject Paid Unmetered Tokens (+Amount):">
              <input id="inject-paid" type="number" value={injectPaidAmount} onChange={(e) => setInjectPaidAmount(Number(e.target.value))} placeholder="0" className={cn(inputClass, "font-mono")} />
            </FormField>

            <FormField id="inject-agents" label="Override Concurrent Agent Limit:" hint={`Current limit: ${injectModalUser.max_agents} agents`}>
              <input id="inject-agents" type="number" value={injectMaxAgents} onChange={(e) => setInjectMaxAgents(Number(e.target.value))} className={cn(inputClass, "font-mono")} />
            </FormField>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setInjectModalUser(null)} className={buttonClasses("secondary", false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className={buttonClasses("primary", false, "disabled:opacity-60")}>
                {submitting ? "Injecting..." : "Inject Quota Now"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* MODAL 2: PRICING PLAN CRUD */}
      {editPlanModal && (
        <Dialog
          id="plan-title"
          title={editPlanModal.plan_id ? "Edit Pricing Tier" : "Create Pricing Tier"}
          description="Update plan limits, prices, and approval enforcement."
          onClose={() => setEditPlanModal(null)}
        >
          <form onSubmit={handleSavePlan} className="space-y-4">
            <FormField id="plan-name" label="Plan Name:">
              <input id="plan-name" type="text" required value={planForm.name || ""} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className={inputClass} />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField id="plan-price" label="Price ($ / mo):">
                <input
                  id="plan-price"
                  type="number"
                  step="0.01"
                  required
                  value={planForm.price ?? 0}
                  onChange={(e) => setPlanForm({ ...planForm, price: parseFloat(e.target.value) })}
                  className={cn(inputClass, "font-mono")}
                />
              </FormField>
              <FormField id="plan-agents" label="Max Agents:">
                <input
                  id="plan-agents"
                  type="number"
                  required
                  value={planForm.agent_limit ?? 3}
                  onChange={(e) => setPlanForm({ ...planForm, agent_limit: parseInt(e.target.value, 10) })}
                  className={cn(inputClass, "font-mono")}
                />
              </FormField>
            </div>

            <FormField id="plan-tokens" label="Included Monthly Tokens:">
              <input
                id="plan-tokens"
                type="number"
                step="10000"
                required
                value={planForm.included_tokens ?? 50000}
                onChange={(e) => setPlanForm({ ...planForm, included_tokens: parseInt(e.target.value, 10) })}
                className={cn(inputClass, "font-mono")}
              />
            </FormField>

            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md bg-slate-50 p-4 border border-slate-200">
              <span>
                <span className="block text-sm font-medium text-slate-900">Require Admin Approval</span>
                <span className="block text-xs text-slate-600">Gate checkouts through the manual approval queue</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(planForm.requires_admin_approval)}
                onChange={(e) => setPlanForm({ ...planForm, requires_admin_approval: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-slate-900"
              />
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setEditPlanModal(null)} className={buttonClasses("secondary", false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className={buttonClasses("primary", false, "disabled:opacity-60")}>
                {submitting ? "Saving..." : "Save Pricing Tier"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Owner strip */}
      <div className="flex flex-col items-start justify-between gap-2 border-t border-slate-200 pt-6 text-xs text-slate-600 sm:flex-row sm:items-center">
        <span>Admin console</span>
        <span>
          Owner: <strong className="text-slate-900">{profile.name}</strong>
        </span>
      </div>
    </div>
  );
}

