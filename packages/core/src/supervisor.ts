import type { Finding, Severity } from "./findings";
import { worstSeverity } from "./findings";
import type { GateName, GateResult } from "./gates";
import { inspectSince, recordReport, type CheckReport } from "./inspect";
import type { NotificationRow, Store } from "./store";
import { takeSnapshot, type Snapshot } from "./workspace";

/**
 * The supervisor: after each of the agent's turns it checks the work, compares what the agent SAID with what really
 * happened, and (if you turned redirect on) tells the agent what to fix, with your next message.
 *
 * A turn starts when you send a message and ends when the agent hands back to you. Checks never delay the agent's
 * reply; only taking the starting snapshot waits, briefly, so the agent cannot change files before it is taken.
 */

export interface TurnStart {
  key: string;
  humanText: string;
}

export interface TurnEnd {
  key: string;
  /** What the agent wrote when it handed back. */
  text: string;
  /** Tool calls it made during the turn. */
  toolCalls: string[];
}

export interface TurnOutcome {
  report: CheckReport;
  action: "none" | "alert" | "redirect" | "held-back";
  redirect?: string;
}

const SNAPSHOT_TIMEOUT_MS = 8000;
const MAX_REDIRECT_CHARS = 1800;

/* -------------------------------- claims ---------------------------------- */

const CLAIMS_TESTS = /\b(?:all\s+(?:the\s+|\d+\s+)?tests?|the\s+tests?|tests?|test\s+suite|specs?)\s+(?:now\s+|are\s+now\s+|are\s+all\s+|all\s+)?(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|are\s+passing|are\s+green|is\s+green|green)\b/i;
const CLAIMS_BUILD = /\b(?:the\s+)?(build|compil(?:e|ation)|type-?check(?:ing)?|types?|lint(?:ing|er)?)\s+(?:now\s+|is\s+now\s+)?(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|is\s+clean|are\s+clean|is\s+green|works|without\s+errors)\b/i;
// "can't", "isn't", "don't": there is no word boundary before the n of n't, so it is matched on its own
const NEGATED = /\bnot\b|n't\b|n’t\b|\bnever\b|\bno longer\b|\bfail(?:s|ed|ing)?\b|\bcannot\b|\bunable\b|\bwould\b|\bshould\b|\bif\b/i;
/** Quoted text is the agent quoting someone (often while refusing to say it), not a claim of its own. */
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’|`[^`]*`/g;
const RAN_TESTS = /\b(test|tests|pytest|jest|vitest|mocha|ava|rspec|phpunit|go test|cargo test|npm t\b|unittest)\b/i;

function claimSentence(text: string, re: RegExp): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const own = sentence.replace(QUOTED, " ");
    if (re.test(own) && !NEGATED.test(own)) return sentence.trim().slice(0, 200);
  }
  return null;
}

const BUILD_GATES: Record<string, GateName> = { build: "build", compile: "build", compilation: "build", typecheck: "typecheck", "type-check": "typecheck", typechecking: "typecheck", "type-checking": "typecheck", type: "typecheck", types: "typecheck", lint: "lint", linting: "lint", linter: "lint" };

/**
 * Compares what the agent says it achieved with the evidence. `gates` is null when the project's checks were not run.
 * Pure.
 */
export function assessClaims(text: string, gates: GateResult[] | null, toolCalls: string[]): Finding[] {
  const out: Finding[] = [];
  if (!text) return out;
  const testClaim = claimSentence(text, CLAIMS_TESTS);
  if (testClaim) {
    const test = gates?.find((g) => g.name === "test");
    if (test && !test.ok) {
      out.push({
        code: "claim-contradicted",
        severity: "CRITICAL",
        title: "The agent said the tests pass, but they fail",
        detail: `It wrote: "${testClaim}". ArgusOps ran \`${test.command}\` and it failed.`,
        evidence: [`Said: ${testClaim}`, ...test.outputTail.split("\n").slice(-4).map((l) => l.trim()).filter(Boolean)],
        files: [],
      });
    } else if (!test && !toolCalls.some((c) => RAN_TESTS.test(c))) {
      out.push({
        code: "claim-unverified",
        severity: "WARN",
        title: "The agent said the tests pass without running them",
        detail: `It wrote: "${testClaim}", but ran no test command during this turn${gates === null ? " (and ArgusOps was not allowed to run the project's checks)" : ""}.`,
        evidence: [`Said: ${testClaim}`],
        files: [],
      });
    }
  }
  const buildClaim = claimSentence(text, CLAIMS_BUILD);
  if (buildClaim && gates) {
    const word = (CLAIMS_BUILD.exec(buildClaim)?.[1] ?? "").toLowerCase();
    const gate = gates.find((g) => g.name === (BUILD_GATES[word] ?? "build"));
    if (gate && !gate.ok) {
      out.push({
        code: "claim-contradicted",
        severity: "CRITICAL",
        title: `The agent said the ${gate.name} works, but it fails`,
        detail: `It wrote: "${buildClaim}". ArgusOps ran \`${gate.command}\` and it failed.`,
        evidence: [`Said: ${buildClaim}`, ...gate.outputTail.split("\n").slice(-4).map((l) => l.trim()).filter(Boolean)],
        files: [],
      });
    }
  }
  return out;
}

