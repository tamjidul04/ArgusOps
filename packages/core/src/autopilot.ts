import crypto from "node:crypto";
import { describeCheck, runChecks, type CheckResult } from "./acceptance";
import type { TurnResult } from "./claude-session";
import { SessionError } from "./claude-session";
import { Controls } from "./control";
import type { Finding, Severity } from "./findings";
import type { GateResult } from "./gates";
import { inspectChanges } from "./inspect";
import type { Plan, PlanStep } from "./planner";
import type { RouteHint } from "./routing";
import type { Store } from "./store";
import { assessClaims } from "./supervisor";
import { diffSnapshots, takeSnapshot, type Snapshot } from "./workspace";

/**
 * Autopilot: carries out an approved plan one step at a time with an agent, checking each step before moving on.
 *
 * For every step: take a snapshot, give the agent the step, wait until it hands back, then check the work (acceptance
 * checks from the plan, the workspace findings, the project's own checks if allowed, and what the agent claims). A step
 * that is not done gets a correction written from the evidence and another attempt; after the last attempt Autopilot
 * stops and asks you. Everything is saved, so a run can be inspected, paused, resumed or stopped from another terminal.
 */

/** planning and awaiting-answers happen before there is a plan (a run started from the app); the rest as before. */
export type RunStatus = "planning" | "awaiting-answers" | "awaiting-approval" | "running" | "paused" | "needs-you" | "done" | "stopped" | "failed";
export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface StepState {
  id: string;
  status: StepStatus;
  attempts: number;
  costUsd: number;
  /** What was wrong at the last check (empty when it passed). */
  problems: string[];
  checks: Array<{ description: string; ok: boolean; detail: string }>;
  /** The agent's summary when it handed back. */
  lastReply?: string;
}

export interface AutopilotRun {
  id: string;
  goal: string;
  root: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  answers: Array<{ question: string; answer: string }>;
  plan: Plan;
  steps: StepState[];
  costUsd: number;
  /** Written by `argus autopilot pause|stop` from another terminal; read between steps and attempts. */
  control: "pause" | "stop" | null;
  /** Why it stopped and needs you, in plain words. */
  needsYou: string | null;
  /** The agent's conversation, so a resumed run can continue it. */
  sessionId: string | null;
  log: Array<{ ts: number; message: string }>;
  /** The planner's questions, while the run waits for your answers (runs started from the app). */
  questions?: string[];
}

/** What Autopilot needs from the agent: send an instruction, get the turn's result. */
export interface AgentLike {
  send(text: string): Promise<TurnResult>;
}

export interface AutopilotDeps {
  store: Store;
  agent: AgentLike;
  /** Attempts per step, including the first. */
  maxAttempts?: number;
  say?: (message: string) => void;
  /** Called after every change to the run (for a live view). */
  onUpdate?: (run: AutopilotRun) => void;
  /** When a step keeps failing: "retry" (with optional extra words for the agent), "skip" or "stop". Without it, the run stops and waits. */
  decide?: (run: AutopilotRun, step: PlanStep) => Promise<{ action: "retry"; instruction?: string } | { action: "skip" } | { action: "stop" }>;
  /** The agent id the proxy records this run under, so a loop it catches can be answered. */
  agentId?: string;
  checkTimeoutMs?: number;
  /** Tells model routing about the step that is about to be sent: its size, and how many attempts already failed. */
  route?: (hint: RouteHint) => void;
  /** For tests. */
  snapshot?: typeof takeSnapshot;
  pollMs?: number;
}

const RANK: Record<Severity, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/**
 * What model routing should know about a step: small steps may run on a cheaper model; anything else (or a step the
 * planner did not size) stays on yours. Each failed attempt climbs one tier back towards your model.
 */
export function routeHint(step: PlanStep, attempt: number): RouteHint {
  const escalate = Math.max(0, attempt - 1);
  if (step.size === "small") return { difficulty: "simple", escalate, reason: escalate ? `attempt ${attempt} of a small step` : "the plan marks this step as small" };
  return { difficulty: step.size === "large" ? "hard" : "normal", escalate, reason: `the plan marks this step as ${step.size ?? "unsized"}` };
}

