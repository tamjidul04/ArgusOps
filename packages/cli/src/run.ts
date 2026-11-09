import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { CloudClient, CloudError, type SyncPayload } from "./api";
import { LoopDetector } from "./detect";
import { startProxy, type IncidentOut, type UsageOut } from "./proxy";
import { ControlState } from "./state";

export interface RunOptions {
  label: string; // "Claude Code"
  type: string; // "CLAUDE"
  command: string;
  args: string[];
  provider: string; // "anthropic"
  upstream: string; // https://api.anthropic.com
  baseUrlEnv: string; // ANTHROPIC_BASE_URL
  cwd: string;
  cloud: CloudClient | null; // null = offline: supervise locally, report nothing
  syncIntervalMs?: number;
  write?: (text: string) => void;
}

const MAX_QUEUED_EVENTS = 1000;

/** Quote one argument for cmd.exe (only used on Windows, where npm-installed CLIs are .cmd shims). */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000).unref();
  }
}

/** Runs an agent under supervision and resolves with its exit code. */
export async function runAgent(opts: RunOptions): Promise<number> {
  const write = opts.write ?? ((t: string) => process.stderr.write(t));
  const say = (m: string) => write(`\n[argus] ${m}\n`);
  const interval = opts.syncIntervalMs ?? 2000;

  const runId = crypto.randomUUID();
  const agentName = `${opts.label} · ${path.basename(opts.cwd) || "project"}`;
  const state = new ControlState();
  const detector = new LoopDetector();
  const queue: unknown[] = [];
  let online = opts.cloud !== null;

  const enqueue = (e: unknown) => {
    if (!opts.cloud) return;
    queue.push(e);
    if (queue.length > MAX_QUEUED_EVENTS) queue.shift();
  };

  const payload = (flags: { start?: boolean; end?: boolean }, events: unknown[]): SyncPayload => ({
    run: { id: runId, ...flags, agent: { name: agentName, type: opts.type } },
    events,
  });

  /** Sends queued events; on failure the events are kept for the next attempt. */
  async function sync(flags: { start?: boolean; end?: boolean } = {}): Promise<void> {
    if (!opts.cloud) return;
    const batch = queue.splice(0, queue.length);
    const epoch = state.epoch;
    try {
      const reply = await opts.cloud.sync(payload(flags, batch));
      if (!online) say("Reconnected to ArgusOps.");
      online = true;
      detector.setPolicy(reply.policy);
      const before = state.desired;
      state.apply(reply, epoch);
      if (state.desired !== before) {
        if (state.desired === "PAUSE") say(`Paused: ${state.reason || "paused from the dashboard"}`);
        else if (state.desired === "KILL") say(`Stopping: ${state.reason || "stopped from the dashboard"}`);
      }
    } catch (e) {
      queue.unshift(...batch);
      if (queue.length > MAX_QUEUED_EVENTS) queue.splice(0, queue.length - MAX_QUEUED_EVENTS);
      if (e instanceof CloudError && e.status === 401) throw e;
      if (online) say("Can't reach ArgusOps: carrying on with local supervision and retrying.");
      online = false;
    }
  }

  // ---- register with the cloud first, so plan limits apply before the agent starts ---------------------------------
  if (opts.cloud) {
    try {
      const first = await opts.cloud.sync(payload({ start: true }, []));
      detector.setPolicy(first.policy);
      state.apply(first);
    } catch (e) {
      if (e instanceof CloudError && e.status === 403) {
        say(e.message);
        return 2;
      }
      if (e instanceof CloudError && e.status === 401) {
        say("You're not signed in (or this key was revoked). Run: argus login");
        return 2;
      }
      online = false;
      say("Can't reach ArgusOps: starting with local supervision only. Usage won't be reported until it reconnects.");
    }
  }

  const proxy = await startProxy({
    provider: opts.provider,
    upstream: opts.upstream,
    state,
    detector,
    onUsage: (u: UsageOut) => enqueue({ type: "usage", ...u }),
    onIncident: (i: IncidentOut) => enqueue({ type: "incident", ...i }),
    onNotice: say,
  });

  // ---- start the agent, pointed at the local proxy -----------------------------------------------------------------
  const env = { ...process.env, [opts.baseUrlEnv]: `http://127.0.0.1:${proxy.port}` };
  const win = process.platform === "win32";
  const child = win
    ? spawn([opts.command, ...opts.args.map(quoteWindowsArg)].join(" "), [], { stdio: "inherit", env, cwd: opts.cwd, shell: true })
    : spawn(opts.command, opts.args, { stdio: "inherit", env, cwd: opts.cwd });

  const exit = new Promise<number>((resolve) => {
    child.once("error", (err: NodeJS.ErrnoException) => {
      say(err.code === "ENOENT" ? `Couldn't find "${opts.command}". Is it installed and on your PATH?` : `Couldn't start "${opts.command}": ${err.message}`);
      resolve(127);
    });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  // Ctrl+C reaches the agent directly; ArgusOps stays up until it exits so the final report is sent.
  const ignore = () => undefined;
  process.on("SIGINT", ignore);
  process.on("SIGTERM", ignore);

  let stopped = false;
  let syncing = false;
  const timer = setInterval(async () => {
    if (syncing || stopped) return;
    syncing = true;
    try {
      await sync();
      if (state.isKilled()) killTree(child);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) {
        say("This device's key was revoked. Stopping the agent.");
        state.apply({ desired: "KILL", reason: "key revoked" });
        killTree(child);
      }
    } finally {
      syncing = false;
    }
  }, interval);

  const code = await exit;
  stopped = true;
  clearInterval(timer);
  process.off("SIGINT", ignore);
  process.off("SIGTERM", ignore);
  await proxy.close();
  await sync({ end: true }).catch(() => undefined);
  return code;
}
