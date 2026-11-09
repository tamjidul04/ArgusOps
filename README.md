# ArgusOps

A supervisor for AI coding agents. ArgusOps watches the agents you run (Claude Code, Codex, Gemini and others), detects loops and wasted tokens, pauses or stops the agent, and tells you. A later phase adds an autopilot that plans a project, asks you questions, and routes each task to the best model.

> **Status: early development (v0.2).** The website, accounts, plans, the control-plane database and the `argus` CLI for Claude Code are working and tested end to end. Notifications, prompt rewrite and the VS Code extension are next. See [.gsd/SPEC.md](.gsd/SPEC.md) and [.gsd/ROADMAP.md](.gsd/ROADMAP.md).

## What works today

| Area | State |
|---|---|
| Accounts | Email + password (scrypt), Google and GitHub sign-in, hashed server-side sessions, optional TOTP 2FA |
| Plans and wallet | Free (2 concurrent agents), Pro (10), Enterprise (custom); upgrades and top-ups go through an admin approval queue until a payment gateway is connected |
| Agent limits | Enforced when a daemon registers or wakes an agent |
| Loop detector | Exact repeats, ping-pong and cycle patterns, and paraphrased (semantic) loops; thresholds come from each user's policy; typically a few milliseconds |
| Control plane | Per-user policy, incident log, file locks with expiry, pause / resume / stop state, all stored in MySQL |
| Dashboard | Cluster view, guardrails, local bridge and API keys, billing, admin panel |
| `argus` CLI | `argus login` (browser approval, no pasted keys), `argus run claude` supervises Claude Code through a proxy on your own machine, reads real token usage, pauses a stuck agent, delivers your hint on resume, and can stop it |
| Proxy `/api/v1/proxy` (legacy, server-side) | Authenticated by API key (hash lookup only). It meters requests, applies the loop breaker and wallet checks, but **does not call a real model yet**: replies are simulated |

## Not built yet

- CLI support for Codex and Gemini (Claude Code only today), and `argus resume` from a terminal
- Prompt rewrite and notifications (email, webhook, VS Code)
- VS Code extension
- Payment gateway (Stripe)
- Autopilot (planning, design review, multi-model routing)

## Run it locally

Requirements: Node 20+ and a MySQL-compatible database (MySQL 8, or TiDB Cloud).

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL (and optional OAuth keys)
npx prisma db push          # create the tables
npm run seed                # plans, model prices, two dev accounts
npm run dev                 # http://localhost:3000
```

Dev logins created by the seed (local only): `admin@argusops.dev` / `ArgusOps-admin-2026` and `demo@argusops.dev` / `ArgusOps-demo-2026`. In production the seed creates only an admin account with a generated password (set `SEED_ADMIN_PASSWORD` to choose it).

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:3306/argusops` (add `?sslaccept=strict` for TiDB Cloud) |
| `APP_URL` | Public origin, used to build OAuth callback URLs (required in production) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Redirect URI: `{APP_URL}/api/auth/oauth/google/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in. Callback URL: `{APP_URL}/api/auth/oauth/github/callback` |

Sign-in buttons for a provider show a "not set up" message until its keys are present.

## The `argus` CLI

You bring your own model credentials: Claude Code keeps using your Anthropic key or login. ArgusOps never sees your prompts or code; the CLI sends only token counts and incident reports.

```bash
npm run cli:build                         # bundles packages/cli into packages/cli/dist/argus.mjs
node packages/cli/dist/argus.mjs login    # prints a code; approve it in the browser at /device
node packages/cli/dist/argus.mjs run claude          # run Claude Code under supervision
node packages/cli/dist/argus.mjs run claude --resume # everything after `claude` goes to Claude Code
node packages/cli/dist/argus.mjs run --offline claude   # supervise locally, report nothing
```

What happens: `argus run` starts a small proxy on 127.0.0.1 and launches Claude Code with `ANTHROPIC_BASE_URL` pointing at it. Each model call is forwarded to Anthropic with your own credentials. If the agent repeats the same failing tool call, its next request is **held** (nothing reaches the provider, so no tokens are spent) and the incident appears in the dashboard's Guardrails page. Resume it there (optionally with a hint, which is added to the next request) or stop it, and the CLI ends the process. The Free plan allows 2 supervised agents at once, Pro 10.

Set `ARGUS_API_URL` to point at a deployed server (default `http://localhost:3000`).

## Tests

```bash
npm test                    # unit tests (no database needed)
npm run test:integration    # real-database tests (needs DATABASE_URL and a seeded database)
npm run test:e2e            # real CLI + running app (start `npm run dev` first); plays operator end to end
npx tsc --noEmit            # type check
```

The integration suite creates temporary users, exercises the proxy, loop breaker, policy, file locks, agent limits and tenant isolation, and deletes everything afterwards.

## Layout

```
src/app/                 pages and API routes (Next.js 16 App Router)
src/proxy.ts             optimistic route guard (every route re-checks auth itself)
src/lib/auth*.ts         sessions, passwords, API keys, TOTP
src/lib/oauth*.ts        Google / GitHub sign-in
src/lib/guardrails-engine.ts   loop detector and mutex logic
src/lib/control-plane*.ts      policy, incidents, locks, agent limits, heartbeat
src/lib/cli-sync.ts            what the CLI reports and what it is told to do
src/app/api/device/            device pairing for `argus login`
packages/cli/                  the `argus` command line tool (local proxy, loop detection, supervisor)
prisma/                  schema and seed
.gsd/                    spec and roadmap
docs/PRD.md              original product brief (v1.1); the spec above supersedes it where they differ
```

`daemon/` holds the earlier prototype process scanner. It is being replaced by the `argus` CLI and no longer works against the authenticated API.

## Security notes

- Passwords are hashed with scrypt; session tokens and API keys are stored only as SHA-256 hashes.
- Every API route and server page checks the session or API key and filters by the owning user. Admin routes require the ADMIN role.
- Cookie-authenticated writes must be same-origin. Login, sign-up and OAuth are rate limited (in memory: use a shared store if you run several instances).
- Signing in with Google or GitHub to an email that already has a password account links the two, and wipes that password and its sessions, because sign-up does not yet verify email addresses.
