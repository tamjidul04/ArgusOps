import { execFileSync } from "node:child_process";
import path from "node:path";
import { executePlan, formatRun, newRun, planCommands, type AutopilotRun } from "../../core/src/autopilot";
import { ClaudeSession } from "../../core/src/claude-session";
import { consentState, detectGates } from "../../core/src/gates";
import { agentIdFor, LocalHub } from "../../core/src/hub";
import { askQuestions, claudePlanner, makePlan, projectContext } from "../../core/src/planner";
import { loadPrices } from "../../core/src/prices";
import { runAgent } from "../../core/src/run";
import type { RouteHint } from "../../core/src/routing";
import type { Store } from "../../core/src/store";
import { describeCheck } from "../../core/src/acceptance";

/**
 * `argus autopilot "goal"`: plan with questions, show the plan and every command it may run, get approval, then carry it
 * out step by step with Claude Code under supervision.
 */

export interface AutopilotIo {
  out(text: string): void;
  err(text: string): void;
  /** Asks the person a question and returns their answer. Absent when there is nobody to ask (not a terminal). */
  ask?: (question: string) => Promise<string>;
}

interface Options {
  goal: string;
  yes: boolean;
  questions: boolean;
  model?: string;
  plannerModel?: string;
  maxAttempts: number;
  allowBash: boolean;
}

/** The agent program: ARGUSOPS_CLAUDE (and, for tests, ARGUSOPS_CLAUDE_ARGS as a JSON list) or `claude` on PATH. */
function claudeProgram(env: NodeJS.ProcessEnv): { command: string; prefix: string[] } {
  let prefix: string[] = [];
  try {
    const parsed = JSON.parse(env.ARGUSOPS_CLAUDE_ARGS ?? "[]");
    if (Array.isArray(parsed)) prefix = parsed.filter((x) => typeof x === "string");
  } catch {
    prefix = [];
  }
  return { command: env.ARGUSOPS_CLAUDE || "claude", prefix };
}

function parse(argv: string[]): { ok: true; o: Options } | { ok: false; error: string } {
  const o: Options = { goal: "", yes: false, questions: true, maxAttempts: 3, allowBash: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      if (!v) throw new Error(`${a.split("=")[0]} needs a value.`);
      return v;
    };
    try {
      if (a === "--yes" || a === "-y") o.yes = true;
      else if (a === "--no-questions") o.questions = false;
      else if (a === "--allow-bash") o.allowBash = true;
      else if (a.startsWith("--model")) o.model = value();
      else if (a.startsWith("--planner-model")) o.plannerModel = value();
      else if (a.startsWith("--max-attempts")) {
        o.maxAttempts = Number(value());
        if (!Number.isInteger(o.maxAttempts) || o.maxAttempts < 1 || o.maxAttempts > 10) return { ok: false, error: "--max-attempts must be between 1 and 10." };
      } else if (a.startsWith("--")) return { ok: false, error: `Unknown option ${a}.` };
      else words.push(a);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  o.goal = words.join(" ").trim();
  return { ok: true, o };
}

function gitState(root: string): "clean" | "dirty" | "none" {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString().trim() ? "dirty" : "clean";
  } catch {
    return "none";
  }
}

function showPlan(io: AutopilotIo, run: AutopilotRun, store: Store) {
  io.out(`\nPlan: ${run.plan.summary || run.goal}`);
  run.plan.steps.forEach((s, i) => {
    io.out(`\n${i + 1}. ${s.title}${s.size ? ` (${s.size})` : ""}`);
    for (const line of s.instructions.split("\n").slice(0, 6)) io.out(`   ${line}`);
    for (const c of s.acceptance) io.out(`   check: ${describeCheck(c)}`);
  });
  const commands = planCommands(run.plan);
  io.out("");
  if (commands.length) {
    io.out("Approving this plan lets ArgusOps run these commands in this folder to check the work:");
    for (const c of commands) io.out(`   ${c}`);
  } else io.out("This plan's checks run no commands.");
  const gates = detectGates(run.root);
  if (gates.length) {
    const state = consentState(store, run.root, gates);
    io.out(state === "allowed" ? "The project's own checks are allowed and will run after each step too." : "The project's own checks will not run (not allowed yet: argus project allow).");
  }
}

/** Starts the proxy and the agent, runs the plan, and cleans up. */
async function execute(run: AutopilotRun, o: Pick<Options, "model" | "maxAttempts" | "allowBash">, store: Store, io: AutopilotIo, env: NodeJS.ProcessEnv): Promise<number> {
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
    io.err("Could not start the ArgusOps proxy.");
    return 2;
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

  try {
    const done = await executePlan(run, {
      store,
      agent: session,
      agentId: agentIdFor(name),
      route: (h) => (routeHint = h),
      maxAttempts: o.maxAttempts,
      say: (m) => io.out(`[autopilot] ${m}`),
      decide: io.ask
        ? async (r, step) => {
            const i = r.plan.steps.findIndex((s) => s.id === step.id) + 1;
            for (;;) {
              const a = (await io.ask!(`Step ${i} still fails. [r]etry with an extra instruction, [s]kip it, or s[t]op? `)).trim().toLowerCase();
              if (a === "s" || a === "skip") return { action: "skip" } as const;
              if (a === "t" || a === "stop") return { action: "stop" } as const;
              if (a === "r" || a === "retry") return { action: "retry", instruction: (await io.ask!("What should the agent know? ")).trim() || undefined } as const;
            }
          }
        : undefined,
    });
    io.out(`\n${formatRun(done)}`);
    if (done.status === "done") io.out("\nReview the changes (git diff) before you commit them.");
    return done.status === "done" ? 0 : 1;
  } finally {
    await session.close(10_000);
    stop.abort();
    await proxyDone;
  }
}

