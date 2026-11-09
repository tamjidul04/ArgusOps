import { describe, it, expect } from "vitest";
import { describeCall, draftRewrite, estimateTokens, loopCost, MAX_INSTRUCTION_CHARS, parseStep } from "./rewrite-core";

describe("parseStep", () => {
  it("parses tool calls, errors and anything else", () => {
    expect(parseStep('Bash({"command":"npm test","description":"run tests"})')).toEqual({ kind: "call", tool: "Bash", input: { command: "npm test", description: "run tests" } });
    expect(parseStep("error: FAIL src/a.test.ts")).toEqual({ kind: "error", text: "FAIL src/a.test.ts" });
    expect(parseStep("something odd")).toEqual({ kind: "other", text: "something odd" });
  });
  it("keeps the tool name when the input was cut short", () => {
    expect(parseStep('Edit({"file_path":"src/a.ts","new_string":"abc')).toMatchObject({ kind: "other" });
    expect(parseStep('Edit({"file_path":"src/a.ts", BROKEN)')).toEqual({ kind: "call", tool: "Edit", input: {} });
  });
});

describe("describeCall", () => {
  const call = (tool: string, input: Record<string, unknown>) => ({ kind: "call" as const, tool, input });
  it("describes common Claude Code tools in plain words", () => {
    expect(describeCall(call("Bash", { command: "npm test" }))).toBe("the command `npm test`");
    expect(describeCall(call("Edit", { file_path: "src/app.ts" }))).toBe("editing src/app.ts");
    expect(describeCall(call("Read", { file_path: "a.ts" }))).toBe("reading a.ts");
    expect(describeCall(call("Grep", { pattern: "TODO" }))).toBe("searching for `TODO`");
    expect(describeCall(call("Mystery", {}))).toBe("the Mystery tool with the same input");
    expect(describeCall(call("Bash", {}))).toBe("the same shell command");
  });
});

describe("draftRewrite", () => {
  it("same failing command: names the command and the error and forbids blind retries", () => {
    const d = draftRewrite(['Bash({"command":"npm test"})', "error: FAIL expected 200 got 500"], 3);
    expect(d.shape).toBe("call-and-error");
    expect(d.instruction).toContain("Stop re-running the command `npm test`");
    expect(d.instruction).toContain('"FAIL expected 200 got 500"');
    expect(d.instruction).toContain("3 times");
    expect(d.instruction).toContain("root cause");
    expect(d.instruction).toContain("stop and explain");
    expect(d.observed).toContain("failed the same way");
  });

  it("same call, no error: tells it to change approach", () => {
    const d = draftRewrite(['Read({"file_path":"src/a.ts"})'], 5);
    expect(d.shape).toBe("single-call");
    expect(d.instruction).toContain("Stop repeating reading src/a.ts");
    expect(d.instruction).toContain("5 times");
  });

  it("edit/test cycle: describes the sequence and asks for a different approach", () => {
    const d = draftRewrite(['Edit({"file_path":"a.ts"})', 'Bash({"command":"npm test"})', "error: TypeError x"], 4);
    expect(d.shape).toBe("cycle");
    expect(d.instruction).toContain("editing a.ts, then the command `npm test`");
    expect(d.instruction).toContain("genuinely different approach");
    expect(d.instruction).toContain('"TypeError x"');
  });

  it("falls back gracefully and never exceeds the length cap", () => {
    expect(draftRewrite([], 3).shape).toBe("unknown");
    expect(draftRewrite(["weird thing"], 0).instruction).toContain("2 times");
    const long = draftRewrite([`Bash({"command":"${"x".repeat(5000)}"})`, `error: ${"y".repeat(5000)}`], 3);
    expect(long.instruction.length).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARS);
  });
});

describe("cost helpers", () => {
  it("estimates tokens at about four characters each", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(1);
  });
  it("computes what the loop already cost from real per-call tokens", () => {
    expect(loopCost([13_000, 14_000, 15_000], 3)).toEqual({ perCall: 14_000, total: 42_000 });
    expect(loopCost([], 3)).toEqual({ perCall: 0, total: 0 });
  });
});
