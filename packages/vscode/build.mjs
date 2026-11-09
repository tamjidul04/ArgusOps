// Bundles the extension into one file. `vscode` is provided by the editor at run time.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, "src/extension.ts")],
  outfile: resolve(here, "out/extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18", // VS Code 1.85 ships Node 18
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
});
console.log("built", resolve(here, "out/extension.js"));
