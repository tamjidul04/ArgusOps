import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { detectGates } from "./gates";
import { quoteWindowsArg } from "./run";

/**
 * The Autopilot planner: turns a goal into clarifying questions and then a step-by-step plan with checks for each step.
 * It asks a model through the user's own Claude login, in a separate call with ALL tools switched off, so planning can
 * never touch the project. The plan is plain data that the user reviews and approves before anything runs.
 */

export type AcceptanceCheck = { type: "command"; command: string } | { type: "file-exists"; path: string } | { type: "file-contains"; path: string; text: string };

export interface PlanStep {
  id: string;
  title: string;
  instructions: string;
  acceptance: AcceptanceCheck[];
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
}

/** Sends one prompt to a model and returns its text answer. */
export type PlannerModel = (prompt: string) => Promise<string>;

const LIMITS = { steps: 12, instructions: 2500, title: 120, checks: 5, command: 300, path: 200, text: 300, questions: 5, question: 300, summary: 600 };

/* ------------------------------ reading the model's JSON ------------------------------ */

/** Finds the JSON object in a model's answer (bare, in a ```json fence, or with words around it). */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    if (start < 0) continue;
    // walk to the matching brace, respecting strings
    let depth = 0;
    let inString = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(c.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A path the plan may mention: relative, inside the project, no tricks. */
export function safeRelativePath(p: string): boolean {
  if (!p || p.length > LIMITS.path) return false;
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.startsWith("~")) return false;
  return !p.split(/[\\/]/).includes("..");
}

export function validateQuestions(v: unknown): string[] {
  const list = v && typeof v === "object" ? (v as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(list)) return [];
  return list.map((q) => str(q, LIMITS.question)).filter(Boolean).slice(0, LIMITS.questions);
}

export function validatePlan(v: unknown): { ok: true; plan: Plan } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "The answer was not a JSON object." };
  const raw = v as { summary?: unknown; steps?: unknown };
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return { ok: false, error: '"steps" must be a non-empty list.' };
  if (raw.steps.length > LIMITS.steps) return { ok: false, error: `Too many steps (${raw.steps.length}); use at most ${LIMITS.steps}.` };
  const steps: PlanStep[] = [];
  for (const [i, s] of raw.steps.entries()) {
    const step = s as { title?: unknown; instructions?: unknown; acceptance?: unknown };
    const title = str(step?.title, LIMITS.title);
    const instructions = str(step?.instructions, LIMITS.instructions);
    if (!title || !instructions) return { ok: false, error: `Step ${i + 1} needs a "title" and "instructions".` };
    const acceptance: AcceptanceCheck[] = [];
    // drop malformed or unsafe checks first, then keep at most LIMITS.checks of the good ones
    for (const c of Array.isArray(step.acceptance) ? step.acceptance.slice(0, 30) : []) {
      if (acceptance.length >= LIMITS.checks) break;
      const check = c as { type?: unknown; command?: unknown; path?: unknown; text?: unknown };
      if (check?.type === "command") {
        const command = str(check.command, LIMITS.command);
        if (command && !/[\r\n]/.test(command)) acceptance.push({ type: "command", command });
      } else if (check?.type === "file-exists") {
        const p = str(check.path, LIMITS.path);
        if (safeRelativePath(p)) acceptance.push({ type: "file-exists", path: p });
      } else if (check?.type === "file-contains") {
        const p = str(check.path, LIMITS.path);
        const text = str(check.text, LIMITS.text);
        if (safeRelativePath(p) && text) acceptance.push({ type: "file-contains", path: p, text });
      }
    }
    steps.push({ id: `step-${i + 1}`, title, instructions, acceptance });
  }
  return { ok: true, plan: { summary: str(raw.summary, LIMITS.summary), steps } };
}

/* ------------------------------------ prompts ------------------------------------ */

/** A short description of the project so the planner fits its plan to it. Names only, never file contents. */
export function projectContext(root: string): string {
  const lines: string[] = [];
  try {
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .slice(0, 60)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    lines.push(entries.length ? `Top-level files and folders: ${entries.join(", ")}` : "The folder is empty.");
  } catch {
    lines.push("The folder could not be read.");
  }
  const gates = detectGates(root);
  if (gates.length) lines.push(`Existing project checks: ${gates.map((g) => `${g.name}: ${g.command}`).join("; ")}`);
  return lines.join("\n");
}

