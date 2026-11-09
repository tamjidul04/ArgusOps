import React from "react";
import type { Metadata } from "next";
import { Fingerprint, KeyRound, Lock, ShieldCheck, UserCheck, EyeOff } from "lucide-react";
import { PublicShell } from "@/components/layout";
import { Bezel, Container, PageHeader } from "@/components/ui";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "Security",
  description: "How ArgusOps keeps your prompts, code and keys out of reach: a local proxy, hashed credentials, owner-scoped data and limited device keys.",
};

const ITEMS = [
  {
    icon: EyeOff,
    title: "Your prompts and code stay local",
    body: "The proxy runs on 127.0.0.1. Model calls go from your machine to the provider. ArgusOps receives token counts and incident reports only.",
  },
  {
    icon: KeyRound,
    title: "Bring your own key",
    body: "Claude Code keeps using your own Anthropic key or login. ArgusOps never holds it, and never bills you for tokens.",
  },
  {
    icon: Lock,
    title: "Credentials stored as hashes",
    body: "Passwords are hashed with scrypt. Session tokens and API keys are stored only as SHA-256 hashes, so a database leak does not reveal them.",
  },
  {
    icon: UserCheck,
    title: "Every request is owner-scoped",
    body: "Each API route and server page checks the session or key and filters by the owning account. Admin routes require the admin role.",
  },
  {
    icon: Fingerprint,
    title: "Optional two-factor sign-in",
    body: "Turn on TOTP for your account. Sign in with email and password, Google or GitHub.",
  },
  {
    icon: ShieldCheck,
    title: "Limited device keys",
    body: "A key created by argus login can read your agents and resume or stop them. It cannot change settings, billing, API keys or webhooks.",
  },
];

export default function SecurityPage() {
  return (
    <PublicShell>
      <PageHeader
        eyebrow="Security"
        title="Designed so we never need your code."
        lead="The safest data is the data we never receive. Where we do store something, we store as little as we can and protect it."
      />

      <Container className="py-20 md:py-28">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((it) => (
            <Bezel as="li" key={it.title} className="reveal">
              <it.icon className="h-5 w-5 text-slate-900" aria-hidden="true" />
              <h2 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{it.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{it.body}</p>
            </Bezel>
          ))}
        </ul>

        <Bezel className="reveal mt-6" innerClassName="sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Other safeguards</h2>
          <ul className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <li>Writes made with a browser session must come from the same origin.</li>
            <li>Sign-in, sign-up and OAuth are rate limited.</li>
            <li>Webhooks to private-network addresses are blocked in production.</li>
            <li>Linking Google or GitHub to an existing password account clears the password and its sessions, until email verification ships.</li>
          </ul>
        </Bezel>
      </Container>

      <CtaBand />
    </PublicShell>
  );
}
