# ArgusOps

**Supervise your AI coding agents, on your own computer.**

ArgusOps sits next to Claude Code (and other agents) and does four things:

- **Catches loops and waste.** An agent that repeats the same failing step is paused, and ArgusOps writes the instruction that gets it unstuck. You approve it with one key.
- **Checks the work, not just the words.** After each turn it looks at what really changed: tests deleted or skipped, placeholders, secrets written to files, and "all tests pass" claims that your own test run contradicts.
- **Autopilot.** Give it a goal. It asks a few questions, writes a step-by-step plan with a check for each step, and after you approve it builds the plan with Claude Code, verifying every step and correcting the agent from the evidence.
- **Right model for the job.** Small tasks can run on a cheaper model, and move back up when the cheaper one struggles. Off by default; you see every switch and what it saved.

Free and open source (MIT). **Everything stays on your computer: there is no ArgusOps server, account or database.** Your prompts and code go straight to your model provider, as they do today.

> **Status: early (0.6).** Verified with real Claude Code 2.1.x on Windows. See [What is verified](#what-is-verified) before relying on it.

## Install

You need Node.js 20 or newer.

```
npm install -g argusops
argus --help
```

Or from source: `npm install && npm run cli:build`, then run `node packages/cli/dist/argus.mjs`.

## Five minutes

**Supervise Claude Code in the terminal**

```
cd your-project
argus run claude
```

**Supervise the Claude Code panel in VS Code (or Antigravity, Cursor...)**

```
argus ide          # in your project folder; Ctrl+C undoes the setting
```

Then run "Developer: Reload Window" once and use Claude as normal.

**See and control everything**

```
argus ui           # opens the app in your browser
argus tui          # the same screens inside the terminal
argus status       # one-off look
```

**Let ArgusOps check each turn's work** (it only runs your project's test/lint/build commands after you allow them once per project):

```
argus project allow
argus supervisor alert      # tell me   (default)
argus supervisor redirect   # tell me, and tell the agent what to fix
```

**Autopilot**

```
argus autopilot "a command-line todo app in Node, with tests"
```

You review the plan and every command it may run. Nothing starts until you approve.

**Cheaper models for small tasks**

```
argus route            # what it would do and what it saved
argus route auto       # switch by itself (default is: only suggest)
```

There is also a desktop app (a window and tray icon around the same engine): `npm run desktop:start` from a source checkout. Installers are not published yet.

## How it works

```
 your agent  ──►  ArgusOps proxy on 127.0.0.1  ──►  model provider
                     │ counts tokens, spots loops, checks each turn
                     ▼
              ~/.argusops/  (plain files)  ◄──  argus ui / tui / cli
```

- The proxy runs on your machine. The agent is pointed at it with a base-URL setting (`ANTHROPIC_BASE_URL`); your credentials pass through untouched.
- Everything ArgusOps remembers is in `~/.argusops/` (or `ARGUSOPS_HOME`): usage, alerts, settings, Autopilot runs. Delete the folder to forget everything. History older than 30 days is dropped.
- The app is served by a local engine on `127.0.0.1` only, behind a private token, Host and Origin checks, and a strict content policy. See [SECURITY.md](SECURITY.md).

## What it will and will not do to your project

- It never runs project commands without your per-project permission (`argus project allow`), and asks again if the commands change.
- Autopilot's agent can edit files only in the project folder and run only the commands you approved (or any command if you pass `--allow-bash`, which warns you). It never uses `--dangerously-skip-permissions`.
- Redirects and routing are rate-limited so ArgusOps cannot loop itself, and every one is logged with its reason.
- Use git. Autopilot warns when the folder is not a repository or is not clean, so you can review or undo what it did.

## What is verified

| Thing | Status |
| --- | --- |
| Claude Code in the terminal and as an editor panel (VS Code, Antigravity) | **Verified** on real runs: loop caught and resumed, sloppy runs flagged, Autopilot built a small project |
| Model routing | **Verified** on real runs (Opus → Sonnet for a rename; escalation after a failed attempt) for the Anthropic API format only |
| OpenAI-format agents (Codex CLI, ...) | Written and tested against a test double; **not yet run with the real Codex** |
| Roo Code, Cline | Detected and described; **not yet verified** |
| Copilot, Gemini Code Assist, Antigravity's own agent | **Observe only** through `argus check`/`argus watch`: they offer no way to route their traffic through ArgusOps |
| Linux and macOS | Built and tested in CI, **not yet used by hand** |

`argus agents` lists what is on your machine and what ArgusOps can do for each.

Known limits: the checks are heuristics and will sometimes miss or over-flag; when you approve `npm test` you approve whatever test script the agent writes, so review in a project you are watching; costs shown are estimates from list prices.

## Commands

`argus --help` lists everything. The main ones: `run`, `proxy`, `ide`, `status`, `pause`, `resume`, `stop`, `usage`, `alerts`, `check`, `watch`, `project`, `supervisor`, `route`, `autopilot`, `agents`, `ui`, `tui`, `serve`, `webhook`.

## Develop

```
npm install
npm test                 # everything
npm run cli:build        # builds packages/cli/dist
npm run test:desktop     # launches the real desktop app (needs a display)
```

Code layout: `packages/core` (the engine), `packages/cli` (commands and terminal app), `packages/ui` (the web page), `packages/desktop` (Electron). `packages/vscode` (an older editor extension) is paused and not published. The `src/` folder is the earlier hosted website, kept for reference and not used; the last hosted version is the git tag `hosted-v1`.

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems as described in [SECURITY.md](SECURITY.md).

## License

MIT. Copyright (c) 2026 MD.Tamjidul Islam.
