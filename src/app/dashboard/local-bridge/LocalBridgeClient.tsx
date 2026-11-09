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
import { Badge, DashHeader, EmptyState, Panel, buttonClasses, inputClass } from "@/components/ui";

/** A read-only value with a copy button (keys, commands). */
function CopyField({ label, value, copied, onCopy, actionLabel, badge }: {
  label: string; value: string; copied: boolean; onCopy: () => void; actionLabel?: string; badge?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
        {badge}
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/[0.03] py-2 pl-3.5 pr-2 ring-1 ring-slate-900/[0.08]">
        <code className="min-w-0 select-all truncate font-mono text-xs font-medium text-slate-900">{value}</code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-900/10 transition-colors hover:bg-slate-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : actionLabel ? <Terminal className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{copied ? "Copied" : actionLabel ?? "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/** One supervised agent process. */
function AgentCard({ name, pid, path, running, statusLabel, memory, cache, lock }: {
  name: string; pid: string; path: string; running: boolean; statusLabel: string; memory: string; cache: string; lock: string;
}) {
  return (
    <Panel bodyClassName="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-slate-900">{name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
            pid: {pid} • {path}
          </p>
        </div>
        <Badge tone={running ? "green" : "neutral"} className="shrink-0">
          {running && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          {statusLabel}
        </Badge>
      </div>
      <dl className="space-y-2.5 border-t border-slate-900/5 pt-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">Memory</dt>
          <dd className="font-mono text-xs font-semibold text-slate-900">{memory}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">Context Cache</dt>
          <dd className="font-mono text-xs font-semibold text-emerald-700">{cache}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Active Lock</dt>
          <dd className="mt-1 truncate rounded-lg bg-slate-900/[0.04] px-2.5 py-1.5 font-mono text-xs font-medium text-slate-800">{lock}</dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Accessible on/off switch with a title and description. */
function ToggleRow({ title, description, checked, onToggle, tone = "dark" }: {
  title: string; description: string; checked: boolean; onToggle: () => void; tone?: "dark" | "green";
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900/[0.03] p-4 ring-1 ring-slate-900/[0.07]">
      <div className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <p className="text-xs leading-relaxed text-slate-600">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onToggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-300",
          checked ? (tone === "green" ? "bg-emerald-600" : "bg-slate-900") : "bg-slate-300"
        )}
      >
        <span className={cn("block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring", checked && "translate-x-5")} />
      </button>
    </div>
  );
}

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
      <DashHeader
        title="Local PC Bridge & API Keys"
        description="Pair a machine with an API key, see which agents hold which files, and choose what the local daemon may do."
        badge={
          <Badge tone={permissions.zeroTrustCodePrivacy ? "green" : "amber"}>
            Zero-trust privacy: {permissions.zeroTrustCodePrivacy ? "Enabled" : "Disabled"}
          </Badge>
        }
      />

      {/* Action Notification Banner */}
      {feedback && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between rounded-xl px-4 py-3 text-sm ring-1",
            feedback.type === "success" && "bg-emerald-50 text-emerald-900 ring-emerald-600/20",
            feedback.type === "warning" && "bg-amber-50 text-amber-900 ring-amber-600/25",
            feedback.type === "error" && "bg-red-50 text-red-900 ring-red-600/20",
            feedback.type === "info" && "bg-slate-900/[0.04] text-slate-800 ring-slate-900/10"
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
            {feedback.type === "warning" && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
            {feedback.type === "error" && <XCircle className="h-4 w-4 shrink-0 text-red-600" />}
            {feedback.type === "info" && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-slate-600" />}
            <span className="font-medium">{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message" className="rounded-md p-1 text-slate-500 hover:text-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ================= TOP BOX: API KEY & DESKTOP BRIDGE COMMAND ================= */}
      <Panel bodyClassName="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CopyField
          label="Active Daemon API Key"
          value={primaryApiKey}
          copied={copiedKey}
          onCopy={() => handleCopyKey(primaryApiKey)}
          badge={<Badge tone="green">Live</Badge>}
        />
        <CopyField label="Desktop Bridge Command" value={defaultCliCmd} copied={copiedCmd} onCopy={handleCopyCmd} actionLabel="Run CLI" />
      </Panel>

      {/* ================= 3 AGENT PROCESS CARDS ================= */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AgentCard
          name="Claude (IDE Agent)"
          pid="49201"
          path="/usr/bin/claude"
          running={claudeAgent?.status === "ACTIVE"}
          statusLabel={claudeAgent?.status === "ACTIVE" ? "Running" : claudeAgent?.status || "Running"}
          memory={claudeAgent?.ram_usage ? `${claudeAgent.ram_usage.toFixed(1)} MB RAM` : "142 MB RAM"}
          cache={claudeAgent?.tokens_used ? `${Math.round(claudeAgent.tokens_used / 1000)}k tokens saved` : "28.4k tokens saved"}
          lock={claudeAgent?.locked_file_path || "src/lib/loop-detector.ts"}
        />
        <AgentCard
          name="Antigravity"
          pid="49288"
          path="/opt/antigravity"
          running={antigravityAgent?.status === "ACTIVE"}
          statusLabel={antigravityAgent?.status === "ACTIVE" ? "Running" : antigravityAgent?.status || "Running"}
          memory={antigravityAgent?.ram_usage ? `${antigravityAgent.ram_usage.toFixed(1)} MB RAM` : "84.5 MB RAM"}
          cache={antigravityAgent?.tokens_used ? `${Math.round(antigravityAgent.tokens_used / 1000)}k tokens saved` : "41.2k tokens saved"}
          lock={antigravityAgent?.locked_file_path || "src/app/dashboard/page.tsx"}
        />
        <AgentCard
          name="Hermes"
          pid="49310"
          path="/usr/local/hermes"
          running={hermesAgent?.status === "ACTIVE"}
          statusLabel={hermesAgent?.status === "ACTIVE" ? "Running" : "Throttled (Idle)"}
          memory={hermesAgent?.ram_usage ? `${hermesAgent.ram_usage.toFixed(1)} MB RAM` : "45.3 MB RAM"}
          cache={hermesAgent?.tokens_used ? `${Math.round(hermesAgent.tokens_used / 1000)}k tokens saved` : "19.0k tokens saved"}
          lock={hermesAgent?.locked_file_path || "src/tests/billing.spec.ts"}
        />
      </div>

      {/* ================= ACTIVE FILE LOCKS (MUTEX CONFLICT PREVENTION) TABLE ================= */}
      <Panel
        title="Active File Locks (Mutex Conflict Prevention)"
        icon={Lock}
        description="ArgusOps intercepts file save system calls to prevent concurrent overwrites between coding agents."
        action={<Badge>{locks.length} Locks Registered</Badge>}
        bodyClassName="p-0 sm:p-0"
      >
        {locks.length === 0 ? (
          <EmptyState icon={Unlock} title="No files are locked">
            When an agent edits a file, it is locked here so a second agent cannot overwrite it. Nothing is locked right now.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-900/5 bg-slate-900/[0.02] text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  <th scope="col" className="px-5 py-3">Workspace File Path</th>
                  <th scope="col" className="px-5 py-3">Locked By</th>
                  <th scope="col" className="px-5 py-3">Queued Agent (Overwrite Prevented)</th>
                  <th scope="col" className="px-5 py-3">Lock Timestamp</th>
                  <th scope="col" className="px-5 py-3 text-right">Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/5">
                {locks.map((lock) => (
                  <tr key={lock.id} className={cn("transition-colors hover:bg-slate-900/[0.02]", lock.status === "CONFLICT_QUEUED" && "bg-amber-50/60")}>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2">
                        <FileCode className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <code className="font-mono text-xs font-semibold text-slate-900">{lock.filePath}</code>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{lock.holderAgent}</td>
                    <td className="px-5 py-3.5">
                      {lock.queuedAgent ? (
                        <Badge tone="amber">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {lock.queuedAgent}
                        </Badge>
                      ) : (
                        <span className="text-slate-600">None (Clean write access)</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{lock.acquiredAt}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleReleaseLock(lock.id)}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/10 transition-colors hover:bg-slate-50"
                      >
                        Release Lock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ================= PERMISSIONS & API KEYS GRID ================= */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Permission & Zero-Trust Governance Layer" icon={Shield} action={<Badge tone="green">Hardware Enforced</Badge>} bodyClassName="space-y-3">
          <ToggleRow
            title="Monitor Local Agent Processes (PID/RAM/CPU)"
            description="Tracks per-agent resident sets against the <150MB daemon cap."
            checked={permissions.monitorProcesses}
            onToggle={() => handleTogglePermission("monitorProcesses")}
          />
          <ToggleRow
            title="Enforce Workspace File-Locking (Mutex)"
            description="Blocks concurrent conflicting edits across Antigravity, Claude, and Hermes."
            checked={permissions.enforceMutex}
            onToggle={() => handleTogglePermission("enforceMutex")}
          />
          <ToggleRow
            title="Intercept Redundant API Calls"
            description="Feeds cached AST tokens across local agents without duplicate billing."
            checked={permissions.interceptRedundantApi}
            onToggle={() => handleTogglePermission("interceptRedundantApi")}
          />
          <ToggleRow
            title="Zero-Trust Code Privacy"
            description="Guarantees raw project source code never leaves this workstation."
            checked={permissions.zeroTrustCodePrivacy}
            onToggle={() => handleTogglePermission("zeroTrustCodePrivacy")}
            tone="green"
          />
        </Panel>

        <Panel
          title="API Key & SDK Manager"
          icon={Key}
          action={
            <button type="button" onClick={() => setShowCreateModal(true)} className={buttonClasses("primary", false, "px-4 py-2")}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Create Key</span>
            </button>
          }
          bodyClassName="space-y-4"
        >
          {keys.length === 0 ? (
            <EmptyState icon={Key} title="No API keys yet" className="py-8">
              Create a key to pair a machine with your account.
            </EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/[0.03] p-3.5 ring-1 ring-slate-900/[0.07]">
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate text-sm font-semibold text-slate-900">{k.label}</div>
                    <div className="select-all truncate font-mono text-xs text-slate-600">{k.masked_key}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyKey(k.masked_key)}
                      className="rounded-full p-2 text-slate-600 hover:bg-slate-900/5 hover:text-slate-900"
                      title="Copy key"
                      aria-label={`Copy key ${k.label}`}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevokeKey(k.id)}
                      className="rounded-full p-2 text-red-600 hover:bg-red-50 hover:text-red-800"
                      title="Revoke key"
                      aria-label={`Revoke key ${k.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-slate-900/5 pt-4">
            <span className="mb-2 block text-xs font-medium text-slate-600">One-line Daemon Handshake:</span>
            <div className="on-dark flex items-center justify-between gap-2 rounded-xl bg-slate-950 py-2 pl-3.5 pr-2 font-mono text-xs text-slate-200">
              <span className="select-all truncate">export ARGUSOPS_API_KEY=&quot;argus_live_...&quot; &amp;&amp; npx argusops-daemon</span>
              <button type="button" onClick={handleCopyCmd} aria-label="Copy handshake command" className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* CREATE KEY MODAL */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowCreateModal(false);
              setCreatedKeyRaw(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="newkey-title"
            className="max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto rounded-3xl bg-white p-6 shadow-lift ring-1 ring-slate-900/10"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-900/5 pb-4">
              <h3 id="newkey-title" className="text-base font-semibold tracking-tight text-slate-900">
                Generate New API Key
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreatedKeyRaw(null);
                }}
                aria-label="Close"
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createdKeyRaw ? (
              <div className="space-y-4">
                <div className="space-y-1 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-600/20">
                  <span className="block font-semibold">Key Generated Successfully!</span>
                  <p className="text-xs">Copy this key now. For your security, it will not be displayed again.</p>
                </div>
                <div className="on-dark flex items-center justify-between gap-2 break-all rounded-xl bg-slate-950 p-3.5 font-mono text-xs text-white">
                  <span className="select-all">{createdKeyRaw}</span>
                  <button type="button" onClick={() => handleCopyKey(createdKeyRaw)} aria-label="Copy new key" className="shrink-0 rounded-full p-2 hover:bg-white/10 hover:text-emerald-300">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreatedKeyRaw(null);
                  }}
                  className={buttonClasses("primary", false, "w-full py-3")}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateApiKey} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="newkey-label" className="block text-sm font-medium text-slate-900">
                    Key Description / Label
                  </label>
                  <input
                    id="newkey-label"
                    type="text"
                    autoFocus
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                    placeholder="e.g. Workstation 02 Daemon"
                    required
                    className={inputClass}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowCreateModal(false)} className={buttonClasses("secondary", false)}>
                    Cancel
                  </button>
                  <button type="submit" className={buttonClasses("primary", false)}>
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
