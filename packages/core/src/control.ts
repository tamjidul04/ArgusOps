import crypto from "node:crypto";
import type { NotificationRow, Store } from "./store";

export type ControlResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_HINT_CHARS = 2000;

const missing = (id: string): ControlResult => ({ ok: false, error: `No agent with id "${id}".` });

/** What the terminal, the control API and the dashboards call. They only write intent into the store. */
export class Controls {
  constructor(
    private readonly store: Store,
    private readonly onNotification?: (n: NotificationRow) => void
  ) {}

  private note(n: Omit<NotificationRow, "id" | "ts" | "read">) {
    const saved = this.store.appendNotification(n);
    this.onNotification?.(saved);
  }

  async pause(id: string, reason = "Paused by you."): Promise<ControlResult> {
    const a = await this.store.setControl(id, { desired: "PAUSE", reason });
    return a ? { ok: true, message: `${a.name} is paused. Its next request will be held.` } : missing(id);
  }

  /** Resume, optionally adding an instruction to the agent's next request. */
  async resume(id: string, hint?: string): Promise<ControlResult> {
    const text = hint?.trim();
    if (text && text.length > MAX_HINT_CHARS) return { ok: false, error: `The instruction is too long (limit ${MAX_HINT_CHARS} characters).` };
    const a = await this.store.setControl(id, { desired: "RUN", reason: "", hint: text || undefined });
    if (!a) return missing(id);
    this.store.appendIncident({ id: crypto.randomUUID(), ts: Date.now(), agentId: id, agentName: a.name, kind: "INFO", action: "NONE", severity: "INFO", score: 0, detail: text ? `You resumed ${a.name} with an instruction.` : `You resumed ${a.name}.` });
    return { ok: true, message: text ? `${a.name} resumes with your instruction.` : `${a.name} resumes.` };
  }

  /** Approve the suggestion ArgusOps wrote (or your edit of it) and resume. */
  async applySuggestion(id: string, edited?: string): Promise<ControlResult> {
    const cur = this.store.agent(id);
    if (!cur) return missing(id);
    if (!cur.suggestion || cur.suggestion.status !== "PENDING") return { ok: false, error: "There is no suggestion waiting for this agent." };
    const text = (edited?.trim() || cur.suggestion.text).slice(0, MAX_HINT_CHARS);
    const result = await this.resume(id, text);
    if (!result.ok) return result;
    await this.store.updateAgent(id, (a) => (a && a.suggestion ? { ...a, suggestion: { ...a.suggestion, status: "APPLIED" } } : null));
    return { ok: true, message: `${cur.name} resumes with the suggested instruction.` };
  }

  async dismissSuggestion(id: string): Promise<ControlResult> {
    const cur = this.store.agent(id);
    if (!cur) return missing(id);
    if (!cur.suggestion || cur.suggestion.status !== "PENDING") return { ok: false, error: "There is no suggestion waiting for this agent." };
    await this.store.updateAgent(id, (a) => (a && a.suggestion ? { ...a, suggestion: { ...a.suggestion, status: "DISMISSED" } } : null));
    return { ok: true, message: "Suggestion dismissed. The agent stays paused until you resume it." };
  }

  /** Stop: the supervising run ends the agent (or, in proxy mode, refuses its requests). */
  async stop(id: string): Promise<ControlResult> {
    const a = await this.store.setControl(id, { desired: "KILL", reason: "Stopped by you." });
    if (!a) return missing(id);
    this.store.appendIncident({ id: crypto.randomUUID(), ts: Date.now(), agentId: id, agentName: a.name, kind: "LOOP", action: "KILLED", severity: "CRITICAL", score: 0, detail: `You stopped ${a.name}.` });
    this.note({ title: `${a.name} was stopped`, body: "You stopped it.", level: "CRITICAL", agentId: id });
    return { ok: true, message: `${a.name} is being stopped.` };
  }
}
