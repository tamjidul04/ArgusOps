import type { Adapter, UsageTap } from "./adapters";
import { stableStringify, withoutCosmetics, type ToolTrace, type UsageResult } from "./anthropic";

/**
 * The OpenAI API format, as spoken by Codex and many other tools: Chat Completions (`/v1/chat/completions`) and
 * Responses (`/v1/responses`).
 *
 * STATUS: written from the published API formats and tested with simulated traffic. It has NOT yet been run against a real
 * Codex session, which is why the registry lists OpenAI Codex as "possible", not "supported".
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const MAX_TEXT = 16_000;

/* ----------------------------- one view of both formats ----------------------------- */

type Item = { kind: "human"; text: string } | { kind: "assistant"; text: string } | { kind: "call"; sig: string } | { kind: "result"; text: string; error: boolean };

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  return asArray(content)
    .map((b) => (isObj(b) && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: raw.slice(0, 200) };
  }
}

const callSig = (name: unknown, args: unknown) => `${typeof name === "string" ? name : "tool"}(${stableStringify(withoutCosmetics(parseArgs(args)))})`.slice(0, 400);

/** Does this tool output look like a failure? (OpenAI tool results carry no error flag, so this is a judgement.) */
export function looksLikeError(text: string): boolean {
  const head = text.slice(0, 600);
  try {
    const j = JSON.parse(text) as { metadata?: { exit_code?: unknown }; exit_code?: unknown; error?: unknown };
    const code = j?.metadata?.exit_code ?? j?.exit_code;
    if (typeof code === "number") return code !== 0;
    if (j?.error) return true;
  } catch {
    // plain text
  }
  return /\b(error|failed|failure|exception|traceback|enoent|eacces|command not found|no such file)\b|exit(?:ed)? (?:with )?(?:code )?[:=]?\s*[1-9]/i.test(head);
}

function normalize(body: unknown): Item[] {
  if (!isObj(body)) return [];
  const items: Item[] = [];
  if (Array.isArray(body.messages)) {
    // Chat Completions
    for (const m of body.messages) {
      if (!isObj(m)) continue;
      if (m.role === "user") items.push({ kind: "human", text: textOfContent(m.content) });
      else if (m.role === "assistant") {
        const t = textOfContent(m.content);
        if (t) items.push({ kind: "assistant", text: t });
        for (const c of asArray(m.tool_calls)) if (isObj(c) && isObj(c.function)) items.push({ kind: "call", sig: callSig(c.function.name, c.function.arguments) });
      } else if (m.role === "tool") {
        const t = textOfContent(m.content).slice(0, 600);
        items.push({ kind: "result", text: t, error: looksLikeError(t) });
      }
    }
    return items;
  }
  // Responses
  if (typeof body.input === "string") return [{ kind: "human", text: body.input }];
  for (const it of asArray(body.input)) {
    if (!isObj(it)) continue;
    const type = it.type;
    if ((type === "message" || type === undefined) && typeof it.role === "string") {
      if (it.role === "user") items.push({ kind: "human", text: textOfContent(it.content) });
      else if (it.role === "assistant") items.push({ kind: "assistant", text: textOfContent(it.content) });
    } else if (type === "function_call") items.push({ kind: "call", sig: callSig(it.name, it.arguments) });
    else if (type === "local_shell_call") items.push({ kind: "call", sig: callSig("shell", isObj(it.action) ? it.action : {}) });
    else if (type === "custom_tool_call") items.push({ kind: "call", sig: callSig(it.name, { input: it.input }) });
    else if (type === "function_call_output" || type === "local_shell_call_output" || type === "custom_tool_call_output") {
      const t = (typeof it.output === "string" ? it.output : textOfContent(it.output)).slice(0, 600);
      items.push({ kind: "result", text: t, error: looksLikeError(t) });
    }
  }
  return items;
}

/** Index of the last human message that is not followed by a tool result, or -1 (mid-turn). */
function lastHumanIndex(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const k = items[i].kind;
    if (k === "result") return -1;
    if (k === "human") return items[i].kind === "human" && (items[i] as { text: string }).text.trim() ? i : -1;
  }
  return -1;
}