/** The corrective instruction sent to the agent, written from the evidence. */
export function redirectFor(findings: Finding[]): string {
  const items = findings
    .filter((f) => f.severity !== "INFO")
    .slice(0, 5)
    .map((f, i) => {
      const ev = f.evidence.slice(0, 2).join(" | ");
      return `${i + 1}. ${f.title}. ${f.detail}${ev ? ` (${ev})` : ""}`;
    });
  const text = [
    "ArgusOps, which supervises this session, checked the work from your last turn and found problems that must be fixed before the task is done:",
    ...items,
    "Fix the causes. Do not delete, skip or weaken tests, silence warnings, or leave placeholders to make checks pass. When you finish, run the project's checks and report the real result, including anything that still fails.",
  ].join("\n");
  return text.length > MAX_REDIRECT_CHARS ? text.slice(0, MAX_REDIRECT_CHARS - 1) + "…" : text;
}

const RANK: Record<Severity, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms).unref?.())]);
}

/* ------------------------------- supervisor -------------------------------- */

export interface TurnSupervisorOptions {
  store: Store;
  root: string;
  agentId: string;
  agentName: string;
  say?: (message: string) => void;
  onNotification?: (n: NotificationRow) => void;
  now?: () => number;
  /** How long the request that starts a turn may wait for the starting snapshot. */
  snapshotTimeoutMs?: number;
  /** For tests. */
  inspect?: typeof inspectSince;
  snapshot?: typeof takeSnapshot;
}

export class TurnSupervisor {
  private baseline: Snapshot | null = null;
  private turnKey = "";
  private turnTokens = 0;
  private budgetTripped = false;
  private lastGate = new Map<GateName, boolean>();
  private redirectsInARow = 0;
  private lastRedirectAt = 0;
  private checking: Promise<TurnOutcome | null> = Promise.resolve(null);

