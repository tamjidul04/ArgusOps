import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the app's screens live: next to the built CLI (dist/ui), or in the repository while developing. The desktop app and the engine serve them. */
export function findUiDir(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  for (const dir of [path.join(from, "ui"), path.resolve(from, "..", "..", "ui"), path.resolve(from, "..", "ui")]) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

export interface DesktopApp {
  /** The program to start. */
  command: string;
  args: string[];
  cwd?: string;
  /** Builds the app first (a source checkout builds on demand). */
  prepare?: () => boolean;
}

/**
 * Where the desktop app is on this computer: the program named by ARGUSOPS_DESKTOP, or the one in a source checkout
 * (packages/desktop with its Electron installed), or the place the Windows installer puts it.
 */
export function findDesktopApp(from: string = path.dirname(fileURLToPath(import.meta.url)), env: NodeJS.ProcessEnv = process.env): DesktopApp | null {
  const named = env.ARGUSOPS_DESKTOP;
  if (named && fs.existsSync(named)) return { command: named, args: [] };
  const installed = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "ArgusOps", "ArgusOps.exe") : "";
  if (installed && fs.existsSync(installed)) return { command: installed, args: [] };
  for (const dir of [path.resolve(from, "..", "..", "desktop"), path.resolve(from, "..", "desktop")]) {
    const marker = path.join(dir, "node_modules", "electron", "path.txt");
    if (!fs.existsSync(marker) || !fs.existsSync(path.join(dir, "package.json"))) continue;
    const exe = path.join(dir, "node_modules", "electron", "dist", fs.readFileSync(marker, "utf8").trim());
    if (!fs.existsSync(exe)) continue;
    return {
      command: exe,
      args: ["."],
      cwd: dir,
      prepare: () => fs.existsSync(path.join(dir, "dist", "main.cjs")) || spawnSync(process.execPath, [path.join(dir, "build.mjs")], { cwd: dir, stdio: "ignore" }).status === 0,
    };
  }
  return null;
}

export interface AppDeps {
  find?: () => DesktopApp | null;
  /** Starts the app and lets this command end (tests replace it). */
  start?: (app: DesktopApp, env: NodeJS.ProcessEnv) => void;
}

/**
 * `argus app`: opens the ArgusOps desktop app, which starts and uses the local engine itself. There is no browser
 * involved: the window shows the app's own screens and can reach nothing else.
 */
export async function appCommand(argv: string[], io: { out(t: string): void; err(t: string): void }, deps: AppDeps = {}): Promise<number> {
  if (argv.length) return (io.err(`argus app takes no options (got ${argv[0]}). Usage: argus app`), 1);
  const found = (deps.find ?? findDesktopApp)();
  if (!found) {
    io.err(
      [
        "The ArgusOps desktop app is not installed on this computer yet.",
        "  Windows: download ArgusOps-Setup from the GitHub Releases page of the ArgusOps repository, then run  argus app",
        "  From a source checkout:  npm install in packages/desktop, then  npm run desktop:start",
        "  In the terminal instead:  argus tui   (the same screens)   or   argus status",
      ].join("\n")
    );
    return 2;
  }
  if (found.prepare && !found.prepare()) return (io.err("The desktop app could not be built. Run: npm run desktop:start"), 2);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // some editors set it, which makes Electron behave as plain Node
  (deps.start ?? ((a, e) => spawn(a.command, a.args, { cwd: a.cwd, env: e, stdio: "ignore", detached: true, windowsHide: false }).unref()))(found, env);
  io.out("Opening the ArgusOps app. It keeps watching from the tray when you close the window.");
  return 0;
}
