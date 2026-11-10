# ArgusOps for VS Code

See your AI coding agents, get told when one is stuck, and resume it with a better instruction or stop it, without leaving the editor.

## What you get

- **An Overview panel** at the top of the ArgusOps sidebar: what needs you (with **Approve & resume** and **Stop** buttons), agents running against your plan limit, tokens left, the last 7 days of usage, loops caught and your latest alerts.
- **An Agents view** in the activity bar: every supervised agent with its status (running, paused, stopped), tokens used and what it is doing. A paused agent shows **why** it was paused and ArgusOps' **suggested instruction**.
- **Alerts** when an agent is paused or stopped, with one-click **Approve suggestion**, **Edit…** or **Stop**.
- **A status bar item** that turns amber when something needs you.
- **Resume and stop** from the view, the alert or the command palette.

## Getting started

1. Run the ArgusOps server and install the `argus` CLI (see the repository README).
2. In VS Code run **ArgusOps: Sign in** and approve the code in your browser. (Or paste an API key.)
3. In a terminal run `argus run claude`. Your agent appears in the view.

## Settings

| Setting | Default | |
|---|---|---|
| `argusops.serverUrl` | `http://localhost:3000` | The server to connect to. Changing it signs you out: a key is only sent to the server that issued it. |
| `argusops.pollIntervalSeconds` | `4` | How often agents are checked (2 to 60). |
| `argusops.notifications` | `true` | Show alerts in VS Code. |

## Privacy and permissions

The extension only talks to your ArgusOps server. The key is kept in VS Code's secret storage. It can read your agents and resume or stop them; it cannot change settings, billing, API keys or webhooks. Your prompts and code never pass through it.

## License

Copyright (c) 2026 MD.Tamjidul Islam. All rights reserved.
