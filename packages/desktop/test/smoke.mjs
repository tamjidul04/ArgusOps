// Starts the real desktop app against a throwaway ArgusOps folder, lets it load the page, and checks what it shows.
// Needs a display and the Electron binary (npm install in packages/desktop). Run: node packages/desktop/test/smoke.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const exe = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
if (!fs.existsSync(exe)) throw new Error("Electron is not installed: run `npm install` in packages/desktop.");
const build = spawnSync(process.execPath, [path.join(root, "build.mjs")], { stdio: "inherit" });
if (build.status !== 0) process.exit(1);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-desktop-smoke-"));
const env = { ...process.env, ARGUSOPS_HOME: home, ARGUSOPS_DESKTOP_SMOKE: "1" };
delete env.ELECTRON_RUN_AS_NODE; // some editors set it, which makes Electron behave as plain Node
const r = spawnSync(exe, ["."], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
fs.rmSync(home, { recursive: true, force: true });

const line = (r.stdout + r.stderr).split("\n").find((l) => l.startsWith("SMOKE "));
if (!line) throw new Error("The app did not report back.\n" + r.stdout + r.stderr);
const info = JSON.parse(line.slice(6));
const problems = [];
if (info.title !== "ArgusOps") problems.push(`title is ${info.title}`);
if (info.conn !== "connected") problems.push(`not connected: ${info.conn}`);
if (info.sections < 4) problems.push(`expected the sidebar sections, saw ${info.sections}`);
if (info.node !== "undefined" || info.process !== "undefined") problems.push("the page can reach Node");
if (info.url.includes("#")) problems.push("the token is still in the address");
if (!info.text.includes("No agent")) problems.push(`unexpected first view: ${info.text}`);
if (problems.length) {
  console.error("FAILED:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("desktop smoke test passed:", JSON.stringify(info));