export function newRun(goal: string, root: string, plan: Plan, answers: AutopilotRun["answers"], now = Date.now()): AutopilotRun {
  return {
    id: `ap_${crypto.randomBytes(5).toString("hex")}`,
    goal,
    root,
    createdAt: now,
    updatedAt: now,
    status: "awaiting-approval",
    answers,
    plan,
    steps: plan.steps.map((s) => ({ id: s.id, status: "pending", attempts: 0, costUsd: 0, problems: [], checks: [] })),
    costUsd: 0,
    control: null,
    needsYou: null,
    sessionId: null,
    log: [],
  };
}

/** Every command an approved plan may run. Shown to the user before approval: approving the plan approves these. */
export function planCommands(plan: Plan): string[] {
  return [...new Set(plan.steps.flatMap((s) => s.acceptance.flatMap((c) => (c.type === "command" ? [c.command] : []))))];
}

/* --------------------------------- messages to the agent --------------------------------- */

export function stepMessage(run: AutopilotRun, step: PlanStep): string {
  const index = run.plan.steps.findIndex((s) => s.id === step.id);
  const outline = run.plan.steps
    .map((s, i) => {
      const st = run.steps[i]?.status;
      return `${i + 1}. ${s.title}${i === index ? "   <- this step" : st === "passed" ? "   (done)" : st === "skipped" ? "   (skipped)" : ""}`;
    })
    .join("\n");
  const checks = step.acceptance.length ? step.acceptance.map((c) => `- ${describeCheck(c)}`).join("\n") : "- (no specific checks; the project's own checks and a review of your changes)";
  return [
    "You are working through a plan one step at a time, in this project folder. ArgusOps supervises the work and checks each step when you finish.",
    `Goal: ${run.goal}`,
    `Plan:\n${outline}`,
    `Now do step ${index + 1}: ${step.title}\n${step.instructions}`,
    `When you finish, ArgusOps will check that:\n${checks}`,
    "Rules: do only this step. Do not delete, skip or weaken tests, do not silence warnings, and do not leave placeholders or fake data. If something blocks you, say so plainly instead of saying it is done. When finished, reply with a short summary of what you changed and anything that does not work.",
  ].join("\n\n");
}

