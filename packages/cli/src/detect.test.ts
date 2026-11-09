import { describe, it, expect } from "vitest";
import { LoopDetector, findRepeatingTail, scoreForRepeats } from "./detect";

const call = (id: string, name: string, input: unknown) => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
const ok = (id: string, text = "ok") => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] });
const err = (id: string, text: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: text }] });
const convo = (...messages: unknown[]) => ({ messages: [{ role: "user", content: "task" }, ...messages] });

/** The agent re-runs the same failing command `n` times. */
const failingRetries = (n: number) => {
  const m: unknown[] = [];
  for (let i = 0; i < n; i++) m.push(call(`c${i}`, "Bash", { command: "npm test" }), err(`c${i}`, "FAIL: expected 200 got 500"));
  return convo(...m);
};

describe("LoopDetector: real stuck agents", () => {
  it("trips on the same failing command repeated", () => {
    const v = new LoopDetector().check(failingRetries(4));
    expect(v.tripped).toBe(true);
    expect(v.reason).toContain("Bash");
    expect(v.interceptionMs).toBeLessThan(100);
  });

  it("trips on the same call repeated even when the results differ every time", () => {
    const m: unknown[] = [];
    for (let i = 0; i < 4; i++) m.push(call(`c${i}`, "Bash", { command: "curl localhost:3000/health" }), ok(`c${i}`, `timeout after ${i * 3}s`));
    expect(new LoopDetector().check(convo(...m)).tripped).toBe(true);
  });

  it("trips on an edit/test ping-pong", () => {
    const m: unknown[] = [];
    for (let i = 0; i < 3; i++) m.push(call(`e${i}`, "Edit", { file_path: "a.ts", new_string: "x" }), ok(`e${i}`), call(`t${i}`, "Bash", { command: "npm test" }), ok(`t${i}`));
    expect(new LoopDetector().check(convo(...m)).tripped).toBe(true);
  });
});

describe("LoopDetector: healthy agents must not be paused", () => {
  it("does not trip on many different file reads (shared path words)", () => {
    const files = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
    const m: unknown[] = [];
    files.forEach((f, i) => m.push(call(`r${i}`, "Read", { file_path: `/home/dev/projects/app/src/components/${f}.tsx` }), ok(`r${i}`, "contents")));
    expect(new LoopDetector().check(convo(...m)).tripped).toBe(false);
  });

  it("does not trip on a normal fix cycle: test fails, edit, test passes", () => {
    const v = new LoopDetector().check(
      convo(call("1", "Bash", { command: "npm test" }), err("1", "FAIL"), call("2", "Edit", { file_path: "a.ts", new_string: "fix" }), ok("2"), call("3", "Bash", { command: "npm test" }), ok("3", "PASS"))
    );
    expect(v.tripped).toBe(false);
  });

  it("allows two failed attempts of the same command (a flaky retry), pauses on the third", () => {
    expect(new LoopDetector().check(failingRetries(2)).tripped).toBe(false);
    expect(new LoopDetector().check(failingRetries(3)).tripped).toBe(true);
  });

  it("allows one or two identical retries", () => {
    expect(new LoopDetector().check(failingRetries(1)).tripped).toBe(false);
    const two = convo(call("1", "Bash", { command: "ls" }), ok("1"), call("2", "Bash", { command: "ls" }), ok("2"));
    expect(new LoopDetector().check(two).tripped).toBe(false);
  });

  it("copes with empty and odd conversations", () => {
    const d = new LoopDetector();
    for (const b of [{}, null, { messages: [] }, convo(), { messages: [{ role: "user", content: "hi" }] }]) expect(d.check(b).tripped).toBe(false);
  });
});

describe("LoopDetector: policy and resume", () => {
  it("honours a stricter repeat limit from the user's policy", () => {
    const d = new LoopDetector();
    d.setPolicy({ exactRepeatLimit: 5, loopScoreThreshold: 0.85 });
    const m: unknown[] = [];
    for (let i = 0; i < 4; i++) m.push(call(`c${i}`, "Bash", { command: "make" }), ok(`c${i}`, `out ${i}`));
    expect(d.check(convo(...m)).tripped).toBe(false);
    for (let i = 4; i < 7; i++) m.push(call(`c${i}`, "Bash", { command: "make" }), ok(`c${i}`, `out ${i}`));
    expect(d.check(convo(...m)).tripped).toBe(true);
  });

  it("after a resume, old history does not re-trigger, but a new loop still does", () => {
    const d = new LoopDetector();
    const stuck = failingRetries(4);
    expect(d.check(stuck).tripped).toBe(true);

    d.markResumed(stuck);
    expect(d.check(stuck).tripped).toBe(false); // same history, already handled

    // the agent tries something new, then gets stuck again on a different command
    const msgs = [...(stuck as { messages: unknown[] }).messages];
    for (let i = 0; i < 4; i++) msgs.push(call(`n${i}`, "Bash", { command: "pnpm build" }), err(`n${i}`, "ENOENT"));
    expect(d.check({ messages: msgs }).tripped).toBe(true);
  });

  it("resets cleanly if the agent compacts its history", () => {
    const d = new LoopDetector();
    d.markResumed(failingRetries(6));
    expect(d.check(failingRetries(1)).tripped).toBe(false);
    expect(d.check(failingRetries(4)).tripped).toBe(true);
  });
});

describe("findRepeatingTail", () => {
  it("finds a unit repeated end to end and ignores older history", () => {
    expect(findRepeatingTail(["A", "A", "A"], 3)).toEqual({ unit: ["A"], repeats: 3 });
    expect(findRepeatingTail(["X", "Y", "A", "A", "A", "A"], 3)).toEqual({ unit: ["A"], repeats: 4 });
    expect(findRepeatingTail(["A", "E", "A", "E", "A", "E"], 3)).toEqual({ unit: ["A", "E"], repeats: 3 });
    expect(findRepeatingTail(["e", "t", "x", "y", "e", "t", "x", "y", "e", "t", "x", "y"], 3)?.unit).toEqual(["e", "t", "x", "y"]);
  });
  it("returns null when nothing repeats enough", () => {
    expect(findRepeatingTail(["A", "A"], 3)).toBeNull();
    expect(findRepeatingTail(["A", "B", "C", "D", "E", "F"], 3)).toBeNull();
    expect(findRepeatingTail(["A", "E", "A", "E"], 3)).toBeNull();
    expect(findRepeatingTail(["A", "A", "B", "A", "A"], 3)).toBeNull();
    expect(findRepeatingTail([], 3)).toBeNull();
  });
  it("scores more repeats higher, capped", () => {
    expect(scoreForRepeats(3)).toBe(0.94);
    expect(scoreForRepeats(4)).toBe(0.97);
    expect(scoreForRepeats(9)).toBe(0.99);
  });
});
