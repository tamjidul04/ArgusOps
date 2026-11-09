"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Terminal } from "lucide-react";
import { AuthShell, Field, authPrimaryButton, authSecondaryButton } from "@/components/auth/AuthShell";

type Stage = "enter" | "done" | "denied";

export function DeviceClient() {
  const params = useSearchParams();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [stage, setStage] = useState<Stage>("enter");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  async function submit(approve: boolean) {
    setError("");
    setBusy(approve ? "approve" : "deny");
    try {
      const res = await fetch("/api/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: code, approve }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setMessage(data.message || "");
      setStage(approve ? "done" : "denied");
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell
      title={stage === "done" ? "Device connected" : stage === "denied" ? "Request denied" : "Connect a device"}
      subtitle={
        stage === "enter"
          ? "Enter the code your terminal is showing to link the argus CLI to your account."
          : message
      }
      footer={
        <Link href="/dashboard/local-bridge" className="font-semibold text-slate-900 underline underline-offset-4">
          Manage devices and API keys
        </Link>
      }
    >
      {stage === "enter" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(true);
          }}
          className="space-y-4"
        >
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-600">
            <Terminal className="h-4 w-4 text-slate-400" />
            argus login
          </div>

          <Field
            id="user_code"
            label="Code"
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            autoFocus
          />

          <p className="text-xs leading-relaxed text-slate-500">
            Only approve a code you started yourself. Approving lets that machine send usage data to your account and receive
            pause, resume and stop commands for the agents you run with <span className="font-mono">argus run</span>.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy !== null || code.length < 8}
              className={authSecondaryButton}
            >
              {busy === "deny" ? "Denying…" : "Deny"}
            </button>
            <button
              type="submit"
              disabled={busy !== null || code.length < 8}
              className={authPrimaryButton}
            >
              {busy === "approve" && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy === "approve" ? "Connecting…" : "Approve"}
            </button>
          </div>
        </form>
      )}

      {stage === "done" && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <span>You can close this tab and go back to your terminal.</span>
        </div>
      )}
      {stage === "denied" && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Nothing was connected. If you didn&apos;t start this request, you can ignore it.
        </div>
      )}
    </AuthShell>
  );
}
