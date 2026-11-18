import crypto from "node:crypto";
import type { AutopilotRun } from "./autopilot";
import { checkProjectFolder, claudeProgram, executeRun, planHash } from "./autopilot-runner";
import { askQuestions, claudePlanner, makePlan, projectContext, type PlannerModel } from "./planner";
import type { Store } from "./store";

/**
 * Autopilot runs started from the desktop app. The engine (the app, or `argus serve`) owns them: it plans, waits for
 * your answers and your approval, then builds the plan, exactly as `argus autopilot` does in a terminal.
 *
 * Consent is the same as in the terminal, and it cannot be skipped:
 *   - nothing runs until you approve the plan, and approval must name the fingerprint of the plan you were shown;
 *   - the agent may edit files in the folder and run only the commands listed in that plan (and the project's own
 *     checks if you allowed them); "any command" cannot be turned on from the app;
 *   - the folder must be a real project folder (not a drive's root, your home folder or ArgusOps' own folder).
 */

export class JobError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface AutopilotJobsOptions {
  store: Store;
  env?: NodeJS.ProcessEnv;
  /** For tests: the planner to use instead of Claude Code. */
  planner?: (root: string) => PlannerModel;
  /** For tests: what carries out an approved run. */
  execute?: typeof executeRun;
  maxAttempts?: number;
  /** At most this many runs build at the same time. */
  maxRunning?: number;
}

type Decision = { action: "retry"; instruction?: string } | { action: "skip" } | { action: "stop" };
const ENDED = new Set(["done", "stopped", "failed"]);
const MAX_GOAL = 2000;
const MAX_ANSWER = 2000;

export class AutopilotJobs {
  private readonly store: Store;
  private readonly env: NodeJS.ProcessEnv;
  /** Runs this engine is building right now, with a way to end them. */
  private readonly active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  /** Runs waiting for you to decide about a step that keeps failing (the agent session is still open). */
  private readonly waiting = new Map<string, (d: Decision) => void>();
  private readonly planning = new Set<string>();
  /** Runs that were waiting for your decision when this engine closed: they go back to waiting, not to stopped. */
  private readonly closingWhileWaiting = new Set<string>();
  private closed = false;

  constructor(private readonly o: AutopilotJobsOptions) {
    this.store = o.store;
    this.env = o.env ?? process.env;
  }

  private get(id: string): AutopilotRun {
    const run = this.store.autopilotRun<AutopilotRun>(id);
    if (!run) throw new JobError(404, `No Autopilot run "${id}".`);
    return run;
  }
  private save(run: AutopilotRun, message?: string) {
    run.updatedAt = Date.now();
    if (message) run.log.push({ ts: run.updatedAt, message });
    this.store.saveAutopilotRun(run);
  }
  private planner(root: string): PlannerModel {
    if (this.o.planner) return this.o.planner(root);
    const { command, prefix } = claudeProgram(this.env);
    return claudePlanner({ command, extraArgs: prefix, cwd: root, env: this.env });
  }

  /** Is this run being worked on by this engine right now (planning, building, or waiting for a decision)? */
  isLive(id: string): boolean {
    return this.planning.has(id) || this.active.has(id) || this.waiting.has(id);
  }

  /** Starts a new run: plans in the background. With questions, it waits for your answers before planning. */
  start(input: { goal: unknown; root: unknown; questions?: unknown }): AutopilotRun {
    if (this.closed) throw new JobError(503, "ArgusOps is shutting down.");
    if (typeof input.goal !== "string" || !input.goal.trim()) throw new JobError(400, "Say what you want built.");
    if (input.goal.length > MAX_GOAL) throw new JobError(400, `Keep the goal under ${MAX_GOAL} characters.`);
    const folder = checkProjectFolder(input.root, this.store.root);
    if (!folder.ok) throw new JobError(400, folder.error);
    const now = Date.now();
    const run: AutopilotRun = {
      id: `ap_${crypto.randomBytes(5).toString("hex")}`,
      goal: input.goal.trim(),
      root: folder.root,
      createdAt: now,
      updatedAt: now,
      status: "planning",
      answers: [],
      plan: { summary: "", steps: [] },
      steps: [],
      costUsd: 0,
      control: null,
      needsYou: null,
      sessionId: null,
      log: [{ ts: now, message: input.questions === false ? "Planning..." : "Thinking about what to ask..." }],
    };
    this.store.saveAutopilotRun(run);
    this.planning.add(run.id);
    void this.prepare(run.id, input.questions !== false);
    return run;
  }

