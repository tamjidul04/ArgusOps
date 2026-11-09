import { countToolCalls, extractToolTrace } from "./anthropic";

export interface DetectPolicy {
  loopScoreThreshold: number;
  exactRepeatLimit: number;
}

export const DEFAULT_POLICY: DetectPolicy = { loopScoreThreshold: 0.85, exactRepeatLimit: 2 };

/** A genuine retry often repeats once or twice, so a pattern must repeat at least this many times. */
export const MIN_REPEATS = 3;

/** Longest repeating unit we look for: e.g. [call, error] is 2, [edit, ok, test, ok] is 4. */
const MAX_PERIOD = 4;

export interface LoopVerdict {
  tripped: boolean;
  score: number;
  loopType: "EXACT_TOOL_LOOP";
  reason: string;
  interceptionMs: number;
}

/**
 * Finds the longest tail of `items` that is one short sequence repeated end to end, at least `minRepeats` times.
 * [A, A, A] -> unit [A] x3.  [A, E, A, E, A, E] -> unit [A, E] x3.  [X, A, A, A] -> unit [A] x3 (ignores older history).
 */
export function findRepeatingTail(items: string[], minRepeats: number): { unit: string[]; repeats: number } | null {
  let best: { unit: string[]; repeats: number } | null = null;
  for (let period = 1; period <= MAX_PERIOD; period++) {
    if (items.length < period * minRepeats) continue;
    const unit = items.slice(items.length - period);
    let repeats = 1;
    while (repeats * period + period <= items.length) {
      const start = items.length - (repeats + 1) * period;
      const chunk = items.slice(start, start + period);
      if (chunk.every((v, i) => v === unit[i])) repeats++;
      else break;
    }
    if (repeats >= minRepeats && (!best || repeats * period > best.repeats * best.unit.length)) best = { unit, repeats };
  }
  return best;
}

/** More repeats means more certainty: 3 -> 0.94, 4 -> 0.97, 5 or more -> 0.99. */
export function scoreForRepeats(repeats: number): number {
  return Math.min(0.99, Math.round((0.88 + 0.03 * (repeats - 1)) * 100) / 100);
}

/**
 * Looks for a stuck agent in the conversation Claude Code sends with each request:
 *  - the same tool call over and over (even if the results differ), or
 *  - a call and its error repeating (call, error, call, error, ...), or a short sequence repeating.
 * Matching is exact on purpose: two different file reads share most of their words, so meaning-based matching
 * would pause healthy agents. After a resume only calls made *after* it are considered.
 */
export class LoopDetector {
  private policy: DetectPolicy = DEFAULT_POLICY;
  private ignoreFirstCalls = 0;

  setPolicy(p: Partial<DetectPolicy> | undefined) {
    if (!p) return;
    this.policy = {
      loopScoreThreshold: typeof p.loopScoreThreshold === "number" ? p.loopScoreThreshold : this.policy.loopScoreThreshold,
      exactRepeatLimit: typeof p.exactRepeatLimit === "number" ? p.exactRepeatLimit : this.policy.exactRepeatLimit,
    };
  }

  /** Call when the operator resumes an agent. `body` is the conversation about to be sent. */
  markResumed(body: unknown) {
    this.ignoreFirstCalls = countToolCalls(body);
  }

  check(body: unknown): LoopVerdict {
    const started = performance.now();
    const trace = extractToolTrace(body);
    if (this.ignoreFirstCalls > trace.calls.length) this.ignoreFirstCalls = 0; // the agent compacted its history

    // only what happened after the resume point counts
    const skip = this.ignoreFirstCalls;
    const calls = trace.calls.slice(skip).slice(-80);
    const mixed = trace.items.filter((i) => i.callNo >= skip).map((i) => i.sig).slice(-80);

    const minRepeats = Math.max(MIN_REPEATS, this.policy.exactRepeatLimit);
    const found = [findRepeatingTail(calls, minRepeats), findRepeatingTail(mixed, minRepeats)]
      .filter((f): f is { unit: string[]; repeats: number } => f !== null)
      .sort((a, b) => b.repeats - a.repeats)[0];

    const ms = Math.round((performance.now() - started) * 100) / 100;
    const score = found ? scoreForRepeats(found.repeats) : 0;

    if (!found || score < this.policy.loopScoreThreshold) {
      return { tripped: false, score, loopType: "EXACT_TOOL_LOOP", reason: "", interceptionMs: ms };
    }
    const what = found.unit.map((u) => u.slice(0, 90)).join(" -> ");
    return {
      tripped: true,
      score,
      loopType: "EXACT_TOOL_LOOP",
      reason: `Repeated ${found.repeats} times: ${what}`.slice(0, 220),
      interceptionMs: ms,
    };
  }
}
