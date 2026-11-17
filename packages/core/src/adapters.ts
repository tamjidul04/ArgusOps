import { applyHint, countToolCalls, extractToolTrace, isMainRequest, SseUsageTap, turnStartOf, turnToolCalls, usageFromJson, type ToolTrace, type UsageResult } from "./anthropic";
import { openaiAdapter } from "./openai";

export type { ToolTrace, UsageResult };

/** Reads a streamed response as it passes by and reports usage, why the model stopped, and what it wrote. */
export interface UsageTap {
  push(chunk: Buffer | string): void;
  result(): UsageResult;
}

/**
 * Everything the proxy needs to know about one provider's API format. The proxy, the loop detector and the supervisor
 * only talk to this interface, so supporting another provider means writing one adapter.
 */
export interface Adapter {
  id: "anthropic" | "openai";
  /** What to add to the proxy address for the agent's base-URL setting, e.g. OpenAI clients expect "/v1". */
  baseUrlSuffix: string;
  /** The environment variable most agents of this provider read for a base URL. */
  baseUrlEnv: string;
  defaultUpstream: string;
  /** Is this a request that carries a conversation worth inspecting? Everything else is forwarded untouched. */
  isModelRequest(method: string, url: string): boolean;
  /** A change the proxy needs in the request to be able to read usage, or null. (Never changes what the model is asked.) */
  prepare(body: Record<string, unknown>): Record<string, unknown> | null;
  extractToolTrace(body: unknown): ToolTrace;
  countToolCalls(body: unknown): number;
  applyHint<T extends object>(body: T, hint: string): T;
  /** The main conversation (carries tools), as opposed to small side requests. */
  isMainRequest(body: unknown): boolean;
  turnStartOf(body: unknown): { key: string; humanText: string } | null;
  turnToolCalls(body: unknown): string[];
  newTap(): UsageTap;
  usageFromJson(text: string): UsageResult | null;
}

export const anthropicAdapter: Adapter = {
  id: "anthropic",
  baseUrlSuffix: "",
  baseUrlEnv: "ANTHROPIC_BASE_URL",
  defaultUpstream: "https://api.anthropic.com",
  isModelRequest: (method, url) => method === "POST" && /^\/v1\/messages(?:\?|$)/.test(url),
  prepare: () => null,
  extractToolTrace,
  countToolCalls,
  applyHint,
  isMainRequest,
  turnStartOf,
  turnToolCalls,
  newTap: () => new SseUsageTap(),
  usageFromJson,
};

export function adapterFor(provider: string): Adapter | null {
  if (provider === "anthropic") return anthropicAdapter;
  if (provider === "openai") return openaiAdapter;
  return null;
}