export function questionsPrompt(goal: string, context: string): string {
  return [
    "You are planning work for an AI coding agent. Do not do the work; only decide what you must know before planning.",
    `Goal: ${goal}`,
    `Project:\n${context}`,
    `If anything essential is ambiguous (for example the language, framework, or what "done" means), ask up to ${LIMITS.questions} short questions. If the goal is clear enough, ask none.`,
    'Answer with JSON only, exactly this shape: {"questions": ["...", "..."]}',
  ].join("\n\n");
}

export function planPrompt(goal: string, context: string, answers: Array<{ question: string; answer: string }>, previousError?: string): string {
  return [
    "You are planning work for an AI coding agent that will carry out one step at a time in the project folder. Do not do the work; write the plan.",
    `Goal: ${goal}`,
    `Project:\n${context}`,
    answers.length ? `The user answered:\n${answers.map((a) => `- ${a.question}\n  ${a.answer || "(no answer)"}`).join("\n")}` : "",
    [
      "Rules for the plan:",
      `- Between 1 and ${LIMITS.steps} small steps, in order. Each step must leave the project working.`,
      "- Each step's instructions are complete on their own: say exactly what to create or change.",
      `- Give each step up to ${LIMITS.checks} acceptance checks that prove it is done. Types: {"type":"command","command":"..."} (must exit with 0, e.g. running the tests), {"type":"file-exists","path":"relative/path"}, {"type":"file-contains","path":"relative/path","text":"..."}.`,
      "- Commands must be safe, local and quick (tests, type-check, build, running the program once). No installs from the internet unless the goal needs them, no deleting outside the project, no network calls to other services.",
      "- Paths are relative to the project folder.",
      "- Add or update tests where it makes sense, and make the last step run all of them.",
    ].join("\n"),
    previousError ? `Your previous answer could not be used: ${previousError}. Fix that.` : "",
    'Answer with JSON only, exactly this shape: {"summary": "...", "steps": [{"title": "...", "instructions": "...", "acceptance": [...]}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------ the calls ------------------------------------ */

export async function askQuestions(goal: string, context: string, model: PlannerModel): Promise<string[]> {
  try {
    return validateQuestions(extractJson(await model(questionsPrompt(goal, context))));
  } catch {
    return []; // questions are a help, not a requirement
  }
}

export async function makePlan(goal: string, context: string, answers: Array<{ question: string; answer: string }>, model: PlannerModel): Promise<Plan> {
  let error: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await model(planPrompt(goal, context, answers, error));
    const parsed = validatePlan(extractJson(answer));
    if (parsed.ok) return parsed.plan;
    error = parsed.error;
  }
  throw new Error(`The planner did not produce a usable plan: ${error}`);
}

/**
 * A planner model backed by Claude Code itself: `claude -p --output-format json --tools ""`, prompt on stdin.
 * Tools are switched off, so the planning call cannot read or change anything.
 */
export function claudePlanner(opts: { command: string; cwd: string; model?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; extraArgs?: string[] }): PlannerModel {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const args = [...(opts.extraArgs ?? []), "-p", "--output-format", "json", "--tools", "", ...(opts.model ? ["--model", opts.model] : [])];
      const win = process.platform === "win32";
      const shell = win && !/\.exe$/i.test(opts.command);
      const child = shell
        ? spawn([quoteWindowsArg(opts.command), ...args.map(quoteWindowsArg)].join(" "), [], { cwd: opts.cwd, env: opts.env ?? process.env, shell: true, windowsHide: true })
        : spawn(opts.command, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("The planner took too long."));
      }, opts.timeoutMs ?? 5 * 60_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Could not start ${opts.command}: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(out) as { result?: unknown; is_error?: boolean };
          if (j.is_error) return reject(new Error(`The planner reported an error: ${String(j.result ?? "").slice(0, 300)}`));
          resolve(typeof j.result === "string" ? j.result : "");
        } catch {
          reject(new Error(`The planner's answer could not be read (exit ${code}). ${err.trim().slice(-300)}`));
        }
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);
    });
}
