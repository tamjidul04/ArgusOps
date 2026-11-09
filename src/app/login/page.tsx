"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { AuthShell, Field, authPrimaryButton } from "@/components/auth/AuthShell";
import { OAuthButtons, OrDivider, oauthErrorMessage } from "@/components/auth/OAuthButtons";

/** Only same-site relative paths are allowed as a post-login target. */
function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const oauthError = oauthErrorMessage(params.get("error"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [formError, setFormError] = useState("");
  const error = formError || oauthError || "";
  const setError = setFormError;
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, otp: needsOtp ? otp : undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Sign-in failed. Please try again.");
        return;
      }
      if (data.require_2fa) {
        setNeedsOtp(true);
        return;
      }
      router.replace(safeNext() ?? data.redirectUrl ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Pick up where your agents left off."
      footer={
        <>
          New to ArgusOps?{" "}
          <Link href="/signup" className="font-semibold text-slate-900 underline underline-offset-4">
            Create a free account
          </Link>
        </>
      }
    >
      <OAuthButtons next={next} />
      <OrDivider />

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={needsOtp}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={needsOtp}
        />

        {needsOtp && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-800">
              <KeyRound className="h-4 w-4" /> Two-factor code
            </div>
            <Field
              id="otp"
              label="6-digit code from your authenticator app"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className={authPrimaryButton}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Signing in…" : needsOtp ? "Verify and sign in" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
