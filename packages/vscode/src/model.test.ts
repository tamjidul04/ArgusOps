import { describe, it, expect } from "vitest";
import { clip, diffForAlerts, formatTokens, kindOf, normalizeServerUrl, statusBar, summarize, timeAgo, type AgentView } from "./model";

const agent = (id: string, status: string, extra: Partial<AgentView> = {}): AgentView => ({
  id,
  name: `Agent ${id}`,
  type: "CLAUDE",
  status,
  tokensUsed: 0,
  currentTask: null,
  lastSeen: new Date().toISOString(),
  suggestion: null,
  ...extra,
});

describe("kinds and summaries", () => {
  it("maps statuses", () => {
    expect(kindOf("ACTIVE")).toBe("running");
    expect(kindOf("PAUSED_NUDGE")).toBe("paused");
    expect(kindOf("KILLED_LOOP")).toBe("stopped");
    expect(kindOf("HIBERNATED")).toBe("idle");
    expect(kindOf("whatever")).toBe("idle");
  });
  it("counts each kind", () => {
    expect(summarize([agent("1", "ACTIVE"), agent("2", "ACTIVE"), agent("3", "PAUSED_NUDGE"), agent("4", "KILLED_LOOP"), agent("5", "HIBERNATED")])).toEqual({ running: 2, paused: 1, stopped: 1 });
  });
});

describe("statusBar", () => {
  const s = { running: 0, paused: 0, stopped: 0 };
  it("asks to sign in, reports offline, and flags paused agents", () => {
    expect(statusBar({ signedIn: false, offline: false, summary: s }).text).toContain("sign in");
    expect(statusBar({ signedIn: true, offline: true, summary: s }).text).toContain("offline");
    const paused = statusBar({ signedIn: true, offline: false, summary: { running: 1, paused: 2, stopped: 0 } });
    expect(paused).toMatchObject({ text: "$(warning) ArgusOps: 2 paused", attention: true });
    expect(paused.tooltip).toContain("2 agents are waiting for you, 1 running");
  });
  it("is calm when things are fine, with correct singular/plural", () => {
    const one = statusBar({ signedIn: true, offline: false, summary: { running: 1, paused: 0, stopped: 0 } });
    expect(one).toMatchObject({ text: "$(shield) ArgusOps: 1 running", attention: false });
    expect(one.tooltip).toBe("1 agent running, none stuck.");
    expect(statusBar({ signedIn: true, offline: false, summary: { running: 0, paused: 1, stopped: 0 } }).tooltip).toContain("1 agent is waiting");
    expect(statusBar({ signedIn: true, offline: false, summary: s }).tooltip).toContain("argus run claude");
  });
});

describe("diffForAlerts", () => {
  it("alerts when an agent becomes paused, once", () => {
    const before = [agent("1", "ACTIVE")];
    const after = [agent("1", "PAUSED_NUDGE")];
    expect(diffForAlerts(before, after).paused.map((a) => a.id)).toEqual(["1"]);
    expect(diffForAlerts(after, after).paused).toEqual([]); // still paused: no repeat
  });
  it("alerts again for a second pause after a resume", () => {
    const paused = [agent("1", "PAUSED_NUDGE")];
    const running = [agent("1", "ACTIVE")];
    expect(diffForAlerts(running, paused).paused).toHaveLength(1);
    expect(diffForAlerts(paused, running).paused).toHaveLength(0);
    expect(diffForAlerts(running, paused).paused).toHaveLength(1);
  });
  it("on the first load, reports agents that are already paused but not old stops", () => {
    const next = [agent("1", "PAUSED_NUDGE"), agent("2", "KILLED_LOOP"), agent("3", "ACTIVE")];
    const a = diffForAlerts(null, next);
    expect(a.paused.map((x) => x.id)).toEqual(["1"]);
    expect(a.stopped).toEqual([]);
  });
  it("reports a stop that was watched, and an agent that appears already paused", () => {
    expect(diffForAlerts([agent("1", "PAUSED_NUDGE")], [agent("1", "KILLED_LOOP")]).stopped.map((x) => x.id)).toEqual(["1"]);
    expect(diffForAlerts([], [agent("9", "PAUSED_NUDGE")]).paused.map((x) => x.id)).toEqual(["9"]);
    expect(diffForAlerts([agent("1", "KILLED_LOOP")], [agent("1", "KILLED_LOOP")]).stopped).toEqual([]);
  });
});

describe("formatting helpers", () => {
  it("clips and formats", () => {
    expect(clip("a  b\nc", 10)).toBe("a b c");
    expect(clip("abcdefghij", 5)).toBe("abcd…");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(2_000_000)).toBe("2M");
    const now = new Date("2026-01-01T12:00:00Z").getTime();
    expect(timeAgo(new Date(now - 3_000).toISOString(), now)).toBe("just now");
    expect(timeAgo(new Date(now - 90_000).toISOString(), now)).toBe("1m ago");
    expect(timeAgo(new Date(now - 5 * 3_600_000).toISOString(), now)).toBe("5h ago");
  });
  it("only accepts safe server URLs", () => {
    expect(normalizeServerUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeServerUrl(" https://argusops.example.com ")).toBe("https://argusops.example.com");
    expect(normalizeServerUrl("https://x.com/base/")).toBe("https://x.com/base");
    for (const bad of ["ftp://x.com", "javascript:alert(1)", "not a url", "", "https://user:pw@x.com"]) expect(normalizeServerUrl(bad), bad).toBeNull();
  });
});
