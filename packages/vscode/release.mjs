// Builds the extension, packages it, and copies the .vsix to public/downloads/ so the website can offer it.
//   npm run vscode:release
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const vsix = resolve(here, `${pkg.name}-${pkg.version}.vsix`);
const outDir = resolve(here, "../../public/downloads");
const target = resolve(outDir, "argusops-vscode.vsix");

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: here, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
};

run("node", ["build.mjs"]);
if (existsSync(vsix)) rmSync(vsix);
run("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies"]);

mkdirSync(outDir, { recursive: true });
copyFileSync(vsix, target);
rmSync(vsix);
console.log(`\nReady to download from the website: public/downloads/argusops-vscode.vsix (version ${pkg.version})`);
