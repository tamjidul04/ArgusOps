import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { agentIdFor, type SyncPayload, type SyncTransport } from "./hub";
import type { NotificationRow, Store } from "./store";
import { TurnSupervisor } from "./supervisor";
import { LoopDetector } from "./detect";
import { startProxy, type IncidentOut, type UsageOut } from "./proxy";
import { ControlState } from "./state";
import { desktopNotify } from "./notify";

export interface RunOptions {
  label: string; // "Claude Code"
  type: string; // "CLAUDE"
  /** The agent to launch. Leave out to just run the proxy for an agent that is already running (`argus proxy`). */
  command?: string;
  args: string[];
  provider: string; // "anthropic"
  upstream: string; // https://api.anthropic.com
  baseUrlEnv: string; // ANTHROPIC_BASE_URL
  cwd: string;
  /** Where usage and loops are recorded and where pause, resume and stop come from. null = record nothing, no outside control. */
  hub: SyncTransport | null;
  syncIntervalMs?: number;
  write?: (text: string) => void;
  /** Fixed port for the proxy (serve mode). */
  port?: number;
  /** Resolves when serve mode should stop (tests); Ctrl+C always stops it. */
  stopSignal?: AbortSignal;
  /** Check each of the agent's turns (files, the project's checks, its claims). Needs the local store. */
  supervise?: { store: Store; root: string; onNotification?: (n: NotificationRow) => void };
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
  const interval = opts.syncIntervalMs ?? 500;

  const runId = crypto.randomUUID();
  const agentName = opts.command ? `${opts.label} · ${path.basename(opts.cwd) || "project"}` : opts.label;
  const state = new ControlState();
  const detector = new LoopDetector();
  const queue: unknown[] = [];
  let online = opts.hub !== null;

  const enqueue = (e: unknown) => {
    if (!opts.hub) return;
    queue.push(e);
    if (queue.length > MAX_QUEUED_EVENTS) queue.shift();
  };

  const payload = (flags: { start?: boolean; end?: boolean }, events: unknown[]): SyncPayload => ({
    run: { id: runId, ...flags, agent: { name: agentName, type: opts.type } },
    events,
  });

  /** Sends queued events; on failure the events are kept for the next attempt. */
  async function sync(flags: { start?: boolean; end?: boolean } = {}): Promise<void> {
    if (!opts.hub) return;
    const batch = queue.splice(0, queue.length);
    const epoch = state.epoch;
    try {
      const reply = await opts.hub.sync(payload(flags, batch));
      if (!online) say("Recording works again.");
      online = true;
      detector.setPolicy(reply.policy);
      const before = state.desired;
      state.apply(reply, epoch);
      if (state.desired !== before) {
        if (state.desired === "PAUSE") {
          say(`Paused: ${state.reason || "paused"}. Resume it with: argus resume`);
          desktopNotify(`${agentName} paused`, state.reason || "Paused.");
        } else if (state.desired === "KILL") {
          say(`Stopping: ${state.reason || "stopped"}`);
          desktopNotify(`${agentName} stopped`, state.reason || "Stopped.");
        }
      }
    } catch (e) {
      queue.unshift(...batch);
      if (queue.length > MAX_QUEUED_EVENTS) queue.splice(0, queue.length - MAX_QUEUED_EVENTS);
      if (online) say("Couldn't save to the ArgusOps folder: carrying on with supervision and retrying.");
      online = false;
    }
  }

  // ---- register first, so the agent exists in the store before it starts -----------------------------------------------
  if (opts.hub) {
    try {
      const first = await opts.hub.sync(payload({ start: true }, []));
      detector.setPolicy(first.policy);
      state.apply(first);
    } catch {
      online = false;
      say("Couldn't save to the ArgusOps folder: supervising without recording until it works again.");
    }
  }

  const supervisor = opts.supervise
    ? new TurnSupervisor({ store: opts.supervise.store, root: opts.supervise.root, agentId: agentIdFor(agentName), agentName, say, onNotification: opts.supervise.onNotification })
    : null;