export function correctionMessage(run: AutopilotRun, step: PlanStep, problems: string[], attempt: number, max: number, extra?: string): string {
  const index = run.plan.steps.findIndex((s) => s.id === step.id) + 1;
  return [
    `ArgusOps checked step ${index} (${step.title}) and it is not done yet:`,
    ...problems.map((p) => `- ${p}`),
    extra ? `From the user: ${extra}` : "",
    `Fix these, then reply with a short summary. Do not work around the checks by deleting or skipping tests. (Attempt ${attempt} of ${max}.)`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ----------------------------------------- checking ----------------------------------------- */

/** The acceptance commands' results, in the shape the claim checker compares against. */
function checksAsGates(results: CheckResult[]): GateResult[] {
  return results
    .filter((r) => r.check.type === "command")
    .map((r) => ({ name: /tests?\b|pytest|jest|vitest|mocha|\bspecs?\b/i.test((r.check as { command: string }).command) ? ("test" as const) : ("build" as const), command: (r.check as { command: string }).command, ok: r.ok, exitCode: r.ok ? 0 : 1, timedOut: false, durationMs: 0, outputTail: r.detail }));
}

export interface StepVerdict {
  passed: boolean;
  problems: string[];
  checks: CheckResult[];
  findings: Finding[];
}

export async function verifyStep(store: Store, root: string, baseline: Snapshot, step: PlanStep, reply: TurnResult, opts: { checkTimeoutMs?: number; snapshot?: typeof takeSnapshot } = {}): Promise<StepVerdict> {
  const after = await (opts.snapshot ?? takeSnapshot)(root);
  const changes = await diffSnapshots(baseline, after);
  const report = await inspectChanges(store, root, changes, { runGates: true });
  const checks = await runChecks(step.acceptance, root, { timeoutMs: opts.checkTimeoutMs });
  const claims = assessClaims(reply.text, [...(report.gates.results ?? []), ...checksAsGates(checks)], []);
  const findings = [...report.findings, ...claims.filter((c) => c.code === "claim-contradicted")].sort((a, b) => RANK[b.severity] - RANK[a.severity]);

  const problems: string[] = [];
  if (reply.isError) problems.push(`Your turn ended with an error: ${reply.text.slice(0, 300) || reply.subtype}`);
  for (const c of checks) if (!c.ok) problems.push(`Check failed: ${describeCheck(c.check)}. ${c.detail}`.trim());
  for (const f of findings) if (f.severity !== "INFO") problems.push(`${f.title}. ${f.detail}${f.evidence.length ? ` (${f.evidence.slice(0, 2).join(" | ")})` : ""}`);
  for (const d of reply.permissionDenials.slice(0, 3)) problems.push(`You were not allowed to use ${d.tool}${d.input && typeof d.input === "object" && "command" in d.input ? ` (${String((d.input as { command: unknown }).command).slice(0, 120)})` : ""}. Find another way that stays within your permissions, or say plainly why you cannot.`);
  // a permission denial alone does not fail a step whose checks pass: the work may have been done another way
  const blocking = problems.filter((p) => !p.startsWith("You were not allowed"));
  return { passed: blocking.length === 0, problems, checks, findings };
}

/* ----------------------------------------- the loop ----------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs (or continues) an approved plan. Returns the run in its final state for now: done, stopped, needs-you, paused or failed. */
export async function executePlan(run: AutopilotRun, deps: AutopilotDeps): Promise<AutopilotRun> {
  const max = Math.max(1, deps.maxAttempts ?? 3);
  const say = deps.say ?? (() => undefined);
  const save = () => {
    // a pause or stop written from another terminal since we last looked must survive our own save
    const disk = deps.store.autopilotRun<AutopilotRun>(run.id);
    if (disk?.control && run.control === null) run.control = disk.control;
    run.updatedAt = Date.now();
    run.costUsd = Math.round(run.steps.reduce((n, s) => n + s.costUsd, 0) * 1_000_000) / 1_000_000;
    deps.store.saveAutopilotRun(run);
    deps.onUpdate?.(run);
  };
  const log = (message: string) => {
    run.log.push({ ts: Date.now(), message });
    if (run.log.length > 500) run.log.splice(0, run.log.length - 500);
    say(message);
  };
  /** Picks up pause/stop written from another terminal. */
  const control = async (): Promise<"go" | "stop"> => {
    for (;;) {
      const saved = deps.store.autopilotRun<AutopilotRun>(run.id);
      if (saved) run.control = saved.control; // null on disk means "carry on" (?? would keep an old pause)
      if (run.control === "stop") return "stop";
      if (run.control !== "pause") return "go";
      if (run.status !== "paused") {
        run.status = "paused";
        log("Paused. Continue with: argus autopilot resume");
        save();
      }
      await sleep(deps.pollMs ?? 1000);
    }
  };

  run.status = "running";
  run.needsYou = null;
  save();

  for (let i = 0; i < run.plan.steps.length; i++) {
    const step = run.plan.steps[i];
    const state = run.steps[i];
    if (state.status === "passed" || state.status === "skipped") continue;

    if ((await control()) === "stop") return finish("stopped", "Stopped by you.");
    run.status = "running";
    state.status = "running";
    state.attempts = 0; // a resumed step gets its attempts back
    log(`Step ${i + 1}/${run.plan.steps.length}: ${step.title}`);
    save();

    const baseline = await (deps.snapshot ?? takeSnapshot)(run.root);
    let message = stepMessage(run, step);

    for (;;) {
      state.attempts++;
      let reply: TurnResult;
      const loopWatch = watchForLoop(deps, run, step);
      deps.route?.(routeHint(step, state.attempts));
      try {
        reply = await deps.agent.send(message);
      } catch (e) {
        loopWatch.stop();
        if (e instanceof SessionError && e.kind === "timeout") {
          reply = { text: "", isError: true, subtype: "timeout", costUsd: 0, permissionDenials: [], sessionId: run.sessionId };
        } else {
          state.status = "failed";
          return finish("failed", `The agent stopped working: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      loopWatch.stop();
      run.sessionId = reply.sessionId ?? run.sessionId;
      state.costUsd += reply.costUsd;
      state.lastReply = reply.text.slice(0, 2000);

      const verdict = await verifyStep(deps.store, run.root, baseline, step, reply, { checkTimeoutMs: deps.checkTimeoutMs, snapshot: deps.snapshot });
      state.problems = verdict.problems;
      state.checks = verdict.checks.map((c) => ({ description: describeCheck(c.check), ok: c.ok, detail: c.detail }));
      if (verdict.passed) {
        state.status = "passed";
        log(`Step ${i + 1} passed${state.attempts > 1 ? ` after ${state.attempts} attempts` : ""}.`);
        save();
        break;
      }
      log(`Step ${i + 1} is not done yet: ${verdict.problems.slice(0, 2).join(" / ")}`);
      save();

      if ((await control()) === "stop") return finish("stopped", "Stopped by you.");
      if (state.attempts < max) {
        message = correctionMessage(run, step, verdict.problems, state.attempts + 1, max);
        continue;
      }
      // out of attempts: ask the human, or stop and wait for them
      if (!deps.decide) {
        state.status = "failed";
        return finish("needs-you", `Step ${i + 1} (${step.title}) still fails after ${max} attempts. Look at it, then: argus autopilot resume ${run.id} (or skip / stop).`);
      }
      run.status = "needs-you";
      run.needsYou = `Step ${i + 1} still fails after ${state.attempts} attempts.`;
      save();
      const choice = await deps.decide(run, step);
      run.needsYou = null;
      if (choice.action === "stop") return finish("stopped", "Stopped by you.");
      if (choice.action === "skip") {
        state.status = "skipped";
        log(`Step ${i + 1} skipped by you.`);
        save();
        break;
      }
      run.status = "running";
      message = correctionMessage(run, step, verdict.problems, state.attempts + 1, state.attempts + 1, choice.instruction);
    }
  }
  return finish("done", null);

  function finish(status: RunStatus, why: string | null): AutopilotRun {
    run.status = status;
    run.needsYou = status === "needs-you" ? why : null;
    if (why) log(why);
    else log(run.plan.steps.length === 1 ? "The step is done." : `All ${run.plan.steps.length} steps are done.`);
    save();
    return run;
  }
}

/**
 * While the agent works on a step, the proxy may catch it looping and hold its next request. Autopilot answers that
 * itself: it approves ArgusOps' suggested correction, so the agent continues with it instead of waiting for a human.
 */
function watchForLoop(deps: AutopilotDeps, run: AutopilotRun, step: PlanStep): { stop(): void } {
  if (!deps.agentId) return { stop() {} };
  const agentId = deps.agentId;
  let stopped = false;
  let answered = 0;
  const tick = async () => {
    while (!stopped) {
      const a = deps.store.agent(agentId);
      if (a?.status === "PAUSED" && answered < 2) {
        answered++;
        const r = a.suggestion?.status === "PENDING" ? await new Controls(deps.store).applySuggestion(agentId) : await new Controls(deps.store).resume(agentId, "You were repeating the same action without progress. Stop, work out why it is not working, and try a different approach.");
        run.log.push({ ts: Date.now(), message: `ArgusOps caught a loop in "${step.title}" and sent the agent a correction.` });
        deps.say?.(`ArgusOps caught a loop in "${step.title}" and sent the agent a correction.`);
        void r;
      }
      await sleep(deps.pollMs ?? 1000);
    }
  };
  void tick();
  return {
    stop() {
      stopped = true;
    },
  };
}

/** A short report for the terminal. */
export function formatRun(run: AutopilotRun): string {
  const icon: Record<StepStatus, string> = { pending: "  ", running: "..", passed: "ok", failed: "!!", skipped: "--" };
  const lines = [`Autopilot ${run.id}: ${run.status}${run.needsYou ? ` (${run.needsYou})` : ""}`, `Goal: ${run.goal}`, `Folder: ${run.root}`, ""];
  run.plan.steps.forEach((s, i) => {
    const st = run.steps[i];
    lines.push(`${icon[st.status]} ${i + 1}. ${s.title}${st.attempts > 1 ? `   (${st.attempts} attempts)` : ""}`);
    if (st.status === "failed" || (st.status === "running" && st.problems.length)) for (const p of st.problems.slice(0, 4)) lines.push(`      - ${p.split("\n")[0].slice(0, 200)}`);
  });
  const cost = run.costUsd > 0 && run.costUsd < 0.01 ? "less than $0.01" : `$${run.costUsd.toFixed(2)}`;
  lines.push("", `Cost so far (reported by Claude Code): ${cost}`);
  return lines.join("\n");
}
