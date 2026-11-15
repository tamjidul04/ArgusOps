import crypto from "node:crypto";
import type { PriceRow } from "./pricing";
import { costUsd } from "./pricing";
import { draftRewrite, estimateTokens, loopCost } from "./rewrite-core";
import type { SyncReply } from "./state";
import type { AgentRecord, IncidentRow, NotificationRow, Store } from "./store";

/** What a run reports on each sync. */
export interface SyncPayload {
  run: { id: string; start?: boolean; end?: boolean; agent: { name: string; type: string } };
  events: unknown[];
  telemetry?: { ram_mb?: number; cpu_percent?: number; current_task?: string };
}

/** What it gets back: whether it may run, and an instruction to deliver if there is one. */
export interface SyncResponse extends SyncReply {
  ok: boolean;
  agentId?: string;
}

/** Anything a run can sync with (the local hub; tests use stand-ins). */
export interface SyncTransport {
  sync(payload: SyncPayload): Promise<SyncResponse>;
}

interface UsageEvent {
  type: "usage";
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  latency_ms?: number;
}

interface IncidentEvent {
  type: "incident";
  action?: "PAUSED" | "KILLED" | "NONE";
  loop_type?: string;
  score?: number;
  detail?: string;
  evidence?: { unit: string[]; repeats: number };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const RECENT_CALLS = 10;
const RECENT_WINDOW_MS = 2 * 3_600_000;

/** A stable id for an agent, so the same project's agent is the same record from one run to the next. */
export function agentIdFor(name: string): string {
  return "ag_" + crypto.createHash("sha1").update(name).digest("hex").slice(0, 12);
}

/**
 * The local stand-in for the old cloud: a run reports what happened (usage, loops) and asks what it may do. Everything
 * is kept in the local store, and nothing leaves this machine. Control (pause, resume with a hint, stop) is whatever
 * the store says: the terminal, the control API or the dashboard write it there, and the run picks it up on its next sync.
 */
export class LocalHub implements SyncTransport {
  constructor(
    private readonly store: Store,
    private readonly prices: PriceRow[],
    private readonly opts: { onNotification?: (n: NotificationRow, agent: AgentRecord) => void; now?: () => number } = {}
  ) {}

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  async sync(p: SyncPayload): Promise<SyncResponse> {
    const id = agentIdFor(p.run.agent.name);
    const now = this.now();
    let tokenDelta = 0;
    let incident: IncidentEvent | null = null;

    for (const raw of p.events) {
      const e = raw as { type?: string };
      if (e.type === "usage") {
        const u = e as UsageEvent;
        const input = num(u.input_tokens);
        const output = num(u.output_tokens);
        const model = typeof u.model === "string" ? u.model : "unknown";
        this.store.appendUsage({
          ts: now,
          agentId: id,
          provider: typeof u.provider === "string" ? u.provider : "unknown",
          model,
          input_tokens: input,
          output_tokens: output,
          cache_read_tokens: num(u.cache_read_tokens),
          latency_ms: num(u.latency_ms),
          cost_usd: costUsd(model, { inputTokens: input, outputTokens: output }, this.prices),
        });
        tokenDelta += input + output;
      } else if (e.type === "incident") {
        incident = e as IncidentEvent;
      }
    }

    let delivered: string | undefined;
    let newIncident: IncidentRow | null = null;
    let newNote: NotificationRow | null = null;

    const rec = await this.store.updateAgent(id, (cur) => {
      delivered = undefined;
      newIncident = null;
      newNote = null;
      let next: AgentRecord =
        cur ?? { id, name: p.run.agent.name, type: p.run.agent.type, status: "ACTIVE", runId: p.run.id, startedAt: now, lastSeen: now, tokensUsed: 0, desired: "RUN", reason: "", suggestion: null };

      if (p.run.start) {
        // a fresh run starts clean: an old pause or stop from a previous run must not carry over
        next = { ...next, type: p.run.agent.type, status: "ACTIVE", desired: "RUN", reason: "", hint: undefined, runId: p.run.id, pid: process.pid, startedAt: now, suggestion: null };
      }
      next = { ...next, lastSeen: now, tokensUsed: next.tokensUsed + tokenDelta };
      if (p.telemetry?.current_task) next.currentTask = p.telemetry.current_task;

      if (incident && incident.action === "PAUSED" && next.desired !== "KILL") {
        const evidence = incident.evidence;
        const draft = evidence && evidence.unit.length ? draftRewrite(evidence.unit, evidence.repeats) : null;
        const recent = this.store
          .usage(now - RECENT_WINDOW_MS)
          .filter((r) => r.agentId === id)
          .slice(-RECENT_CALLS)
          .map((r) => r.input_tokens + r.output_tokens);
        const cost = loopCost(recent, evidence?.repeats ?? 0);
        const detail = incident.detail ?? "Repeated the same step.";
        next = {
          ...next,
          status: "PAUSED",
          desired: "PAUSE",
          reason: detail,
          currentTask: detail,
          suggestion: draft
            ? { id: crypto.randomUUID(), text: draft.instruction, observed: draft.observed, tokensBefore: cost.total || estimateTokens(draft.instruction), source: "rule", createdAt: now, status: "PENDING" }
            : null,
        };
        newIncident = {
          id: crypto.randomUUID(),
          ts: now,
          agentId: id,
          agentName: next.name,
          kind: "LOOP",
          action: "PAUSED",
          severity: "WARN",
          loop_type: incident.loop_type,
          score: num(incident.score),
          detail,
          evidence,
        };
        newNote = { id: crypto.randomUUID(), ts: now, title: `${next.name} was paused`, body: draft?.observed ?? detail, level: "WARN", agentId: id, read: false };
      }

      if (p.run.end && next.runId === p.run.id) next = { ...next, status: next.status === "STOPPED" ? "STOPPED" : "ENDED" };

      if (next.desired === "RUN" && next.hint) {
        delivered = next.hint; // handed out exactly once
        next = { ...next, hint: undefined };
      }
      return next;
    });

    const inc = newIncident as IncidentRow | null;
    const note = newNote as NotificationRow | null;
    if (inc) this.store.appendIncident(inc);
    if (note && rec) {
      this.store.appendNotification(note);
      this.opts.onNotification?.(note, rec);
    }

    const cfg = this.store.config();
    return {
      ok: true,
      agentId: id,
      desired: rec?.desired ?? "RUN",
      reason: rec?.reason ?? "",
      hint: delivered,
      policy: { loopScoreThreshold: cfg.policy.loopScoreThreshold, exactRepeatLimit: cfg.policy.exactRepeatLimit },
    };
  }
}
