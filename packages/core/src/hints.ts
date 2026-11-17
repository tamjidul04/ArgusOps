import crypto from "node:crypto";
import { stableStringify } from "./anthropic";

/**
 * Keeps operator notes in the conversation once they have been delivered.
 *
 * ArgusOps delivers your instruction by adding a note to the agent's next request. The agent (Claude Code) keeps its
 * own copy of the conversation, so on the request after that the note is gone. Newer Anthropic models sign their
 * thinking against the exact history they saw; a history that later lacks the note no longer matches, and the
 * provider rejects the request ("The block is bound to a different conversation") or drops the model's reasoning.
 * The note also silently disappears from what the model sees.
 *
 * So the conversation must stay append-only: this ledger remembers where each note went (which message, in which
 * conversation, and what that message looked like) and puts it back in exactly the same place on every later request.
 * If the message it was attached to has changed (the agent compacted or rewrote its history), the note is not replayed:
 * the history is new anyway, and a note in the wrong place would be worse than none.
 */

type Message = { role?: string; content?: unknown };

interface Entry {
  /** Index of the message the note belongs to, in the history as the provider saw it. */
  index: number;
  /** append-block: a text block added to that message. append-string: text added to its string content. new-message: a user message inserted at `index`. */
  mode: "append-block" | "append-string" | "new-message";
  /** Fingerprint of the message it is attached to (for new-message: the message just before it), ignoring cache markers. */
  anchor: string;
  note: string;
}

const MAX_CONVERSATIONS = 50;
const MAX_NOTES = 20;
export const NOTE_PREFIX = "[ArgusOps note from the operator] ";

/** Cache markers move from message to message as the conversation grows; they are not part of the history. */
function withoutCacheMarkers(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutCacheMarkers);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== "cache_control") out[k] = withoutCacheMarkers(x);
    return out;
  }
  return v;
}
const fingerprint = (m: unknown) => crypto.createHash("sha1").update(stableStringify(withoutCacheMarkers(m))).digest("hex");

/** One conversation, recognised by how it began (as the agent wrote it: ArgusOps' own notes left out). */
export function conversationOf(messages: unknown[]): string {
  return fingerprint(withoutNotes(messages[0] ?? null)).slice(0, 16);
}

function withoutNotes(m: unknown): unknown {
  if (!m || typeof m !== "object") return m;
  const msg = m as Message;
  if (typeof msg.content === "string") {
    const at = msg.content.indexOf(`\n\n${NOTE_PREFIX}`);
    return at >= 0 ? { ...msg, content: msg.content.slice(0, at) } : msg;
  }
  if (Array.isArray(msg.content)) {
    return { ...msg, content: msg.content.filter((b) => !(b && typeof b === "object" && (b as { type?: unknown }).type === "text" && String((b as { text?: unknown }).text ?? "").startsWith(NOTE_PREFIX))) };
  }
  return msg;
}

export class HintLedger {
  private convs = new Map<string, Entry[]>();

  /** Adds the note to the request (to the last message if it is the human's or a tool result, otherwise as a new user message) and remembers where. */
  deliver<T extends object>(body: T, hint: string): T {
    const note = `${NOTE_PREFIX}${hint.trim()}`;
    const clone = JSON.parse(JSON.stringify(body)) as { messages?: Message[] };
    const messages = Array.isArray(clone.messages) ? clone.messages : (clone.messages = []);
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    let entry: Entry;
    if (last && last.role === "user" && typeof last.content === "string") {
      entry = { index: lastIndex, mode: "append-string", anchor: fingerprint(last), note };
    } else if (last && last.role === "user" && Array.isArray(last.content)) {
      entry = { index: lastIndex, mode: "append-block", anchor: fingerprint(last), note };
    } else {
      entry = { index: messages.length, mode: "new-message", anchor: fingerprint(last ?? null), note };
    }
    apply(messages, entry);
    if (messages.length > 0) {
      const key = conversationOf(messages);
      const list = this.convs.get(key) ?? [];
      list.push(entry);
      this.convs.delete(key);
      this.convs.set(key, list.slice(-MAX_NOTES));
      if (this.convs.size > MAX_CONVERSATIONS) this.convs.delete(this.convs.keys().next().value as string);
    }
    return clone as T;
  }

  /** Puts earlier notes back where they were. Returns the new body, or null when nothing needed replaying. */
  replay<T extends object>(body: T): T | null {
    const msgs = (body as { messages?: unknown }).messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return null;
    const entries = this.convs.get(conversationOf(msgs));
    if (!entries?.length) return null;
    const clone = JSON.parse(JSON.stringify(body)) as { messages: Message[] };
    let changed = false;
    // in the order they were delivered: each was recorded on a history that already held the earlier ones
    for (const e of entries) {
      if (present(clone.messages, e)) continue; // the agent kept it itself (or this is a retry of the same request)
      const target = e.mode === "new-message" ? clone.messages[e.index - 1] : clone.messages[e.index];
      if (target === undefined || fingerprint(target) !== e.anchor) continue;
      if (e.mode === "new-message" && e.index > clone.messages.length) continue;
      apply(clone.messages, e);
      changed = true;
    }
    return changed ? (clone as unknown as T) : null;
  }

  /** For tests and debugging. */
  size(): number {
    let n = 0;
    for (const l of this.convs.values()) n += l.length;
    return n;
  }
}

function apply(messages: Message[], e: Entry) {
  if (e.mode === "new-message") {
    messages.splice(e.index, 0, { role: "user", content: [{ type: "text", text: e.note }] });
    return;
  }
  const m = messages[e.index];
  if (e.mode === "append-string") m.content = `${String(m.content ?? "")}\n\n${e.note}`;
  else m.content = [...(Array.isArray(m.content) ? m.content : []), { type: "text", text: e.note }];
}

/** Is the note already where it belongs? */
function present(messages: Message[], e: Entry): boolean {
  if (e.mode === "new-message") {
    const m = messages[e.index];
    return !!m && m.role === "user" && Array.isArray(m.content) && m.content.length === 1 && (m.content[0] as { text?: unknown })?.text === e.note;
  }
  const m = messages[e.index];
  if (!m) return false;
  if (e.mode === "append-string") return typeof m.content === "string" && m.content.endsWith(`\n\n${e.note}`);
  const blocks = Array.isArray(m.content) ? m.content : [];
  const lastBlock = blocks[blocks.length - 1] as { type?: unknown; text?: unknown } | undefined;
  return lastBlock?.type === "text" && lastBlock.text === e.note;
}
