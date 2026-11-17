# Security

## Reporting a problem

Please report security problems privately through GitHub's "Report a vulnerability" button on the repository's Security tab, not as a public issue. Include what you did and what happened. This is a small open-source project run by one person: expect a reply within a week or so, not hours.

## The model

ArgusOps runs on your computer and talks to nobody except your model provider. There is no ArgusOps server.

**Local engine and app (`argus app`, `argus serve`, the desktop app)**
- Listens on `127.0.0.1` only.
- Any web page you visit can make your browser send requests to `127.0.0.1`, so loopback alone is not enough. Every request must have a Host of exactly `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding), no foreign `Origin` and no cross-site `Sec-Fetch-Site` (stops web pages calling it), and, for anything but `/api/health` and the app's own three files, the secret token from `~/.argusops/control.token` (created with owner-only permissions; compared in constant time).
- No CORS headers are sent. POST bodies must be small valid JSON.
- The app's screens are served with a content policy that allows only its own script and style, no framing, and nothing from other sites. Text from agents and models is only ever shown as plain text. In the terminal app, control characters in such text are replaced before display.
- The token travels in the address fragment (`#t=…`), which is never sent to any server.
- The desktop window runs the screens sandboxed with no Node access, and refuses other sites, new windows and permission requests.

**Running your project's commands**
- Test, lint and build commands (and commands in an Autopilot plan) run only after you allow them: once per project for the project's own checks (re-asked if the commands change, including pre/post scripts), and by approving the plan for Autopilot. Commands run in the project folder with a timeout, and output stays local.
- Autopilot's agent gets file edits inside the project and only the commands you approved. It never runs with `--dangerously-skip-permissions`.

**Editor settings**
- `argus ide` adds one setting pointing the Claude Code panel at the local proxy and removes it when you stop. If a crash leaves it behind, `argus disconnect` removes it. ArgusOps never rewrites an editor settings file that contains comments.

**Webhooks (optional)**
- `argus webhook add <url>` posts alert titles to a URL you choose (Slack, Discord, …). It follows no redirects and gives up after 5 seconds. Nothing is sent unless you add one.

## What it cannot protect you from

- Another program running as you can read `~/.argusops/`, including the token. That is the same trust boundary as your own files.
- Approving a command approves what it does. `npm test` runs whatever test script the project then contains.
- The supervisor's checks are heuristics. A determined agent, or a project with no tests, can get past them.
