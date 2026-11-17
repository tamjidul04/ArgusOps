// Small helpers shared by the end-to-end scripts. Everything runs locally: a temporary ArgusOps folder, the real
// built CLI, and a free stand-in for the model provider.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..", "..");
export const CLI = path.join(ROOT, "packages", "cli", "dist", "argus.mjs");
export const FAKE = path.join(HERE, "fake-anthropic.mjs");

let failures = 0;
export const failed = () => failures;
export function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "   " + extra : ""}`);
  if (!ok) failures++;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const lines = (text) => text.split(/\r?\n/);

/** Starts a process and collects what it prints (the returned object's `out` and `err` keep growing). */
export function start(cmd, args, opts = {}) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(cmd, args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: opts.shell ?? false, windowsHide: true });
  const p = { child, out: "", err: "", exited: null };
  child.stdout.on("data", (d) => (p.out += d));
  child.stderr.on("data", (d) => (p.err += d));
  p.exited = new Promise((r) => child.on("exit", (code) => r(code)));
  return p;
}

/** Runs the CLI to completion and returns its output. */
export async function argus(home, args, cwd) {
  const p = start(process.execPath, [CLI, ...args], { env: { ARGUSOPS_HOME: home }, cwd });
  const code = await p.exited;
  return { code, out: p.out, err: p.err };
}

export async function fakeProvider(extra = []) {
  const p = start(process.execPath, [FAKE, "0", ...extra]);
  const m = await until(() => /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(p.out), 10_000, "the fake provider to start");
  // the same object (not a copy), so `out` keeps growing as the provider logs
  return Object.assign(p, { url: m[1], requests: () => lines(p.out).filter((l) => /\[fake-anthropic\] #\d+ POST \/v1\/messages/.test(l)).length });
}

export function finish(name, cleanup = []) {
  for (const c of cleanup) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
  console.log(failures === 0 ? `\n${name}: ALL PASSED` : `\n${name}: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
