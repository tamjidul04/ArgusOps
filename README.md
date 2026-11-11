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
| VS Code extension | An **Overview** panel (needs-you cards with Approve and Stop, agents against your limit, tokens left, 7-day usage, latest alerts) and an **ArgusOps** view in the activity bar that lists your agents (running, paused, stopped) with tokens used, why a paused one stopped and its suggested instruction; alerts with Approve suggestion / Edit / Stop; a status bar item that turns amber when an agent needs you; resume and stop from the view or the command palette. Sign in through the browser or with a key |
| Usage & Savings page | Real tokens, estimated spend at list prices, model calls, loops caught and savings from prompt caching, per hour or day over 24h / 7d / 30d, by agent and by model, with the plan allowance |
| Suggested instructions (prompt rewrite) | When an agent loops, ArgusOps writes a short corrective instruction from the steps it kept repeating and the error it kept hitting, shows what the loop really cost, and lets you approve, edit or dismiss it; approving resumes the agent with it. Optional auto-resume (once per 30 minutes per agent). If the server has its own key (`ARGUS_REWRITE_API_KEY`), a small model polishes the wording; your own model key is never used |
| Notifications | When an agent is paused or stopped, or the token allowance runs out: a bell and pop-up in the dashboard, an optional browser alert, a desktop pop-up from the CLI (Windows, macOS, Linux), and webhooks (Slack, Discord or any https endpoint) |
| Proxy `/api/v1/proxy` (legacy, server-side) | Authenticated by API key (hash lookup only). It meters requests, applies the loop breaker and wallet checks, but **does not call a real model yet**: replies are simulated |

## Not built yet

- CLI support for Codex and Gemini (Claude Code only today), and `argus resume` from a terminal
- Email notifications (needs an email provider)
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
| `ARGUS_REWRITE_API_KEY` | Optional: the server operator's own Anthropic key, used only to polish suggested instructions (only the repeated steps are sent). `ARGUS_REWRITE_MODEL` and `ARGUS_REWRITE_API_URL` override the model and endpoint |
| `ARGUS_ALLOW_PRIVATE_WEBHOOKS` | Set to `1` only to allow webhooks to http or private-network addresses in production (they are always allowed in development) |
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

Set `ARGUS_API_URL` to point at a deployed server (default `http://localhost:3000`). The CLI shows a desktop notification when an agent is paused or stopped; set `ARGUS_NO_DESKTOP_NOTIFY=1` to turn that off.

### Try it for free (no Anthropic account, no token spend)

Claude Code is free to install; only its model calls cost money. `packages/cli/e2e/fake-anthropic.mjs` is a local stand-in for the Anthropic API, so you can run the **real** Claude Code through ArgusOps at no cost:

```bash
npm install -g @anthropic-ai/claude-code
npm run dev                         # in one terminal
npm run test:vscode         # loads the extension in a real VS Code (throwaway profile); checks it activates and registers its commands
npm run test:claude                 # in another: real Claude Code is made to loop, ArgusOps pauses it, resumes it with a hint
```

To poke at it by hand: `node packages/cli/e2e/fake-anthropic.mjs 8787 --loop`, then run `ANTHROPIC_API_KEY=sk-ant-fake argus run --upstream http://127.0.0.1:8787 claude`. Without `--loop` the fake provider just answers every message with a canned reply.

## Supervising the Claude Code panel in VS Code

In your project folder run `argus ide`. It signs you in if needed, points that folder's Claude Code panel at Argus, and undoes it on Ctrl+C. Run **Developer: Reload Window** once in VS Code, then use Claude as normal. Sessions share one agent named "Claude Code (IDE)"; Stop makes the proxy refuse requests with a 403. Advanced: `argus proxy` runs only the proxy (options `--port`, `--name`, `--offline`) if you want to set `claudeCode.environmentVariables` yourself.

## The VS Code extension

`packages/vscode` is the editor companion to the CLI. It shows the agents you run with `argus run`, alerts you when one is paused, and lets you approve ArgusOps' suggested instruction (or edit it), resume, or stop the agent without leaving VS Code.

**Install (no terminal):** sign in to the website, open **Local PC Bridge**, click **Download extension**, then in VS Code open the Extensions panel (`Ctrl+Shift+X`), click the `⋯` menu, choose **Install from VSIX…** and pick the file. Reload if asked.

**For maintainers:** `npm run vscode:release` builds the extension and refreshes `public/downloads/argusops-vscode.vsix`, which the website serves. Run it whenever the extension changes, and commit the result. `npm run vscode:package` builds a versioned `.vsix` inside `packages/vscode` instead.

**Marketplace (so users can install from the Extensions search box):** create a free publisher at https://marketplace.visualstudio.com/manage, create an Azure DevOps personal access token with the *Marketplace > Manage* scope, then from `packages/vscode` run `npx @vscode/vsce login tamjidul04` and `npx @vscode/vsce publish`. The publisher id in `packages/vscode/package.json` must match the one you create. Open VSX (https://open-vsx.org) works the same way for VS Code forks.
After installing, a shield icon named **ArgusOps** appears in the left bar and a first-run message offers to sign in; you can also run **ArgusOps: Sign in** from the command palette (it opens the same browser approval page as `argus login`). Settings: `argusops.serverUrl`, `argusops.pollIntervalSeconds`, `argusops.notifications`. The key is kept in VS Code's secret storage and is only ever sent to the server it was issued by. A device key can read your agents and resume or stop them; it cannot change settings, billing, API keys or webhooks.

## Tests

```bash
npm test                    # unit tests (no database needed)
npm run test:integration    # real-database tests (needs DATABASE_URL and a seeded database)
npm run test:e2e            # real CLI + running app (start `npm run dev` first); plays operator end to end
npm run test:claude         # same, with the REAL Claude Code and a free fake model (needs `claude` installed)
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
packages/vscode/               the VS Code extension (Agents view, alerts, resume/stop)
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

## License

Copyright (c) 2026 MD.Tamjidul Islam. **All rights reserved.** The source is visible for reference only; see [LICENSE](LICENSE). Using, copying, modifying or reselling it requires written permission.
