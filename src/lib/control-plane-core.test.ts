import { describe, it, expect } from "vitest";
import {
  sanitizePolicyInput,
  policyRowToDto,
  policyDtoToRowUpdate,
  sanitizePermissions,
  incidentToStreamEvent,
  latencyStats,
  canActivateAgent,
  agentLimitMessage,
  relativeTime,
  normalizeLockPath,
} from "./control-plane-core";

describe("sanitizePolicyInput", () => {
  it("clamps out-of-range numbers and rounds integers", () => {
    expect(
      sanitizePolicyInput({
        maxConsecutiveRetries: 999,
        semanticSimilarityThreshold: 5,
        nudgeCompletionThreshold: 0,
        maxRamPerAgentMb: 1,
      })
    ).toEqual({
      maxConsecutiveRetries: 10,
      semanticSimilarityThreshold: 0.99,
      nudgeCompletionThreshold: 50,
      maxRamPerAgentMb: 64,
    });
    expect(sanitizePolicyInput({ maxConsecutiveRetries: 3.7 }).maxConsecutiveRetries).toBe(4);
  });

  it("accepts numeric strings but drops junk and unknown keys", () => {
    expect(sanitizePolicyInput({ maxRamPerAgentMb: "300" }).maxRamPerAgentMb).toBe(300);
    const out = sanitizePolicyInput({
      maxRamPerAgentMb: "lots",
      semanticSimilarityThreshold: NaN,
      nudgeCompletionThreshold: Infinity,
      isAdmin: true,
      user_id: "x",
    });
    expect(out).toEqual({});
  });

  it("only accepts a real boolean for autoThrottleEnabled", () => {
    expect(sanitizePolicyInput({ autoThrottleEnabled: false })).toEqual({ autoThrottleEnabled: false });
    expect(sanitizePolicyInput({ autoThrottleEnabled: "false" })).toEqual({});
    expect(sanitizePolicyInput({ autoApplyRewrites: true })).toEqual({ autoApplyRewrites: true });
    expect(sanitizePolicyInput({ autoApplyRewrites: "yes" })).toEqual({});
    expect(sanitizePolicyInput(null)).toEqual({});
    expect(sanitizePolicyInput("x")).toEqual({});
  });
});

describe("policy mapping", () => {
  it("round-trips through the DB row shape", () => {
    const update = policyDtoToRowUpdate({
      maxConsecutiveRetries: 4,
      semanticSimilarityThreshold: 0.9,
      nudgeCompletionThreshold: 85,
      maxRamPerAgentMb: 300,
      autoThrottleEnabled: false,
      autoApplyRewrites: true,
    });
    expect(update).toMatchObject({
      max_consecutive_retries: 4,
      exact_repeat_limit: 3,
      loop_score_threshold: 0.9,
      nudge_progress_pct: 85,
      ram_soft_limit_mb: 300,
      auto_downgrade_models: false,
      auto_apply_rewrites: true,
    });
    expect(
      policyRowToDto({
        loop_score_threshold: 0.9,
        exact_repeat_limit: 3,
        nudge_progress_pct: 85,
        max_consecutive_retries: 4,
        ram_soft_limit_mb: 300,
        auto_downgrade_models: false,
        auto_apply_rewrites: true,
      })
    ).toEqual({
      maxConsecutiveRetries: 4,
      semanticSimilarityThreshold: 0.9,
      nudgeCompletionThreshold: 85,
      maxRamPerAgentMb: 300,
      autoThrottleEnabled: false,
      autoApplyRewrites: true,
    });
  });

  it("keeps the exact-repeat limit at least 1", () => {
    expect(policyDtoToRowUpdate({ maxConsecutiveRetries: 1 }).exact_repeat_limit).toBe(1);
  });

  it("only keeps known boolean permissions", () => {
    expect(sanitizePermissions({ enforceMutex: false, monitorProcesses: "yes", admin: true })).toEqual({
      enforceMutex: false,
    });
  });
});

