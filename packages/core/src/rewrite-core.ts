/**
 * Rule-based "prompt rewrite" for a stuck agent: turns the steps it kept repeating (as captured by the CLI,
 * e.g. `Bash({"command":"npm test"})` and `error: FAIL ...`) into one short corrective instruction.
 * Pure and deterministic; an optional AI polish lives in rewriter.ts.
 */

export type Step = { kind: "call"; tool: string; input: Record<string, unknown> } | { kind: "error"; text: string } | { kind: "other"; text: string };

/** Parses one captured step. Calls look like `Tool({...json...})`, errors like `error: message`. */
export function parseStep(raw: string): Step {
  const text = raw.trim();
  if (/^error:/i.test(text)) return { kind: "error", text: text.replace(/^error:\s*/i, "").trim() };
  const m = /^([A-Za-z][\w.-]{0,60})\(([\s\S]*)\)$/.exec(text);
  if (m) {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(m[2]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
    } catch {
      // the CLI may have cut a very long call short; keep the tool name
    }
    return { kind: "call", tool: m[1], input };
  }
  return { kind: "other", text };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const short = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
};

/** Plain-language description of a tool call, e.g. "the command `npm test`" or "editing src/a.ts". */
export function describeCall(step: Extract<Step, { kind: "call" }>): string {
  const i = step.input;
  const file = str(i.file_path) || str(i.path) || str(i.notebook_path);
  switch (step.tool) {
    case "Bash":
      return str(i.command) ? `the command \`${short(str(i.command), 120)}\`` : "the same shell command";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return file ? `editing ${short(file, 100)}` : "the same edit";
    case "Read":
      return file ? `reading ${short(file, 100)}` : "reading the same file";
    case "Grep":
    case "Glob":
      return str(i.pattern) ? `searching for \`${short(str(i.pattern), 60)}\`` : "the same search";
    case "WebFetch":
      return str(i.url) ? `fetching ${short(str(i.url), 100)}` : "the same fetch";
    default:
      return `the ${step.tool} tool with the same input`;
  }
}

export interface RewriteDraft {
  instruction: string;
  /** What the agent kept doing, in words, for the dashboard. */
  observed: string;
  shape: "single-call" | "call-and-error" | "cycle" | "unknown";
}

export const MAX_INSTRUCTION_CHARS = 700;

/** Writes the corrective instruction for a loop of `unit` repeated `repeats` times. */
export function draftRewrite(unit: string[], repeats: number): RewriteDraft {
  const steps = unit.map(parseStep);
  const calls = steps.filter((s): s is Extract<Step, { kind: "call" }> => s.kind === "call");
  const errors = steps.filter((s): s is Extract<Step, { kind: "error" }> => s.kind === "error");
  const n = Math.max(2, repeats);
  const errorText = errors[0] ? short(errors[0].text, 160) : "";
  const tail =
    "If you can't find a way forward, stop and explain in one short message what is blocking you, instead of retrying.";

  let draft: RewriteDraft;
  if (calls.length === 1) {
    const what = describeCall(calls[0]);
    const observed = errorText ? `Ran ${what} ${n} times in a row; it failed the same way each time: "${errorText}".` : `Ran ${what} ${n} times in a row with no change in approach.`;
    const instruction = errorText
      ? `Stop re-running ${what}. It has failed ${n} times in a row with the same error: "${errorText}". Running it again won't change the result. Read that error, find the root cause (look at the file, test or setting it points to), fix that first, and only then run it once more. ${tail}`
      : `Stop repeating ${what}. You've done it ${n} times in a row and it hasn't moved the task forward. Decide what you actually need from it, change your approach, and don't repeat the identical step again. ${tail}`;
    draft = { instruction, observed, shape: errorText ? "call-and-error" : "single-call" };
  } else if (calls.length > 1) {
    const sequence = calls.map(describeCall).join(", then ");
    const observed = `Repeated the same ${calls.length}-step sequence ${n} times: ${sequence}${errorText ? `, ending with "${errorText}"` : ""}.`;
    const instruction = `You've repeated the same sequence ${n} times (${sequence}) and it isn't working${errorText ? `; it keeps ending with "${errorText}"` : ""}. Step back: in two sentences, say why the last attempts failed, then try a genuinely different approach. ${tail}`;
    draft = { instruction, observed, shape: "cycle" };
  } else {
    const what = short(unit.join(" → ") || "the same step", 160);
    draft = {
      instruction: `You've repeated the same step ${n} times (${what}) without progress. Stop, work out why it isn't succeeding, and change your approach. ${tail}`,
      observed: `Repeated ${what} ${n} times.`,
      shape: "unknown",
    };
  }
  draft.instruction = short(draft.instruction, MAX_INSTRUCTION_CHARS);
  return draft;
}

/** Rough token count (about four characters per token), used only for the "tokens saved" comparison. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Tokens this loop has already burned, from the agent's real usage: the average tokens per call over its recent
 * calls times the number of repeats (each repeat resends the whole conversation).
 */
export function loopCost(recentCallTokens: number[], repeats: number): { perCall: number; total: number } {
  if (recentCallTokens.length === 0) return { perCall: 0, total: 0 };
  const perCall = Math.round(recentCallTokens.reduce((a, b) => a + b, 0) / recentCallTokens.length);
  return { perCall, total: perCall * Math.max(0, repeats) };
}
