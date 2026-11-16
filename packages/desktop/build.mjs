// Bundles the desktop app's main process (with the engine from packages/core) and copies the page next to it.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  logLevel: "info",
});
rmSync(resolve(here, "dist/ui"), { recursive: true, force: true });
cpSync(resolve(here, "../ui"), resolve(here, "dist/ui"), { recursive: true, filter: (src) => !/\.test\.[jt]s$/.test(src) });
console.log("built", resolve(here, "dist"));
