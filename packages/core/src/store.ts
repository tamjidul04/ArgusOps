import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Desired } from "./state";

/**
 * Everything ArgusOps remembers lives in one folder on this machine (default `~/.argusops`, or `ARGUSOPS_HOME`).
 * Plain files, no database: `config.json`, `agents.json`, and append-only `usage.jsonl`, `incidents.jsonl` and
 * `notifications.jsonl`. Several ArgusOps processes (a run, the control API, the terminal) share it, so writes that
 * read-then-modify take a lock, and every file write is atomic.
 */

export type AgentStatus = "ACTIVE" | "PAUSED" | "STOPPED" | "ENDED";

export interface Suggestion {
  id: string;
  text: string;
  /** What was observed, e.g. "Repeated 4 times: Bash(npm test)". */
  observed: string;
  tokensBefore: number;
  source: "rule" | "ai";
  createdAt: number;
  status: "PENDING" | "APPLIED" | "DISMISSED";
}

export interface AgentRecord {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  /** The run (process) currently supervising this agent. */
  runId: string;
  pid?: number;
  startedAt: number;
  lastSeen: number;
  tokensUsed: number;
  currentTask?: string;
  /** What the agent is allowed to do right now. Written by whoever controls it, read by the run that supervises it. */
  desired: Desired;
  reason: string;
  /** An instruction to add to the agent's next request; delivered once, then cleared. */
  hint?: string;
  suggestion: Suggestion | null;
}

export interface UsageRow {
  ts: number;
  agentId: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  latency_ms: number;
  cost_usd: number;
}

export interface IncidentRow {
  id: string;
  ts: number;
  agentId: string;
  agentName: string;
  kind: "LOOP" | "INFO";
  action: "PAUSED" | "KILLED" | "NONE";
  severity: "INFO" | "WARN" | "CRITICAL";
  loop_type?: string;
  score: number;
  detail: string;
  evidence?: { unit: string[]; repeats: number };
}

export interface NotificationRow {
  id: string;
  ts: number;
  title: string;
  body: string;
  level: "INFO" | "WARN" | "CRITICAL";
  agentId?: string;
  read: boolean;
}

export interface AppConfig {
  policy: { loopScoreThreshold: number; exactRepeatLimit: number };
  /** Slack, Discord or any https address that should be told when an agent pauses or stops. */
  webhooks: string[];
  /** Port the proxy listens on for `argus proxy` and the editor integration. */
  proxyPort: number;
  /** Port of the local control API. */
  apiPort: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  policy: { loopScoreThreshold: 0.85, exactRepeatLimit: 2 },
  webhooks: [],
  proxyPort: 47821,
  apiPort: 47822,
};

const DAY_MS = 86_400_000;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 8_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function defaultHome(): string {
  return process.env.ARGUSOPS_HOME || path.join(os.homedir(), ".argusops");
}

export class Store {
  readonly root: string;

  constructor(root: string = defaultHome()) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  private file(name: string) {
    return path.join(this.root, name);
  }

  /* ------------------------------ low level ------------------------------ */

