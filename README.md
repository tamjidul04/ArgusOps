# ArgusOps

A supervisor for AI coding agents. ArgusOps watches the agents you run (Claude Code, Codex, Gemini and others), detects loops and wasted tokens, pauses or stops the agent, and tells you. A later phase adds an autopilot that plans a project, asks you questions, and routes each task to the best model.

> **Status: early development (v0.2).** The website, accounts, billing plans and the control-plane database are real. The `argus run` CLI, the real provider-forwarding proxy and the VS Code extension are the next milestones. See [.gsd/SPEC.md](.gsd/SPEC.md) and [.gsd/ROADMAP.md](.gsd/ROADMAP.md).

## What works today

| Area | State |
|---|---|
| Accounts | Email + password (scrypt), Google and GitHub sign-in, hashed server-side sessions, optional TOTP 2FA |
| Plans and wallet | Free (2 concurrent agents), Pro (10), Enterprise (custom); upgrades and top-ups go through an admin approval queue until a payment gateway is connected |
| Agent limits | Enforced when a daemon registers or wakes an agent |
| Loop detector | Exact repeats, ping-pong and cycle patterns, and paraphrased (semantic) loops; thresholds come from each user's policy; typically a few milliseconds |
| Control plane | Per-user policy, incident log, file locks with expiry, pause / resume / stop state, all stored in MySQL |
| Dashboard | Cluster view, guardrails, local bridge and API keys, billing, admin panel |
| Proxy `/api/v1/proxy` | Authenticated by API key (hash lookup only). It meters requests, applies the loop breaker and wallet checks, but **does not call a real model yet**: replies are simulated |

## Not built yet

- `argus run <agent>` CLI that owns the agent process (real pause / resume) and the forwarding proxy with provider-reported token counts
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

## Tests

```bash
npm test                    # unit tests (no database needed)
npm run test:integration    # real-database tests (needs DATABASE_URL and a seeded database)
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
