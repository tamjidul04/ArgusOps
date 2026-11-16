import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { Store, type AgentRecord } from "../../../core/src/store";
import { perform, runTui } from "./app";
import { handleKey, initialView, parseKeys, type View } from "./keys";
import { clean, readData, type Data } from "./model";
import { paint, render, visible } from "./render";

const ESC = String.fromCharCode(27);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-tui-"));
  dirs.push(d);
  return d;
};
const NOW = 1_800_000_000_000;
const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({ id: "ag_1", name: "Claude Code · shop", type: "CLAUDE", status: "ACTIVE", runId: "r", startedAt: NOW - 1000, lastSeen: NOW - 1000, tokensUsed: 4200, desired: "RUN", reason: "", suggestion: null, ...over });
const paused = (over: Partial<AgentRecord> = {}) => agent({ status: "PAUSED", desired: "PAUSE", reason: "Repeated 3 times: npm test", suggestion: { id: "s", text: "Stop re-running npm test.", observed: "o", tokensBefore: 1, source: "rule", createdAt: NOW, status: "PENDING" }, ...over });

async function dataWith(agents: AgentRecord[]): Promise<{ store: Store; data: Data }> {
  const store = new Store(tmp());
  for (const a of agents) await store.updateAgent(a.id, () => a);
  return { store, data: readData(store, NOW) };
}
const press = (view: View, data: Data, ...keys: string[]) => {
  const effects: unknown[] = [];
  for (const k of keys) {
    const r = handleKey(view, k, data);
    view = r.view;
    effects.push(...r.effects);
  }
  return { view, effects };
};

describe("parseKeys", () => {
  it("turns arrows and special keys into names and keeps ordinary characters", () => {
    expect(parseKeys(`${ESC}[A${ESC}[B${ESC}[C${ESC}[D\r\t\x7fq3`)).toEqual(["up", "down", "right", "left", "enter", "tab", "backspace", "q", "3"]);
    expect(parseKeys("\x03")).toEqual(["ctrl-c"]);
    expect(parseKeys(ESC)).toEqual(["escape"]);
    expect(parseKeys(`${ESC}[1;5C`)).toEqual(["ignored"]);
    expect(parseKeys("hi there")).toEqual(["h", "i", " ", "t", "h", "e", "r", "e"]); // a paste arrives as one chunk
  });
});

describe("keys", () => {
  it("switches screens and moves the selection without leaving the list", async () => {
    const { data } = await dataWith([agent({ id: "ag_1" }), agent({ id: "ag_2", name: "b" })]);
    let r = press(initialView(), data, "3");
    expect(r.view.tab).toBe("usage");
    r = press(r.view, data, "tab");
    expect(r.view.tab).toBe("alerts");
    r = press(r.view, data, "left", "left", "left");
    expect(r.view.tab).toBe("agents");
    r = press(r.view, data, "down", "down", "down");
    expect(r.view.sel.agents).toBe(1);
    r = press(r.view, data, "up", "up", "up");
    expect(r.view.sel.agents).toBe(0);
  });

  it("a paused agent: continue, send the suggestion, edit it, or add your own words", async () => {
    const { data } = await dataWith([paused()]);
    expect(press(initialView(), data, "r").effects).toEqual([{ type: "resume", id: "ag_1" }]);
    expect(press(initialView(), data, "a").effects).toEqual([{ type: "approve", id: "ag_1" }]);
    let r = press(initialView(), data, "e");
    expect(r.view.mode).toBe("input");
    expect(r.view.input).toBe("Stop re-running npm test.");
    r = press(r.view, data, "backspace", "!", "enter");
    expect(r.effects).toEqual([{ type: "approve", id: "ag_1", text: "Stop re-running npm test!" }]);
    expect(r.view.mode).toBe("normal");
    r = press(initialView(), data, "h", "d", "o", " ", "x", "enter");
    expect(r.effects).toEqual([{ type: "resume", id: "ag_1", hint: "do x" }]);
    r = press(initialView(), data, "h", "z", "escape");
    expect(r.effects).toEqual([]);
    expect(r.view.mode).toBe("normal");
    // while typing, letters are text, not commands
    r = press(initialView(), data, "h", "q", "x");
    expect(r.effects).toEqual([]);
    expect(r.view.input).toBe("qx");
  });

  it("stopping asks first, and only y does it", async () => {
    const { data } = await dataWith([agent()]);
    let r = press(initialView(), data, "x");
    expect(r.view.mode).toBe("confirm");
    expect(r.effects).toEqual([]);
    expect(press(r.view, data, "n").effects).toEqual([]);
    expect(press(r.view, data, "enter").effects).toEqual([]);
    expect(press(r.view, data, "y").effects).toEqual([{ type: "stop", id: "ag_1" }]);
    expect(press(initialView(), data, "p").effects).toEqual([{ type: "pause", id: "ag_1" }]);
  });

  it("an agent that is not running cannot be controlled", async () => {
    const { data } = await dataWith([agent({ lastSeen: NOW - 120_000 })]);
    const r = press(initialView(), data, "p");
    expect(r.effects).toEqual([]);
    expect(r.view.message).toContain("not running");
  });

  it("quits with q or Ctrl+C, but not while typing", async () => {
    const { data } = await dataWith([paused()]);
    expect(press(initialView(), data, "q").effects).toEqual([{ type: "quit" }]);
    expect(press(initialView(), data, "ctrl-c").effects).toEqual([{ type: "quit" }]);
    expect(press(initialView(), data, "h", "q").effects).toEqual([]);
  });

  it("the Models screen changes the routing mode", async () => {
    const { data } = await dataWith([]);
    expect(press(initialView(), data, "5", "down", "enter").effects).toEqual([{ type: "mode", mode: "auto" }]);
    expect(press(initialView(), data, "5", "m").effects).toEqual([{ type: "mode", mode: "auto" }]);
  });
});

