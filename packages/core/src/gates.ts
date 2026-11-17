import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProjectConsent, Store } from "./store";

/**
 * Gates: the project's own checks (tests, type-check, lint, build), run by ArgusOps after an agent's turn. A failing gate
 * means the work is wrong whatever the agent said. This is how "all tests pass" claims are checked against reality.
 *
 * SECURITY: a gate runs commands taken from files in the project, and a downloaded project can put anything there.
 * So gates never run until the user has allowed that project, having seen the exact commands (and the script text behind
 * them). If any of that text changes, the user is asked again. See `consentState` and `allowProject`.
 */

export type GateName = "test" | "typecheck" | "lint" | "build";

export interface Gate {
  name: GateName;
  /** What is run, e.g. "npm test". */
  command: string;
  /** The text behind it (the script body, including pre/post scripts), so the consent covers what really runs. */
  body: string;
  source: string;
}

export interface GateResult {
  name: GateName;
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** The end of the output, enough to see why it failed. */
  outputTail: string;
}

const ORDER: GateName[] = ["test", "typecheck", "lint", "build"];
const NPM_PLACEHOLDER = /no test specified/i;
const OUTPUT_TAIL_BYTES = 2048;
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60_000;

const readText = (p: string): string | null => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const exists = (root: string, name: string) => fs.existsSync(path.join(root, name));

function nodeRunner(root: string): string {
  if (exists(root, "pnpm-lock.yaml")) return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "bun.lockb") || exists(root, "bun.lock")) return "bun";
  return "npm";
}