  private async prepare(id: string, withQuestions: boolean) {
    try {
      if (withQuestions) {
        const run = this.get(id);
        const questions = await askQuestions(run.goal, projectContext(run.root), this.planner(run.root));
        const now = this.get(id);
        if (now.status !== "planning") return; // stopped meanwhile
        if (questions.length) {
          now.status = "awaiting-answers";
          now.questions = questions;
          this.save(now, `${questions.length} question${questions.length === 1 ? "" : "s"} for you before planning.`);
          return;
        }
      }
      await this.plan(id);
    } catch (e) {
      this.fail(id, e);
    } finally {
      this.planning.delete(id);
    }
  }

  private async plan(id: string) {
    const run = this.get(id);
    const plan = await makePlan(run.goal, projectContext(run.root), run.answers, this.planner(run.root));
    const now = this.get(id);
    if (now.status !== "planning") return;
    now.plan = plan;
    now.steps = plan.steps.map((s) => ({ id: s.id, status: "pending", attempts: 0, costUsd: 0, problems: [], checks: [] }));
    now.status = "awaiting-approval";
    delete now.questions;
    this.save(now, "The plan is ready for you to review.");
  }

  private fail(id: string, e: unknown) {
    const run = this.store.autopilotRun<AutopilotRun>(id);
    if (!run || ENDED.has(run.status)) return;
    run.status = "failed";
    run.needsYou = null;
    this.save(run, `Planning failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  /** Your answers to the planner's questions (an empty answer skips that question); then it plans. */
  answer(id: string, answers: unknown): AutopilotRun {
    const run = this.get(id);
    if (run.status !== "awaiting-answers") throw new JobError(409, "That run is not waiting for answers.");
    const questions = run.questions ?? [];
    if (!Array.isArray(answers) || answers.length !== questions.length || !answers.every((a) => typeof a === "string" && a.length <= MAX_ANSWER)) throw new JobError(400, `Send one answer (text) for each of the ${questions.length} questions.`);
    run.answers = questions.map((q, i) => ({ question: q, answer: (answers[i] as string).trim() }));
    run.status = "planning";
    delete run.questions;
    this.save(run, "Planning...");
    this.planning.add(id);
    void this.plan(id)
      .catch((e) => this.fail(id, e))
      .finally(() => this.planning.delete(id));
    return run;
  }

  /** Approves the plan you were shown (named by its fingerprint) and starts building it. */
  approve(id: string, hash: unknown): AutopilotRun {
    if (this.closed) throw new JobError(503, "ArgusOps is shutting down.");
    const run = this.get(id);
    if (run.status !== "awaiting-approval") throw new JobError(409, "That run is not waiting for approval.");
    if (typeof hash !== "string" || hash !== planHash(run.plan)) throw new JobError(409, "The plan changed since you looked at it. Review it again before approving.");
    if (!checkProjectFolder(run.root, this.store.root).ok) throw new JobError(409, "That run's folder is no longer usable.");
    return this.launch(run, "Approved in the app.");
  }

  /** A step kept failing: retry it (with optional words for the agent), skip it, or stop the run. */
  decide(id: string, input: { action: unknown; instruction?: unknown }): AutopilotRun {
    const run = this.get(id);
    if (run.status !== "needs-you") throw new JobError(409, "That run is not waiting for you.");
    const action = input.action;
    if (action !== "retry" && action !== "skip" && action !== "stop") throw new JobError(400, '"action" must be retry, skip or stop.');
    if (input.instruction !== undefined && (typeof input.instruction !== "string" || input.instruction.length > MAX_ANSWER)) throw new JobError(400, "The instruction must be text.");
    const instruction = typeof input.instruction === "string" && input.instruction.trim() ? input.instruction.trim() : undefined;
    const pending = this.waiting.get(id);
    if (pending) {
      this.waiting.delete(id);
      pending(action === "retry" ? { action, instruction } : { action });
      return this.get(id);
    }
    // the agent session that was waiting is gone (ArgusOps restarted): carry on with a fresh one
    if (action === "stop") {
      run.status = "stopped";
      run.needsYou = null;
      this.save(run, "Stopped by you.");
      return run;
    }
    const i = run.steps.findIndex((s) => s.status === "failed" || s.status === "running");
    if (i >= 0 && action === "skip") run.steps[i] = { ...run.steps[i], status: "skipped" };
    if (i >= 0 && action === "retry" && instruction) run.plan.steps[i] = { ...run.plan.steps[i], instructions: `${run.plan.steps[i].instructions}\n\nFrom the user: ${instruction}` };
    return this.launch(run, action === "skip" ? `Step ${i + 1} skipped by you.` : "Trying the step again.");
  }

  /** Continues a paused run: clears the pause, or (if nothing is building it) starts building it again. */
  resume(id: string): AutopilotRun {
    const run = this.get(id);
    if (this.active.has(id)) {
      run.control = null;
      this.save(run, "Continuing.");
      return run;
    }
    if (run.status !== "paused" && run.status !== "running") throw new JobError(409, `That run cannot be continued (${run.status}).`);
    return this.launch(run, "Continuing.");
  }

  /** Stops a run that is still being planned or waiting for answers or approval (a building run stops through control). */
  cancel(id: string): AutopilotRun {
    const run = this.get(id);
    if (ENDED.has(run.status)) throw new JobError(409, `That run is already ${run.status}.`);
    const pending = this.waiting.get(id);
    if (pending) {
      this.waiting.delete(id);
      pending({ action: "stop" });
      return this.get(id);
    }
    if (this.active.has(id)) {
      run.control = "stop";
      this.save(run);
      return run;
    }
    run.status = "stopped";
    run.needsYou = null;
    this.save(run, "Stopped by you.");
    return run;
  }

  private launch(run: AutopilotRun, message: string): AutopilotRun {
    if (this.active.has(run.id)) throw new JobError(409, "That run is already being built.");
    if (this.active.size >= (this.o.maxRunning ?? 2)) throw new JobError(429, "Two Autopilot runs are already building. Wait for one to finish.");
    for (const other of this.active.keys()) {
      if (this.store.autopilotRun<AutopilotRun>(other)?.root === run.root) throw new JobError(409, "Another Autopilot run is already building in that folder.");
    }
    // a resumed run starts its unfinished step again with fresh attempts; passed steps are kept
    const fresh: AutopilotRun = { ...run, control: null, status: "running", needsYou: null, steps: run.steps.map((s) => (s.status === "failed" || s.status === "running" ? { ...s, status: "pending" } : s)) };
    this.save(fresh, message);
    const abort = new AbortController();
    const execute = this.o.execute ?? executeRun;
    const done = (async () => {
      try {
        const ended = await execute(
          fresh,
          {
            maxAttempts: this.o.maxAttempts ?? 3,
            allowBash: false,
            say: () => undefined, // the run's own log is what the app shows
            abort: abort.signal,
            decide: (r) =>
              new Promise<Decision>((resolve) => {
                if (abort.signal.aborted) return resolve({ action: "stop" });
                this.waiting.set(r.id, resolve);
              }),
          },
          this.store,
          this.env
        );
        if (!ended) this.markInterrupted(fresh.id, "Could not start the ArgusOps proxy.", "failed");
      } catch (e) {
        this.markInterrupted(fresh.id, `Autopilot stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}`, "failed");
      } finally {
        this.active.delete(fresh.id);
        this.waiting.delete(fresh.id);
        if (abort.signal.aborted) {
          if (this.closingWhileWaiting.delete(fresh.id)) this.markInterrupted(fresh.id, "ArgusOps was closed while this run waited for you. Decide what to do with the step: retry, skip or stop.", "needs-you", true);
          else this.markInterrupted(fresh.id, "ArgusOps was closed during this run. Continue it when you are ready.", "paused");
        }
      }
    })();
    this.active.set(fresh.id, { abort, done });
    return fresh;
  }

  private markInterrupted(id: string, message: string, status: "paused" | "failed" | "needs-you", force = false) {
    const run = this.store.autopilotRun<AutopilotRun>(id);
    if (!run || run.status === "done" || (run.status === "stopped" && !force)) return;
    run.status = status;
    run.needsYou = status === "needs-you" ? message : null;
    run.control = null;
    this.save(run, message);
  }

  /** Ends everything this engine is doing; building runs are left paused so they can be continued later. */
  async close(): Promise<void> {
    this.closed = true;
    const jobs = [...this.active.values()];
    for (const j of jobs) j.abort.abort();
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      this.closingWhileWaiting.add(id);
      resolve({ action: "stop" });
    }
    await Promise.allSettled(jobs.map((j) => j.done));
  }
}