describe("incidentToStreamEvent", () => {
  const base = {
    id: "i1",
    agent_id: "a1",
    agent_name: "Claude",
    loop_type: "EXACT_TOOL_LOOP",
    kind: "LOOP",
    action: "KILLED",
    score: 0.98,
    detail: "same failing call x4",
    interception_ms: 12,
    created_at: new Date("2026-01-01T00:00:00Z"),
  };

  it("maps a killed exact loop", () => {
    const e = incidentToStreamEvent(base);
    expect(e).toMatchObject({ eventType: "EXACT_TOOL_LOOP", actionTaken: "KILLED_LOOP", latencyMs: 12, agentName: "Claude" });
    expect(e.similarityScore).toBeUndefined();
  });

  it("maps a paused semantic loop and carries the score", () => {
    const e = incidentToStreamEvent({ ...base, loop_type: "SEMANTIC_REASONING_LOOP", action: "PAUSED", score: 0.91 });
    expect(e).toMatchObject({ eventType: "SEMANTIC_REASONING_LOOP", actionTaken: "PAUSED_NUDGE", similarityScore: 0.91 });
  });

  it("maps RAM/budget/waste to memory governance and unknown actions to FLAGGED", () => {
    expect(incidentToStreamEvent({ ...base, kind: "RAM", action: "THROTTLED" })).toMatchObject({
      eventType: "MEMORY_GOVERNANCE",
      actionTaken: "THROTTLED",
    });
    expect(incidentToStreamEvent({ ...base, kind: "BAD_PROMPT", action: "REWRITE_PROPOSED" }).actionTaken).toBe("FLAGGED");
    expect(incidentToStreamEvent({ ...base, agent_name: null, agent_id: null }).agentName).toBe("Agent");
  });
});

describe("latencyStats", () => {
  it("returns zeros with no data (never a made-up number)", () => {
    expect(latencyStats([])).toEqual({ avg: 0, p99: 0 });
  });
  it("computes average and p99", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(latencyStats(samples)).toEqual({ avg: 50.5, p99: 99 });
    expect(latencyStats([7])).toEqual({ avg: 7, p99: 7 });
  });
});

describe("agent slots", () => {
  it("allows activation only below the plan limit", () => {
    expect(canActivateAgent(0, 2)).toBe(true);
    expect(canActivateAgent(1, 2)).toBe(true);
    expect(canActivateAgent(2, 2)).toBe(false); // Free plan: third agent refused
    expect(canActivateAgent(9, 10)).toBe(true);
    expect(canActivateAgent(10, 10)).toBe(false); // Pro plan: eleventh agent refused
    expect(canActivateAgent(0, 0)).toBe(false);
    expect(canActivateAgent(0, -3)).toBe(false);
  });
  it("words the refusal with the plan numbers", () => {
    expect(agentLimitMessage(2, "Free")).toContain("allows 2 concurrent agents");
    expect(agentLimitMessage(1)).toContain("1 concurrent agent.");
  });
});

describe("formatters", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  it("formats relative time", () => {
    expect(relativeTime(new Date(now - 2_000), now)).toBe("just now");
    expect(relativeTime(new Date(now - 42_000), now)).toBe("42s ago");
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000), now)).toBe("3h ago");
    expect(relativeTime(new Date(now - 72 * 3_600_000), now)).toBe("3d ago");
    expect(relativeTime(new Date(now + 10_000), now)).toBe("just now");
  });
  it("normalises lock paths so the same file always collides", () => {
    expect(normalizeLockPath("  .\\src\\app\\page.tsx ")).toBe("src/app/page.tsx");
    expect(normalizeLockPath("./src//app/page.tsx")).toBe("src/app/page.tsx");
    expect(normalizeLockPath("src/app/page.tsx")).toBe("src/app/page.tsx");
  });
});
