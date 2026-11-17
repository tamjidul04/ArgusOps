# Contributing

Thanks for helping. This is a small project, so keep changes focused.

## Set up

```
npm install
npm test
```

Node 20 or newer. The engine is in `packages/core`, commands and the terminal app in `packages/cli`, the app's screens in `packages/ui`, the desktop app in `packages/desktop` (it has its own `package.json`; run `npm install` there, and unset `ELECTRON_RUN_AS_NODE` if your editor sets it). There is no website; the old hosted version is the git tag `hosted-v1`.

## Ground rules

- **Tests with every change.** The suite must pass: `npm test`, and `npx tsc -p tsconfig.packages.json`.
- **Nothing leaves the machine.** No telemetry, no accounts, no calls to anything but the user's model provider (and a webhook the user added).
- **Never run a project's commands without the user's permission.** Use the consent code in `packages/core/src/gates.ts`.
- **Text from agents is untrusted.** In the page use `textContent` only (no `innerHTML`); in the terminal app pass it through `clean()`.
- **Say what is verified.** An agent or feature is "supported" only after a real run proves it; otherwise say "possible" or "observe only".
- Be honest in messages: what happened, why, and what to do next, in plain words.

## Adding an agent

Agents are described in `packages/core/src/registry.ts`. A new API format needs an adapter (`packages/core/src/adapters.ts`, see `openai.ts` for an example) with tests against a fake provider. Please include a note on how you verified it with the real agent.

## Pull requests

Small and focused, with a short description of what and why. Do not commit secrets, build output or files outside the project.
