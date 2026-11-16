import { spawn, type ChildProcess } from "node:child_process";
import { quoteWindowsArg } from "./run";

/**
 * One headless Claude Code process that stays open and takes instructions one after another:
 *   claude -p --input-format stream-json --output-format stream-json --verbose
 * Each instruction is one JSON line on stdin; each turn ends with a "result" event. This is how Autopilot gives the agent
 * a step, checks the work, and then gives it the next step (or a correction) in the same conversation.
 * Verified against Claude Code 2.1.325.
 */

export interface TurnResult {
  /** The agent's final text for this turn. */
  text: string;
  isError: boolean;
  subtype: string;
  /** Cost of this turn alone (Claude Code reports a running total; this is the difference). */
  costUsd: number;
  /** Tools it wanted but was not allowed to use. */
  permissionDenials: Array<{ tool: string; input: unknown }>;
  sessionId: string | null;
}

export interface SessionOptions {
  /** The claude program (a path to claude.exe, or "claude" on PATH). */
  command: string;
  /** Extra flags, e.g. ["--model", "...", "--allowedTools", "Read", ...]. */
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Every event Claude Code emits, for logging or a live view. */
  onEvent?: (event: Record<string, unknown>) => void;
  /** How long one turn may take before it is abandoned. */
  turnTimeoutMs?: number;
}

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly kind: "exited" | "timeout" | "busy" | "closed"
  ) {
    super(message);
  }
}

const BASE_FLAGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;

export class ClaudeSession {
  private child: ChildProcess;
  private buffer = "";
  private stderr = "";
  private lastCost = 0;
  private sessionId: string | null = null;
  private pending: { resolve: (r: TurnResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private exited: number | null | undefined = undefined;
  private exitWaiters: Array<(code: number | null) => void> = [];

  private constructor(private readonly opts: SessionOptions) {
    // the caller's arguments first: that way a wrapper (or a test double run by node) receives them before the flags
    const args = [...(opts.args ?? []), ...BASE_FLAGS];
    const win = process.platform === "win32";
    // On Windows an npm-installed `claude` is a .cmd shim, which only runs through the shell (with careful quoting).
    const needsShell = win && !/\.exe$/i.test(opts.command);
    this.child = needsShell
      ? spawn([quoteWindowsArg(opts.command), ...args.map(quoteWindowsArg)].join(" "), [], { cwd: opts.cwd, env: opts.env ?? process.env, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(opts.command, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    this.child.stdout?.on("data", (d: Buffer) => this.onData(d));
    this.child.stderr?.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString("utf8")).slice(-4000);
    });
    this.child.on("error", (e) => this.onExit(null, `Could not start ${opts.command}: ${e.message}`));
    this.child.on("exit", (code) => this.onExit(code));
    this.child.stdin?.on("error", () => undefined); // writing to a process that just died must not crash us
  }

  static start(opts: SessionOptions): ClaudeSession {
    return new ClaudeSession(opts);
  }

  get running(): boolean {
    return this.exited === undefined;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Sends one instruction and resolves when the agent finishes its turn. */
  send(text: string): Promise<TurnResult> {
    if (!this.running) return Promise.reject(new SessionError(`The agent is not running (it exited${this.exited !== null ? ` with code ${this.exited}` : ""}).`, "closed"));
    if (this.pending) return Promise.reject(new SessionError("The agent is still working on the previous instruction.", "busy"));
    return new Promise<TurnResult>((resolve, reject) => {
      const timeoutMs = this.opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new SessionError(`The agent did not finish within ${Math.round(timeoutMs / 1000)}s.`, "timeout"));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.child.stdin?.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
    });
  }

  /** Ends the conversation: closes its input and waits for it to exit (and ends it if it does not, after `graceMs`). */
  async close(graceMs = 10_000): Promise<number | null> {
    if (!this.running) return this.exited ?? null;
    this.child.stdin?.end();
    const timer = setTimeout(() => this.kill(), graceMs);
    const code = await new Promise<number | null>((r) => this.exitWaiters.push(r));
    clearTimeout(timer);
    return code;
  }

  kill() {
    if (!this.running || this.child.pid === undefined) return;
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else this.child.kill("SIGKILL");
  }

  private onData(d: Buffer) {
    this.buffer += d.toString("utf8");
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // not an event (warnings, progress text)
      }
      if (typeof ev.session_id === "string") this.sessionId = ev.session_id;
      this.opts.onEvent?.(ev);
      if (ev.type === "result") this.finishTurn(ev);
    }
    if (this.buffer.length > 4_000_000) this.buffer = "";
  }

  private finishTurn(ev: Record<string, unknown>) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    const total = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : this.lastCost;
    const cost = Math.max(0, total - this.lastCost);
    this.lastCost = total;
    const denials = Array.isArray(ev.permission_denials)
      ? (ev.permission_denials as Array<Record<string, unknown>>).map((d) => ({ tool: String(d.tool_name ?? "tool"), input: d.tool_input }))
      : [];
    p.resolve({
      text: typeof ev.result === "string" ? ev.result : "",
      isError: ev.is_error === true,
      subtype: typeof ev.subtype === "string" ? ev.subtype : "",
      costUsd: Math.round(cost * 1_000_000) / 1_000_000,
      permissionDenials: denials,
      sessionId: this.sessionId,
    });
  }

  private onExit(code: number | null, why?: string) {
    if (this.exited !== undefined) return;
    this.exited = code;
    const p = this.pending;
    this.pending = null;
    if (p) {
      clearTimeout(p.timer);
      const tail = this.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
      p.reject(new SessionError(why ?? `The agent exited${code !== null ? ` with code ${code}` : ""} before finishing${tail ? `: ${tail}` : "."}`, "exited"));
    }
    for (const w of this.exitWaiters.splice(0)) w(code);
  }
}
