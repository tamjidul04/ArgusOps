"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Sliders,
  Shield,
  Laptop,
  CreditCard,
  Bell,
  BarChart3,
  Lock,
  ChevronsUpDown,
  Coins,
  Cloud,
  LogOut,
  ArrowUpRight,
  Menu,
  X,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import { NotificationBell } from "./NotificationBell";
import { BrainProvider, useBrain } from "@/context/BrainContext";
import { Logo } from "@/components/ui/Logo";
import { Segmented } from "@/components/ui/Dash";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Supervise",
    items: [
      { name: "Overview", href: "/dashboard", icon: Activity },
      { name: "Orchestrator", href: "/dashboard/orchestrator", icon: Sliders },
      { name: "Guardrails", href: "/dashboard/guardrails", icon: Shield },
      { name: "Local bridge", href: "/dashboard/local-bridge", icon: Laptop },
    ],
  },
  {
    label: "Insights",
    items: [
      { name: "Usage & savings", href: "/dashboard/usage", icon: BarChart3 },
      { name: "Notifications", href: "/dashboard/notifications", icon: Bell },
    ],
  },
  {
    label: "Account",
    items: [
      { name: "Plan & billing", href: "/dashboard/billing", icon: CreditCard },
      { name: "Admin", href: "/admin", icon: Lock, adminOnly: true },
    ],
  },
];

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, environment, setEnvironment, signOut } = useDashboard();
  const { wallet, interceptionLatencyMs } = useBrain();
  const [accountOpen, setAccountOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const accountRef = useRef<HTMLDivElement>(null);

  if (lastPath !== pathname) {
    setLastPath(pathname);
    setNavOpen(false);
    setAccountOpen(false);
  }

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAccountOpen(false);
        setNavOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const initial = loading ? "·" : (profile.name || profile.email || "?").charAt(0).toUpperCase();
  const usedPct = profile.maxAgents > 0 ? Math.min(100, (profile.activeAgents / profile.maxAgents) * 100) : 0;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/" aria-label="ArgusOps home" className="rounded-md">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Dashboard" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || profile.role === "ADMIN");
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="px-2 pb-1 text-[11px] font-medium text-slate-400">{group.label}</p>
              <ul className="space-y-px">
                {items.map((item) => {
                  const isActive = item.href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-100",
                          isActive ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-slate-900" : "text-slate-400")} aria-hidden="true" />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-900">{profile.planName} plan</span>
          <Link href="/dashboard/billing" className="text-slate-500 transition-colors hover:text-slate-900">
            Upgrade
          </Link>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-slate-900 transition-[width] duration-500 ease-out" style={{ width: `${usedPct}%` }} />
        </div>
        <p className="tabular mt-1.5 text-[11px] text-slate-500">
          {profile.activeAgents} of {profile.maxAgents} agents running
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-50 font-sans text-slate-900 antialiased">
      <a
        href="#dashboard-main"
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="z-20 hidden h-full w-60 shrink-0 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      <div className={cn("fixed inset-0 z-50 lg:hidden", navOpen ? "" : "pointer-events-none")} aria-hidden={!navOpen} inert={!navOpen}>
        <div onClick={() => setNavOpen(false)} className={cn("absolute inset-0 bg-slate-950/30 transition-opacity duration-200", navOpen ? "opacity-100" : "opacity-0")} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            "absolute inset-y-0 left-0 w-64 max-w-[85vw] border-r border-slate-200 bg-white transition-transform duration-200 ease-out",
            navOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebar}
        </aside>
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Segmented
              label="Environment"
              value={environment}
              onChange={setEnvironment}
              options={[
                { value: "CLOUD", label: "Cloud", icon: Cloud, iconClassName: "text-sky-600" },
                { value: "LOCAL_PC", label: "Local PC", icon: Laptop, iconClassName: "text-indigo-600" },
              ]}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden h-8 items-center gap-2 rounded-md px-2.5 text-xs text-slate-500 xl:flex" title="Time the loop guard takes to check each call">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Loop guard
              <span className="font-mono text-slate-900">{interceptionLatencyMs > 0 ? `${Math.round(interceptionLatencyMs)}ms` : "idle"}</span>
            </div>

            <Link
              href="/dashboard/billing"
              className="hidden h-8 items-center gap-2 rounded-md border border-slate-200 px-2.5 text-xs transition-colors hover:border-slate-300 hover:bg-slate-50 sm:flex"
              title="Token wallet"
            >
              <Coins className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              <span className="tabular font-medium text-slate-900">{formatTokens(wallet ? wallet.free_tokens : profile.freeTokens)}</span>
              <span className="text-slate-400">free</span>
              <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
              <span className="tabular font-medium text-slate-900">{formatTokens(wallet ? wallet.paid_tokens : profile.paidTokens)}</span>
              <span className="text-slate-400">paid</span>
            </Link>

            <NotificationBell />

            <div className="relative" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                className="flex h-8 items-center gap-2 rounded-md pl-1 pr-1.5 text-xs transition-colors hover:bg-slate-100"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-900 text-[11px] font-semibold text-white">{initial}</span>
                <span className="hidden max-w-[120px] truncate font-medium text-slate-900 sm:inline">{loading ? "Loading…" : profile.name}</span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              </button>

              {accountOpen && (
                <div role="menu" className="pop-in absolute right-0 z-50 mt-1.5 w-64 origin-top-right rounded-lg border border-slate-200 bg-white p-1 shadow-lift">
                  <div className="px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-900">{profile.name}</span>
                      {profile.role === "ADMIN" && <span className="rounded bg-slate-900 px-1.5 py-px font-mono text-[10px] text-white">admin</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{profile.email}</p>
                  </div>
                  <div className="my-1 h-px bg-slate-100" />
                  <Link
                    href="/dashboard/billing"
                    role="menuitem"
                    onClick={() => setAccountOpen(false)}
                    className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-slate-700 hover:bg-slate-100"
                  >
                    <CreditCard className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Plan &amp; billing
                    <span className="tabular ml-auto font-mono text-[11px] text-slate-400">
                      {profile.activeAgents}/{profile.maxAgents}
                    </span>
                  </Link>
                  <Link href="/" role="menuitem" className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-slate-700 hover:bg-slate-100">
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Public site
                  </Link>
                  <div className="my-1 h-px bg-slate-100" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] text-rose-700 hover:bg-rose-50"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="dashboard-main" className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="dash mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:px-8">
            {children}
            <footer className="flex flex-col gap-2 border-t border-slate-200 pb-2 pt-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>Your prompts and code stay on your machine.</span>
              <div className="flex items-center gap-4">
                <Link href="/docs" className="hover:text-slate-900">
                  Docs
                </Link>
                <Link href="/status" className="hover:text-slate-900">
                  Status
                </Link>
                <Link href="/privacy" className="hover:text-slate-900">
                  Privacy
                </Link>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <BrainProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </BrainProvider>
    </DashboardProvider>
  );
}
