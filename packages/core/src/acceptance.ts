import fs from "node:fs";
import path from "node:path";
import { runGate } from "./gates";
import type { AcceptanceCheck } from "./planner";
import { safeRelativePath } from "./planner";

/**
 * Runs a plan step's acceptance checks. Commands are code written by the planner: the caller must only run them for a
 * plan the user approved (the approval lists every command).
 */

export interface CheckResult {
  check: AcceptanceCheck;
  ok: boolean;
  /** Why it failed (or the end of the command's output), in plain words. */
  detail: string;
}

export const describeCheck = (c: AcceptanceCheck): string =>
  c.type === "command" ? `runs \`${c.command}\` successfully` : c.type === "file-exists" ? `${c.path} exists` : `${c.path} contains "${c.text}"`;

function inside(root: string, rel: string): string | null {
  if (!safeRelativePath(rel)) return null;
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export async function runCheck(check: AcceptanceCheck, root: string, opts: { timeoutMs?: number } = {}): Promise<CheckResult> {
  if (check.type === "command") {
    const r = await runGate({ name: "test", command: check.command, body: check.command, source: "plan" }, root, { timeoutMs: opts.timeoutMs ?? 5 * 60_000 });
    const tail = r.outputTail.split("\n").slice(-8).join("\n").trim();
    return { check, ok: r.ok, detail: r.ok ? "" : `${r.timedOut ? "did not finish in time" : `exited with ${r.exitCode ?? "an error"}`}${tail ? `:\n${tail}` : ""}` };
  }
  const full = inside(root, check.path);
  if (!full) return { check, ok: false, detail: `${check.path} is not a path inside the project` };
  if (check.type === "file-exists") {
    return fs.existsSync(full) ? { check, ok: true, detail: "" } : { check, ok: false, detail: `${check.path} does not exist` };
  }
  let text: string;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    return { check, ok: false, detail: `${check.path} does not exist` };
  }
  return text.includes(check.text) ? { check, ok: true, detail: "" } : { check, ok: false, detail: `${check.path} does not contain "${check.text}"` };
}

export async function runChecks(checks: AcceptanceCheck[], root: string, opts: { timeoutMs?: number } = {}): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const c of checks) out.push(await runCheck(c, root, opts));
  return out;
}
