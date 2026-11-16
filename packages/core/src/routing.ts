import crypto from "node:crypto";
import path from "node:path";
import { findPrice, type PriceRow } from "./pricing";

/**
 * Model routing: the right model for the task. When a turn is simple (rename a variable, fix a typo, explain a
 * function) and the agent is set to an expensive model, ArgusOps can run that turn on a cheaper one, at a lower effort,
 * and go back to your model the moment the work needs it or the cheaper model struggles.
 *
 * Rules, in order of importance:
 *  - It never makes a request MORE expensive than the model you chose. Escalation climbs back towards your model, never past it.
 *  - Decisions are made once per turn (when you send a message), so a turn runs on one model and its cache stays warm.
 *  - Switching models re-reads the whole conversation at full price (caches belong to one model), so it only switches
 *    when the estimated saving is bigger than that cost.
 *  - It only rewrites requests it knows are valid for the target model; anything it is unsure about goes unchanged,
 *    and a request the provider rejects after a switch is re-sent unchanged (see the proxy).
 *  - Default mode is "suggest": it tells you what it would do and what that would save, and changes nothing.
 */

export type Difficulty = "trivial" | "simple" | "normal" | "hard";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface RouteTarget {
  model: string;
  effort?: Effort;
}

export interface RoutingConfig {
  /** off: never. suggest (default): say what it would switch and the saving. auto: switch by itself. */
  mode: "off" | "suggest" | "auto";
  /** Where each kind of turn may go. Turns judged normal or hard always stay on your model. null = stay. */
  targets: { trivial: RouteTarget | null; simple: RouteTarget | null };
  /** Models to climb through when a cheaper model struggles, cheapest first. */
  ladder: string[];
  /** A model to always use, per project folder ("*" = everywhere), or "keep" to never switch there. A pin always wins. */
  pins: Record<string, string>;
}

export const DEFAULT_LADDER = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"];

export const DEFAULT_ROUTING: RoutingConfig = {
  mode: "suggest",
  targets: { trivial: { model: "claude-sonnet-5-5", effort: "low" }, simple: { model: "claude-sonnet-5-5", effort: "medium" } },
  ladder: DEFAULT_LADDER,
  pins: {},
};

/* ----------------------------------- difficulty ----------------------------------- */