  constructor(private readonly o: TurnSupervisorOptions) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }
  private config() {
    return this.o.store.config().supervisor;
  }

  /** Called before the request that begins a turn is forwarded. Waits (briefly) for the starting snapshot. */
  async turnStarted(ev: TurnStart): Promise<void> {
    if (ev.key === this.turnKey) return; // the same request retried
    if (this.config().mode === "off") return;
    this.turnKey = ev.key;
    this.turnTokens = 0;
    this.budgetTripped = false;
    this.baseline = await withTimeout((this.o.snapshot ?? takeSnapshot)(this.o.root), this.o.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS);
    if (!this.baseline) this.o.say?.("ArgusOps could not take its starting snapshot in time, so it will not check this turn.");
  }

  /** Called when the agent hands back. Runs the checks in the background; the promise is for tests and callers that want the outcome. */
  turnEnded(ev: TurnEnd): Promise<TurnOutcome | null> {
    if (ev.key !== this.turnKey || !this.baseline) return Promise.resolve(null);
    const baseline = this.baseline;
    this.baseline = null; // one check per turn
    this.checking = this.check(baseline, ev).catch(() => null);
    return this.checking;
  }

  /** Resolves when no check is running (used before exiting, so a check is not cut off half-way). */
  async settle(timeoutMs = 60_000): Promise<void> {
    await withTimeout(this.checking, timeoutMs);
  }

  /** Token budget per turn. Returns a reason to pause the agent the first time the limit is passed. */
  usage(tokens: number): string | null {
    const max = this.config().maxTurnTokens;
    this.turnTokens += Math.max(0, tokens);
    if (max > 0 && !this.budgetTripped && this.turnTokens > max) {
      this.budgetTripped = true;
      return `Used ${this.turnTokens.toLocaleString("en-US")} tokens in one turn, over your limit of ${max.toLocaleString("en-US")}`;
    }
    return null;
  }

  private async check(baseline: Snapshot, ev: TurnEnd): Promise<TurnOutcome | null> {
    const cfg = this.config();
    if (cfg.mode === "off") return null;
    const report = await (this.o.inspect ?? inspectSince)(this.o.store, baseline, { runGates: true, now: this.o.now });
    if (report.changes.files.length === 0) return null; // a conversation, not a change: nothing to judge

    // claims versus evidence, and regressions against the last turn this supervisor saw
    const extra: Finding[] = assessClaims(ev.text, report.gates.results, ev.toolCalls);
    for (const r of report.gates.results ?? []) {
      if (!r.ok && this.lastGate.get(r.name) === true) {
        extra.push({ code: "regression", severity: "CRITICAL", title: `The ${r.name} check passed before this turn and fails now`, detail: `\`${r.command}\` worked after the previous turn; this turn broke it.`, evidence: r.outputTail.split("\n").slice(-3).map((l) => l.trim()).filter(Boolean), files: [] });
      }
      this.lastGate.set(r.name, r.ok);
    }
    report.findings = [...report.findings, ...extra].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    report.worst = worstSeverity(report.findings);

    const notable = report.findings.filter((f) => f.severity !== "INFO");
    if (notable.length === 0) {
      this.redirectsInARow = 0;
      return { report, action: "none" };
    }

    recordReport(this.o.store, report, this.o.onNotification, { agentId: this.o.agentId, agentName: this.o.agentName });
    this.o.say?.(`ArgusOps checked the last turn: ${notable.map((f) => f.title).join("; ")}.`);
    if (cfg.mode !== "redirect") return { report, action: "alert" };

    if (this.redirectsInARow >= cfg.maxRedirectsInARow) {
      const n = this.o.store.appendNotification({ title: `${this.o.agentName} needs you`, body: `ArgusOps redirected it ${this.redirectsInARow} times in a row and the problems remain, so it stopped redirecting.`, level: "CRITICAL", agentId: this.o.agentId });
      this.o.onNotification?.(n);
      this.o.say?.("ArgusOps stopped redirecting: the same kind of problems kept coming back. Please look yourself.");
      return { report, action: "held-back" };
    }
    if (this.lastRedirectAt && this.now() - this.lastRedirectAt < cfg.redirectCooldownMs) return { report, action: "held-back" };

    const redirect = redirectFor(notable);
    await this.o.store.setControl(this.o.agentId, { hint: redirect });
    this.redirectsInARow++;
    this.lastRedirectAt = this.now();
    this.o.say?.("ArgusOps will pass what needs fixing to the agent with your next message.");
    return { report, action: "redirect", redirect };
  }
}