/** Which checks does this project have? An optional `.argusops.json` ({"gates": {"test": "make check"}}) takes over entirely. */
export function detectGates(root: string): Gate[] {
  const explicit = readText(path.join(root, ".argusops.json"));
  if (explicit) {
    try {
      const g = (JSON.parse(explicit) as { gates?: Record<string, unknown> }).gates;
      if (g && typeof g === "object") {
        return ORDER.filter((n) => typeof g[n] === "string" && (g[n] as string).trim()).map((n) => ({ name: n, command: (g[n] as string).trim(), body: (g[n] as string).trim(), source: ".argusops.json" }));
      }
    } catch {
      // unreadable: fall back to detection
    }
  }

  const gates: Gate[] = [];
  const add = (g: Gate) => {
    if (!gates.some((x) => x.name === g.name)) gates.push(g);
  };

  const pkgText = readText(path.join(root, "package.json"));
  if (pkgText) {
    try {
      const scripts = ((JSON.parse(pkgText) as { scripts?: Record<string, unknown> }).scripts ?? {}) as Record<string, unknown>;
      const runner = nodeRunner(root);
      const body = (n: string) => [scripts[`pre${n}`], scripts[n], scripts[`post${n}`]].filter((x): x is string => typeof x === "string").join(" && ");
      const pick = (names: string[]) => names.find((n) => typeof scripts[n] === "string" && !NPM_PLACEHOLDER.test(scripts[n] as string));
      const run = (n: string) => (n === "test" ? `${runner} test` : `${runner} run ${n}`);
      for (const [gate, names] of [
        ["test", ["test"]],
        ["typecheck", ["typecheck", "type-check", "check-types", "tsc"]],
        ["lint", ["lint"]],
        ["build", ["build"]],
      ] as Array<[GateName, string[]]>) {
        const n = pick(names);
        if (n) add({ name: gate, command: run(n), body: body(n), source: "package.json" });
      }
    } catch {
      // not valid JSON: no node gates
    }
  }

  const py = readText(path.join(root, "pyproject.toml")) ?? "";
  if (/\[tool\.pytest|pytest/.test(py) || exists(root, "pytest.ini") || exists(root, "tox.ini") || (exists(root, "tests") && !pkgText)) {
    add({ name: "test", command: "python -m pytest -q", body: "python -m pytest -q", source: "pytest" });
  }
  if (/\[tool\.ruff/.test(py) || exists(root, "ruff.toml")) add({ name: "lint", command: "ruff check .", body: "ruff check .", source: "ruff" });
  if (/\[tool\.mypy/.test(py) || exists(root, "mypy.ini")) add({ name: "typecheck", command: "mypy .", body: "mypy .", source: "mypy" });

  if (exists(root, "Cargo.toml")) {
    add({ name: "test", command: "cargo test", body: "cargo test", source: "Cargo.toml" });
    add({ name: "typecheck", command: "cargo check", body: "cargo check", source: "Cargo.toml" });
    add({ name: "build", command: "cargo build", body: "cargo build", source: "Cargo.toml" });
  }
  if (exists(root, "go.mod")) {
    add({ name: "test", command: "go test ./...", body: "go test ./...", source: "go.mod" });
    add({ name: "lint", command: "go vet ./...", body: "go vet ./...", source: "go.mod" });
    add({ name: "build", command: "go build ./...", body: "go build ./...", source: "go.mod" });
  }
  const make = readText(path.join(root, "Makefile"));
  if (make && /^test\s*:/m.test(make)) add({ name: "test", command: "make test", body: "make test", source: "Makefile" });

  return gates.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
}

/* --------------------------------- consent ---------------------------------- */

/** One key per folder, however it was typed (relative, with different case on Windows, through a link). */
export function projectKey(root: string): string {
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {
    real = path.resolve(root);
  }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

export function gatesFingerprint(gates: Gate[]): string {
  const canon = gates.map((g) => [g.name, g.command, g.body]).sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** `allowed`: run them. `changed`: allowed before, but the commands are different now, so ask again. `unknown`: never asked. `denied`: said no. */
export type ConsentState = "allowed" | "changed" | "unknown" | "denied";

export function consentState(store: Store, root: string, gates: Gate[]): ConsentState {
  const c = store.projectConsent(projectKey(root));
  if (!c) return "unknown";
  if (!c.allowed) return "denied";
  return c.fingerprint === gatesFingerprint(gates) ? "allowed" : "changed";
}

export async function allowProject(store: Store, root: string, gates: Gate[], now = Date.now()): Promise<ProjectConsent> {
  const consent: ProjectConsent = { allowed: true, fingerprint: gatesFingerprint(gates), commands: gates.map((g) => ({ name: g.name, command: g.command })), at: now };
  await store.setProjectConsent(projectKey(root), consent);
  return consent;
}

export async function denyProject(store: Store, root: string, now = Date.now()): Promise<void> {
  await store.setProjectConsent(projectKey(root), { allowed: false, fingerprint: "", commands: [], at: now });
}

/* --------------------------------- running ---------------------------------- */

function killTree(pid: number | undefined) {
  if (pid === undefined) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

/** Runs one gate. The caller must have checked consent: this function does not. Never throws. */
export function runGate(gate: Gate, root: string, opts: { timeoutMs?: number } = {}): Promise<GateResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const started = Date.now();
  return new Promise((resolve) => {
    let tail = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name: gate.name, command: gate.command, ok: exitCode === 0 && !timedOut, exitCode, timedOut, durationMs: Date.now() - started, outputTail: tail.trim() });
    };
    const child = spawn(gate.command, [], {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32", // its own process group, so a timeout can end the whole tree
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1", npm_config_color: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (c: Buffer) => {
      tail = (tail + c.toString("utf8")).slice(-OUTPUT_TAIL_BYTES * 2);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (e) => {
      tail += `\n${e.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    const timer = setTimeout(() => {
      timedOut = true;
      tail += `\n[ArgusOps stopped this check after ${Math.round(timeoutMs / 1000)}s]`;
      killTree(child.pid);
      setTimeout(() => finish(null), 2000).unref();
    }, timeoutMs);
    timer.unref?.();
  });
}

export async function runGates(gates: Gate[], root: string, opts: { timeoutMs?: number } = {}): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const g of gates) results.push(await runGate(g, root, opts));
  return results;
}