export async function autopilotCommand(argv: string[], store: Store, io: AutopilotIo, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<number> {
  const [sub, ...rest] = argv;
  const pick = (id?: string): AutopilotRun | null => (id ? store.autopilotRun<AutopilotRun>(id) : store.autopilotRuns<AutopilotRun>()[0] ?? null);

  if (sub === "list") {
    const runs = store.autopilotRuns<AutopilotRun>();
    if (!runs.length) io.out('No Autopilot runs yet. Start one: argus autopilot "what you want built"');
    for (const r of runs.slice(0, 20)) io.out(`${r.id}  ${r.status.padEnd(17)} ${new Date(r.createdAt).toLocaleString()}  ${r.goal.slice(0, 70)}`);
    return 0;
  }
  if (sub === "status") {
    const r = pick(rest[0]);
    if (!r) return (io.err("No such Autopilot run. See: argus autopilot list"), 1);
    io.out(formatRun(r));
    return 0;
  }
  if (sub === "pause" || sub === "stop") {
    const r = pick(rest[0]);
    if (!r) return (io.err("No such Autopilot run. See: argus autopilot list"), 1);
    if (["done", "stopped", "failed"].includes(r.status)) return (io.err(`That run has already ended (${r.status}).`), 1);
    store.saveAutopilotRun({ ...r, control: sub });
    io.out(sub === "pause" ? "Autopilot will pause after the agent's current turn." : "Autopilot will stop after the agent's current turn.");
    return 0;
  }
  if (sub === "resume") {
    // options with values (e.g. --model x) are parsed as usual; the first plain word is the run id
    const parsed = parse(rest);
    if (!parsed.ok) return (io.err(parsed.error), 1);
    const r = pick(parsed.o.goal.split(" ")[0] || undefined);
    if (!r) return (io.err("No such Autopilot run. See: argus autopilot list"), 1);
    if (r.status === "done") return (io.err("That run is already done."), 1);
    if (r.status === "running") {
      store.saveAutopilotRun({ ...r, control: null });
      io.out("Autopilot will continue.");
      return 0;
    }
    if (r.status === "awaiting-approval" && !(await approve(r, parsed.o.yes))) return 1;
    // a resumed run starts its unfinished step again, with fresh attempts; earlier passed steps are kept
    const fresh: AutopilotRun = { ...r, control: null, status: "running", steps: r.steps.map((s) => (s.status === "failed" || s.status === "running" ? { ...s, status: "pending" } : s)) };
    store.saveAutopilotRun(fresh);
    return execute(fresh, parsed.o, store, io, env);
  }

  // a new run: argus autopilot "goal" [options]
  const parsed = parse(argv);
  if (!parsed.ok) return (io.err(parsed.error), 1);
  const o = parsed.o;
  if (!o.goal) {
    io.err('Say what you want built, e.g.: argus autopilot "a command-line todo app in Node with tests"');
    return 1;
  }
  const root = cwd;
  const git = gitState(root);
  if (git === "none") io.out("Note: this folder is not a git repository, so the agent's changes will be hard to undo. Consider `git init` first.");
  if (git === "dirty") io.out("Note: you have uncommitted changes. Commit or stash them first so you can review (or undo) exactly what Autopilot changed.");

  const { command, prefix } = claudeProgram(env);
  const planner = claudePlanner({ command, extraArgs: prefix, cwd: root, model: o.plannerModel, env });
  const context = projectContext(root);

  const answers: AutopilotRun["answers"] = [];
  if (o.questions) {
    io.out("Thinking about what to ask...");
    const questions = await askQuestions(o.goal, context, planner);
    if (questions.length && io.ask) {
      io.out("A few questions first (press Enter to skip one):");
      for (const q of questions) answers.push({ question: q, answer: (await io.ask(`  ${q}\n  > `)).trim() });
    }
  }
  io.out("Planning...");
  let plan;
  try {
    plan = await makePlan(o.goal, context, answers, planner);
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const run = newRun(o.goal, root, plan, answers);
  store.saveAutopilotRun(run);
  showPlan(io, run, store);
  if (!(await approve(run, o.yes))) return 1;
  return execute(run, o, store, io, env);

  async function approve(r: AutopilotRun, yes: boolean): Promise<boolean> {
    if (yes) {
      io.out("Approved with --yes.");
      return true;
    }
    if (!io.ask) {
      io.out(`\nSaved as ${r.id}. Approve and start it with: argus autopilot resume ${r.id} --yes`);
      return false;
    }
    const a = (await io.ask("\nApprove this plan and start? [y/N] ")).trim().toLowerCase();
    if (a === "y" || a === "yes") return true;
    io.out(`Not started. It is saved as ${r.id}; start it later with: argus autopilot resume ${r.id}`);
    return false;
  }
}
