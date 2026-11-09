# ROADMAP.md

> **Current Phase**: 1 — Guardian MVP (Phase 0 complete)
> **Version**: 0.2.0 (single source of truth: `package.json`)

## Phase 0: Foundation and honesty — DONE
- [x] Reconcile version numbers; honest README (PRD v1.1 kept as the original brief)
- [x] Sessions, `src/proxy.ts` route guard, admin role check, owner-scoped keys/billing/pages
- [x] Hash-only API-key lookup; demo key and password fallback removed; real TOTP
- [x] Google and GitHub sign-in (OAuth 2.0, PKCE for Google)
- [x] In-memory stores replaced with Prisma: policy, incidents, file locks, permissions
- [x] Schema: `UsageEvent`, `Incident`, `Policy`, `Notification`, `NotificationChannel`, `PromptRewrite`, `Session`, `CliDevice`, `ModelPrice`, `FileLock`, `OAuthAccount`
- [x] Agent limits enforced at registration/wake (Free 2, Pro 10); free top-ups removed
- [x] Test runner: 44 unit tests + 27 real-database integration tests
- [x] Simulated backends and invented dashboard numbers removed

## Phase 1: Guardian MVP (6–8 weeks)
- [x] Forwarding proxy for Anthropic (Claude Code), local to the user's machine, with provider-reported usage into `UsageEvent` (bring-your-own-key); OpenAI and Google adapters still to do
- [ ] Detectors: waste (context bloat, burn rate) and wrong/unclear prompt check (loop detector already policy-driven)
- [x] `packages/cli`: `argus login` (device pairing), `argus run claude`, pause by holding requests, resume with a hint, stop, plan limits at start; `argus resume` and Codex/Gemini still to do
- [ ] Prompt rewrite flow with approval and diff (`PromptRewrite`)
- [x] Notifications: in-app bell + toast, browser alerts, CLI desktop pop-up, webhooks (Slack/Discord/https, private addresses blocked); email and VS Code still to do
- [x] Usage & savings page from `UsageEvent` (tokens, spend, calls, loops caught, cache savings; by agent and model); device pairing page; incidents feed in Guardrails and Notifications
- [ ] `packages/vscode` extension
- [ ] Stripe billing; monthly token reset
- [ ] Email verification at sign-up (then the OAuth link-wipes-password rule can be relaxed)

## Phase 2: Autopilot
- [ ] LLM planner with clarifying questions, plan, design approval
- [ ] Runtime model router across Claude, GPT, Gemini
- [ ] Supervised sub-agents with the file mutex
- [ ] Deeper VS Code control
