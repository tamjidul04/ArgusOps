"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Triangle,
  ArrowRight,
  Shield,
  Check,
  Copy,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const handleCopyCmd = () => {
    navigator.clipboard.writeText("npx argusops-daemon login --token=env");
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!email || !password) {
      setErrorMsg("Please provide both email and password.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Failed to create account. Please try again.");
        setIsLoading(false);
        return;
      }

      setSuccessMsg("Free Tier provisioned! Redirecting to your cluster console...");

      // Set active persona or state
      try {
        localStorage.setItem("argusops_active_persona", "FREE_TIER");
      } catch {}

      setTimeout(() => {
        router.push("/dashboard");
      }, 1200);
    } catch (err) {
      console.error(err);
      setErrorMsg("Network error occurred during registration. Please try again.");
      setIsLoading(false);
    }
  };

  const handleOAuthClick = (provider: string) => {
    try {
      localStorage.setItem("argusops_active_persona", "FREE_TIER");
    } catch {}
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-white text-slate-900 font-sans antialiased selection:bg-slate-900 selection:text-white">
      {/* Top Header matching Stitch export */}
      <header className="h-16 border-b border-slate-200 px-6 sm:px-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white transition-transform group-hover:scale-105">
            <Triangle className="h-3.5 w-3.5 fill-white text-white" />
          </div>
          <span className="font-bold tracking-tight text-slate-900 text-base">
            ArgusOps
          </span>
        </Link>

        <div className="flex items-center gap-6 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>daemon.v1::auth</span>
          </div>
          <Link href="/docs" className="hover:text-slate-900 transition-colors">
            Documentation
          </Link>
          <Link href="/status" className="hover:text-slate-900 transition-colors">
            Status
          </Link>
        </div>
      </header>

      {/* Main Split Section matching Stitch Screenshot 02-auth.png */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 sm:px-12 py-12 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
        {/* ================= LEFT COLUMN: REGISTRATION FORM ================= */}
        <div className="max-w-md w-full space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
              <Sparkles className="h-3 w-3 text-emerald-600" />
              <span>Instant Free Tier: 50,000 Tokens</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Create your ArgusOps account
            </h1>
            <p className="text-sm text-slate-500">
              Automatic provisioning for up to 3 agents on local PC and cloud.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="full-name"
                className="block text-xs font-semibold text-slate-800"
              >
                Full Name
              </label>
              <input
                id="full-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="work-email"
                className="block text-xs font-semibold text-slate-800"
              >
                Work Email
              </label>
              <input
                id="work-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@studio.dev"
                required
                className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all shadow-2xs"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-800"
              >
                Password (min. 6 characters)
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition-all shadow-2xs"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-md bg-slate-900 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 active:scale-[0.99] transition-all disabled:opacity-60"
            >
              {isLoading ? "Provisioning Free Tier..." : "Start Free (3 Agents + 50k Tokens)"}
            </button>
          </form>

          {/* Social Auth Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs text-slate-400">
              <span className="bg-white px-3">or</span>
            </div>
          </div>

          {/* Social OAuth Buttons */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => handleOAuthClick("GitHub")}
              className="w-full flex items-center justify-center gap-2.5 rounded-md border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors shadow-2xs"
            >
              <svg className="h-4 w-4 fill-slate-900" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>Sign up with GitHub</span>
            </button>

            <button
              type="button"
              onClick={() => handleOAuthClick("Google")}
              className="w-full flex items-center justify-center gap-2.5 rounded-md border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors shadow-2xs"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Sign up with Google</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500 pt-2">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-700"
            >
              Sign in
            </Link>
          </p>

          <p className="text-[11px] text-slate-400">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="underline hover:text-slate-700">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-slate-700">
              Zero-Trust Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* ================= RIGHT COLUMN: FREE TIER PROVISIONING ================= */}
        {/* Matches Stitch Screenshot 02-auth.png */}
        <div className="border-t lg:border-t-0 lg:border-l border-slate-200 pt-8 lg:pt-0 lg:pl-16 space-y-8">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Free tier provisioning
            </h2>
            <span className="font-mono text-xs text-slate-500 font-semibold uppercase tracking-wider bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
              PLAN::DEVELOPER
            </span>
          </div>

          <div className="space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Concurrent Agent Limit
              </span>
              <p className="text-sm font-semibold text-slate-900">
                Up to 3 agents free (Claude, Antigravity, Hermes)
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Initial Token Grant
              </span>
              <p className="text-sm font-semibold text-slate-900">
                50,000 free tokens provisioned on sign-up
              </p>
            </div>

            <div className="flex items-center justify-between py-2 border-y border-slate-100 text-xs">
              <span className="text-slate-600 font-medium">Loop Interception Latency</span>
              <span className="font-mono font-bold text-slate-900">&lt; 100ms</span>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-100 text-xs">
              <span className="text-slate-600 font-medium">Desktop Daemon Footprint</span>
              <span className="font-mono font-bold text-slate-900">&lt; 150MB RAM</span>
            </div>

            {/* Zero-trust daemon handshake card */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Zero-trust daemon handshake
              </span>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between font-mono text-xs">
                <span className="text-slate-800 font-semibold select-all">
                  npx argusops-daemon login --token=env
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">v1.4.0</span>
                  <button
                    type="button"
                    onClick={handleCopyCmd}
                    className="p-1 text-slate-400 hover:text-slate-900 transition-colors"
                    title="Copy command"
                  >
                    {copiedCmd ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>SOC 2 Type II Certified</span>
            <span>2026.03.R9_VERCEL_SPEC</span>
          </div>
        </div>
      </main>

      {/* Footer matching Stitch screenshot */}
      <footer className="border-t border-slate-200 px-6 sm:px-12 py-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/docs" className="hover:text-slate-900 underline-offset-4 hover:underline">
            /docs
          </Link>
          <span>•</span>
          <Link href="/privacy" className="hover:text-slate-900 underline-offset-4 hover:underline">
            Privacy Policy (Zero-Trust Local Code)
          </Link>
          <span>•</span>
          <Link href="/terms" className="hover:text-slate-900 underline-offset-4 hover:underline">
            Terms of Service
          </Link>
        </div>
        <div>
          <span>Owner: </span>
          <strong className="font-semibold text-slate-900">MD.Tamjidul Islam</strong>
        </div>
      </footer>
    </div>
  );
}

