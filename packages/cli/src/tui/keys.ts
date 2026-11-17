import type { Data } from "./model";
import { isGone, isWaiting } from "./model";

export const TABS = ["overview", "agents", "autopilot", "usage", "alerts", "models"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABEL: Record<Tab, string> = { overview: "Overview", agents: "Agents", autopilot: "Autopilot", usage: "Usage", alerts: "Alerts", models: "Models" };

export interface View {
  tab: Tab;
  sel: Record<Tab, number>;
  /** normal: keys are commands. input: typing a line of text. confirm: waiting for y/n. */
  mode: "normal" | "input" | "confirm";
  input: string;
  inputKind: "hint" | "edit" | null;
  confirm: { text: string; effect: Effect } | null;
  message: string;
  help: boolean;
}

export type Effect =
  | { type: "pause"; id: string }
  | { type: "resume"; id: string; hint?: string }
  | { type: "approve"; id: string; text?: string }
  | { type: "stop"; id: string }
  | { type: "autopilot"; id: string; control: "pause" | "stop" }
  | { type: "mode"; mode: "off" | "suggest" | "auto" }
  | { type: "alerts-read" }
  | { type: "quit" };

export const initialView = (): View => ({ tab: "overview", sel: { overview: 0, agents: 0, autopilot: 0, usage: 0, alerts: 0, models: 0 }, mode: "normal", input: "", inputKind: null, confirm: null, message: "", help: false });

const ESC = String.fromCharCode(27);
const SEQUENCE = new RegExp("^" + ESC + "(\\[[0-9;]*[A-Za-z~]|O[A-D])");
const NAMES: Record<string, string> = { "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[H": "home", "[F": "end", "[3~": "delete", "[Z": "shift-tab", OA: "up", OB: "down", OC: "right", OD: "left" };

/** Splits what the terminal sent into keys: arrows and other escape sequences become names, the rest single characters. */
export function parseKeys(chunk: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < chunk.length; ) {
    const c = chunk[i];
    if (c === ESC) {
      const m = SEQUENCE.exec(chunk.slice(i));
      if (m) {
        out.push(NAMES[m[1]] ?? "ignored");
        i += m[0].length;
      } else {
        out.push("escape");
        i++;
      }
    } else {
      if (c === "\r" || c === "\n") out.push("enter");
      else if (c === "\t") out.push("tab");
      else if (c === "\x7f" || c === "\b") out.push("backspace");
      else if (c === "\x03") out.push("ctrl-c");
      else if (c >= " ") out.push(c);
      i++;
    }
  }
  return out;
}

const count = (view: View, data: Data) => ({ overview: 0, agents: data.agents.length, autopilot: data.runs.length, usage: 0, alerts: data.alerts.length, models: 3 })[view.tab];
export const MODES = ["suggest", "auto", "off"] as const;