const HARD =
  /\b(design|architect(?:ure)?|refactor(?:ing)?|re-?write|migrat(?:e|ion|ing)|debug(?:ging)?|investigate|root cause|why (?:does|is|do|did|are|isn't|doesn't|won't)|race condition|deadlock|concurren\w*|security|vulnerab\w*|authenticat\w*|authori[sz]\w*|encrypt\w*|performance|optimi[sz]e|memory leak|from scratch|implement|build (?:a|an|the|me)|end-to-end|across (?:the )?(?:codebase|project|repo)|every file|all (?:the )?files|plan)\b/i;
const TRIVIAL =
  /\b(rename|typo|spelling|re-?format|indent(?:ation)?|whitespace|trailing spaces?|add (?:a |an )?comment|remove (?:the |an? )?(?:unused|comment|console\.log|print)|bump (?:the )?version|(?:change|update|set) (?:the )?(?:version|copyright|year|text|label|title|colou?r|wording|string|message|port)|sort (?:the )?imports?|fix (?:the )?(?:typo|indentation|formatting|import))\b/i;
const SIMPLE =
  /\b(add (?:a |an )?(?:unit )?(?:test|log(?:ging)?|flag|option|field|button|parameter|argument|docstring|example)|small|quick|simple|minor|tweak|(?:update|write|improve) (?:the )?(?:readme|docs?|documentation|docstring|changelog)|explain|what does|what is|where is|summari[sz]e|list (?:the|all)|show me|find (?:where|the))\b/i;
const TRACE = /Traceback \(most recent call last\)|^\s+at .+[:(]\d+|\b[A-Z]\w*(?:Error|Exception): /m;
const FILE_MENTION = /(?:^|[\s"'`(])[\w./-]+\.(?:tsx?|jsx?|mjs|py|go|rs|java|kt|rb|php|cs|c|cpp|h|css|scss|html|vue|svelte|md|json|ya?ml|toml|sql|sh)\b/g;

/**
 * How hard the human's request looks, from its words alone. Deliberately cautious: only clear signs of small work make a
 * turn trivial or simple, and any sign of real work (design, debugging, many files, a stack trace) keeps your model.
 */
export function scoreDifficulty(text: string): { level: Difficulty; reasons: string[] } {
  // agents add their own context to the human's message (Claude Code wraps it in <system-reminder>): judge only the person's words
  const t = (text ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ").trim();
  if (!t) return { level: "normal", reasons: ["no request text to judge"] };
  const hard = HARD.exec(t);
  if (hard) return { level: "hard", reasons: [`asks to ${JSON.stringify(hard[1].toLowerCase())}`] };
  if (TRACE.test(t)) return { level: "hard", reasons: ["includes an error or stack trace"] };
  const files = new Set((t.match(FILE_MENTION) ?? []).map((f) => f.trim())).size;
  if (files >= 4) return { level: "hard", reasons: [`mentions ${files} files`] };
  if (t.length > 1500) return { level: "hard", reasons: ["a long, detailed request"] };
  if (t.includes("```")) return { level: "normal", reasons: ["includes code"] };
  const trivial = TRIVIAL.exec(t);
  if (trivial && t.length <= 400) return { level: "trivial", reasons: [`a small edit (${JSON.stringify(trivial[1].toLowerCase())})`] };
  const simple = SIMPLE.exec(t);
  if (simple && t.length <= 600) return { level: "simple", reasons: [`a small task (${JSON.stringify(simple[1].toLowerCase())})`] };
  return { level: "normal", reasons: ["nothing marks it as small"] };
}

/* ------------------------------- request compatibility ------------------------------- */

const effortRank = (e: unknown) => (typeof e === "string" ? EFFORTS.indexOf(e as Effort) : -1);

const FIVE = /^claude-(?:fable|mythos|opus|sonnet|haiku)-5(?:-|$)/;
/** Explicit `thinking: {type: "disabled"}` is a 400 on these. */
const NO_DISABLED = /^claude-(?:fable|mythos)-5|^claude-opus-5-5|^claude-sonnet-5-5/;
/** Forced tool use (tool_choice any / tool) is a 400 on these. */
const NO_FORCED_TOOL = /^claude-(?:fable|mythos)-5-[12]|^claude-opus-5-5|^claude-sonnet-5-5/;
/** `thinking.display: "updates"` exists only on these. */
const UPDATES_DISPLAY = /^claude-(?:fable|mythos)-5|^claude-opus-5-5|^claude-sonnet-5-5/;
/** Server-side `fallbacks: "default"` exists only on these. */
const SERVER_FALLBACKS = /^claude-(?:fable|mythos)-5|^claude-opus-5|^claude-sonnet-5-5/;
/** `budget_tokens` thinking is gone here; adaptive thinking replaces it. */
const NO_BUDGET = (m: string) => FIVE.test(m) || /^claude-opus-4-[78]/.test(m);
/** Effort each model uses when the request does not say. */
const DEFAULT_EFFORT = (m: string): Effort => (/^claude-(?:opus-5-5|haiku-5-5)/.test(m) ? "medium" : "high");

/**
 * The same request, addressed to another model: the model name, a lower effort if asked, and the few settings that the
 * target model would reject translated to their equivalent. Returns a reason instead when the request uses something
 * that cannot be carried over safely (fast mode, sampling settings, forced tool use, advisor or computer tools...).
 * Pure; the input is not modified.
 */
export function rewriteForModel(body: Record<string, unknown>, target: RouteTarget): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  const to = target.model;
  if (body.speed !== undefined) return { ok: false, reason: "uses fast mode, which belongs to one model" };
  if (["temperature", "top_p", "top_k"].some((k) => body[k] !== undefined)) return { ok: false, reason: "sets sampling options that newer models reject" };
  if (Array.isArray(body.fallbacks)) return { ok: false, reason: "names its own fallback models" };
  const tools = Array.isArray(body.tools) ? (body.tools as Array<{ type?: unknown }>) : [];
  if (tools.some((t) => typeof t?.type === "string" && /^(?:advisor|computer)/.test(t.type))) return { ok: false, reason: "uses a tool tied to particular models" };
  const choice = body.tool_choice as { type?: unknown } | undefined;
  if (choice && (choice.type === "any" || choice.type === "tool") && NO_FORCED_TOOL.test(to)) return { ok: false, reason: `forces a tool call, which ${to} does not accept` };

  const out: Record<string, unknown> = { ...body, model: to };

  // effort: never raise it, only lower it to the target's
  const oc = body.output_config && typeof body.output_config === "object" ? { ...(body.output_config as Record<string, unknown>) } : null;
  if (target.effort) {
    const cur = oc?.effort;
    const effort = effortRank(cur) >= 0 && effortRank(cur) < effortRank(target.effort) ? (cur as Effort) : target.effort;
    out.output_config = { ...(oc ?? {}), effort };
  }
  const effective = ((out.output_config as { effort?: unknown } | undefined)?.effort as Effort | undefined) ?? DEFAULT_EFFORT(to);

  // thinking settings the target would reject
  const th = body.thinking && typeof body.thinking === "object" ? { ...(body.thinking as Record<string, unknown>) } : null;
  if (th) {
    let next: Record<string, unknown> | null = th;
    if (th.type === "enabled" && NO_BUDGET(to)) {
      next = { type: "adaptive", ...(th.display !== undefined ? { display: th.display } : {}) };
    } else if (th.type === "disabled") {
      if (/^claude-sonnet-5-5/.test(to)) next = effortRank(effective) <= effortRank("high") ? { type: "between_tools" } : null;
      else if (NO_DISABLED.test(to)) next = null;
      else if (/^claude-haiku-5-5/.test(to) && effortRank(effective) > effortRank("high")) next = null;
    } else if (th.type === "between_tools" && !/^claude-sonnet-5-5/.test(to)) {
      next = null;
    }
    if (next && next.display === "updates" && !UPDATES_DISPLAY.test(to)) {
      next = { ...next };
      delete next.display;
    }
    if (next) out.thinking = next;
    else delete out.thinking; // runs the model's default (adaptive) thinking
  }
  if (body.fallbacks !== undefined && !SERVER_FALLBACKS.test(to)) delete out.fallbacks;
  return { ok: true, body: out };
}

/* ---------------------------------- cost of a switch ---------------------------------- */

/** What one turn usually looks like, for estimates. Labelled as estimates wherever they are shown. */
export const TURN_ASSUMPTIONS = { requests: 8, outputTokens: 6000, newInputTokens: 4000 };

const cacheRead = (p: PriceRow) => p.cache_read_per_mtok ?? p.input_per_mtok * 0.1;

/**
 * Is moving this conversation from one model to another worth it for one turn? Caches belong to one model. If the
 * current model has the conversation cached (`warm`), staying reads it cheaply while switching writes it all again
 * (1.25x the new model's input price), so a big conversation may not be worth moving. If nothing is cached anyway (a
 * new session), both would write it, and the cheaper model writes it for less. After the first request, every request
 * is cheaper on the cheaper model. Returns null when either model has no price.
 */
export function switchCost(prefixTokens: number, from: string, to: string, prices: PriceRow[], alreadyThere = false, warm = true): { extraUsd: number; savingUsd: number; netUsd: number; worth: boolean } | null {
  const a = findPrice(from, prices);
  const b = findPrice(to, prices);
  if (!a || !b) return null;
  const A = TURN_ASSUMPTIONS;
  const stayFirst = warm ? cacheRead(a) : 1.25 * a.input_per_mtok;
  const switchFirst = alreadyThere ? (warm ? cacheRead(b) : 1.25 * b.input_per_mtok) : 1.25 * b.input_per_mtok;
  const extraUsd = (prefixTokens * (switchFirst - stayFirst)) / 1e6; // negative when switching is cheaper from the start
  const savingUsd = (A.requests * prefixTokens * (cacheRead(a) - cacheRead(b)) + A.outputTokens * (a.output_per_mtok - b.output_per_mtok) + A.newInputTokens * 1.25 * (a.input_per_mtok - b.input_per_mtok)) / 1e6;
  const netUsd = savingUsd - extraUsd;
  return { extraUsd, savingUsd, netUsd, worth: netUsd > 0 };
}

/* ------------------------------------- the router ------------------------------------- */

export interface RouteHint {
  difficulty?: Difficulty;
  /** How many tiers to climb above the cheap model (Autopilot raises it for each failed attempt). */
  escalate?: number;
  reason?: string;
}

export interface RouteDecision {
  kind: "switch" | "suggest" | "escalate" | "revert" | "pin" | "error";
  /** The model the agent asked for. */
  from: string;
  /** The model the turn runs on (or would, for a suggestion). */
  to: string;
  effort?: Effort;
  difficulty?: Difficulty;
  reasons: string[];
  /** Estimated saving for this turn, after the cost of switching (list prices). */
  estSavingUsd?: number;
  applied: boolean;
  message: string;
}

export interface RouterOptions {
  provider: string;
  adapter: { isMainRequest(body: unknown): boolean; turnStartOf(body: unknown): { key: string; humanText: string } | null };
  config: () => RoutingConfig;
  prices: PriceRow[];
  /** The project folder, for per-project pins. */
  root?: string;
  /** Extra knowledge from whoever drives the agent (Autopilot knows each step's size and attempt number). */
  hint?: () => RouteHint | null;
  onDecision?: (d: RouteDecision) => void;
  /** Debug only: why each turn went where it did. */
  onDebug?: (line: string) => void;
  now?: () => number;
}

interface Conversation {
  original: string;
  turnKey: string;
  /** The cheap target chosen for this turn, before any escalation. */
  base: RouteTarget | null;
  /** What requests in this conversation are sent to now; null = the model the agent asked for. */
  current: RouteTarget | null;
  escalation: number;
  difficulty?: Difficulty;
  suggested: boolean;
  pinned?: string;
}

const MAX_CONVERSATIONS = 64;
/** A model used this recently is assumed to still have the shared part of the prompt cached (the shortest cache lives 5 minutes). */
const WARM_MS = 5 * 60_000;
const SUGGEST_EVERY_MS = 10 * 60_000;
const money = (n: number) => (n < 0.01 ? "less than $0.01" : `$${n.toFixed(2)}`);

/** Identifies one conversation (a main session, or a sub-agent with its own history) by how it began. */
export function conversationKey(body: unknown): string {
  const first = Array.isArray((body as { messages?: unknown[] })?.messages) ? (body as { messages: unknown[] }).messages[0] : null;
  return crypto.createHash("sha1").update(JSON.stringify(first ?? null).slice(0, 8000)).digest("hex").slice(0, 16);
}

export function pinKey(root: string): string {
  const abs = path.resolve(root);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

export class Router {
  private convs = new Map<string, Conversation>();
  private broken = new Set<string>();
  private lastSuggestAt = -Infinity;
  private lastTurnConv = "";
  /** When each model last received a main request from this router, to guess whether its cache is warm. */
  private lastUse = new Map<string, number>();

  constructor(private readonly o: RouterOptions) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }
  private priceIn(model: string) {
    return findPrice(model, this.o.prices)?.input_per_mtok;
  }
  private emit(d: RouteDecision) {
    this.o.onDecision?.(d);
  }

  /**
   * Called for every model request. Returns the request to send instead (and to which model), or null to send it as it is.
   */
  route(body: Record<string, unknown>): { body: Record<string, unknown>; from: string; to: string } | null {
    if (this.o.provider !== "anthropic") return null; // other API formats: later
    const model = typeof body.model === "string" ? body.model : "";
    if (!model || model.includes("[") || !this.o.adapter.isMainRequest(body)) return null;
    const cfg = this.o.config();

    const key = conversationKey(body);
    let conv = this.convs.get(key);
    if (conv && conv.original !== model) conv = undefined; // the person picked another model: start over
    const start = this.o.adapter.turnStartOf(body);
    if (start && (!conv || conv.turnKey !== start.key)) {
      conv = this.newTurn(key, conv, model, start, body, cfg);
    }
    if (!conv) return null; // a conversation first seen mid-turn: leave it alone until the next turn
    this.convs.delete(key);
    this.convs.set(key, conv); // most recently used last
    const sendTo = conv.current && conv.current.model !== model && !this.broken.has(`${model}>${conv.current.model}`) ? conv.current : null;
    const r = sendTo ? rewriteForModel(body, sendTo) : null;
    if (!sendTo || !r || !r.ok) {
      this.lastUse.set(model, this.now());
      return null;
    }
    this.lastUse.set(sendTo.model, this.now());
    return { body: r.body, from: model, to: sendTo.model };
  }

  private newTurn(key: string, prev: Conversation | undefined, model: string, start: { key: string; humanText: string }, body: Record<string, unknown>, cfg: RoutingConfig): Conversation {
    this.lastTurnConv = key;
    const conv: Conversation = prev ?? { original: model, turnKey: "", base: null, current: null, escalation: 0, suggested: false };
    conv.turnKey = start.key;
    if (this.convs.size >= MAX_CONVERSATIONS && !this.convs.has(key)) this.convs.delete(this.convs.keys().next().value as string);
    this.convs.set(key, conv);

    // a pin always wins
    const pin = (this.o.root ? cfg.pins[pinKey(this.o.root)] : undefined) ?? cfg.pins["*"];
    if (pin) {
      conv.base = null;
      conv.current = pin === "keep" || pin === model ? null : { model: pin };
      if (conv.current && conv.pinned !== pin) {
        conv.pinned = pin;
        this.emit({ kind: "pin", from: model, to: pin, reasons: ["pinned by you"], applied: true, message: `Pinned: using ${pin} instead of ${model} here. Undo with: argus route unpin` });
      }
      return conv;
    }
    if (cfg.mode === "off") {
      conv.base = conv.current = null;
      return conv;
    }

    const hint = this.o.hint?.() ?? null;
    if (hint) conv.escalation = Math.max(0, hint.escalate ?? 0);
    const judged = hint?.difficulty ? { level: hint.difficulty, reasons: [hint.reason ?? `the plan marks this step as ${hint.difficulty}`] } : scoreDifficulty(start.humanText);
    conv.difficulty = judged.level;
    this.o.onDebug?.(`route: ${model} turn judged ${judged.level} (${judged.reasons.join(", ")}); text starts ${JSON.stringify(start.humanText.slice(0, 120))}`);
    const wanted = judged.level === "trivial" || judged.level === "simple" ? cfg.targets[judged.level] : null;
    const base = wanted && this.cheaper(wanted.model, model) ? wanted : null;
    let target = base ? this.climb(model, base, conv.escalation, cfg) : null;
    // only announce a switch that will really happen: not one the provider rejected before, nor one this request can't take
    if (target && (this.broken.has(`${model}>${target.model}`) || !rewriteForModel(body, target).ok)) target = null;
    const before = conv.current;

    if (!target) {
      conv.base = base;
      if (cfg.mode === "auto" && before) {
        conv.current = null;
        this.emit({ kind: "revert", from: model, to: model, difficulty: judged.level, reasons: judged.reasons, applied: true, message: `This turn needs more (${judged.reasons.join(", ")}): back on ${model}.` });
      }
      conv.current = null;
      return conv;
    }

    const prefix = Math.round(JSON.stringify(body).length / 4);
    const fromNow = before?.model ?? model;
    const warm = (m: string) => this.now() - (this.lastUse.get(m) ?? -Infinity) < WARM_MS;
    const cost = switchCost(prefix, fromNow, target.model, this.o.prices, fromNow === target.model, warm(fromNow));
    const fromOriginal = switchCost(prefix, model, target.model, this.o.prices, fromNow === target.model, warm(model));
    if (!cost || (!cost.worth && conv.escalation === 0)) {
      // not worth switching now: stay where the conversation already is (still cheaper than the original if it was routed)
      conv.base = base;
      if (cfg.mode !== "auto") conv.current = null;
      return conv;
    }
    const net = Math.max(0, fromOriginal?.netUsd ?? cost.netUsd);
    const effortText = target.effort ? ` at ${target.effort} effort` : "";

    if (cfg.mode === "suggest") {
      conv.base = base;
      conv.current = null;
      if (!conv.suggested && this.now() - this.lastSuggestAt >= SUGGEST_EVERY_MS) {
        conv.suggested = true;
        this.lastSuggestAt = this.now();
        this.emit({
          kind: "suggest",
          from: model,
          to: target.model,
          effort: target.effort,
          difficulty: judged.level,
          reasons: judged.reasons,
          estSavingUsd: net,
          applied: false,
          message: `Tip: this turn looks ${judged.level} (${judged.reasons.join(", ")}). ${target.model}${effortText} could do it for about ${money(net)} less than ${model} (estimate). To let ArgusOps switch by itself: argus route auto`,
        });
      }
      return conv;
    }

    conv.base = base;
    conv.current = target;
    if (!before || before.model !== target.model || before.effort !== target.effort) {
      const escalated = conv.escalation > 0;
      this.emit({
        kind: escalated ? "escalate" : "switch",
        from: model,
        to: target.model,
        effort: target.effort,
        difficulty: judged.level,
        reasons: judged.reasons,
        estSavingUsd: net,
        applied: true,
        message: escalated
          ? `${base?.model ?? "The cheaper model"} did not get this done (${judged.reasons.join(", ")}), so this turn moves up to ${target.model}${effortText}. It will not go past ${model}, the model you chose.`
          : `This turn looks ${judged.level} (${judged.reasons.join(", ")}): running it on ${target.model}${effortText} instead of ${model}, about ${money(net)} cheaper (estimate). Change with: argus route`,
      });
    }
    return conv;
  }

  private cheaper(candidate: string, than: string): boolean {
    const a = this.priceIn(candidate);
    const b = this.priceIn(than);
    return a !== undefined && b !== undefined && a < b;
  }

  /** The cheap target, moved `steps` tiers up the ladder; null once that reaches the agent's own model. */
  private climb(original: string, base: RouteTarget, steps: number, cfg: RoutingConfig): RouteTarget | null {
    if (steps <= 0) return base;
    const baseIn = this.priceIn(base.model) ?? 0;
    const above = [...new Set(cfg.ladder)]
      .filter((m) => m !== base.model && this.cheaper(m, original) && (this.priceIn(m) ?? 0) > baseIn && !this.broken.has(`${original}>${m}`))
      .sort((x, y) => (this.priceIn(x) ?? 0) - (this.priceIn(y) ?? 0));
    const seq = [base.model, ...above];
    return steps < seq.length ? { model: seq[steps] } : null; // escalated tiers keep the agent's own effort
  }

  /** The cheaper model is struggling (a loop, failing checks): move this conversation one tier up, towards the agent's model. */
  struggled(reason: string, body?: unknown): void {
    const key = body ? conversationKey(body) : this.lastTurnConv;
    const conv = this.convs.get(key);
    if (!conv || !conv.current || !conv.base || conv.pinned) return;
    conv.escalation++;
    const from = conv.current.model;
    conv.current = this.climb(conv.original, conv.base, conv.escalation, this.o.config());
    const to = conv.current?.model ?? conv.original;
    this.emit({
      kind: "escalate",
      from: conv.original,
      to,
      difficulty: conv.difficulty,
      reasons: [reason],
      applied: true,
      message: conv.current ? `${from} was struggling (${reason}): moved this conversation up to ${to}.` : `${from} was struggling (${reason}): back on ${to}, the model you chose.`,
    });
  }

  /** How the last turn went, from the supervisor's checks: a failed turn moves the next one up a tier. */
  turnOutcome(ok: boolean, reason = "the checks failed after its turn"): void {
    const conv = this.convs.get(this.lastTurnConv);
    if (!conv) return;
    if (ok) conv.escalation = 0;
    else this.struggled(reason);
  }

  /** The provider rejected a rewritten request. It was re-sent unchanged; never make this switch again in this session. */
  failed(from: string, to: string, status: number, detail: string): void {
    const pair = `${from}>${to}`;
    if (this.broken.has(pair)) return;
    this.broken.add(pair);
    for (const c of this.convs.values()) if (c.current?.model === to && c.original === from) c.current = null;
    this.emit({
      kind: "error",
      from,
      to,
      reasons: [detail.slice(0, 200)],
      applied: false,
      message: `${to} rejected a request (HTTP ${status}), so ArgusOps sent it unchanged to ${from} and will not switch ${from} to ${to} again in this session.`,
    });
  }
}
