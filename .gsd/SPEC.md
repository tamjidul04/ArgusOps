# SPEC.md — Project Specification

> **Status**: `FINALIZED`
>
> Derived from the approved plan at `C:\Users\Ashfee\.claude\plans\check-the-whole-code-structured-corbato.md`.

## Vision
ArgusOps is a supervisor "brain" for AI coding agents (Claude Code, Codex/GPT, Gemini). It watches what other agents do, detects loops, waste and bad prompts, pauses the agent, rewrites the prompt to use fewer tokens, and notifies the user. It ships as a website, a terminal CLI and a VS Code extension. A later phase adds an Autopilot that plans, designs, asks the user questions, and routes sub-tasks to the best model.

## Goals
1. **Real control** — `argus run <agent>` owns the agent process, so pause, resume and kill actually work.
2. **Real metering** — a forwarding proxy records provider-reported tokens and cost for every request.
3. **Guardian** — loop, waste and wrong-prompt detection, with prompt rewrite (user approval by default) and notifications.
4. **Three surfaces** — website dashboard, CLI, and VS Code extension, all showing the same state.
5. **Tiers** — Free = 2 concurrent agents; Pro = 5x (10 agents, 5x tokens); Enterprise = custom.
6. **Autopilot (Phase 2)** — plan, design, user Q&A, then multi-model routing on top of the Phase 1 control layer.

## Non-Goals (Out of Scope)
- Autopilot work before Phase 1 ships.
- Deep VS Code control (editing files, opening diffs) before Phase 2.
- Enterprise SSO, on-prem deployment.

## Constraints
- Next.js 16 has breaking changes: read `node_modules/next/dist/docs/` before writing Next code (see `AGENTS.md`).
- Light-mode design system from `.antigravityrules`.
- Prompts and code pass through the proxy, so a local-first mode (proxy local, only metadata to cloud) must stay possible.
- Windows is the primary dev platform, so pause and resume need a Windows implementation as well as POSIX signals.

## Success Criteria
- [ ] No API route is reachable without a session or a valid hashed API key; admin routes check the role.
- [ ] `UsageEvent` rows hold provider-reported tokens from a real agent run.
- [ ] A looping agent is detected and its process is really suspended.
- [ ] A rewrite is proposed, approved, and injected on resume, with a stored diff and token saving.
- [ ] Notifications arrive through email and VS Code.
- [ ] A third concurrent agent on Free is refused; Pro allows 10.

## Technical Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Session auth, route guard, role checks | Must-have | Phase 0 |
| Remove demo key, password fallback, fake 2FA | Must-have | Phase 0 |
| Persist guardrail and bridge state in Prisma | Must-have | Phase 0 |
| Forwarding proxy for Anthropic, OpenAI, Gemini | Must-have | Phase 1 |
| `packages/cli` with PTY spawn and pause/resume | Must-have | Phase 1 |
| Prompt rewrite flow | Must-have | Phase 1 |
| Notifications (email, webhook, toast, VS Code) | Must-have | Phase 1 |
| `packages/vscode` extension | Must-have | Phase 1 |
| Stripe billing and limit enforcement | Must-have | Phase 1 |
| LLM-driven orchestrator and runtime router | Should-have | Phase 2 |

---

*Last updated: 2026-11-09*
