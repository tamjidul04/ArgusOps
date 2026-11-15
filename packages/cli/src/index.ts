import { parseProxyArgs, parseRunArgs } from "./args";
import { LocalHub } from "../../core/src/hub";
import { loadPrices } from "../../core/src/prices";
import { runAgent } from "../../core/src/run";
import { pointWorkspaceAtProxy, snippet } from "../../core/src/ide-settings";
import { Store } from "../../core/src/store";

export const VERSION = "0.5.0";

const HELP = `argus ${VERSION}: supervise your AI coding agents, on your own machine

Usage:
  argus run [options] claude [claude args...]    run Claude Code under supervision
  argus run [options] -- <command> [args...]     run any agent that talks to the Anthropic API
  argus ide                                       one step for the Claude Code panel in VS Code or Antigravity:
                                                  points this folder's panel at Argus, undoes it on Ctrl+C
  argus proxy [options]                           supervise an agent you start yourself

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
  return new LocalHub(store, loadPrices(store.root));
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

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
      return run(rest);
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
