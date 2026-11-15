import { parseProxyArgs, parseRunArgs } from "./args";
import { LocalHub } from "../../core/src/hub";
import { loadPrices } from "../../core/src/prices";
import { runAgent } from "../../core/src/run";
import { pointWorkspaceAtProxy, snippet } from "../../core/src/ide-settings";
import { Store } from "../../core/src/store";
import { startControlApi } from "../../core/src/control-api";
import { webhookNotifier } from "../../core/src/webhooks";
import * as commands from "./commands";

export const VERSION = "0.5.0";

const HELP = `argus ${VERSION}: supervise your AI coding agents, on your own machine

Usage:
  argus run [options] claude [claude args...]    run Claude Code under supervision
  argus run [options] codex [codex args...]      run OpenAI Codex under supervision (OpenAI API format)
  argus run [options] -- <command> [args...]     run any agent that talks to the Anthropic API (or OpenAI with --provider openai)
  argus ide                                       one step for the Claude Code panel in VS Code or Antigravity:
                                                  points this folder's panel at Argus, undoes it on Ctrl+C
  argus proxy [options]                           supervise an agent you start yourself

  argus status [--json]                           what is running, what is paused and why
  argus resume [agent] [--approve | --hint "..."]  continue a paused agent (approve the suggested instruction, or write your own)
  argus pause [agent]    argus stop [agent]       hold or end an agent
  argus usage [--range 24h|7d|30d]                tokens and estimated cost
  argus alerts [--all]                            what ArgusOps has told you
  argus webhook [list|add <url>|remove <url>|test]  also post alerts to Slack, Discord or any URL
  argus check [--since <ref>] [--no-checks] [--json] [--alert] [folder]
                                                  look at what an agent changed (default: since the last commit)
  argus watch [folder]                            check a folder automatically whenever the agent stops writing
  argus project [status|allow|deny] [folder]      allow ArgusOps to run this project's tests, lint and build
  argus supervisor [off|alert|redirect] [--max-turn-tokens <n>]
                                                  how ArgusOps reacts to problems in an agent's turn (default: alert)
  argus agents                                    the AI agents and editors on this machine, and what ArgusOps can do for each
  argus disconnect [--force]                      remove a leftover editor setting that points at a proxy that is gone
  argus serve [--port <n>]                        run the local control API (127.0.0.1 only) for apps and editors

Run options (before the agent):
  --offline            save nothing to disk (no history, no outside control)
  --name <label>       the name shown for this agent
  --upstream <url>     send model calls somewhere other than the provider's own address
  --provider <name>    anthropic (default) or openai: which API format the agent speaks

Proxy options (argus proxy, argus ide):
  --port <n>           listen on this port (default 47821)
  --provider, --offline, --name <label>, --upstream <url>   as above

Environment:
  ARGUSOPS_HOME        where ArgusOps keeps its files (default ~/.argusops)

Everything stays on this machine. Your prompts and code go straight to the model
provider; nothing is sent to ArgusOps because there is no ArgusOps server.`;

const out = (m: string) => process.stdout.write(m + "\n");
const err = (m: string) => process.stderr.write(m + "\n");

/** The local store, hub and turn supervisor, or nothing when `--offline` asks for nothing to be saved. */
function openHub(offline: boolean) {
  if (offline) return { hub: null, supervise: undefined };
  const store = new Store();
  void store.prune().catch(() => undefined); // old history is dropped quietly; failing to is not worth a message
  const notify = webhookNotifier(store);
  return { hub: new LocalHub(store, loadPrices(store.root), { onNotification: notify }), supervise: { store, root: process.cwd(), onNotification: notify } };
}

async function run(argv: string[]): Promise<number> {
  const parsed = parseRunArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const { spec } = parsed;
  return runAgent({
    label: spec.label,
    type: spec.type,
    command: spec.command,
    args: spec.args,
    provider: spec.provider,
    upstream: spec.upstream,
    baseUrlEnv: spec.baseUrlEnv,
    cwd: process.cwd(),
    ...openHub(spec.offline),
  });
}