/* ---------------------------------- adapter pieces ---------------------------------- */

function extractToolTrace(body: unknown): ToolTrace {
  const calls: string[] = [];
  const out: Array<{ sig: string; callNo: number }> = [];
  for (const it of normalize(body)) {
    if (it.kind === "call") {
      out.push({ sig: it.sig, callNo: calls.length });
      calls.push(it.sig);
    } else if (it.kind === "result" && it.error) {
      out.push({ sig: `error: ${it.text.replace(/\s+/g, " ").trim().slice(0, 200) || "(empty)"}`, callNo: Math.max(0, calls.length - 1) });
    }
  }
  return { calls, items: out };
}

const countToolCalls = (body: unknown) => normalize(body).filter((i) => i.kind === "call").length;

function applyHint<T extends object>(body: T, hint: string): T {
  const note = `[ArgusOps note from the operator] ${hint.trim()}`;
  const clone = JSON.parse(JSON.stringify(body)) as Obj;
  if (Array.isArray(clone.messages)) {
    const last = clone.messages[clone.messages.length - 1] as Obj | undefined;
    if (last && last.role === "user") {
      if (typeof last.content === "string") last.content = `${last.content}\n\n${note}`;
      else if (Array.isArray(last.content)) last.content.push({ type: "text", text: note });
      else last.content = note;
    } else (clone.messages as unknown[]).push({ role: "user", content: note });
    return clone as T;
  }
  if (typeof clone.input === "string") clone.input = `${clone.input}\n\n${note}`;
  else {
    const input = Array.isArray(clone.input) ? (clone.input as unknown[]) : (clone.input = []) as unknown[];
    const last = input[input.length - 1] as Obj | undefined;
    if (last && last.role === "user" && Array.isArray(last.content)) last.content.push({ type: "input_text", text: note });
    else input.push({ type: "message", role: "user", content: [{ type: "input_text", text: note }] });
  }
  return clone as T;
}

function turnStartOf(body: unknown): { key: string; humanText: string } | null {
  const items = normalize(body);
  const i = lastHumanIndex(items);
  if (i < 0 || i !== items.length - 1) return null;
  const text = (items[i] as { text: string }).text.trim();
  let h = 0;
  for (let k = 0; k < text.length; k++) h = (h * 31 + text.charCodeAt(k)) | 0;
  return { key: `${items.length}:${h}`, humanText: text.slice(0, 2000) };
}

function turnToolCalls(body: unknown): string[] {
  const items = normalize(body);
  let from = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "human") {
      from = i;
      break;
    }
  }
  return items.slice(from).flatMap((i) => (i.kind === "call" ? [i.sig] : []));
}

/** The main conversation offers tools: in `tools`, or (Codex 0.169 and later) as `additional_tools` items in the input. */
const hasTools = (body: unknown) =>
  isObj(body) && ((Array.isArray(body.tools) && body.tools.length > 0) || asArray(body.input).some((it) => isObj(it) && it.type === "additional_tools" && Array.isArray(it.tools) && it.tools.length > 0));

/** The usage numbers differ from Anthropic's: prompt tokens INCLUDE the cached ones, so split them. */
function usageOf(u: unknown): { input: number; output: number; cached: number } {
  const x = isObj(u) ? u : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const total = n(x.prompt_tokens) || n(x.input_tokens);
  const details = isObj(x.prompt_tokens_details) ? x.prompt_tokens_details : isObj(x.input_tokens_details) ? x.input_tokens_details : {};
  const cached = Math.min(total, n(details.cached_tokens));
  return { input: total - cached, output: n(x.completion_tokens) || n(x.output_tokens), cached };
}

const STOP: Record<string, string> = { stop: "end_turn", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "content_filter" };
const TOOL_ITEM = /^(function_call|local_shell_call|custom_tool_call)$/;

class OpenAiTap implements UsageTap {
  private buffer = "";
  private model = "";
  private usage = { input: 0, output: 0, cached: 0 };
  private stop = "";
  private text = "";
  private sawToolCall = false;