  private readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), "utf8")) as T;
    } catch {
      return fallback; // missing, or half-written by a crash: start from the default instead of failing
    }
  }

  /** Write to a temporary file in the same folder, then rename over the target, so readers never see half a file. */
  private writeJson(name: string, value: unknown) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }

  /** Runs `fn` while holding a lock that other ArgusOps processes respect. A lock left by a crash expires. */
  async withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const dir = this.file(`${name}.lock`);
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.mkdirSync(dir);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) {
            fs.rmSync(dir, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue; // released between the two calls
        }
        if (Date.now() > deadline) throw new Error(`Timed out waiting for the ArgusOps lock "${name}".`);
        await sleep(15 + Math.random() * 25);
      }
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private append(name: string, row: unknown) {
    fs.appendFileSync(this.file(name), JSON.stringify(row) + "\n");
  }

  private readRows<T extends { ts: number }>(name: string, sinceMs = 0): T[] {
    let text: string;
    try {
      text = fs.readFileSync(this.file(name), "utf8");
    } catch {
      return [];
    }
    const rows: T[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as T;
        if (row.ts >= sinceMs) rows.push(row);
      } catch {
        // a line cut short by a crash: skip it
      }
    }
    return rows;
  }

  /* -------------------------------- token -------------------------------- */

  /** The secret the control API requires. Created once, readable only by this user. */
  token(): string {
    const p = this.file("control.token");
    try {
      const existing = fs.readFileSync(p, "utf8").trim();
      if (existing.length >= 32) return existing;
    } catch {
      // not created yet
    }
    const fresh = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(p, fresh, { mode: 0o600, flag: "wx" });
      return fresh;
    } catch {
      // another process created it first: use theirs
      return fs.readFileSync(p, "utf8").trim();
    }
  }

  /* -------------------------------- config ------------------------------- */

  config(): AppConfig {
    const saved = this.readJson<Partial<AppConfig>>("config.json", {});
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      policy: { ...DEFAULT_CONFIG.policy, ...(saved.policy ?? {}) },
      webhooks: Array.isArray(saved.webhooks) ? saved.webhooks.filter((w) => typeof w === "string") : [],
    };
  }

  async saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return this.withLock("config", () => {
      const next = { ...this.config(), ...patch, policy: { ...this.config().policy, ...(patch.policy ?? {}) } };
      this.writeJson("config.json", next);
      return next;
    });
  }

  /* -------------------------------- agents ------------------------------- */

  agents(): AgentRecord[] {
    return Object.values(this.readJson<Record<string, AgentRecord>>("agents.json", {}));
  }

  agent(id: string): AgentRecord | null {
    return this.readJson<Record<string, AgentRecord>>("agents.json", {})[id] ?? null;
  }

  /**
   * Create or change one agent. `change` gets the current record (or null) and returns the new one; returning null
   * leaves things as they are. Done under a lock, so two processes can't overwrite each other.
   */
  async updateAgent(id: string, change: (current: AgentRecord | null) => AgentRecord | null): Promise<AgentRecord | null> {
    return this.withLock("agents", () => {
      const all = this.readJson<Record<string, AgentRecord>>("agents.json", {});
      const next = change(all[id] ?? null);
      if (!next) return all[id] ?? null;
      all[id] = next;
      this.writeJson("agents.json", all);
      return next;
    });
  }

  /** Tell an agent what it may do. The run that supervises it picks this up within a moment. */
  async setControl(id: string, control: { desired?: Desired; reason?: string; hint?: string }): Promise<AgentRecord | null> {
    return this.updateAgent(id, (cur) => {
      if (!cur) return null;
      return {
        ...cur,
        desired: control.desired ?? cur.desired,
        reason: control.reason ?? cur.reason,
        hint: control.hint ?? cur.hint,
        status: control.desired === "KILL" ? "STOPPED" : control.desired === "RUN" ? "ACTIVE" : control.desired === "PAUSE" ? "PAUSED" : cur.status,
      };
    });
  }

  /* ----------------------------- usage, incidents ------------------------ */

  appendUsage(row: UsageRow) {
    this.append("usage.jsonl", row);
  }
  usage(sinceMs = 0): UsageRow[] {
    return this.readRows<UsageRow>("usage.jsonl", sinceMs);
  }

  appendIncident(row: IncidentRow) {
    this.append("incidents.jsonl", row);
  }
  incidents(sinceMs = 0): IncidentRow[] {
    return this.readRows<IncidentRow>("incidents.jsonl", sinceMs);
  }

  appendNotification(row: Omit<NotificationRow, "id" | "ts" | "read"> & Partial<Pick<NotificationRow, "id" | "ts" | "read">>): NotificationRow {
    const full: NotificationRow = { id: crypto.randomUUID(), ts: Date.now(), read: false, ...row };
    this.append("notifications.jsonl", full);
    return full;
  }
  /** Newest first. `read` state lives in a separate small file so the log itself stays append-only. */
  notifications(limit = 20): NotificationRow[] {
    const readIds = new Set(this.readJson<string[]>("notifications-read.json", []));
    return this.readRows<NotificationRow>("notifications.jsonl")
      .map((n) => ({ ...n, read: n.read || readIds.has(n.id) }))
      .reverse()
      .slice(0, limit);
  }
  async markNotificationsRead(ids?: string[]) {
    await this.withLock("notifications", () => {
      const all = ids ?? this.readRows<NotificationRow>("notifications.jsonl").map((n) => n.id);
      const read = new Set(this.readJson<string[]>("notifications-read.json", []));
      for (const id of all) read.add(id);
      this.writeJson("notifications-read.json", [...read].slice(-2000));
    });
  }

  /* -------------------------------- upkeep ------------------------------- */

  /** Drops usage, incident and notification rows older than `days`, and agents not seen for that long. */
  async prune(days = 30, now = Date.now()) {
    const cutoff = now - days * DAY_MS;
    for (const name of ["usage.jsonl", "incidents.jsonl", "notifications.jsonl"]) {
      await this.withLock(`prune-${name}`, () => {
        const keep = this.readRows<{ ts: number }>(name, cutoff);
        const all = this.readRows<{ ts: number }>(name);
        if (keep.length === all.length) return;
        const tmp = this.file(`${name}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
        fs.renameSync(tmp, this.file(name));
      });
    }
    await this.withLock("agents", () => {
      const all = this.readJson<Record<string, AgentRecord>>("agents.json", {});
      const kept = Object.fromEntries(Object.entries(all).filter(([, a]) => a.lastSeen >= cutoff));
      if (Object.keys(kept).length !== Object.keys(all).length) this.writeJson("agents.json", kept);
    });
  }
}