describe("screens", () => {
  it("shows agents, what is waiting for you, and the keys that apply", async () => {
    const { data } = await dataWith([agent({ id: "ag_2", name: "Quiet agent" }), paused()]);
    const text = render(initialView(), data, 100, 24).map((l) => l.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "")).join("\n");
    expect(text).toContain("1 Agents (1)");
    expect(text).toContain("PAUSED");
    expect(text).toContain("Repeated 3 times: npm test");
    expect(text).toContain("Stop re-running npm test.");
    expect(text.indexOf("Claude Code · shop")).toBeLessThan(text.indexOf("Quiet agent")); // the one that needs you comes first
    expect(text).toContain("r continue · a send suggestion · e edit");
  });

  it("every line fits the terminal, however narrow, and the screen has exactly the rows asked for", async () => {
    const { data } = await dataWith([paused({ name: "x".repeat(200), reason: "y ".repeat(300) })]);
    for (const [cols, rows] of [[20, 8], [40, 12], [80, 24], [200, 50]]) {
      for (const tab of ["1", "2", "3", "4", "5"]) {
        const lines = render(press(initialView(), data, tab).view, data, cols, rows);
        expect(lines).toHaveLength(rows);
        for (const l of lines) expect(l.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "").length, `${cols}x${rows} tab ${tab}`).toBeLessThanOrEqual(cols);
      }
    }
  });

  it("text from an agent can never send escape sequences to your terminal", async () => {
    const evil = `${ESC}]0;pwned${String.fromCharCode(7)}${ESC}[2J${ESC}[1;1H${String.fromCharCode(0x9b)}31mred`;
    const { store, data } = await dataWith([paused({ name: evil, reason: evil, suggestion: { id: "s", text: evil, observed: "o", tokensBefore: 1, source: "rule", createdAt: NOW, status: "PENDING" } })]);
    store.appendNotification({ title: evil, body: evil, level: "WARN" });
    const d2 = readData(store, NOW);
    for (const tab of ["1", "4"]) {
      const out = render(press(initialView(), d2, tab).view, d2, 120, 30).join("\n");
      // the only escape sequences left are our own colours
      const stripped = out.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "");
      expect(stripped).not.toContain(ESC);
      expect(stripped).not.toContain(String.fromCharCode(0x9b));
      expect(stripped).not.toContain(String.fromCharCode(7));
    }
    expect(data.agents.length).toBe(1);
    expect(clean(`a${ESC}b${String.fromCharCode(0x85)}c d`)).toBe("a b c d");
    expect(visible([{ t: evil }])).not.toContain(ESC);
    expect(paint([{ t: evil, s: "bold" }], 10)).not.toContain("]0;pwned" + String.fromCharCode(7));
  });

  it("explains each empty screen", async () => {
    const { data } = await dataWith([]);
    const at = (t: string) => render(press(initialView(), data, t).view, data, 100, 24).join("\n");
    expect(at("1")).toContain("argus run claude");
    expect(at("2")).toContain("argus autopilot");
    expect(at("4")).toContain("Nothing to report");
    expect(at("3")).toContain("Last 7 days");
    expect(at("5")).toContain("Suggest (default)");
    expect(render({ ...initialView(), help: true }, data, 100, 24).join("\n")).toContain("quit");
  });

  it("shows Autopilot steps and what needs you", async () => {
    const { store } = await dataWith([]);
    store.saveAutopilotRun({ id: "ap_1", goal: "build a todo app", root: "/p", createdAt: 1, updatedAt: NOW, status: "needs-you", answers: [], costUsd: 0.5, control: null, needsYou: "Step 2 did not pass after 3 attempts.", sessionId: null, log: [], plan: { summary: "s", steps: [{ id: "s1", title: "Set up", instructions: "x", acceptance: [] }, { id: "s2", title: "Add storage", instructions: "x", acceptance: [] }] }, steps: [{ id: "s1", status: "passed", attempts: 1, costUsd: 0, problems: [], checks: [] }, { id: "s2", status: "failed", attempts: 3, costUsd: 0, problems: ["x"], checks: [] }] });
    const d = readData(store, NOW);
    const text = render(press(initialView(), d, "2").view, d, 100, 24).join("\n");
    expect(text).toContain("build a todo app");
    expect(text).toContain("✓ ");
    expect(text).toContain("3 attempts");
    expect(text).toContain("argus autopilot resume ap_1");
  });
});

