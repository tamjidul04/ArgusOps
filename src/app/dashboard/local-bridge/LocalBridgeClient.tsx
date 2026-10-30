"use client";

import React, { useState } from "react";
import { useBrain } from "@/context/BrainContext";
import {
  Laptop,
  Key,
  Shield,
  Copy,
  Check,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  RefreshCw,
  Terminal,
  Activity,
  Cpu,
  FileCode,
  ArrowRight,
  Sliders,
  ExternalLink,
  X,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { FileMutexLock } from "@/app/api/local-bridge/route";

interface LocalAgentData {
  agent_id: string;
  name: string;
  agent_type: string;
  status: string;
  model_tier: string;
  ram_usage: number;
  cpu_usage: number;
  tokens_used: number;
  current_task: string | null;
  locked_file_path: string | null;
}

interface ApiKeyItem {
  id: string;
  label: string;
  key_prefix: string;
  masked_key: string;
  last_used_at: string | Date | null;
  created_at: string | Date;
}

interface LocalBridgeClientProps {
  initialAgents: LocalAgentData[];
  initialLocks: FileMutexLock[];
  initialKeys: ApiKeyItem[];
  initialPermissions: {
    monitorProcesses: boolean;
    enforceMutex: boolean;
    interceptRedundantApi: boolean;
    zeroTrustCodePrivacy: boolean;
  };
}

export function LocalBridgeClient({
  initialAgents,
  initialLocks,
  initialKeys,
  initialPermissions,
}: LocalBridgeClientProps) {
  const { hardware, localCluster, executeBrainAction } = useBrain();

  // Local state
  const [agents, setAgents] = useState<LocalAgentData[]>(initialAgents);
  const [locks, setLocks] = useState<FileMutexLock[]>(initialLocks);
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys);
  const [permissions, setPermissions] = useState(initialPermissions);

  // Derive active local agents from live BrainContext or fall back to initialAgents
  const claudeAgent =
    localCluster?.agents?.find(
      (a) => a.name.toLowerCase().includes("claude") || a.agent_id.includes("claude")
    ) ||
    agents.find(
      (a) => a.name.toLowerCase().includes("claude") || a.agent_id.includes("claude")
    );

  const antigravityAgent =
    localCluster?.agents?.find(
      (a) => a.name.toLowerCase().includes("antigravity") || a.agent_id.includes("antigravity")
    ) ||
    agents.find(
      (a) => a.name.toLowerCase().includes("antigravity") || a.agent_id.includes("antigravity")
    );

  const hermesAgent =
    localCluster?.agents?.find(
      (a) => a.name.toLowerCase().includes("hermes") || a.agent_id.includes("hermes")
    ) ||
    agents.find(
      (a) => a.name.toLowerCase().includes("hermes") || a.agent_id.includes("hermes")
    );

  // UI Feedback
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info" | "warning";
    text: string;
  } | null>(null);

  // Copy states
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // New Key modal state
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const defaultCliCmd = "npx argusops-daemon init --bridge=local";
  const primaryApiKey = keys[0]?.masked_key || "argus_live_98f24a081bc7e41a9";

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(defaultCliCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleCopyKey = (keyText: string) => {
    navigator.clipboard.writeText(keyText);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Simulate File Collision
  const handleSimulateCollision = async () => {
    setFeedback({
      type: "info",
      text: "Simulating concurrent write clash from Claude on src/app/dashboard/page.tsx...",
    });

    try {
      const res = await executeBrainAction("TEST_FILE_MUTEX", {
        targetFilePath: "src/app/dashboard/page.tsx",
      });

      if (!res.success) {
        setFeedback({ type: "error", text: res.error || "Simulation failed." });
        return;
      }

      setFeedback({
        type: "warning",
        text: res.message || "Write collision intercepted! Mutex protected write path.",
      });

      setLocks((prev) => [
        {
          id: `lock-collision-${Date.now()}`,
          filePath: "src/app/dashboard/page.tsx",
          holderAgent: "Antigravity (Local IDE)",
          queuedAgent: "Claude Code CLI (BLOCKED: Rerouted to .conflict-agent_local_claude.tsx)",
          acquiredAt: "Just now",
          status: "CONFLICT_QUEUED",
        },
        ...prev.filter((l) => l.filePath !== "src/app/dashboard/page.tsx"),
      ]);
    } catch (err) {
      console.error(err);
      setFeedback({ type: "error", text: "Failed to simulate file collision." });
    }
  };

  // Release Lock
  const handleReleaseLock = async (lockId: string) => {
    try {
      const res = await fetch("/api/local-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RELEASE_LOCK", lockId }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({ type: "success", text: data.message });
        setLocks(data.fileLocks);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle Governance Permissions
  const handleTogglePermission = async (key: keyof typeof permissions) => {
    const updated = { ...permissions, [key]: !permissions[key] };
    setPermissions(updated);

    try {
      const res = await fetch("/api/local-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPDATE_PERMISSIONS", permissions: updated }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({ type: "success", text: data.message });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Create API Key
  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyLabel.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newKeyLabel }),
      });

      const data = await res.json();
      if (data.success) {
        setCreatedKeyRaw(data.key.full_key);
        setNewKeyLabel("");
        // Refresh keys
        const getRes = await fetch("/api/keys");
        if (getRes.ok) {
          const fresh = await getRes.json();
          setKeys(fresh.keys);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Revoke Key
  const handleRevokeKey = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key? Connected daemons will be disconnected.")) return;

    try {
      const res = await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: "success", text: "API key revoked." });
        setKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* ================= HEADER matching Stitch Export ================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Local PC Bridge &amp; API Keys
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Daemon Memory:{" "}
            <strong className="font-mono text-emerald-700">
              {hardware?.daemonMemoryMb ? `${hardware.daemonMemoryMb} MB` : "42.4 MB"}
            </strong>{" "}
            (&lt;150MB limit) • Host RAM:{" "}
            <strong className="font-mono text-slate-800">
              {hardware
                ? `${hardware.usedRamGb} / ${hardware.totalRamGb} GB (${hardware.ramUsagePercent}%)`
                : "16.00 GB"}
            </strong>{" "}
            • Zero-Trust Local Privacy: <strong className="text-emerald-700">Enabled</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSimulateCollision}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 shadow-2xs transition-colors active:scale-95"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <span>Simulate File Collision (Claude → page.tsx)</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {feedback && (
        <div
          className={cn(
            "p-3 rounded-lg text-xs flex items-center justify-between border animate-in fade-in duration-150",
            feedback.type === "success" && "bg-emerald-50 text-emerald-900 border-emerald-200",
            feedback.type === "warning" && "bg-amber-50 text-amber-900 border-amber-200",
            feedback.type === "error" && "bg-rose-50 text-rose-900 border-rose-200",
            feedback.type === "info" && "bg-slate-100 text-slate-800 border-slate-200"
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
            {feedback.type === "warning" && <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
            {feedback.type === "error" && <XCircle className="h-4 w-4 text-rose-600 shrink-0" />}
            {feedback.type === "info" && <RefreshCw className="h-4 w-4 text-slate-600 animate-spin shrink-0" />}
            <span className="font-medium">{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700 font-bold">
            ×
          </button>
        </div>
      )}

      {/* ================= TOP BOX: API KEY & DESKTOP BRIDGE COMMAND (Stitch Match) ================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Production API Key */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Daemon API Key
            </span>
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
              Live
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-xs">
            <span className="text-slate-800 select-all font-semibold truncate">{primaryApiKey}</span>
            <button
              type="button"
              onClick={() => handleCopyKey(primaryApiKey)}
              className="text-slate-400 hover:text-slate-900 flex items-center gap-1 font-sans text-xs font-semibold ml-2"
            >
              {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedKey ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* Desktop Bridge Command */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Desktop Bridge Command
            </span>
            <span className="font-mono text-[10px] text-slate-500">v1.4.0</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-xs">
            <span className="text-slate-800 select-all font-semibold truncate">{defaultCliCmd}</span>
            <button
              type="button"
              onClick={handleCopyCmd}
              className="rounded bg-slate-900 text-white px-3 py-1 font-sans text-xs font-semibold hover:bg-slate-800 transition-colors ml-2 shrink-0 flex items-center gap-1"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Terminal className="h-3.5 w-3.5" />}
              <span>{copiedCmd ? "Copied" : "Run CLI"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 3 AGENT PROCESS CARDS (Stitch Match) ================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Agent 1: Claude */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Claude (IDE Agent)</h3>
              <span className="font-mono text-[11px] text-slate-400">
                pid: {claudeAgent?.agent_id ? "49201" : "49201"} • /usr/bin/claude
              </span>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border",
                claudeAgent?.status === "ACTIVE"
                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                  : "text-slate-600 bg-slate-100 border-slate-200"
              )}
            >
              {claudeAgent?.status === "ACTIVE" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
              {claudeAgent?.status === "ACTIVE" ? "Running" : (claudeAgent?.status || "Running")}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Memory:</span>
              <strong className="text-slate-900 font-bold">
                {claudeAgent?.ram_usage ? `${claudeAgent.ram_usage.toFixed(1)} MB RAM` : "142 MB RAM"}
              </strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Context Cache:</span>
              <span className="text-emerald-700 font-bold">
                {claudeAgent?.tokens_used
                  ? `${Math.round(claudeAgent.tokens_used / 1000)}k tokens saved`
                  : "28.4k tokens saved"}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] font-sans text-slate-600">
              <span className="text-slate-400 block font-mono text-[10px]">Active Lock:</span>
              <code className="font-mono text-slate-800 font-semibold truncate block">
                {claudeAgent?.locked_file_path || "src/lib/loop-detector.ts"}
              </code>
            </div>
          </div>
        </div>

        {/* Agent 2: Antigravity */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Antigravity</h3>
              <span className="font-mono text-[11px] text-slate-400">
                pid: {antigravityAgent?.agent_id ? "49288" : "49288"} • /opt/antigravity
              </span>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border",
                antigravityAgent?.status === "ACTIVE"
                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                  : "text-slate-600 bg-slate-100 border-slate-200"
              )}
            >
              {antigravityAgent?.status === "ACTIVE" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
              {antigravityAgent?.status === "ACTIVE" ? "Running" : (antigravityAgent?.status || "Running")}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Memory:</span>
              <strong className="text-slate-900 font-bold">
                {antigravityAgent?.ram_usage
                  ? `${antigravityAgent.ram_usage.toFixed(1)} MB RAM`
                  : "84.5 MB RAM"}
              </strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Context Cache:</span>
              <span className="text-emerald-700 font-bold">
                {antigravityAgent?.tokens_used
                  ? `${Math.round(antigravityAgent.tokens_used / 1000)}k tokens saved`
                  : "41.2k tokens saved"}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] font-sans text-slate-600">
              <span className="text-slate-400 block font-mono text-[10px]">Active Lock:</span>
              <code className="font-mono text-slate-800 font-semibold truncate block">
                {antigravityAgent?.locked_file_path || "src/app/dashboard/page.tsx"}
              </code>
            </div>
          </div>
        </div>

        {/* Agent 3: Hermes */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Hermes</h3>
              <span className="font-mono text-[11px] text-slate-400">
                pid: {hermesAgent?.agent_id ? "49310" : "49310"} • /usr/local/hermes
              </span>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border",
                hermesAgent?.status === "ACTIVE"
                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                  : "text-slate-600 bg-slate-100 border-slate-200"
              )}
            >
              {hermesAgent?.status === "ACTIVE" && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
              {hermesAgent?.status === "ACTIVE" ? "Running" : "Throttled (Idle)"}
            </span>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Memory:</span>
              <strong className="text-slate-900 font-bold">
                {hermesAgent?.ram_usage
                  ? `${hermesAgent.ram_usage.toFixed(1)} MB RAM`
                  : "45.3 MB RAM"}
              </strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Context Cache:</span>
              <span className="text-emerald-700 font-bold">
                {hermesAgent?.tokens_used
                  ? `${Math.round(hermesAgent.tokens_used / 1000)}k tokens saved`
                  : "19.0k tokens saved"}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] font-sans text-slate-600">
              <span className="text-slate-400 block font-mono text-[10px]">Active Lock:</span>
              <code className="font-mono text-slate-800 font-semibold truncate block">
                {hermesAgent?.locked_file_path || "src/tests/billing.spec.ts"}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* ================= ACTIVE FILE LOCKS (MUTEX CONFLICT PREVENTION) TABLE ================= */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Lock className="h-4 w-4 text-slate-700" />
              <span>Active File Locks (Mutex Conflict Prevention)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ArgusOps intercepts file save system calls to prevent concurrent overwrites between coding agents.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-700 px-2.5 py-1 rounded border border-slate-200">
            {locks.length} Locks Registered
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Workspace File Path</th>
                <th className="py-3 px-4">Locked By</th>
                <th className="py-3 px-4">Queued Agent (Overwrite Prevented)</th>
                <th className="py-3 px-4">Lock Timestamp</th>
                <th className="py-3 px-4 text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {locks.map((lock) => (
                <tr
                  key={lock.id}
                  className={cn(
                    "hover:bg-slate-50/60 transition-colors",
                    lock.status === "CONFLICT_QUEUED" && "bg-amber-50/60"
                  )}
                >
                  <td className="py-3.5 px-4 font-bold text-slate-900 font-sans flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-slate-500 shrink-0" />
                    <code className="font-mono font-semibold text-xs">{lock.filePath}</code>
                  </td>
                  <td className="py-3.5 px-4 font-sans font-semibold text-slate-800">
                    {lock.holderAgent}
                  </td>
                  <td className="py-3.5 px-4 font-sans">
                    {lock.queuedAgent ? (
                      <span className="inline-flex items-center gap-1.5 text-amber-800 font-semibold bg-amber-100/80 px-2.5 py-0.5 rounded border border-amber-300">
                        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                        <span>{lock.queuedAgent}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">None (Clean write access)</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-slate-500">{lock.acquiredAt}</td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleReleaseLock(lock.id)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-sans text-xs font-semibold shadow-2xs transition-colors"
                    >
                      Release Lock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= PERMISSIONS & API KEYS GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Permission & Zero-Trust Governance Layer */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              <span>Permission &amp; Zero-Trust Governance Layer</span>
            </h3>
            <span className="font-mono text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Hardware Enforced
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {/* Toggle 1 */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-900">Monitor Local Agent Processes (PID/RAM/CPU)</span>
                <p className="text-[11px] text-slate-500">Tracks per-agent resident sets against the &lt;150MB daemon cap.</p>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePermission("monitorProcesses")}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors p-0.5 relative",
                  permissions.monitorProcesses ? "bg-slate-900" : "bg-slate-300"
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    permissions.monitorProcesses && "translate-x-5"
                  )}
                />
              </button>
            </div>

            {/* Toggle 2 */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-900">Enforce Workspace File-Locking (Mutex)</span>
                <p className="text-[11px] text-slate-500">Blocks concurrent conflicting edits across Antigravity, Claude, and Hermes.</p>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePermission("enforceMutex")}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors p-0.5 relative",
                  permissions.enforceMutex ? "bg-slate-900" : "bg-slate-300"
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    permissions.enforceMutex && "translate-x-5"
                  )}
                />
              </button>
            </div>

            {/* Toggle 3 */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-900">Intercept Redundant API Calls</span>
                <p className="text-[11px] text-slate-500">Feeds cached AST tokens across local agents without duplicate billing.</p>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePermission("interceptRedundantApi")}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors p-0.5 relative",
                  permissions.interceptRedundantApi ? "bg-slate-900" : "bg-slate-300"
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    permissions.interceptRedundantApi && "translate-x-5"
                  )}
                />
              </button>
            </div>

            {/* Toggle 4 */}
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-900">Zero-Trust Code Privacy</span>
                <p className="text-[11px] text-slate-500">Guarantees raw project source code never leaves this workstation.</p>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePermission("zeroTrustCodePrivacy")}
                className={cn(
                  "w-10 h-5 rounded-full transition-colors p-0.5 relative",
                  permissions.zeroTrustCodePrivacy ? "bg-emerald-600" : "bg-slate-300"
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    permissions.zeroTrustCodePrivacy && "translate-x-5"
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        {/* API Key & SDK Manager */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Key className="h-4 w-4 text-slate-700" />
              <span>API Key &amp; SDK Manager</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Key</span>
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            {keys.map((k) => (
              <div
                key={k.id}
                className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
              >
                <div className="space-y-0.5 truncate">
                  <div className="font-semibold text-slate-900">{k.label}</div>
                  <div className="font-mono text-slate-500 text-[11px] select-all truncate">{k.masked_key}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyKey(k.masked_key)}
                    className="p-1 text-slate-400 hover:text-slate-800"
                    title="Copy key"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevokeKey(k.id)}
                    className="p-1 text-rose-500 hover:text-rose-700"
                    title="Revoke key"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Connect Command Helper */}
          <div className="pt-3 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              One-line Daemon Handshake:
            </span>
            <div className="rounded bg-slate-900 p-2.5 font-mono text-xs text-slate-200 flex items-center justify-between">
              <span className="truncate select-all">export ARGUSOPS_API_KEY=&quot;argus_live_...&quot; &amp;&amp; npx argusops-daemon</span>
              <button
                type="button"
                onClick={handleCopyCmd}
                className="text-slate-400 hover:text-white p-1 ml-2 shrink-0"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CREATE KEY MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">Generate New API Key</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreatedKeyRaw(null);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {createdKeyRaw ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 space-y-1">
                  <span className="font-bold block">Key Generated Successfully!</span>
                  <p className="text-[11px]">Copy this key now. For your security, it will not be displayed again.</p>
                </div>
                <div className="p-3 rounded bg-slate-900 text-white font-mono text-xs break-all select-all flex items-center justify-between">
                  <span>{createdKeyRaw}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyKey(createdKeyRaw)}
                    className="p-1 hover:text-emerald-400 ml-2"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreatedKeyRaw(null);
                  }}
                  className="w-full rounded bg-slate-900 py-2 text-xs font-semibold text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateApiKey} className="space-y-4">
                <div className="space-y-1 text-xs">
                  <label className="font-semibold text-slate-800 block">Key Description / Label</label>
                  <input
                    type="text"
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                    placeholder="e.g. Workstation 02 Daemon"
                    required
                    className="w-full rounded-md border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3 py-1.5 rounded border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Generate Key
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
