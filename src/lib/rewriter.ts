import { prisma } from "@/lib/prisma";
import { draftRewrite, estimateTokens, loopCost, MAX_INSTRUCTION_CHARS } from "@/lib/rewrite-core";
import { getPolicyRow, resumeAgent } from "@/lib/control-plane";

/**
 * Suggested instructions for stuck agents.
 * Always available: a rule-based instruction written from the steps the agent kept repeating.
 * Optional: if the server has its own key (ARGUS_REWRITE_API_KEY), a small model polishes the wording.
 * The user's own model key is never used for this, and only the repeated steps are sent, never the conversation.
 */

/** An agent may be auto-resumed with a suggestion at most once in this window, so it can't loop through resumes. */
export const AUTO_APPLY_COOLDOWN_MS = 30 * 60_000;
const AI_TIMEOUT_MS = 6000;

export function aiRewriteConfigured(): boolean {
  return Boolean(process.env.ARGUS_REWRITE_API_KEY);
}

/** Asks a small model to tighten the rule-based instruction. Returns null on any problem (we then keep the rules version). */
async function polishWithAI(unit: string[], repeats: number, draft: string): Promise<string | null> {
  const key = process.env.ARGUS_REWRITE_API_KEY;
  if (!key) return null;
  const base = (process.env.ARGUS_REWRITE_API_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ARGUS_REWRITE_MODEL || "claude-haiku-4-5",
        max_tokens: 300,
        system:
          "You write ONE short corrective instruction (at most 90 words) for an AI coding agent that is stuck repeating the same steps. " +
          "Be specific about what to stop doing and what to do instead. Plain text only: no preamble, no quotes, no markdown.",
        messages: [
          {
            role: "user",
            content: `The agent repeated these steps ${repeats} times:\n${unit.map((u) => `- ${u}`).join("\n")}\n\nA first draft of the instruction:\n${draft}\n\nWrite the final instruction.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ").trim();
    if (!text) return null;
    return text.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").slice(0, MAX_INSTRUCTION_CHARS);
  } catch {
    return null;
  }
}

export interface ProposeArgs {
  userId: string;
  agentId: string;
  agentName: string;
  incidentId?: string | null;
  unit: string[];
  repeats: number;
}

/**
 * Writes a suggested instruction for a loop and stores it. If the user's policy allows it (and the agent wasn't
 * auto-resumed in the last 30 minutes) the suggestion is marked applied and `autoApplied` is true: the caller then
 * resumes the agent with it instead of pausing.
 */
export async function proposeRewrite(a: ProposeArgs) {
  const draft = draftRewrite(a.unit, a.repeats);
  const polished = await polishWithAI(a.unit, a.repeats, draft.instruction);
  const instruction = polished ?? draft.instruction;

  // real cost of the loop: this agent's recent calls (each repeat resends the whole conversation)
  const recent = await prisma.usageEvent.findMany({
    where: { user_id: a.userId, agent_id: a.agentId, created_at: { gte: new Date(Date.now() - 2 * 3_600_000) } },
    orderBy: { created_at: "desc" },
    take: 10,
    select: { input_tokens: true, output_tokens: true },
  });
  const cost = loopCost(recent.map((r) => r.input_tokens + r.output_tokens), a.repeats);
  const rationale = cost.perCall
    ? `${draft.observed} Each attempt resent about ${cost.perCall.toLocaleString()} tokens, so the loop has cost about ${cost.total.toLocaleString()} tokens so far.`
    : draft.observed;

  // only the newest suggestion per agent stays open
  await prisma.promptRewrite.updateMany({
    where: { user_id: a.userId, agent_id: a.agentId, status: "PROPOSED" },
    data: { status: "SUPERSEDED", decided_at: new Date() },
  });

  const policy = await getPolicyRow(a.userId);
  let autoApplied = false;
  if (policy.auto_apply_rewrites) {
    const recentAuto = await prisma.promptRewrite.count({
      where: { user_id: a.userId, agent_id: a.agentId, auto_applied: true, created_at: { gte: new Date(Date.now() - AUTO_APPLY_COOLDOWN_MS) } },
    });
    autoApplied = recentAuto === 0;
  }

  const rewrite = await prisma.promptRewrite.create({
    data: {
      user_id: a.userId,
      agent_id: a.agentId,
      incident_id: a.incidentId ?? null,
      original_prompt: a.unit.join("\n").slice(0, 8000),
      rewritten_prompt: instruction,
      rationale: rationale.slice(0, 2000),
      tokens_before: cost.total,
      tokens_after: estimateTokens(instruction),
      repeats: a.repeats,
      source: polished ? "AI" : "RULES",
      status: autoApplied ? "APPLIED" : "PROPOSED",
      auto_applied: autoApplied,
      decided_at: autoApplied ? new Date() : null,
    },
  });
  return { rewrite, autoApplied };
}

/** The operator approves a suggestion (optionally edited): the agent resumes with it. */
export async function applyRewrite(userId: string, id: string, editedText?: string) {
  const rw = await prisma.promptRewrite.findFirst({ where: { id, user_id: userId } });
  if (!rw || !rw.agent_id) return { ok: false as const, status: 404, error: "Suggestion not found." };
  if (rw.status !== "PROPOSED") return { ok: false as const, status: 409, error: "This suggestion was already handled." };

  const text = editedText?.trim() ? editedText.trim().slice(0, 1000) : rw.rewritten_prompt;
  const resumed = await resumeAgent(userId, rw.agent_id, text);
  if (!resumed.ok) return resumed;

  await prisma.promptRewrite.update({
    where: { id: rw.id },
    data: { status: "APPLIED", rewritten_prompt: text, tokens_after: estimateTokens(text), decided_at: new Date() },
  });
  return { ok: true as const, value: { agent: resumed.value.agent, text } };
}

export async function dismissRewrite(userId: string, id: string) {
  const result = await prisma.promptRewrite.updateMany({
    where: { id, user_id: userId, status: "PROPOSED" },
    data: { status: "REJECTED", decided_at: new Date() },
  });
  return result.count === 1;
}