describe("perform", () => {
  it("pauses and resumes through the same store the engine uses, and sets routing and Autopilot control", async () => {
    const { store } = await dataWith([agent()]);
    expect(await perform(store, { type: "pause", id: "ag_1" })).toContain("paus");
    expect(store.agent("ag_1")?.desired).toBe("PAUSE");
    await perform(store, { type: "resume", id: "ag_1", hint: "try another way" });
    expect(store.agent("ag_1")).toMatchObject({ desired: "RUN", hint: "try another way" });
    expect(await perform(store, { type: "mode", mode: "auto" })).toContain("auto");
    expect(store.config().routing.mode).toBe("auto");
    expect(await perform(store, { type: "autopilot", id: "ap_missing", control: "stop" })).toContain("gone");
    expect(await perform(store, { type: "stop", id: "ag_nope" })).toBeTruthy();
  });
});

describe("the terminal app", () => {
  function terminal() {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream & { raw: boolean };
    stdin.raw = false;
    (stdin as unknown as { setRawMode: (on: boolean) => void }).setRawMode = (on: boolean) => {
      stdin.raw = on;
    };
    const written: string[] = [];
    const stdout = Object.assign(new PassThrough(), { columns: 90, rows: 26 }) as unknown as NodeJS.WriteStream;
    stdout.write = ((t: string) => (written.push(String(t)), true)) as typeof stdout.write;
    return { stdin, stdout, written };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("draws the screen, approves a suggestion with one key, and puts the terminal back when you quit", async () => {
    const { store } = await dataWith([paused()]);
    const { stdin, stdout, written } = terminal();
    const done = runTui({ store, stdin, stdout, intervalMs: 20, now: () => NOW });
    expect(stdin.raw).toBe(true);
    expect(written.join("")).toContain(ESC + "[?1049h"); // its own screen
    expect(written.join("")).toContain("Repeated 3 times: npm test");

    stdin.emit("data", Buffer.from("a"));
    await wait(150);
    expect(store.agent("ag_1")).toMatchObject({ desired: "RUN", hint: "Stop re-running npm test." });

    stdin.emit("data", Buffer.from("q"));
    expect(await done).toBe(0);
    expect(stdin.raw).toBe(false);
    expect(written.join("")).toContain(ESC + "[?1049l");
    expect(written.join("")).toContain(ESC + "[?25h"); // cursor back
  });

  it("follows what other ArgusOps processes write", async () => {
    const { store } = await dataWith([]);
    const { stdin, stdout, written } = terminal();
    const done = runTui({ store, stdin, stdout, intervalMs: 20, now: () => NOW });
    expect(written.join("")).toContain("No agent is being supervised");
    await store.updateAgent("ag_9", () => agent({ id: "ag_9", name: "Appeared later" }));
    await wait(120);
    expect(written.join("")).toContain("Appeared later");
    stdin.emit("data", Buffer.from("\x03"));
    await done;
  });
});
