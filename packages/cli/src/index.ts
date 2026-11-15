import { parseProxyArgs, parseRunArgs } from "./args";
import { LocalHub } from "../../core/src/hub";
import { loadPrices } from "../../core/src/prices";
import { runAgent } from "../../core/src/run";
import { pointWorkspaceAtProxy, snippet } from "../../core/src/ide-settings";
import { Store } from "../../core/src/store";
import { webhookNotifier } from "../../core/src/webhooks";
import * as commands from "./commands";

export const VERSION = "0.5.0";

const HELP = `argus ${VERSION}: supervise your AI coding agents, on your own machine

Usage:
  argus run [options] claude [claude args...]    run Claude Code under supervision
  argus run [options] -- <command> [args...]     run any agent that talks to the Anthropic API
  argus ide                                       one step for the Claude Code panel in VS Code or Antigravity:
                                                  points this folder's panel at Argus, undoes it on Ctrl+C
  argus proxy [options]                           supervise an agent you start yourself

  argus status [--json]                           what is running, what is paused and why
  argus resume [agent] [--approve | --hint "..."]  continue a paused agent (approve the suggested instruction, or write your own)
  argus pause [agent]    argus stop [agent]       hold or end an agent
  argus usage [--range 24h|7d|30d]                tokens and estimated cost
  argus alerts [--all]                            what ArgusOps has told you
  argus webhook [list|add <url>|remove <url>|test]  also post alerts to Slack, Discord or any URL

Run options (before the agent):
  --offline            save nothing to disk (no history, no outside control)
  --name <label>       the name shown for this agent
  --upstream <url>     send model calls somewhere other than api.anthropic.com

Proxy options (argus proxy, argus ide):
  --port <n>           listen on this port (default 47821)
  --offline, --name <label>, --upstream <url>   as above

Environment:
  ARGUSOPS_HOME        where ArgusOps keeps its files (default ~/.argusops)

Everything stays on this machine. Your prompts and code go straight to the model
provider; nothing is sent to ArgusOps because there is no ArgusOps server.`;

const out = (m: string) => process.stdout.write(m + "\n");
const err = (m: string) => process.stderr.write(m + "\n");

/** The local store and hub, or null when `--offline` asks for nothing to be saved. */
function openHub(offline: boolean): LocalHub | null {
  if (offline) return null;
  const store = new Store();
  void store.prune().catch(() => undefined); // old history is dropped quietly; failing to is not worth a message
  return new LocalHub(store, loadPrices(store.root), { onNotification: webhookNotifier(store) });
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
    hub: openHub(spec.offline),
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
    hub: openHub(spec.offline),
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
