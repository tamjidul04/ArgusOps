// Launches a real VS Code with the extension loaded and runs suite.cjs inside it.
//   npm run test:vscode            (uses the VS Code installed on this machine; set VSCODE_EXE to point elsewhere)
// It uses a throwaway profile, so your own VS Code settings and extensions are never touched.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "../..");

function findVSCode() {
  if (process.env.VSCODE_EXE) return process.env.VSCODE_EXE;
  const candidates =
    process.platform === "win32"
      ? [join(process.env.LOCALAPPDATA ?? "", "Programs/Microsoft VS Code/Code.exe"), "C:/Program Files/Microsoft VS Code/Code.exe"]
      : process.platform === "darwin"
        ? ["/Applications/Visual Studio Code.app/Contents/MacOS/Electron"]
        : ["/usr/share/code/code", "/usr/bin/code"];
  return candidates.find((p) => existsSync(p));
}

const exe = findVSCode();
if (!exe) {
  console.log("SKIPPED: VS Code was not found. Set VSCODE_EXE to its executable to run this check.");
  process.exit(0);
}
if (!existsSync(join(extensionPath, "out/extension.js"))) {
  console.error("Build the extension first: npm run vscode:build");
  process.exit(1);
}

/**
 * If this runs inside another VS Code (for example from its terminal), that editor leaves variables behind that
 * would make the new one start in Node mode or attach to the old window. Remove them.
 */
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (k.startsWith("VSCODE_")) delete env[k];
  return env;
}

const work = mkdtempSync(join(tmpdir(), "argus-vscode-"));
const resultFile = join(work, "result.json");
const child = spawn(
  exe,
  [
    `--extensionDevelopmentPath=${extensionPath}`,
    `--extensionTestsPath=${join(here, "suite.cjs")}`,
    `--user-data-dir=${join(work, "data")}`,
    `--extensions-dir=${join(work, "ext")}`,
    "--disable-extensions",
    "--disable-updates",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--no-sandbox",
    "--disable-gpu-sandbox",
  ],
  { stdio: "ignore", env: cleanEnv({ ARGUS_VSCODE_RESULT: resultFile }) }
);

const timer = setTimeout(() => {
  console.error("Timed out waiting for VS Code (90s).");
  child.kill();
}, 90_000);

child.on("exit", (code) => {
  clearTimeout(timer);
  let results = [];
  try {
    results = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch {
    console.error("VS Code closed without writing results.");
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   " + r.extra : ""}`);
  rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(results.length === 0 ? "\nVS CODE CHECK: NO RESULTS" : failed === 0 ? "\nVS CODE CHECK: ALL PASSED" : `\nVS CODE CHECK: ${failed} FAILED`);
  process.exit(results.length > 0 && failed === 0 && code === 0 ? 0 : 1);
});
