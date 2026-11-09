import { describe, it, expect } from "vitest";
import { evaluateAgentStreamForLoops, MAX_INTERCEPTION_BUDGET_MS } from "./guardrails-engine";

const call = "run_tests(): FAIL expected 200 got 500";
const same = (n: number) => Array.from({ length: n }, () => call);

describe("loop detection: defaults", () => {
  it("does nothing on short or varied streams", () => {
    expect(evaluateAgentStreamForLoops(["one"], 10).status).toBe("ACTIVE");
    expect(evaluateAgentStreamForLoops(["read file a", "edit file b", "run build", "open docs"], 10).status).toBe("ACTIVE");
  });

  it("kills a repeating call early in the task and pauses it when nearly done", () => {
    const early = evaluateAgentStreamForLoops(same(4), 40);
    expect(early).toMatchObject({ status: "KILLED_LOOP", loopType: "EXACT_TOOL_LOOP", circuitBreakerTripped: true });
    const late = evaluateAgentStreamForLoops(same(4), 92);
    expect(late).toMatchObject({ status: "PAUSED_NUDGE", nudgeRequired: true, circuitBreakerTripped: false });
  });

  it("flags two identical calls in a row with the default limit of 2", () => {
    expect(evaluateAgentStreamForLoops(["plan", call, call], 30).status).toBe("KILLED_LOOP");
  });

  it("detects A-B-A-B ping-pong", () => {
    const r = evaluateAgentStreamForLoops(["edit config", "run tests: fail", "edit config", "run tests: fail"], 30);
    expect(r.loopType).toBe("EXACT_TOOL_LOOP");
    expect(r.status).toBe("KILLED_LOOP");
  });

  it("detects paraphrased reasoning loops", () => {
    const r = evaluateAgentStreamForLoops(
      [
        "I need to alter the database schema to drop the foreign key constraint before committing.",
        "Attempting to alter the database schema to drop the foreign key constraint before committing.",
      ],
      91
    );
    expect(r.loopType).toBe("SEMANTIC_REASONING_LOOP");
    expect(r.status).toBe("PAUSED_NUDGE");
  });

  it("stays well inside the latency budget", () => {
    const logs = Array.from({ length: 200 }, (_, i) => `step ${i}: reading module ${i % 17} and running checks`);
    const r = evaluateAgentStreamForLoops(logs, 50);
    expect(r.interceptionMs).toBeLessThan(MAX_INTERCEPTION_BUDGET_MS);
    expect(r.withinLatencyBudget).toBe(true);
  });
});

describe("loop detection: user policy", () => {
  it("a stricter score threshold ignores a double repeat but still catches a triple", () => {
    const opts = { loopScoreThreshold: 0.95 };
    expect(evaluateAgentStreamForLoops(["plan", call, call], 30, opts).status).toBe("ACTIVE");
    expect(evaluateAgentStreamForLoops(["plan", call, call, call], 30, opts).status).toBe("KILLED_LOOP");
  });

  it("exactRepeatLimit decides how many identical calls count", () => {
    const opts = { exactRepeatLimit: 3 };
    expect(evaluateAgentStreamForLoops(["plan", call, call], 30, opts).status).toBe("ACTIVE");
    expect(evaluateAgentStreamForLoops(["plan", call, call, call], 30, opts).status).toBe("KILLED_LOOP");
  });

  it("the nudge cutoff moves the pause-versus-kill boundary", () => {
    expect(evaluateAgentStreamForLoops(same(4), 70, { nudgeProgressPct: 60 }).status).toBe("PAUSED_NUDGE");
    expect(evaluateAgentStreamForLoops(same(4), 70, { nudgeProgressPct: 90 }).status).toBe("KILLED_LOOP");
    expect(evaluateAgentStreamForLoops(same(4), 70).status).toBe("KILLED_LOOP"); // default cutoff 80
  });

  it("a looser threshold catches paraphrases the default misses", () => {
    const logs = [
      "Reading the configuration file to find the database settings",
      "Looking at the configuration file for the database connection settings",
    ];
    const strict = evaluateAgentStreamForLoops(logs, 30, { loopScoreThreshold: 0.99 });
    expect(strict.status).toBe("ACTIVE");
  });

  it("never lets exactRepeatLimit drop below 2", () => {
    expect(evaluateAgentStreamForLoops(["a", "b", "c", "d"], 30, { exactRepeatLimit: 0 }).status).toBe("ACTIVE");
  });

  it("semanticEnabled:false ignores near-identical lines but still catches exact repeats", () => {
    const reads = [
      "Read({\"file_path\":\"/home/dev/projects/app/src/components/Alpha.tsx\"})",
      "Read({\"file_path\":\"/home/dev/projects/app/src/components/Beta.tsx\"})",
    ];
    expect(evaluateAgentStreamForLoops(reads, 10).status).not.toBe("ACTIVE"); // by meaning they look alike
    expect(evaluateAgentStreamForLoops(reads, 10, { semanticEnabled: false }).status).toBe("ACTIVE");
    expect(evaluateAgentStreamForLoops(same(3), 10, { semanticEnabled: false }).status).toBe("KILLED_LOOP");
  });

  it("two lines with nothing meaningful in them are not a loop", () => {
    expect(evaluateAgentStreamForLoops(["ok", "done", "a", "b"], 10).status).toBe("ACTIVE");
  });
});