  push(chunk: Buffer | string) {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.startsWith("data:")) this.handle(line.slice(5).trim());
    }
    if (this.buffer.length > 1_000_000) this.buffer = "";
  }

  private handle(payload: string) {
    if (!payload || payload === "[DONE]") return;
    let ev: Obj;
    try {
      ev = JSON.parse(payload) as Obj;
    } catch {
      return;
    }
    if (typeof ev.model === "string") this.model = ev.model;
    // Chat Completions chunks
    for (const c of asArray(ev.choices)) {
      if (!isObj(c)) continue;
      const delta = isObj(c.delta) ? c.delta : {};
      if (typeof delta.content === "string" && this.text.length < MAX_TEXT) this.text += delta.content.slice(0, MAX_TEXT - this.text.length);
      if (asArray(delta.tool_calls).length) this.sawToolCall = true;
      if (typeof c.finish_reason === "string") this.stop = STOP[c.finish_reason] ?? c.finish_reason;
    }
    if (isObj(ev.usage)) this.usage = usageOf(ev.usage);
    // Responses events
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string" && this.text.length < MAX_TEXT) this.text += ev.delta.slice(0, MAX_TEXT - this.text.length);
    if (typeof ev.type === "string" && (ev.type === "response.completed" || ev.type === "response.incomplete") && isObj(ev.response)) {
      const r = ev.response;
      if (typeof r.model === "string") this.model = r.model;
      if (isObj(r.usage)) this.usage = usageOf(r.usage);
      const out = asArray(r.output);
      this.stop = r.status === "incomplete" ? "max_tokens" : out.some((o) => isObj(o) && typeof o.type === "string" && TOOL_ITEM.test(o.type)) ? "tool_use" : "end_turn";
    }
  }

  result(): UsageResult {
    return {
      model: this.model || "unknown",
      inputTokens: this.usage.input,
      outputTokens: this.usage.output,
      cacheReadTokens: this.usage.cached,
      stopReason: this.stop || (this.sawToolCall ? "tool_use" : undefined),
      text: this.text || undefined,
    };
  }
}

function usageFromJson(text: string): UsageResult | null {
  let j: Obj;
  try {
    j = JSON.parse(text) as Obj;
  } catch {
    return null;
  }
  if (!isObj(j) || !isObj(j.usage)) return null;
  const u = usageOf(j.usage);
  let stop: string | undefined;
  let written = "";
  const choice = asArray(j.choices)[0];
  if (isObj(choice)) {
    if (typeof choice.finish_reason === "string") stop = STOP[choice.finish_reason] ?? choice.finish_reason;
    if (isObj(choice.message)) written = textOfContent(choice.message.content);
  } else if (Array.isArray(j.output)) {
    const out = j.output;
    stop = j.status === "incomplete" ? "max_tokens" : out.some((o) => isObj(o) && typeof o.type === "string" && TOOL_ITEM.test(o.type)) ? "tool_use" : "end_turn";
    written = out.map((o) => (isObj(o) && o.type === "message" ? textOfContent(o.content) : "")).filter(Boolean).join("\n");
  }
  return { model: typeof j.model === "string" ? j.model : "unknown", inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cached, stopReason: stop, text: written ? written.slice(0, MAX_TEXT) : undefined };
}

export const openaiAdapter: Adapter = {
  id: "openai",
  baseUrlSuffix: "/v1",
  baseUrlEnv: "OPENAI_BASE_URL",
  defaultUpstream: "https://api.openai.com",
  isModelRequest: (method, url) => method === "POST" && /^(?:\/v1)?\/(?:chat\/completions|responses)(?:\?|$)/.test(url),
  prepare(body) {
    // A streamed Chat Completions reply only reports token usage if the client asks for it. Asking costs nothing and only
    // adds a final chunk with the usage; the answer itself is unchanged.
    if (body.stream === true && Array.isArray(body.messages)) {
      const so = isObj(body.stream_options) ? body.stream_options : {};
      if (so.include_usage !== true) return { ...body, stream_options: { ...so, include_usage: true } };
    }
    return null;
  },
  extractToolTrace,
  countToolCalls,
  applyHint,
  isMainRequest: hasTools,
  turnStartOf,
  turnToolCalls,
  newTap: () => new OpenAiTap(),
  usageFromJson,
};
