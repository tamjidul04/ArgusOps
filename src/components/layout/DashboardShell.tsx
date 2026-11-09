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
  ChevronDown,
  Coins,
  Cloud,
  LogOut,
  ExternalLink,
  Menu,
  X,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { DashboardProvider, useDashboard } from "./DashboardContext";
import { NotificationBell } from "./NotificationBell";
import { BrainProvider, useBrain } from "@/context/BrainContext";
import { Logo } from "@/components/ui/Logo";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Cluster Visualizer", href: "/dashboard", icon: Activity },
  { name: "Master Orchestrator", href: "/dashboard/orchestrator", icon: Sliders },
  { name: "Loop & RAM Guardrails", href: "/dashboard/guardrails", icon: Shield },
  { name: "Local PC Bridge & SDK", href: "/dashboard/local-bridge", icon: Laptop },
  { name: "Usage & Savings", href: "/dashboard/usage", icon: BarChart3 },
  { name: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { name: "Plan & Token Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Admin Control Panel", href: "/admin", icon: Lock, badge: "Admin", adminOnly: true },
];

const EASE = "ease-spring";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, environment, setEnvironment, signOut } = useDashboard();
  const { wallet, interceptionLatencyMs } = useBrain();
  const [accountOpen, setAccountOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close the mobile drawer when the route changes.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setNavOpen(false);
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Escape closes menus; the drawer also locks page scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAccountOpen(false);
        setNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/" aria-label="ArgusOps home" className="rounded-lg">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-900/5 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Dashboard" className="space-y-1 p-3">
          <div className="px-3 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">Supervision</div>
          {NAV_ITEMS.filter((item) => !item.adminOnly || profile.role === "ADMIN").map((item) => {
            const isActive = item.href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-300",
                  isActive ? "bg-slate-900 text-white shadow-soft" : "text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900"
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-slate-500 group-hover:text-slate-800")} aria-hidden="true" />
                  <span className="truncate">{item.name}</span>
                </div>
                {item.badge && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                      isActive ? "bg-white/15 text-white" : "bg-slate-900 text-white"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 p-3">
        <div className="rounded-2xl bg-slate-900/[0.04] p-3.5 ring-1 ring-slate-900/5">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate font-semibold text-slate-900">{profile.planName}</span>
            <span className="font-mono text-[10px] text-slate-500">v0.2</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate">
              {profile.activeAgents} / {profile.maxAgents} agents active
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between border-t border-slate-900/5 pt-2.5 text-[11px] text-slate-500">
            <span className="max-w-[130px] truncate">{profile.name}</span>
            <span className="font-mono text-[10px]">{profile.role}</span>
          </div>
        </div>

        <div className="flex items-center justify-between px-2 pt-1 text-xs text-slate-500">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-slate-900">
            <ExternalLink className="h-3 w-3" aria-hidden="true" /> Public site
          </Link>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-rose-700">
            <LogOut className="h-3 w-3" aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-50 font-sans text-slate-900 antialiased">
      <a
        href="#dashboard-main"
        className="fixed left-4 top-4 z-[60] -translate-y-20 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="z-20 hidden h-full w-64 shrink-0 border-r border-slate-900/5 bg-white lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      <div
        className={cn("fixed inset-0 z-50 lg:hidden", navOpen ? "" : "pointer-events-none")}
        aria-hidden={!navOpen}
        inert={!navOpen}
      >
        <div
          onClick={() => setNavOpen(false)}
          className={cn("absolute inset-0 bg-slate-950/40 transition-opacity duration-500", EASE, navOpen ? "opacity-100" : "opacity-0")}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            "absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-lift transition-transform duration-500",
            EASE,
            navOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebar}
        </aside>
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-900/5 bg-white/85 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-900 hover:bg-slate-900/5 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div role="group" aria-label="Environment" className="flex items-center rounded-full bg-slate-900/[0.05] p-1">
              <button
                type="button"
                onClick={() => setEnvironment("CLOUD")}
                aria-pressed={environment === "CLOUD"}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-[background-color,box-shadow] duration-300",
                  environment === "CLOUD" ? "bg-white font-semibold text-slate-900 shadow-soft" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Cloud className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                <span>Cloud</span>
              </button>
              <button
                type="button"
                onClick={() => setEnvironment("LOCAL_PC")}
                aria-pressed={environment === "LOCAL_PC"}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-[background-color,box-shadow] duration-300",
                  environment === "LOCAL_PC" ? "bg-white font-semibold text-slate-900 shadow-soft" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Laptop className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Local PC</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-900/10 xl:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span className="font-mono font-semibold text-slate-900">
                Loop guard: {interceptionLatencyMs > 0 ? `${Math.round(interceptionLatencyMs)}ms` : "idle"}
              </span>
            </div>

            <NotificationBell />

            <Link
              href="/dashboard/billing"
              className="group hidden items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs ring-1 ring-slate-900/10 transition-colors hover:bg-slate-50 sm:flex"
              title="View token wallet and quotas"
            >
              <Coins className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900">{formatTokens(wallet ? wallet.free_tokens : profile.freeTokens)}</span>
                <span className="text-slate-500">Free</span>
                <span className="text-slate-300">·</span>
                <span className="font-semibold text-slate-900">{formatTokens(wallet ? wallet.paid_tokens : profile.paidTokens)}</span>
                <span className="text-slate-500">Paid</span>
              </div>
            </Link>

            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAccountOpen(!accountOpen)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-2.5 text-xs font-medium text-slate-800 ring-1 ring-slate-900/10 transition-colors hover:bg-slate-50"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                  {loading ? "…" : (profile.name || profile.email || "?").charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-[120px] truncate font-semibold text-slate-900 sm:inline">{loading ? "Loading…" : profile.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              </button>

              {accountOpen && (
                <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-2xl bg-white p-1.5 shadow-lift ring-1 ring-slate-900/10">
                  <div className="border-b border-slate-900/5 px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{profile.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
                          profile.role === "ADMIN" ? "bg-slate-900 text-white" : "bg-slate-900/[0.06] text-slate-600"
                        )}
                      >
                        {profile.role}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{profile.email}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {profile.planName} · {profile.activeAgents}/{profile.maxAgents} agents
                    </p>
                  </div>
                  <Link
                    href="/dashboard/billing"
                    role="menuitem"
                    onClick={() => setAccountOpen(false)}
                    className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-slate-700 hover:bg-slate-900/[0.05]"
                  >
                    <CreditCard className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> Plan &amp; billing
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-rose-700 hover:bg-rose-50"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="dashboard-main" className="min-w-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
          {children}

          <footer className="flex flex-col items-center justify-between gap-3 border-t border-slate-900/5 pb-2 pt-6 text-xs text-slate-500 sm:flex-row">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
              <span>ArgusOps v0.2</span>
              <span className="hidden sm:inline">•</span>
              <span>Your prompts and code stay on your machine</span>
            </div>
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
