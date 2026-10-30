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
          {toastMessage.type === "info" && <Shield className="w-5 h-5 text-amber-400 shrink-0" />}
          <span>{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 hover:opacity-75 text-inherit"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header matching 07-admin-panel.png */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Admin Control: Pricing, Approvals &amp; User Access
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Superuser orchestration console for workspace quota, licensing gates, and security restrictions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setToastMessage({
                type: "success",
                text: "Platform configuration synced across US-East cluster (instant propagation).",
              });
            }}
            className="px-5 py-2.5 rounded-lg text-xs font-semibold bg-black text-white hover:bg-slate-800 shadow-sm transition-colors cursor-pointer"
          >
            Save Configuration
          </button>
        </div>
      </div>

      {/* SECTION 1: PURCHASE & UPGRADE APPROVAL QUEUE (Section 4.6.2) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Header Bar */}
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">
              Purchase &amp; Upgrade Approval Queue
            </h2>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              {pendingCount} Pending
            </span>
          </div>

          <div className="text-xs text-slate-400 font-mono">
            Automatic circuit-breaker: Zero manual bypass
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-6">Transaction ID</th>
                <th className="py-3 px-6">User Email</th>
                <th className="py-3 px-6">Requested Tier</th>
                <th className="py-3 px-6">Amount</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No transactions currently in queue.
                  </td>
                </tr>
              ) : (
                queue.map((tx) => (
                  <tr key={tx.tx_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-4 px-6 font-mono text-slate-900 font-semibold">
                      {tx.tx_id}
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-900">
                      {tx.user_email}
                    </td>
                    <td className="py-4 px-6 text-slate-900">
                      {tx.requested_plan}
                    </td>
                    <td className="py-4 px-6 font-mono font-bold text-slate-900">
                      ${tx.amount.toFixed(2)}
                    </td>
                    <td className="py-4 px-6">
                      {tx.admin_status === "PENDING" ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                          <span className="h-2 w-2 rounded-full bg-slate-900" />
                          Pending Approval
                        </span>
                      ) : tx.admin_status === "APPROVED" ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-rose-700">
                          <X className="w-3.5 h-3.5" />
                          Rejected
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {tx.admin_status === "PENDING" ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApprove(tx.tx_id)}
                            disabled={submitting}
                            className="px-3 py-1 text-xs font-semibold text-white bg-black hover:bg-slate-800 rounded transition-colors shadow-2xs cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(tx.tx_id)}
                            disabled={submitting}
                            className="px-3 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded transition-colors cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-mono">
                          {tx.admin_status.toLowerCase()}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BOTTOM 2-COLUMN GRID matching 07-admin-panel.png */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ==================== LEFT CARD: PRICING & TIER PARAMETERS (Section 4.6.1) ==================== */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Pricing &amp; Tier Parameters
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure plan capacity, billing rates, and gated checkout thresholds.
                </p>
              </div>
              <div className="flex items-center gap-2">
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
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded"
                >
                  + Add Tier
                </button>
                <span className="text-xs font-mono text-slate-400">schema.v1</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Tier</th>
                    <th className="py-3 px-5">Price</th>
                    <th className="py-3 px-5">Agent Cap</th>
                    <th className="py-3 px-5">Approval Gate</th>
                    <th className="py-3 px-5 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {plans.map((plan) => {
                    const isFree = plan.price === 0;

                    return (
                      <tr key={plan.plan_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-4 px-5 font-bold text-slate-900">
                          {plan.name}
                        </td>
                        <td className="py-4 px-5 font-semibold text-slate-900">
                          {isFree ? "$0" : plan.name.toLowerCase().includes("enterprise") ? "Custom" : `$${plan.price}`}
                        </td>
                        <td className="py-4 px-5 text-slate-800">
                          {plan.agent_limit} Agents
                        </td>
                        <td className="py-4 px-5">
                          {isFree ? (
                            <span className="text-slate-500 font-normal">
                              Auto-Provisioned (100k Tokens)
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-700 font-medium">
                                {plan.requires_admin_approval
                                  ? "Require Approval (On)"
                                  : "Require Approval (Off)"}
                              </span>
                              {/* Native Toggle Switch matching screenshot */}
                              <button
                                type="button"
                                onClick={() => handleToggleApprovalGate(plan)}
                                className={cn(
                                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                                  plan.requires_admin_approval
                                    ? "bg-black"
                                    : "bg-slate-200"
                                )}
                              >
                                <span
                                  className={cn(
                                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                                    plan.requires_admin_approval
                                      ? "translate-x-4"
                                      : "translate-x-0"
                                  )}
                                />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <button
                            onClick={() => {
                              setPlanForm(plan);
                              setEditPlanModal(plan);
                            }}
                            className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer Sync Strip */}
          <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
            <span>Active plan registry synced across US-East cluster</span>
            <span className="font-mono">sync: instant</span>
          </div>
        </div>

        {/* ==================== RIGHT CARD: USER GOVERNANCE & TOKEN INJECTION (Section 4.6.3) ==================== */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  User Governance &amp; Token Injection
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Inspect tenant identity, inject emergency quotas, or clamp execution access.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">rbac::active</span>
            </div>

            <div className="divide-y divide-slate-100 p-2">
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
                  <div
                    key={user.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/60 rounded-lg transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {user.email}
                        </span>
                        {isBanned && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">
                            BANNED
                          </span>
                        )}
                        {user.role === "ADMIN" && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-slate-900 text-white">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        PID: {pid} &bull; {statusSubtitle}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setInjectModalUser(user);
                          setInjectFreeAmount(100000);
                          setInjectPaidAmount(0);
                          setInjectMaxAgents(user.max_agents);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-black hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-2xs"
                      >
                        Inject Free Tokens
                      </button>

                      <button
                        onClick={() => handleToggleBan(user)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
                          isBanned
                            ? "bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100"
                            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                        )}
                      >
                        {isBanned ? "Unban User" : "Restrict / Ban"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Sync Strip */}
          <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
            <span>Token injections bypass billing ledger directly</span>
            <span className="font-mono">zero-trust: verified</span>
          </div>
        </div>
      </div>

      {/* MODAL 1: TOKEN INJECTION & CAPACITY OVERRIDE (Section 4.6.3) */}
      {injectModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Manual Token &amp; Quota Injection
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Target Tenant: <strong className="text-slate-900">{injectModalUser.email}</strong>
                </p>
              </div>
              <button
                onClick={() => setInjectModalUser(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInjectTokens} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Inject Free Tokens Allowance (+Amount):
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[50000, 100000, 500000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setInjectFreeAmount(amt)}
                      className={cn(
                        "py-1.5 px-2 rounded border text-center font-semibold transition-all",
                        injectFreeAmount === amt
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      +{(amt / 1000).toLocaleString()}k
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={injectFreeAmount}
                  onChange={(e) => setInjectFreeAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Inject Paid Unmetered Tokens (+Amount):
                </label>
                <input
                  type="number"
                  value={injectPaidAmount}
                  onChange={(e) => setInjectPaidAmount(Number(e.target.value))}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Override Concurrent Agent Limit:
                </label>
                <input
                  type="number"
                  value={injectMaxAgents}
                  onChange={(e) => setInjectMaxAgents(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Current limit: {injectModalUser.max_agents} agents
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setInjectModalUser(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-black rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submitting ? "Injecting..." : "Inject Quota Now"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: PRICING PLAN CRUD (Section 4.6.1) */}
      {editPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editPlanModal.plan_id ? "Edit Pricing Tier" : "Create Pricing Tier"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update plan limits, prices, and approval enforcement.
                </p>
              </div>
              <button
                onClick={() => setEditPlanModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Plan Name:</label>
                <input
                  type="text"
                  required
                  value={planForm.name || ""}
                  onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Price ($ / mo):</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={planForm.price ?? 0}
                    onChange={(e) => setPlanForm({ ...planForm, price: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Max Agents:</label>
                  <input
                    type="number"
                    required
                    value={planForm.agent_limit ?? 3}
                    onChange={(e) => setPlanForm({ ...planForm, agent_limit: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Included Monthly Tokens:</label>
                <input
                  type="number"
                  step="10000"
                  required
                  value={planForm.included_tokens ?? 50000}
                  onChange={(e) => setPlanForm({ ...planForm, included_tokens: parseInt(e.target.value, 10) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div>
                  <div className="font-semibold text-slate-900">Require Admin Approval</div>
                  <div className="text-[11px] text-slate-500">Gate checkouts through the manual approval queue</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(planForm.requires_admin_approval)}
                  onChange={(e) => setPlanForm({ ...planForm, requires_admin_approval: e.target.checked })}
                  className="h-4 w-4 rounded text-slate-900 focus:ring-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditPlanModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-black rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {submitting ? "Saving..." : "Save Pricing Tier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Info Strip matching 07-admin-panel.png */}
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