  let proxy: Awaited<ReturnType<typeof startProxy>>;
  try {
    proxy = await startProxy({
    provider: opts.provider,
    upstream: opts.upstream,
    state,
    detector,
    onUsage: (u: UsageOut) => {
      enqueue({ type: "usage", ...u });
      const over = supervisor?.usage(u.input_tokens + u.output_tokens);
      if (over && state.desired === "RUN") {
        state.pauseLocally(over);
        enqueue({ type: "incident", kind: "LOOP", loop_type: "TOKEN_BUDGET", action: "PAUSED", score: 1, detail: over, interception_ms: 0 });
        say(`Paused: ${over}. Resume it with "argus resume" or end it with "argus stop".`);
        desktopNotify(`${agentName} paused`, over);
      }
    },
    onTurnStart: supervisor ? (ev) => supervisor.turnStarted(ev) : undefined,
    onTurnEnd: supervisor ? (ev) => void supervisor.turnEnded(ev) : undefined,
    onIncident: (i: IncidentOut) => {
      enqueue({ type: "incident", ...i });
      // the moment it happens, without waiting for the next save
      desktopNotify(`${agentName} paused`, `${i.detail}. Run "argus resume" or "argus stop".`);
    },
    onNotice: say,
    port: opts.port,
  });
  } catch (e) {
    say(e instanceof Error ? e.message : "Couldn't start the local proxy.");
    return 2;
  }
  const baseUrl = `http://127.0.0.1:${proxy.port}`;

  // ---- start the agent, pointed at the local proxy -----------------------------------------------------------------
  const serve = !opts.command;
  let child: ChildProcess | null = null;
  let exit: Promise<number>;
  let ignore: () => void = () => undefined;

  if (serve) {
    // No child to start: the agent (for example the Claude Code panel in VS Code) is launched by something else and
    // pointed at this proxy with ANTHROPIC_BASE_URL. It runs until Ctrl+C.
    say(`Supervising anything that uses ${opts.baseUrlEnv}=${baseUrl}. Press Ctrl+C to stop.`);
    exit = new Promise<number>((resolve) => {
      const done = () => resolve(0);
      // embedded in an editor (a stopSignal is given): don't touch the host process's signals
      if (!opts.stopSignal) {
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
      }
      opts.stopSignal?.addEventListener("abort", done, { once: true });
    });
  } else {
    const env = { ...process.env, [opts.baseUrlEnv]: baseUrl };
    const win = process.platform === "win32";
    child = win
      ? spawn([opts.command!, ...opts.args.map(quoteWindowsArg)].join(" "), [], { stdio: "inherit", env, cwd: opts.cwd, shell: true })
      : spawn(opts.command!, opts.args, { stdio: "inherit", env, cwd: opts.cwd });
    const c = child;
    exit = new Promise<number>((resolve) => {
      c.once("error", (err: NodeJS.ErrnoException) => {
        say(err.code === "ENOENT" ? `Couldn't find "${opts.command}". Is it installed and on your PATH?` : `Couldn't start "${opts.command}": ${err.message}`);
        resolve(127);
      });
      c.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    // Ctrl+C reaches the agent directly; ArgusOps stays up until it exits so the final report is sent.
    process.on("SIGINT", ignore);
    process.on("SIGTERM", ignore);
  }

  let stopped = false;
  let syncing = false;
  const timer = setInterval(async () => {
    if (syncing || stopped) return;
    syncing = true;
    try {
      await sync();
      if (state.isKilled() && child) killTree(child);
    } catch {
      // a save that fails is retried on the next tick
    } finally {
      syncing = false;
    }
  }, interval);

  const code = await exit;
  stopped = true;
  clearInterval(timer);
  if (!serve) {
    process.off("SIGINT", ignore);
    process.off("SIGTERM", ignore);
  }
  await proxy.close();
  await supervisor?.settle();
  await sync({ end: true }).catch(() => undefined);
  return code;
}
