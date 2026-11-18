import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executePlan, planCommands, type AutopilotDeps, type AutopilotRun } from "./autopilot";
import { ClaudeSession } from "./claude-session";
import { consentState, detectGates } from "./gates";
import { agentIdFor, LocalHub } from "./hub";
import type { Plan } from "./planner";
import { loadPrices } from "./prices";
import type { RouteHint } from "./routing";
import { runAgent } from "./run";
import type { Store } from "./store";

/**
 * Carrying out an approved Autopilot plan: the proxy (usage, loops, routing), one headless Claude Code session in the
 * project folder, and the step loop. Shared by `argus autopilot` and the engine behind the desktop app.
 */

/** The agent program: ARGUSOPS_CLAUDE (and, for tests, ARGUSOPS_CLAUDE_ARGS as a JSON list) or `claude` on PATH. */
export function claudeProgram(env: NodeJS.ProcessEnv): { command: string; prefix: string[] } {
  let prefix: string[] = [];
  try {
    const parsed = JSON.parse(env.ARGUSOPS_CLAUDE_ARGS ?? "[]");
    if (Array.isArray(parsed)) prefix = parsed.filter((x) => typeof x === "string");
  } catch {
    prefix = [];
  }
  return { command: env.ARGUSOPS_CLAUDE || "claude", prefix };
}

export function gitState(root: string): "clean" | "dirty" | "none" {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString().trim() ? "dirty" : "clean";
  } catch {
    return "none";
  }
}

/** A short fingerprint of a plan. Approving from the app sends the fingerprint of the plan that was shown, so a plan that changed since cannot be approved by mistake. */
export function planHash(plan: Plan): string {
  return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

/**
 * Checks a folder someone wants Autopilot (or an editor connection) to work in, and returns its real path. Refused: a
 * folder that does not exist, a drive's root, your home folder itself, and ArgusOps' own folder.
 */
export function checkProjectFolder(input: unknown, storeRoot: string): { ok: true; root: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "Choose a project folder." };
  const given = input.trim();
  if (!path.isAbsolute(given)) return { ok: false, error: "Give the folder's full path." };
  let real: string;
  try {
    real = fs.realpathSync.native(given);
    if (!fs.statSync(real).isDirectory()) return { ok: false, error: "That is a file, not a folder." };
  } catch {
    return { ok: false, error: "That folder does not exist." };
  }
  const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(path.parse(real).root, real)) return { ok: false, error: "Pick a project folder, not the root of a drive." };
  let home = os.homedir();
  try {
    home = fs.realpathSync.native(home);
  } catch {
    /* keep it as it is */
  }
  if (same(real, home)) return { ok: false, error: "Pick a project folder, not your whole home folder." };
  let own = storeRoot;
  try {
    own = fs.realpathSync.native(storeRoot);
  } catch {
    /* not created yet */
  }
  const rel = path.relative(own, real);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return { ok: false, error: "That is ArgusOps' own folder." };
  return { ok: true, root: real };
}

export interface ExecuteOptions {
  model?: string;
  maxAttempts: number;
  allowBash: boolean;
  say: (message: string) => void;
  decide?: AutopilotDeps["decide"];
  /** Ends the run early: the agent session is closed and the run is left as it is (the caller marks it). */
  abort?: AbortSignal;
}

/** Starts the proxy and the agent, runs the plan, and cleans up. Returns the run as it ended, or null when the proxy could not start. */
export async function executeRun(run: AutopilotRun, o: ExecuteOptions, store: Store, env: NodeJS.ProcessEnv): Promise<AutopilotRun | null> {
  const name = `Autopilot · ${path.basename(run.root) || "project"}`;
  const stop = new AbortController();
  let baseUrl = "";
  let routeHint: RouteHint | null = null;
  const prices = loadPrices(store.root);
  const proxyDone = runAgent({
    label: name,
    type: "CLAUDE",
    args: [],
    provider: "anthropic",
    upstream: env.ARGUS_UPSTREAM_ANTHROPIC || "https://api.anthropic.com",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    cwd: run.root,
    hub: new LocalHub(store, prices),
    routing: { config: () => store.config().routing, prices, root: run.root, hint: () => routeHint },
    stopSignal: stop.signal,
    onReady: (u) => (baseUrl = u),
    write: () => undefined, // Autopilot reports progress itself
  });
  for (let i = 0; i < 100 && !baseUrl; i++) await new Promise((r) => setTimeout(r, 50));
  if (!baseUrl) {
    stop.abort();
    await proxyDone;
    return null;
  }

  // what the agent may do: edit files in this folder, and run only the commands you approved
  const gates = detectGates(run.root);
  const allowedGates = gates.length && consentState(store, run.root, gates) === "allowed" ? gates.map((g) => g.command) : [];
  const bash = o.allowBash ? ["Bash"] : [...new Set([...planCommands(run.plan), ...allowedGates])].map((c) => `Bash(${c})`);
  const { command, prefix } = claudeProgram(env);
  const session = ClaudeSession.start({
    command,
    args: [
      ...prefix,
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "TodoWrite",
      ...bash,
      ...(o.model ? ["--model", o.model] : []),
      ...(run.sessionId ? ["--resume", run.sessionId] : []),
    ],
    cwd: run.root,
    env: { ...env, ANTHROPIC_BASE_URL: baseUrl },
  });
  const onAbort = () => void session.close(5_000);
  o.abort?.addEventListener("abort", onAbort, { once: true });

  try {
    return await executePlan(run, {
      store,
      agent: session,
      agentId: agentIdFor(name),
      route: (h) => (routeHint = h),
      maxAttempts: o.maxAttempts,
      say: o.say,
      decide: o.decide,
    });
  } finally {
    o.abort?.removeEventListener("abort", onAbort);
    await session.close(10_000);
    stop.abort();
    await proxyDone;
  }
}
