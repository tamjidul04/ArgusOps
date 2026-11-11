import os from "node:os";
import { spawn } from "node:child_process";
import { parseProxyArgs, parseRunArgs } from "./args";
import { CloudClient, CloudError } from "./api";
import { clearToken, loadConfig, saveConfig } from "./config";
import { runAgent } from "./run";
import { pointWorkspaceAtProxy, snippet } from "./ide-settings";

export const VERSION = "0.2.0";

const HELP = `argus ${VERSION}: supervise your AI coding agents

Usage:
  argus login [--api-url <url>] [--no-browser]   connect this machine to your ArgusOps account
  argus run [options] claude [claude args...]    run Claude Code under supervision
  argus run [options] -- <command> [args...]     run any agent that talks to the Anthropic API
  argus ide                                       one step for the Claude Code panel in VS Code: signs you in if needed,
                                                  points this folder's panel at Argus, and undoes it on Ctrl+C
  argus proxy [options]                           supervise an agent you start yourself, e.g. the Claude Code
                                                  panel in VS Code (see "Use it from VS Code" in the docs)
  argus whoami                                    show who you're signed in as
  argus logout                                    forget this machine's key
  argus status                                    check the connection

Run options (before the agent):
  --offline            supervise locally and report nothing to the cloud
  --name <label>       the name shown in the dashboard
  --upstream <url>     send model calls somewhere other than api.anthropic.com

Proxy options (argus proxy):
  --port <n>           listen on this port (default 47821)
  --offline, --name <label>, --upstream <url>   as above

Environment:
  ARGUS_API_URL        ArgusOps server (default http://localhost:3000)
  ARGUS_API_KEY        use this key instead of the saved login (CI)

Your prompts and code go straight to the model provider. Only token counts and
incident reports are sent to ArgusOps.`;

const out = (m: string) => process.stdout.write(m + "\n");
const err = (m: string) => process.stderr.write(m + "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openBrowser(url: string) {
  try {
    const [cmd, args] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // the URL is printed too, so nothing is lost
  }
}

async function login(argv: string[]): Promise<number> {
  const cfg = loadConfig();
  let apiUrl = cfg.apiUrl;
  let browser = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--no-browser") browser = false;
    else if (argv[i] === "--api-url" && argv[i + 1]) apiUrl = argv[++i].replace(/\/+$/, "");
    else if (argv[i].startsWith("--api-url=")) apiUrl = argv[i].slice(10).replace(/\/+$/, "");
    else {
      err(`Unknown option ${argv[i]}.`);
      return 1;
    }
  }

  const cloud = new CloudClient(apiUrl);
  let dc;
  try {
    dc = await cloud.deviceCode(os.hostname());
  } catch (e) {
    err(`Couldn't reach ${apiUrl}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }

  out(`\nTo connect this machine, open:\n\n  ${dc.verification_uri_complete}\n\nand confirm the code:  ${dc.user_code}\n`);
  if (browser) openBrowser(dc.verification_uri_complete);
  out("Waiting for approval...");

  let wait = Math.max(1, dc.interval) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    try {
      const token = await cloud.pollToken(dc.device_code);
      saveConfig({ apiUrl, token: token.access_token, user: token.user });
      out(`\nSigned in as ${token.user.email}. Try: argus run claude`);
      return 0;
    } catch (e) {
      if (!(e instanceof CloudError)) continue;
      if (e.code === "authorization_pending") continue;
      if (e.code === "slow_down") wait += 5000;
      else if (e.code === "access_denied") return (err("\nThe request was denied in the browser."), 1);
      else if (e.code === "expired_token") break;
      else if (e.code === "network") continue;
      else return (err(`\nSign-in failed: ${e.message}`), 1);
    }
  }
  err("\nThe code expired. Run `argus login` again.");
  return 1;
}

async function whoami(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg.token) {
    err("Not signed in. Run: argus login");
    return 1;
  }
  try {
    const me = await new CloudClient(cfg.apiUrl, cfg.token).me();
    out(`${me.user.name} <${me.user.email}>`);
    if (me.subscription) out(`Plan: ${me.subscription.plan_name} (${me.active_agents}/${me.subscription.max_agents} agents active)`);
    out(`Server: ${cfg.apiUrl}`);
    return 0;
  } catch (e) {
    if (e instanceof CloudError && e.status === 401) err("This key is no longer valid. Run: argus login");
    else err(`Couldn't reach ${cfg.apiUrl}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

async function run(argv: string[]): Promise<number> {
  const parsed = parseRunArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const { spec } = parsed;
  const cfg = loadConfig();

  let cloud: CloudClient | null = null;
  if (!spec.offline) {
    if (!cfg.token) {
      err("You're not signed in. Run `argus login` first, or use --offline to supervise locally.");
      return 1;
    }
    cloud = new CloudClient(cfg.apiUrl, cfg.token);
  }

  return runAgent({
    label: spec.label,
    type: spec.type,
    command: spec.command,
    args: spec.args,
    provider: spec.provider,
    upstream: spec.upstream,
    baseUrlEnv: spec.baseUrlEnv,
    cwd: process.cwd(),
    cloud,
  });
}

async function ide(argv: string[]): Promise<number> {
  const parsed = parseProxyArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const { spec } = parsed;
  if (!spec.offline && !loadConfig().token) {
    const code = await login([]);
    if (code !== 0) return code;
  }
  const baseUrl = `http://127.0.0.1:${spec.port}`;
  const r = pointWorkspaceAtProxy(process.cwd(), baseUrl);
  if ("error" in r) {
    console.log(`${r.error} Add this to it yourself:

${snippet(baseUrl)}
`);
  } else {
    console.log("Set up this folder for Argus. In VS Code, run \"Developer: Reload Window\" once, then use Claude as normal.");
    console.log("Ctrl+C here stops Argus and undoes the setting (reload the window again afterwards).");
  }
  try {
    return await proxy(argv);
  } finally {
    if (!("error" in r)) r.undo();
  }
}

async function proxy(argv: string[]): Promise<number> {
  const parsed = parseProxyArgs(argv);
  if (!parsed.ok) {
    err(parsed.error);
    return 1;
  }
  const { spec } = parsed;
  const cfg = loadConfig();

  let cloud: CloudClient | null = null;
  if (!spec.offline) {
    if (!cfg.token) {
      err("You're not signed in. Run `argus login` first, or use --offline to supervise locally.");
      return 1;
    }
    cloud = new CloudClient(cfg.apiUrl, cfg.token);
  }

  return runAgent({
    label: spec.label,
    type: spec.type,
    args: [],
    provider: spec.provider,
    upstream: spec.upstream,
    baseUrlEnv: spec.baseUrlEnv,
    cwd: process.cwd(),
    cloud,
    port: spec.port,
  });
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "login":
      return login(rest);
    case "logout":
      clearToken();
      out("Signed out. (Revoke the key itself from the dashboard under Local PC Bridge.)");
      return 0;
    case "whoami":
    case "status":
      return whoami();
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
