# ROADMAP.md

> **Current Phase**: 0 — Foundation and honesty
> **Version**: 0.x (single source of truth: `package.json`)

## Phase 0: Foundation and honesty (1–2 weeks)
- [ ] Reconcile version numbers, PRD, README and `.antigravityrules` (tiers, daemon RAM budget)
- [ ] Sessions, `src/proxy.ts` route guard, admin role check, scoped `/api/keys`
- [ ] Hash-only API-key lookup; remove demo key and password fallback; real TOTP
- [ ] Replace in-memory stores with Prisma models
- [ ] Schema: `UsageEvent`, `Incident`, `Policy`, `Notification`, `NotificationChannel`, `PromptRewrite`, `Session`, `CliDevice`, `ModelPrice`
- [ ] Enforce agent limits and token caps; seed Free 2 / Pro 10 / Enterprise custom; remove free top-ups
- [ ] Add `vitest`; port `test-proxy.ts`

## Phase 1: Guardian MVP (6–8 weeks)
- [ ] Real forwarding proxy with provider adapters and real usage
- [ ] Detectors: loop (policy-driven), waste, wrong prompt
- [ ] `packages/cli`: `argus run`, PTY, pause/resume/kill/nudge, device pairing
- [ ] Prompt rewrite flow with approval and diff
- [ ] Notifications: email, webhook, toast, VS Code, desktop
- [ ] Website wired to real data; incidents feed; device pairing page
- [ ] `packages/vscode` extension
- [ ] Stripe billing and limit enforcement

## Phase 2: Autopilot
- [ ] LLM planner with clarifying questions, plan, design approval
- [ ] Runtime model router across Claude, GPT, Gemini
- [ ] Supervised sub-agents with the file mutex
- [ ] Deeper VS Code control
