/**
 * Pure helpers for the Anthropic Messages API as spoken by Claude Code: reading tool calls out of a request,
 * adding an operator hint, and tapping token usage out of (streamed or plain) responses.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON.stringify with sorted keys, so the same call always produces the same text. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): Json => {
    if (v === null || typeof v !== "object") return (v === undefined ? null : (v as Json));
    if (seen.has(v as object)) return "[circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: { [key: string]: Json } = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = walk((v as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

interface ContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
  is_error?: boolean;
  content?: unknown;
  text?: string;
}

interface Message {
  role?: string;
  content?: string | ContentBlock[];
}

function messagesOf(body: unknown): Message[] {
  if (!body || typeof body !== "object") return [];
  const m = (body as { messages?: unknown }).messages;
  return Array.isArray(m) ? (m.filter((x) => x && typeof x === "object") as Message[]) : [];
}

function blocksOf(msg: Message): ContentBlock[] {
  return Array.isArray(msg.content) ? (msg.content.filter((b) => b && typeof b === "object") as ContentBlock[]) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as ContentBlock).text === "string" ? (b as ContentBlock).text : ""))
      .join(" ");
  }
  return "";
}

/**
 * Fields that describe a call rather than change what it does. Agents reword them on every retry (Claude Code's Bash
 * tool writes a fresh "description" each time), which would make an identical retry look new.
 */
const COSMETIC_FIELDS = new Set(["description", "timeout"]);

function withoutCosmetics(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input ?? {};
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([k]) => !COSMETIC_FIELDS.has(k)));
}

export interface ToolTrace {
  /** Every tool call the agent has made, oldest first: `Name({sorted input})`. */
  calls: string[];
  /** Calls interleaved with the errors they produced, oldest first. */
  items: Array<{ sig: string; callNo: number }>;
}

/**
 * Walks the conversation so far and lists what the agent did and what failed.
 * `callNo` is the 0-based number of the tool call an item belongs to (an error belongs to the call before it),
 * so callers can ignore everything up to a point such as an operator resume.
 */
export function extractToolTrace(body: unknown): ToolTrace {
  const calls: string[] = [];
  const items: Array<{ sig: string; callNo: number }> = [];

  for (const msg of messagesOf(body)) {
    for (const block of blocksOf(msg)) {
      if (msg.role === "assistant" && block.type === "tool_use" && typeof block.name === "string") {
        const sig = `${block.name}(${stableStringify(withoutCosmetics(block.input))})`.slice(0, 400);
        items.push({ sig, callNo: calls.length });
        calls.push(sig);
      } else if (msg.role === "user" && block.type === "tool_result" && block.is_error === true) {
        const text = textOf(block.content).replace(/\s+/g, " ").trim().slice(0, 200);
        items.push({ sig: `error: ${text || "(empty)"}`, callNo: Math.max(0, calls.length - 1) });
      }
    }
  }
  return { calls, items };
}

/** Number of tool calls in the conversation so far (used to ignore history from before a resume). */
export function countToolCalls(body: unknown): number {
  let n = 0;
  for (const msg of messagesOf(body)) {
    for (const block of blocksOf(msg)) if (msg.role === "assistant" && block.type === "tool_use") n++;
  }
  return n;
}

/**
 * Adds the operator's hint to the end of the conversation, as extra text on the last user turn.
 * Returns a new body; the input is not modified. If there is no user turn, one is appended.
 */
export function applyHint<T extends object>(body: T, hint: string): T {
  const note = `[ArgusOps note from the operator] ${hint.trim()}`;
  const clone = JSON.parse(JSON.stringify(body)) as { messages?: Message[] };
  const messages = Array.isArray(clone.messages) ? clone.messages : (clone.messages = []);
  const last = messages[messages.length - 1];

  if (last && last.role === "user") {
    if (typeof last.content === "string") last.content = `${last.content}\n\n${note}`;
    else if (Array.isArray(last.content)) last.content.push({ type: "text", text: note });
    else last.content = [{ type: "text", text: note }];
  } else {
    messages.push({ role: "user", content: [{ type: "text", text: note }] });
  }
  return clone as T;
}

/* ------------------------------- response usage ------------------------------- */

export interface UsageResult {
  model: string;
  /** Tokens billed as input: uncached input plus cache writes. Cache reads are reported separately. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Incrementally reads usage from a Server-Sent-Events stream, however the bytes are chunked. */
export class SseUsageTap {
  private buffer = "";
  private model = "";
  private input = 0;
  private cacheWrite = 0;
  private cacheRead = 0;
  private output = 0;

  push(chunk: Buffer | string) {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.startsWith("data:")) this.handle(line.slice(5).trim());
    }
    if (this.buffer.length > 1_000_000) this.buffer = ""; // never grow without bound on odd input
  }

  private handle(payload: string) {
    if (!payload || payload === "[DONE]") return;
    let ev: { type?: string; message?: { model?: string; usage?: RawUsage }; usage?: RawUsage };
    try {
      ev = JSON.parse(payload);
    } catch {
      return;
    }
    if (ev.type === "message_start" && ev.message) {
      if (typeof ev.message.model === "string") this.model = ev.message.model;
      const u = ev.message.usage ?? {};
      this.input = n(u.input_tokens);
      this.cacheWrite = n(u.cache_creation_input_tokens);
      this.cacheRead = n(u.cache_read_input_tokens);
      this.output = Math.max(this.output, n(u.output_tokens));
    } else if (ev.type === "message_delta" && ev.usage) {
      const u = ev.usage;
      // later events carry cumulative totals, so take the larger value
      this.output = Math.max(this.output, n(u.output_tokens));
      if (n(u.input_tokens)) this.input = Math.max(this.input, n(u.input_tokens));
    }
  }

  result(): UsageResult {
    return {
      model: this.model || "unknown",
      inputTokens: this.input + this.cacheWrite,
      outputTokens: this.output,
      cacheReadTokens: this.cacheRead,
    };
  }
}

/** Usage from a non-streaming `/v1/messages` JSON response. */
export function usageFromJson(text: string): UsageResult | null {
  try {
    const j = JSON.parse(text) as { model?: string; usage?: RawUsage };
    if (!j || typeof j !== "object" || !j.usage) return null;
    return {
      model: typeof j.model === "string" ? j.model : "unknown",
      inputTokens: n(j.usage.input_tokens) + n(j.usage.cache_creation_input_tokens),
      outputTokens: n(j.usage.output_tokens),
      cacheReadTokens: n(j.usage.cache_read_input_tokens),
    };
  } catch {
    return null;
  }
}
