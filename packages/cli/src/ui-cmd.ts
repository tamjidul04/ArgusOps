import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startControlApi } from "../../core/src/control-api";
import type { Store } from "../../core/src/store";
import { webhookNotifier } from "../../core/src/webhooks";

/** Where the app's web page lives: next to the built CLI (dist/ui), or in the repository while developing. */
export function findUiDir(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  for (const dir of [path.join(from, "ui"), path.resolve(from, "..", "..", "ui"), path.resolve(from, "..", "ui")]) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

/** Opens an address in the default browser. The address never contains anything but the page URL and the one-time token fragment. */
export function openInBrowser(url: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/(#t=[A-Za-z0-9]+)?$/.test(url)) return; // only ever our own page
  if (process.platform === "win32") spawn("cmd", ["/c", "start", '""', url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

export interface UiDeps {
  version: string;
  open?: (url: string) => void;
  /** Ends the command (tests); Ctrl+C always does. */
  signal?: AbortSignal;
  uiDir?: string | null;
}

/**
 * `argus ui`: serves the app's page from the local engine and opens it in your browser. The token travels in the
 * address fragment (#t=...), which browsers never send to any server; the page keeps it for that tab only.
 */
export async function uiCommand(argv: string[], store: Store, io: { out(t: string): void; err(t: string): void }, deps: UiDeps): Promise<number> {
  let port = store.config().apiPort;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-open") open = false;
    else if (a === "--port" || a.startsWith("--port=")) {
      port = Number(a === "--port" ? argv[++i] : a.slice(7));
      if (!Number.isInteger(port) || port < 0 || port > 65535) return (io.err("--port must be a whole number between 1 and 65535."), 1);
    } else return (io.err(`Unknown option ${a}. Usage: argus ui [--port <n>] [--no-open]`), 1);
  }
  const uiDir = deps.uiDir === undefined ? findUiDir() : deps.uiDir;
  if (!uiDir) return (io.err("The app's page was not found next to this program. Reinstall ArgusOps."), 2);

  const token = store.token();
  const withToken = (base: string) => `${base}/#t=${token}`;
  const launch = (base: string) => {
    if (open) (deps.open ?? openInBrowser)(withToken(base));
    else io.out(`Open this address in your browser (it contains your private token, so keep it to yourself):\n${withToken(base)}`);
  };

  // is an ArgusOps engine already serving on this port? Then just open it.
  if (port > 0) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      const j = (await r.json()) as { app?: string };
      if (j.app === "argusops") {
        io.out(`ArgusOps is already running on http://127.0.0.1:${port}.`);
        launch(`http://127.0.0.1:${port}`);
        return 0;
      }
    } catch {
      // nothing there: start our own
    }
  }

  let api;
  try {
    api = await startControlApi({ store, port, version: deps.version, uiDir, onNotification: webhookNotifier(store) });
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  io.out(`ArgusOps is on ${api.url} (this computer only). Press Ctrl+C to close it.`);
  launch(api.url);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
    deps.signal?.addEventListener("abort", () => resolve(), { once: true });
  });
  await api.close();
  return 0;
}