/** One key in, the new view and anything that should now happen out. Pure, so it can be tested without a terminal. */
export function handleKey(view: View, key: string, data: Data): { view: View; effects: Effect[] } {
  const say = (message: string, v: View = view): View => ({ ...v, message });

  if (view.mode === "input") {
    if (key === "escape" || key === "ctrl-c") return { view: { ...view, mode: "normal", input: "", inputKind: null, message: "Cancelled." }, effects: [] };
    if (key === "enter") {
      const agent = data.agents[view.sel.agents];
      const text = view.input.trim();
      const done: View = { ...view, mode: "normal", input: "", inputKind: null, message: "" };
      if (!agent) return { view: done, effects: [] };
      if (view.inputKind === "edit") return { view: say("Sending your instruction…", done), effects: text ? [{ type: "approve", id: agent.id, text }] : [] };
      return { view: say("Continuing…", done), effects: [{ type: "resume", id: agent.id, ...(text ? { hint: text } : {}) }] };
    }
    if (key === "backspace") return { view: { ...view, input: view.input.slice(0, -1) }, effects: [] };
    if (key.length === 1) return { view: { ...view, input: (view.input + key).slice(0, 2000) }, effects: [] };
    return { view, effects: [] };
  }

  if (view.mode === "confirm") {
    const yes = key === "y" || key === "Y";
    const effect = view.confirm?.effect;
    return { view: { ...view, mode: "normal", confirm: null, message: yes ? "Done." : "Left as it was." }, effects: yes && effect ? [effect] : [] };
  }

  if (key === "ctrl-c" || key === "q") return { view, effects: [{ type: "quit" }] };
  if (key === "?") return { view: { ...view, help: !view.help }, effects: [] };
  if (view.help) return { view: { ...view, help: false }, effects: [] };

  const i = TABS.indexOf(view.tab);
  if (key === "tab" || key === "right") return { view: { ...view, tab: TABS[(i + 1) % TABS.length], message: "" }, effects: [] };
  if (key === "shift-tab" || key === "left") return { view: { ...view, tab: TABS[(i + TABS.length - 1) % TABS.length], message: "" }, effects: [] };
  if (/^[1-6]$/.test(key)) return { view: { ...view, tab: TABS[Number(key) - 1], message: "" }, effects: [] };

  const n = count(view, data);
  const sel = view.sel[view.tab];
  if (key === "up" || key === "k") return { view: { ...view, sel: { ...view.sel, [view.tab]: Math.max(0, sel - 1) } }, effects: [] };
  if (key === "down" || key === "j") return { view: { ...view, sel: { ...view.sel, [view.tab]: Math.min(Math.max(0, n - 1), sel + 1) } }, effects: [] };

  if (view.tab === "agents") {
    const a = data.agents[Math.min(sel, data.agents.length - 1)];
    if (!a) return { view, effects: [] };
    const live = (a.status === "ACTIVE" || a.status === "PAUSED") && !isGone(a, data.now);
    if (!live) return { view: say("That agent is not running, so there is nothing to control."), effects: [] };
    if (a.status === "ACTIVE") {
      if (key === "p") return { view: say("Pausing…"), effects: [{ type: "pause", id: a.id }] };
      if (key === "x") return { view: { ...view, mode: "confirm", confirm: { text: `Stop "${a.name}"? It cannot continue; you would start a new session. (y/n)`, effect: { type: "stop", id: a.id } } }, effects: [] };
      return { view, effects: [] };
    }
    if (isWaiting(a, data.now)) {
      const pending = a.suggestion?.status === "PENDING" ? a.suggestion : null;
      if (key === "r") return { view: say("Continuing…"), effects: [{ type: "resume", id: a.id }] };
      if (key === "a" && pending) return { view: say("Sending the suggestion…"), effects: [{ type: "approve", id: a.id }] };
      if (key === "e" && pending) return { view: { ...view, mode: "input", inputKind: "edit", input: pending.text, message: "" }, effects: [] };
      if (key === "h") return { view: { ...view, mode: "input", inputKind: "hint", input: "", message: "" }, effects: [] };
      if (key === "x") return { view: { ...view, mode: "confirm", confirm: { text: `Stop "${a.name}"? (y/n)`, effect: { type: "stop", id: a.id } } }, effects: [] };
    }
    return { view, effects: [] };
  }

  if (view.tab === "autopilot") {
    const r = data.runs[Math.min(sel, data.runs.length - 1)];
    if (r && (r.status === "running" || r.status === "paused") && !r.control) {
      if (key === "p") return { view: say("Autopilot will pause after the agent's current turn."), effects: [{ type: "autopilot", id: r.id, control: "pause" }] };
      if (key === "x") return { view: { ...view, mode: "confirm", confirm: { text: `Stop Autopilot run ${r.id}? (y/n)`, effect: { type: "autopilot", id: r.id, control: "stop" } } }, effects: [] };
    }
    return { view, effects: [] };
  }

  if (view.tab === "alerts" && key === "m") return { view: say("Marked as read."), effects: [{ type: "alerts-read" }] };

  if (view.tab === "models") {
    if (key === "enter" || key === " ") return { view: say(`Routing: ${MODES[sel]}.`), effects: [{ type: "mode", mode: MODES[sel] }] };
    if (key === "m") {
      const next = MODES[(MODES.indexOf(data.routing.config.mode) + 1) % MODES.length];
      return { view: say(`Routing: ${next}.`), effects: [{ type: "mode", mode: next }] };
    }
  }
  return { view, effects: [] };
}
