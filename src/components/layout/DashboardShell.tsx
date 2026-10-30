"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Triangle,
  Activity,
  Sliders,
  Shield,
  Laptop,
  CreditCard,
  Lock,
  ChevronDown,
  Coins,
  Cloud,
  Check,
  Zap,
  Radio,
  UserCheck,
  Server,
  LogOut,
  ExternalLink,
} from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import {
  DashboardProvider,
  useDashboard,
  PersonaType,
  PERSONA_PROFILES,
} from "./DashboardContext";
import { BrainProvider, useBrain } from "@/context/BrainContext";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    name: "Cluster Visualizer",
    href: "/dashboard",
    icon: Activity,
  },
  {
    name: "Master Orchestrator",
    href: "/dashboard/orchestrator",
    icon: Sliders,
  },
  {
    name: "Loop & RAM Guardrails",
    href: "/dashboard/guardrails",
    icon: Shield,
  },
  {
    name: "Local PC Bridge & SDK",
    href: "/dashboard/local-bridge",
    icon: Laptop,
  },
  {
    name: "Plan & Token Billing",
    href: "/dashboard/billing",
    icon: CreditCard,
  },
  {
    name: "Admin Control Panel",
    href: "/admin",
    icon: Lock,
    badge: "Admin",
    adminOnly: true,
  },
];

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { persona, setPersona, profile, environment, setEnvironment } = useDashboard();
  const { hardware, wallet, interceptionLatencyMs } = useBrain();
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setRoleDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900 antialiased">
      {/* ================= FIXED LEFT SIDEBAR ================= */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col justify-between h-full select-none z-20">
        <div>
          {/* Brand Header */}
          <div className="h-16 flex items-center px-6 border-b border-slate-200 gap-2.5">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white transition-transform group-hover:scale-105 shadow-sm">
                <Triangle className="h-4 w-4 fill-white text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold tracking-tight text-slate-900 text-base leading-none">
                  ArgusOps
                </span>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">
                  Hypervisor
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            <div className="px-3 pt-2 pb-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Cluster Supervision
            </div>
            {NAV_ITEMS.map((item) => {
              // Active route check: exact match for root dashboard, or startsWith for subroutes
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname?.startsWith(item.href);

              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all group",
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        isActive
                          ? "text-slate-900"
                          : "text-slate-400 group-hover:text-slate-700"
                      )}
                    />
                    <span className="truncate">{item.name}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={cn(
                        "text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded border font-semibold",
                        item.badge === "Admin"
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-slate-100 text-slate-600 border-slate-200"
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

        {/* Sidebar Footer with Active Persona Card */}
        <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/50">
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-slate-900 truncate">
                {profile.planName}
              </span>
              <span className="text-[10px] font-mono text-slate-400">v1.1.0</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">
                {profile.activeAgents} / {profile.maxAgents} agents active
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="truncate max-w-[130px]">{profile.name}</span>
              <span className="font-mono text-slate-400 text-[10px]">
                {profile.role}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-slate-400">
            <Link
              href="/"
              className="hover:text-slate-700 inline-flex items-center gap-1 transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> Public Site
            </Link>
            <Link
              href="/login"
              className="hover:text-rose-600 inline-flex items-center gap-1 transition-colors"
            >
              <LogOut className="h-3 w-3" /> Sign Out
            </Link>
          </div>
        </div>
      </aside>

      {/* ================= MAIN COLUMN ================= */}
      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        {/* ================= STICKY TOP HEADER ================= */}
        <header className="h-16 shrink-0 sticky top-0 z-30 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4">
          {/* Environment Switcher Pill */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200/80">
            <button
              type="button"
              onClick={() => setEnvironment("CLOUD")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                environment === "CLOUD"
                  ? "bg-white text-slate-900 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Cloud className="h-3.5 w-3.5 text-sky-600" />
              <span>Cloud Swarm (100 Agents)</span>
            </button>
            <button
              type="button"
              onClick={() => setEnvironment("LOCAL_PC")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                environment === "LOCAL_PC"
                  ? "bg-white text-slate-900 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <Laptop className="h-3.5 w-3.5 text-indigo-600" />
              <span>Local PC Bridge (Claude/Hermes/Antigravity)</span>
            </button>
          </div>

          {/* Right Header Section: SLA Pill + Host RAM + Token Wallet + Quick Role Switcher */}
          <div className="flex items-center gap-2.5">
            {/* Live SLA & Loop Guard Pill */}
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 shadow-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span className="font-mono text-slate-900 font-semibold">
                Loop Guard: {interceptionLatencyMs || 18}ms
              </span>
              <span className="text-slate-300">|</span>
              <span className="font-mono text-emerald-700 font-medium text-[11px]">
                &lt;100ms SLA
              </span>
            </div>

            {/* Live PC Host RAM Badge */}
            <div className="hidden md:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono text-slate-700 shadow-xs">
              <span className="text-slate-500 font-sans text-[11px]">Host RAM:</span>
              <strong className="text-slate-900 font-bold">
                {hardware ? `${hardware.usedRamGb.toFixed(2)} GB` : "21.88 GB"}
              </strong>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500 text-[11px]">
                {hardware ? `${hardware.totalRamGb.toFixed(2)} GB` : "31.19 GB"}
              </span>
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 ml-0.5">
                {hardware ? `${hardware.ramUsagePercent}%` : "70%"}
              </span>
            </div>

            {/* Token Wallet Badge */}
            <Link
              href="/dashboard/billing"
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs transition-colors shadow-xs group"
              title="View Token Wallet and Quotas"
            >
              <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0 group-hover:scale-110 transition-transform" />
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900">
                  {formatTokens(wallet ? wallet.free_tokens : profile.freeTokens)}
                </span>
                <span className="text-slate-400">Free</span>
                <span className="text-slate-300">·</span>
                <span className="font-semibold text-slate-900">
                  {formatTokens(wallet ? wallet.paid_tokens : profile.paidTokens)}
                </span>
                <span className="text-slate-400">Paid</span>
              </div>
            </Link>

            {/* Quick Role Switcher Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors shadow-xs"
              >
                <UserCheck className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-slate-500 hidden sm:inline">Viewing as:</span>
                <span className="font-semibold text-slate-900">{profile.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
              </button>

              {roleDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Switch Test Persona
                  </div>

                  {(
                    Object.keys(PERSONA_PROFILES) as PersonaType[]
                  ).map((key) => {
                    const p = PERSONA_PROFILES[key];
                    const isSelected = persona === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setPersona(key);
                          setRoleDropdownOpen(false);
                        }}
                        className={cn(
                          "w-full text-left flex items-start justify-between p-2.5 rounded-md text-xs transition-colors",
                          isSelected
                            ? "bg-slate-100 text-slate-900 font-medium"
                            : "text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900">
                              {p.name}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.2 rounded font-mono font-medium border",
                                p.role === "ADMIN"
                                  ? "bg-slate-900 text-white border-slate-900"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              )}
                            >
                              {p.role}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal">
                            {p.description}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {p.email} • {p.planName}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ================= MAIN SCROLLABLE CONTENT ================= */}
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-6 space-y-6">
          {children}

          {/* Persistent Shell Footer matching Stitch export */}
          <footer className="pt-6 pb-2 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span>Cluster ID: <strong className="text-slate-700 font-semibold">us-east-cluster-09</strong></span>
              <span>•</span>
              <span>Daemon: <strong className="text-slate-700 font-semibold">v1.4.0 (Zero-Trust Local Code)</strong></span>
            </div>
            <div>
              <span>Owner: <strong className="text-slate-900 font-semibold">MD.Tamjidul Islam</strong></span>
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

