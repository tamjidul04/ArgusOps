"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type EnvironmentType = "CLOUD" | "LOCAL_PC";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  planName: string;
  freeTokens: number;
  paidTokens: number;
  maxAgents: number;
  activeAgents: number;
  status: "ACTIVE" | "PENDING";
}

const EMPTY_PROFILE: UserProfile = {
  id: "",
  email: "",
  name: "",
  role: "USER",
  planName: "Free",
  freeTokens: 0,
  paidTokens: 0,
  maxAgents: 2,
  activeAgents: 0,
  status: "ACTIVE",
};

/** Loads the signed-in user's profile. Resolves "unauthorized" on 401 and null on any other failure. */
async function fetchProfile(): Promise<UserProfile | "unauthorized" | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.status === 401) return "unauthorized";
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: data.user.role,
      planName: data.subscription?.plan_name ?? "Free",
      freeTokens: data.subscription?.free_tokens ?? 0,
      paidTokens: data.subscription?.paid_tokens ?? 0,
      maxAgents: data.subscription?.max_agents ?? 2,
      activeAgents: data.active_agents ?? 0,
      status: data.subscription?.purchase_status === "PENDING" ? "PENDING" : "ACTIVE",
    };
  } catch {
    return null;
  }
}

interface DashboardContextValue {
  profile: UserProfile;
  /** True until the first /api/auth/me response arrives. */
  loading: boolean;
  environment: EnvironmentType;
  setEnvironment: (env: EnvironmentType) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<EnvironmentType>("CLOUD");

  const refreshProfile = useCallback(async () => {
    const result = await fetchProfile();
    if (result === "unauthorized") {
      router.replace("/login");
      return;
    }
    if (result) setProfile(result);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchProfile();
      if (cancelled) return;
      if (result === "unauthorized") {
        router.replace("/login");
        return;
      }
      if (result) setProfile(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    // One-time restore of a UI preference from an external store on mount.
    try {
      const savedEnv = localStorage.getItem("argusops_active_env");
      if (savedEnv === "CLOUD" || savedEnv === "LOCAL_PC") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEnvironment(savedEnv);
      }
    } catch {
      // storage can be unavailable (private mode); default environment is fine
    }
  }, []);

  const handleSetEnvironment = (env: EnvironmentType) => {
    setEnvironment(env);
    try {
      localStorage.setItem("argusops_active_env", env);
    } catch {
      // ignore
    }
  };

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }, [router]);

  return (
    <DashboardContext.Provider
      value={{ profile, loading, environment, setEnvironment: handleSetEnvironment, refreshProfile, signOut }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return context;
}