async function proxy(argv: string[]): Promise<number> {
  const parsed = parseProxyArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const { spec } = parsed;
  return runAgent({
    label: spec.label,
    type: spec.type,
    args: [],
    provider: spec.provider,
    upstream: spec.upstream,
    baseUrlEnv: spec.baseUrlEnv,
    cwd: process.cwd(),
    ...openHub(spec.offline),
    port: spec.port,
  });
}

async function ide(argv: string[]): Promise<number> {
  const parsed = parseProxyArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const baseUrl = `http://127.0.0.1:${parsed.spec.port}`;
  const r = pointWorkspaceAtProxy(process.cwd(), baseUrl);
  if ("error" in r) {
    out(`${r.error} Add this to it yourself:\n\n${snippet(baseUrl)}\n`);
  } else {
    out('Set up this folder for Argus. In your editor, run "Developer: Reload Window" once, then use Claude as normal.');
    out("Ctrl+C here stops Argus and undoes the setting (reload the window again afterwards).");
  }
  try {
    return await proxy(argv);
  } finally {
    if (!("error" in r)) r.undo();
  }
}

const io = { out, err };

async function serve(argv: string[]): Promise<number> {
  const store = new Store();
  let port = store.config().apiPort;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = a === "--port" ? argv[++i] : a.startsWith("--port=") ? a.slice(7) : null;
    if (v === null) return (err(`Unknown option ${a}.`), 1);
    port = Number(v);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return (err("--port must be a whole number between 1024 and 65535."), 1);
  }
  let api;
  try {
    api = await startControlApi({ store, port, version: VERSION, onNotification: webhookNotifier(store) });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  out(`ArgusOps control API on ${api.url} (this machine only). Press Ctrl+C to stop.`);
  out(`Programs must send the token from ${store.root}${process.platform === "win32" ? "\\" : "/"}control.token in the x-argus-token header.`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await api.close();
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
      return run(rest);
    case "status":
      return commands.status(new Store(), io, rest.includes("--json"));
    case "resume":
      return commands.resume(new Store(), io, rest);
    case "pause":
      return commands.pause(new Store(), io, rest);
    case "stop":
      return commands.stop(new Store(), io, rest);
    case "usage":
      return commands.usage(new Store(), io, rest);
    case "alerts":
      return commands.alerts(new Store(), io, rest);
    case "webhook":
    case "webhooks":
      return commands.webhook(new Store(), io, rest);
    case "check":
      return commands.check(new Store(), io, rest);
    case "project":
      return commands.project(new Store(), io, rest);
    case "watch": {
      const stop = new AbortController();
      process.once("SIGINT", () => stop.abort());
      process.once("SIGTERM", () => stop.abort());
      return commands.watch(new Store(), io, rest, stop.signal);
    }
    case "supervisor":
      return commands.supervisor(new Store(), io, rest);
    case "agents":
      return commands.agents(io);
    case "disconnect":
      return commands.disconnect(io, rest);
    case "serve":
      return serve(rest);
    case "ide":
      return ide(rest);
    case "proxy":
      return proxy(rest);
    case "-v":
    case "--version":
    case "version":
      out(VERSION);
      return 0;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      out(HELP);
      return cmd === undefined ? 1 : 0;
    default:
      err(`Unknown command "${cmd}".\n`);
      out(HELP);
      return 1;
  }
}

/**
 * Set the exit code and let Node exit on its own. Calling process.exit() while sockets are still closing
 * crashes Node on Windows (libuv assertion), turning a clean exit into a failure code. The unref'd timer is
 * only a safety net for a handle that never closes.
 */
function finish(code: number) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
}

main(process.argv.slice(2)).then(finish, (e) => {
  err(`argus: ${e instanceof Error ? e.message : e}`);
  finish(1);
});
