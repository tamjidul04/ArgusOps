import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appCommand, findDesktopApp, findUiDir, type DesktopApp } from "./ui-cmd";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-app-"));
  dirs.push(d);
  return d;
};
const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};

describe("argus app", () => {
  it("finds the screens that ship in the repository", () => {
    const dir = findUiDir();
    expect(dir && fs.existsSync(path.join(dir, "index.html"))).toBe(true);
  });

  it("finds the desktop app named by ARGUSOPS_DESKTOP, or one in a source checkout", () => {
    const root = tmp();
    const exe = path.join(root, "ArgusOps.exe");
    fs.writeFileSync(exe, "");
    expect(findDesktopApp(root, { ARGUSOPS_DESKTOP: exe })).toEqual({ command: exe, args: [] });
    expect(findDesktopApp(path.join(root, "nowhere", "dist"), {})).toBeNull();

    // where the Windows installer puts it
    const local = path.join(root, "local");
    fs.mkdirSync(path.join(local, "Programs", "ArgusOps"), { recursive: true });
    expect(findDesktopApp(path.join(root, "nowhere", "dist"), { LOCALAPPDATA: local })).toBeNull();
    const installed = path.join(local, "Programs", "ArgusOps", "ArgusOps.exe");
    fs.writeFileSync(installed, "");
    expect(findDesktopApp(path.join(root, "nowhere", "dist"), { LOCALAPPDATA: local })).toEqual({ command: installed, args: [] });

    // packages/cli/dist (where the built CLI sits) -> ../../desktop
    const desktop = path.join(root, "packages", "desktop");
    fs.mkdirSync(path.join(desktop, "node_modules", "electron", "dist"), { recursive: true });
    fs.writeFileSync(path.join(desktop, "package.json"), "{}");
    fs.writeFileSync(path.join(desktop, "node_modules", "electron", "path.txt"), "electron.exe");
    expect(findDesktopApp(path.join(root, "packages", "cli", "dist"), {})).toBeNull(); // Electron's program is not there
    fs.writeFileSync(path.join(desktop, "node_modules", "electron", "dist", "electron.exe"), "");
    const found = findDesktopApp(path.join(root, "packages", "cli", "dist"), {})!;
    expect(found.command).toBe(path.join(desktop, "node_modules", "electron", "dist", "electron.exe"));
    expect(found.args).toEqual(["."]);
    expect(found.cwd).toBe(desktop);
  });

  it("starts the app without ELECTRON_RUN_AS_NODE and opens no browser", async () => {
    const a = io();
    const started: Array<{ app: DesktopApp; env: NodeJS.ProcessEnv }> = [];
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      expect(await appCommand([], a.io, { find: () => ({ command: "electron", args: ["."] }), start: (app, env) => started.push({ app, env }) })).toBe(0);
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
    expect(started).toHaveLength(1);
    expect(started[0].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(a.out.join("\n")).toContain("Opening the ArgusOps app");
  });

  it("says what to do when the desktop app is not installed, and rejects options", async () => {
    const a = io();
    expect(await appCommand([], a.io, { find: () => null })).toBe(2);
    expect(a.err.join("\n")).toContain("argus tui");
    expect(a.err.join("\n")).toContain("desktop:start");
    expect(await appCommand(["--port", "1"], a.io, { find: () => null })).toBe(1);
  });

  it("does not start anything when the app cannot be built", async () => {
    const a = io();
    let started = false;
    expect(await appCommand([], a.io, { find: () => ({ command: "x", args: [], prepare: () => false }), start: () => (started = true) })).toBe(2);
    expect(started).toBe(false);
  });
});
