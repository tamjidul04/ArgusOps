import { evaluateAgentStreamForLoops } from "../../../src/lib/guardrails-engine";
import { countToolCalls, extractToolTrace } from "./anthropic";

export interface DetectPolicy {
  loopScoreThreshold: number;
  exactRepeatLimit: number;
}

export const DEFAULT_POLICY: DetectPolicy = { loopScoreThreshold: 0.85, exactRepeatLimit: 2 };

/** A genuine retry often repeats once, so require at least this many identical calls in a row. */
export const MIN_CONSECUTIVE_REPEATS = 3;

export interface LoopVerdict {
  tripped: boolean;
  score: number;
  loopType: "EXACT_TOOL_LOOP";
  reason: string;
  interceptionMs: number;
}

/**
 * Looks for a stuck agent in the conversation Claude Code sends with each request.
 *  - the same tool call over and over (even if the results differ), or
 *  - a call and its error repeating (A, error, A, error, ...).
 * Meaning-based matching is switched off here: different files share most of their words.
 * After a resume only calls made *after* it are considered, so the agent isn't re-paused for old history.
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
    const calls = trace.calls.slice(skip).slice(-60);
    const interleaved = trace.items.filter((i) => i.callNo >= skip).map((i) => i.sig).slice(-60);

    const limit = Math.max(MIN_CONSECUTIVE_REPEATS, this.policy.exactRepeatLimit);
    const opts = {
      loopScoreThreshold: this.policy.loopScoreThreshold,
      exactRepeatLimit: limit,
      nudgeProgressPct: 0, // any trip pauses for a human (never a silent hard kill)
      semanticEnabled: false,
    };

    const a = evaluateAgentStreamForLoops(calls, 100, opts);
    const b = interleaved.length >= 2 ? evaluateAgentStreamForLoops(interleaved, 100, opts) : null;
    const worst = b && b.loopScore > a.loopScore ? b : a;
    const ms = Math.round((performance.now() - started) * 100) / 100;

    if (worst.status === "ACTIVE") {
      return { tripped: false, score: worst.loopScore, loopType: "EXACT_TOOL_LOOP", reason: "", interceptionMs: ms };
    }
    return {
      tripped: true,
      score: worst.loopScore,
      loopType: "EXACT_TOOL_LOOP",
      reason: worst.matchedPattern ? `Repeating: ${worst.matchedPattern.slice(0, 160)}` : worst.reason,
      interceptionMs: ms,
    };
  }
}
