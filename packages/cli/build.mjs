// Bundles the CLI (and the shared loop detector from src/lib) into one dependency-free file.
import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, "dist/argus.mjs");
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
try {
  chmodSync(outfile, 0o755);
} catch {
  // not meaningful on Windows
}
console.log("built", outfile);
