"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type PersonaType = "DEMO_USER" | "ADMIN" | "FREE_TIER";
export type EnvironmentType = "CLOUD" | "LOCAL_PC";

export interface PersonaProfile {
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
  description: string;
}

export const PERSONA_PROFILES: Record<PersonaType, PersonaProfile> = {
  DEMO_USER: {
    id: "usr_tamjid_master",
    email: "tamjid@argusops.dev",
    name: "Tamjidul Islam",
    role: "USER",
    planName: "Enterprise",
    freeTokens: 50000,
    paidTokens: 12450000,
    maxAgents: 100,
    activeAgents: 28,
    status: "ACTIVE",
    description: "Main Demo User (Enterprise Swarm)",
  },
  ADMIN: {
    id: "usr_admin_platform",
    email: "admin@argusops.dev",
    name: "Platform Administrator",
    role: "ADMIN",
    planName: "Enterprise Superuser",
    freeTokens: 50000,
    paidTokens: 50000000,
    maxAgents: 100,
    activeAgents: 31,
    status: "ACTIVE",
    description: "Platform Admin (Superuser Controls)",
  },
  FREE_TIER: {
    id: "usr_dev_indie",
    email: "dev@localbridge.io",
    name: "Alex Rivera",
    role: "USER",
    planName: "Free Tier",
    freeTokens: 38200,
    paidTokens: 0,
    maxAgents: 3,
    activeAgents: 2,
    status: "PENDING",
    description: "Indie Developer (Upgrade Pending)",
  },
};

interface DashboardContextValue {
  persona: PersonaType;
  setPersona: (p: PersonaType) => void;
  profile: PersonaProfile;
  environment: EnvironmentType;
  setEnvironment: (env: EnvironmentType) => void;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = useState<PersonaType>("DEMO_USER");
  const [environment, setEnvironment] = useState<EnvironmentType>("CLOUD");

  useEffect(() => {
    try {
      const savedPersona = localStorage.getItem("argusops_active_persona") as PersonaType;
      if (savedPersona && PERSONA_PROFILES[savedPersona]) {
        setPersonaState(savedPersona);
      }
      const savedEnv = localStorage.getItem("argusops_active_env") as EnvironmentType;
      if (savedEnv === "CLOUD" || savedEnv === "LOCAL_PC") {
        setEnvironment(savedEnv);
      }
    } catch {
      // localStorage may fail in iframe/private browsing, fallback gracefully
    }
  }, []);

  const setPersona = (p: PersonaType) => {
    setPersonaState(p);
    try {
      localStorage.setItem("argusops_active_persona", p);
    } catch {
      // ignore
    }
  };

  const handleSetEnvironment = (env: EnvironmentType) => {
    setEnvironment(env);
    try {
      localStorage.setItem("argusops_active_env", env);
    } catch {
      // ignore
    }
  };

  const profile = PERSONA_PROFILES[persona];

  return (
    <DashboardContext.Provider
      value={{
        persona,
        setPersona,
        profile,
        environment,
        setEnvironment: handleSetEnvironment,
      }}
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

