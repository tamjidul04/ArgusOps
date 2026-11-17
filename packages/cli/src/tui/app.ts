import { Controls } from "../../../core/src/control";
import type { AutopilotRun } from "../../../core/src/autopilot";
import type { Store } from "../../../core/src/store";
import { handleKey, initialView, parseKeys, type Effect, type View } from "./keys";
import { readData, type Data } from "./model";
import { render } from "./render";

export interface TuiOptions {
  store: Store;
  stdin: NodeJS.ReadStream & { setRawMode?: (on: boolean) => unknown };
  stdout: NodeJS.WriteStream;
  intervalMs?: number;
  now?: () => number;
}

const ESC = String.fromCharCode(27);
const ENTER_SCREEN = `${ESC}[?1049h${ESC}[?25l`; // second screen, hidden cursor
const LEAVE_SCREEN = `${ESC}[?25h${ESC}[?1049l`;

/** Does what a key asked for, and says in words how it went. */
export async function perform(store: Store, effect: Effect): Promise<string> {
  const controls = new Controls(store);
  const say = (r: { ok: true; message: string } | { ok: false; error: string }) => (r.ok ? r.message : r.error);
  switch (effect.type) {
    case "pause":
      return say(await controls.pause(effect.id));
    case "resume":
      return say(await controls.resume(effect.id, effect.hint));
    case "approve":
      return say(await controls.applySuggestion(effect.id, effect.text));
    case "stop":
      return say(await controls.stop(effect.id));
    case "autopilot": {
      const run = store.autopilotRun<AutopilotRun>(effect.id);
      if (!run) return "That Autopilot run is gone.";
      if (run.status === "done" || run.status === "stopped" || run.status === "failed") return `That run is already ${run.status}.`;
      store.saveAutopilotRun({ ...run, control: effect.control });
      return effect.control === "pause" ? "Autopilot will pause after the agent's current turn." : "Autopilot will stop after the agent's current turn.";
    }
    case "mode": {
      await store.saveConfig({ routing: { ...store.config().routing, mode: effect.mode } });
      return `Model routing is now ${effect.mode}.`;
    }
    case "alerts-read":
      await store.markNotificationsRead();
      return "All alerts marked as read.";
    case "quit":
      return "";
  }
}

/**
 * The terminal app: the same screens as the desktop app, drawn in the terminal and driven by the keyboard. It reads
 * the local store directly (like the other commands), so it needs no server and no token. Resolves when you quit.
 */
export function runTui(o: TuiOptions): Promise<number> {
  const { store, stdin, stdout } = o;
  let view: View = initialView();
  let data: Data = readData(store, o.now?.());
  let busy = false;
  let closed = false;

  const draw = () => {
    if (closed) return;
    const cols = Math.max(20, stdout.columns || 80);
    const rows = Math.max(8, stdout.rows || 24);
    stdout.write(`${ESC}[H` + render(view, data, cols, rows).map((l) => l + `${ESC}[K`).join("\n") + `${ESC}[J`);
  };
  const refresh = () => {
    try {
      data = readData(store, o.now?.());
    } catch {
      // a file half-written by another ArgusOps process: keep what is on screen, try again next time
    }
    draw();
  };

  return new Promise<number>((resolve) => {
    const timer = setInterval(() => {
      if (!busy && view.mode === "normal") refresh();
    }, o.intervalMs ?? 1000);
    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      stdin.off("data", onData);
      stdout.off("resize", draw);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write(LEAVE_SCREEN);
      resolve(0);
    };
    const onData = (chunk: Buffer | string) => {
      for (const key of parseKeys(String(chunk))) {
        const r = handleKey(view, key, data);
        view = r.view;
        for (const effect of r.effects) {
          if (effect.type === "quit") return finish();
          busy = true;
          void perform(store, effect)
            .then((m) => {
              if (m) view = { ...view, message: m };
            })
            .catch((e) => {
              view = { ...view, message: e instanceof Error ? e.message : "Something went wrong." };
            })
            .finally(() => {
              busy = false;
              refresh();
            });
        }
      }
      draw();
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
    stdout.on("resize", draw);
    process.once("SIGTERM", finish);
    stdout.write(ENTER_SCREEN);
    draw();
  });
}
