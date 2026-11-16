import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { anthropicAdapter } from "./adapters";
import { LoopDetector } from "./detect";
import { DEFAULT_PRICES } from "./prices";
import { costUsd } from "./pricing";
import { startProxy, type UsageOut } from "./proxy";
import { conversationKey, DEFAULT_ROUTING, pinKey, rewriteForModel, Router, scoreDifficulty, switchCost, type RouteDecision, type RouteHint, type RoutingConfig } from "./routing";
import { ControlState } from "./state";

const FABLE = "claude-fable-5-2";
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

const tools = [{ name: "Bash", input_schema: { type: "object" } }];
/** A main request (it carries tools) whose newest message is the human speaking: a turn starts. */
const turn = (text: string, model = FABLE, history: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  model,
  max_tokens: 32000,
  tools,
  messages: [...(history.length ? history : []), { role: "user", content: text }],
  ...extra,
});
/** A request in the middle of a turn: the newest message answers a tool call. */
const midTurn = (first: string, model = FABLE) => ({
  model,
  max_tokens: 32000,
  tools,
  messages: [
    { role: "user", content: first },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a.ts" }] },
  ],
});

describe("scoreDifficulty", () => {
  it("only calls clearly small work trivial or simple", () => {
    expect(scoreDifficulty("rename the variable foo to bar in utils.ts").level).toBe("trivial");
    expect(scoreDifficulty("Fix the typo in the README heading").level).toBe("trivial");
    expect(scoreDifficulty("explain what this function does").level).toBe("simple");
    expect(scoreDifficulty("add a test for the empty string case").level).toBe("simple");
  });

  it("keeps your model for anything that looks like real work", () => {
    expect(scoreDifficulty("refactor the auth module").level).toBe("hard");
    expect(scoreDifficulty("rename things across the codebase").level).toBe("hard");
    expect(scoreDifficulty("why does the login test fail?").level).toBe("hard");
    expect(scoreDifficulty("rename x\nTypeError: cannot read properties of undefined").level).toBe("hard");
    expect(scoreDifficulty("update a.ts, b.ts, c.py and d.go so they agree").level).toBe("hard");
    expect(scoreDifficulty("fix the bug").level).toBe("normal");
    expect(scoreDifficulty("rename this:\n```js\nconst a = 1\n```").level).toBe("normal");
    expect(scoreDifficulty("").level).toBe("normal");
    expect(scoreDifficulty(`rename ${"x".repeat(2000)}`).level).toBe("hard");
  });

  it("judges only what the person wrote, not the context the agent adds", () => {
    const ctx = `<system-reminder>
Context: ${"security plan refactor ".repeat(200)}
</system-reminder>`;
    expect(scoreDifficulty(`${ctx}
rename the variable foo to bar in a.js`).level).toBe("trivial");
    expect(scoreDifficulty(ctx).level).toBe("normal");
  });

  it("says why", () => {
    expect(scoreDifficulty("rename foo").reasons[0]).toContain("rename");
    expect(scoreDifficulty("design a cache").reasons[0]).toContain("design");
  });
});

describe("rewriteForModel", () => {
  it("changes the model and lowers (never raises) the effort", () => {
    const r = rewriteForModel({ model: FABLE, output_config: { effort: "xhigh", other: 1 } }, { model: SONNET, effort: "low" });
    expect(r).toEqual({ ok: true, body: { model: SONNET, output_config: { effort: "low", other: 1 } } });
    const keepLow = rewriteForModel({ model: FABLE, output_config: { effort: "low" } }, { model: SONNET, effort: "medium" });
    expect(keepLow.ok && keepLow.body.output_config).toEqual({ effort: "low" });
    const noEffort = rewriteForModel({ model: FABLE }, { model: SONNET });
    expect(noEffort.ok && noEffort.body.output_config).toBeUndefined();
  });

  it("does not modify the request it was given", () => {
    const body = { model: FABLE, thinking: { type: "enabled", budget_tokens: 4000 }, output_config: { effort: "high" } };
    const copy = JSON.parse(JSON.stringify(body));
    rewriteForModel(body, { model: SONNET, effort: "low" });
    expect(body).toEqual(copy);
  });

  it("translates thinking settings the target model would reject", () => {
    const t = (thinking: unknown, to: string, effort?: string) => {
      const r = rewriteForModel({ model: "claude-opus-4-6", thinking, ...(effort ? { output_config: { effort } } : {}) }, { model: to });
      return r.ok ? r.body.thinking : "skipped";
    };
    expect(t({ type: "enabled", budget_tokens: 8000 }, SONNET)).toEqual({ type: "adaptive" });
    expect(t({ type: "disabled" }, SONNET)).toEqual({ type: "between_tools" });
    expect(t({ type: "disabled" }, SONNET, "max")).toBeUndefined(); // between_tools is a 400 above high
    expect(t({ type: "disabled" }, OPUS)).toBeUndefined();
    expect(t({ type: "disabled" }, HAIKU)).toEqual({ type: "disabled" });
    expect(t({ type: "disabled" }, HAIKU, "xhigh")).toBeUndefined();
    expect(t({ type: "between_tools" }, HAIKU)).toBeUndefined();
    expect(t({ type: "adaptive", display: "updates" }, HAIKU)).toEqual({ type: "adaptive" });
    expect(t({ type: "adaptive", display: "summarized" }, SONNET)).toEqual({ type: "adaptive", display: "summarized" });
  });

  it("drops server-side fallbacks for a model that has none, keeps them where they exist", () => {
    const toHaiku = rewriteForModel({ model: SONNET, fallbacks: "default" }, { model: HAIKU });
    expect(toHaiku.ok && "fallbacks" in toHaiku.body).toBe(false);
    const toSonnet = rewriteForModel({ model: FABLE, fallbacks: "default" }, { model: SONNET });
    expect(toSonnet.ok && toSonnet.body.fallbacks).toBe("default");
  });

  it("refuses requests it cannot carry over safely", () => {
    expect(rewriteForModel({ model: FABLE, speed: "fast" }, { model: SONNET }).ok).toBe(false);
    expect(rewriteForModel({ model: "claude-opus-4-6", temperature: 0.2 }, { model: SONNET }).ok).toBe(false);
    expect(rewriteForModel({ model: FABLE, fallbacks: [{ model: "claude-opus-4-8" }] }, { model: SONNET }).ok).toBe(false);
    expect(rewriteForModel({ model: FABLE, tools: [{ type: "advisor_20260301", name: "advisor" }] }, { model: SONNET }).ok).toBe(false);
    expect(rewriteForModel({ model: HAIKU, tool_choice: { type: "any" } }, { model: SONNET }).ok).toBe(false);
    expect(rewriteForModel({ model: OPUS, tool_choice: { type: "tool", name: "x" } }, { model: HAIKU }).ok).toBe(true);
    expect(rewriteForModel({ model: FABLE, tool_choice: { type: "auto" } }, { model: SONNET }).ok).toBe(true);
  });
});

describe("switchCost", () => {
  it("weighs the one-time cache rebuild against what the turn saves", () => {
    const small = switchCost(20_000, FABLE, SONNET, DEFAULT_PRICES)!;
    expect(small.worth).toBe(true);
    expect(small.extraUsd).toBeGreaterThan(0);
    // a huge conversation costs more to move than one turn saves
    expect(switchCost(2_000_000, FABLE, SONNET, DEFAULT_PRICES)!.worth).toBe(false);
    // already on the cheap model: nothing to rebuild
    expect(switchCost(2_000_000, SONNET, SONNET, DEFAULT_PRICES, true)!.extraUsd).toBe(0);
    expect(switchCost(1000, "mystery-model", SONNET, DEFAULT_PRICES)).toBeNull();
    // nothing cached yet (a new session): the cheaper model also writes the cache for less, so moving is worth it
    const cold = switchCost(40_000, OPUS, SONNET, DEFAULT_PRICES, false, false)!;
    expect(cold.extraUsd).toBeLessThan(0);
    expect(cold.worth).toBe(true);
    expect(switchCost(200_000, OPUS, SONNET, DEFAULT_PRICES, false, true)!.worth).toBe(false); // a big conversation with Opus's cache warm stays
  });
});

describe("pricing", () => {
  it("knows the current Anthropic models and charges cache reads and writes", () => {
    expect(costUsd(OPUS, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, DEFAULT_PRICES)).toBe(24);
    expect(costUsd(SONNET, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, DEFAULT_PRICES)).toBeCloseTo(0.1, 6);
    expect(costUsd(FABLE, { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 }, DEFAULT_PRICES)).toBe(10);
    expect(costUsd(HAIKU, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, DEFAULT_PRICES)).toBeCloseTo(0.6, 6);
  });
});

/* --------------------------------------- the router --------------------------------------- */

function makeRouter(cfg: Partial<RoutingConfig> = {}, opts: { hint?: () => RouteHint | null; root?: string; now?: () => number } = {}) {
  const decisions: RouteDecision[] = [];
  let config: RoutingConfig = { ...DEFAULT_ROUTING, mode: "auto", ...cfg };
  const router = new Router({ provider: "anthropic", adapter: anthropicAdapter, config: () => config, prices: DEFAULT_PRICES, onDecision: (d) => decisions.push(d), ...opts });
  return { router, decisions, set: (c: Partial<RoutingConfig>) => (config = { ...config, ...c }) };
}

describe("Router", () => {
  it("auto: runs a simple turn on the cheaper model at lower effort, for every request of that turn", () => {
    const { router, decisions } = makeRouter();
    const first = router.route(turn("rename foo to bar"));
    expect(first).toMatchObject({ from: FABLE, to: SONNET });
    expect(first!.body).toMatchObject({ model: SONNET, output_config: { effort: "low" } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: "switch", from: FABLE, to: SONNET, effort: "low", difficulty: "trivial", applied: true });
    expect(decisions[0].message).toContain("instead of claude-fable-5-2");
    expect(decisions[0].estSavingUsd).toBeGreaterThan(0);
    // the rest of the turn follows, without another decision
    expect(router.route(midTurn("rename foo to bar"))).toMatchObject({ to: SONNET });
    expect(decisions).toHaveLength(1);
  });

  it("leaves real work, side requests and unknown models alone", () => {
    const { router, decisions } = makeRouter();
    expect(router.route(turn("refactor the payment service"))).toBeNull();
    expect(router.route({ model: FABLE, messages: [{ role: "user", content: "rename foo" }] })).toBeNull(); // no tools: a side request
    expect(router.route(turn("rename foo", "some-other-model"))).toBeNull();
    expect(router.route(turn("rename foo", "claude-fable-5-2[1m]"))).toBeNull();
    expect(router.route(turn("rename foo", HAIKU))).toBeNull(); // the target is not cheaper: never route up
    expect(decisions).toHaveLength(0);
  });

  it("a conversation first seen mid-turn is left alone until its next turn", () => {
    const { router } = makeRouter();
    expect(router.route(midTurn("rename foo"))).toBeNull();
  });

  it("goes back to your model when the next turn needs it", () => {
    const { router, decisions } = makeRouter();
    const h1 = [{ role: "user", content: "rename foo" }, { role: "assistant", content: "Done." }];
    expect(router.route(turn("rename foo"))).not.toBeNull();
    // same conversation (same first message), a harder turn
    const next = { model: FABLE, max_tokens: 100, tools, messages: [...h1, { role: "user", content: "now debug why the cache test fails" }] };
    expect(router.route(next)).toBeNull();
    expect(decisions.map((d) => d.kind)).toEqual(["switch", "revert"]);
  });

  it("keeps separate conversations (a sub-agent) apart", () => {
    const { router } = makeRouter();
    expect(router.route(turn("rename foo"))).not.toBeNull();
    expect(router.route(turn("design the new storage layer"))).toBeNull();
    expect(router.route(midTurn("rename foo"))).toMatchObject({ to: SONNET });
    expect(router.route(midTurn("design the new storage layer"))).toBeNull();
    expect(conversationKey(turn("a"))).not.toBe(conversationKey(turn("b")));
  });

  it("suggest: changes nothing, and says what it would do once per conversation, not more than every 10 minutes", () => {
    let t = 0;
    const { router, decisions } = makeRouter({ mode: "suggest" }, { now: () => t });
    expect(router.route(turn("rename foo"))).toBeNull();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: "suggest", to: SONNET, applied: false });
    expect(decisions[0].message).toContain("argus route auto");
    router.route(turn("fix the typo in b"));
    expect(decisions).toHaveLength(1); // too soon
    t += 11 * 60_000;
    router.route(turn("fix the typo in c"));
    expect(decisions).toHaveLength(2);
  });

  it("off: does nothing", () => {
    const { router, decisions } = makeRouter({ mode: "off" });
    expect(router.route(turn("rename foo"))).toBeNull();
    expect(decisions).toHaveLength(0);
  });

  it("escalates one tier when the cheaper model struggles, then back to your model, never past it", () => {
    const { router, decisions } = makeRouter();
    const body = turn("rename foo");
    expect(router.route(body)).toMatchObject({ to: SONNET });
    router.struggled("repeated the same step", body);
    const up = router.route(midTurn("rename foo"));
    expect(up).toMatchObject({ to: OPUS });
    expect((up!.body.output_config as { effort?: string } | undefined)?.effort).toBeUndefined(); // escalated tiers keep your effort
    router.struggled("repeated the same step", body);
    expect(router.route(midTurn("rename foo"))).toBeNull(); // back on Fable, the model you chose
    expect(decisions.map((d) => [d.kind, d.to])).toEqual([["switch", SONNET], ["escalate", OPUS], ["escalate", FABLE]]);
    router.struggled("again", body);
    expect(decisions).toHaveLength(3); // nothing above your model
  });

  it("a failed turn moves the next turn up; a clean turn lets it come back down", () => {
    const { router } = makeRouter();
    const h = [{ role: "user", content: "rename foo" }, { role: "assistant", content: "Done." }];
    router.route(turn("rename foo"));
    router.turnOutcome(false);
    expect(router.route({ ...turn("fix the typo too", FABLE), messages: [...h, { role: "user", content: "fix the typo too" }] })).toMatchObject({ to: OPUS });
    router.turnOutcome(true);
    const h2 = [...h, { role: "user", content: "fix the typo too" }, { role: "assistant", content: "Done." }];
    expect(router.route({ ...turn("x"), messages: [...h2, { role: "user", content: "rename bar" }] })).toMatchObject({ to: SONNET });
  });

  it("Autopilot's hint decides the difficulty and the escalation", () => {
    let hint: RouteHint | null = { difficulty: "simple" };
    const { router, decisions } = makeRouter({}, { hint: () => hint });
    expect(router.route(turn("Step 1: build the whole thing with tests"))).toMatchObject({ to: SONNET });
    hint = { difficulty: "simple", escalate: 1 };
    const h = [{ role: "user", content: "Step 1: build the whole thing with tests" }, { role: "assistant", content: "Done." }];
    expect(router.route({ ...turn("x"), messages: [...h, { role: "user", content: "The step is not done yet." }] })).toMatchObject({ to: OPUS });
    expect(decisions.at(-1)).toMatchObject({ kind: "escalate", to: OPUS });
    expect(decisions.at(-1)!.message).toContain("did not get this done");
    hint = { difficulty: "hard" };
    const h2 = [...h, { role: "user", content: "The step is not done yet." }, { role: "assistant", content: "Done." }];
    expect(router.route({ ...turn("x"), messages: [...h2, { role: "user", content: "Step 2" }] })).toBeNull();
  });

  it("a pin always wins: a fixed model, or keep", () => {
    const root = process.cwd();
    const { router, decisions, set } = makeRouter({ pins: { [pinKey(root)]: OPUS } }, { root });
    expect(router.route(turn("refactor everything"))).toMatchObject({ to: OPUS });
    expect(decisions[0]).toMatchObject({ kind: "pin", to: OPUS });
    set({ pins: { "*": "keep" } });
    expect(router.route(turn("rename foo"))).toBeNull();
  });

  it("does not switch when moving a big, cached conversation costs more than the turn saves", () => {
    const { router } = makeRouter();
    expect(router.route(turn("refactor the parser"))).toBeNull(); // Fable was just used, so its cache is warm
    const huge = [{ role: "user", content: "start" }, { role: "assistant", content: "x".repeat(8_000_000) }];
    expect(router.route(turn("rename foo", FABLE, huge))).toBeNull();
  });

  it("switches a new session even when its prompt is big, if nothing is cached yet", () => {
    const { router } = makeRouter({ targets: { trivial: { model: SONNET, effort: "low" }, simple: null } });
    const big = [{ role: "user", content: "start" }, { role: "assistant", content: "x".repeat(160_000) }];
    expect(router.route(turn("rename foo", OPUS, big))).toMatchObject({ to: SONNET });
  });

  it("after the provider rejects a switch, never makes that switch again", () => {
    const { router, decisions } = makeRouter();
    expect(router.route(turn("rename foo"))).not.toBeNull();
    router.failed(FABLE, SONNET, 400, "invalid_request_error: something");
    expect(router.route(midTurn("rename foo"))).toBeNull();
    expect(router.route(turn("rename bar"))).toBeNull();
    expect(decisions.at(-1)).toMatchObject({ kind: "error", applied: false });
    expect(decisions.at(-1)!.message).toContain("HTTP 400");
  });

  it("only routes the Anthropic format for now", () => {
    const decisions: RouteDecision[] = [];
    const r = new Router({ provider: "openai", adapter: anthropicAdapter, config: () => ({ ...DEFAULT_ROUTING, mode: "auto" }), prices: DEFAULT_PRICES, onDecision: (d) => decisions.push(d) });
    expect(r.route(turn("rename foo"))).toBeNull();
  });
});

/* ------------------------------------ through the proxy ------------------------------------ */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function upstream(respond: (body: Record<string, unknown>, res: http.ServerResponse) => void) {
  const seen: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      seen.push(body);
      respond(body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { seen, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

const reply = (res: http.ServerResponse, model: string) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model, stop_reason: "end_turn", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 0 } }));
};

async function proxyWith(router: Router, up: string) {
  const usage: UsageOut[] = [];
  const state = new ControlState();
  const p = await startProxy({ provider: "anthropic", upstream: up, state, detector: new LoopDetector(), onUsage: (u) => usage.push(u), onIncident: () => undefined, router });
  closers.push(p.close);
  return { usage, state, base: `http://127.0.0.1:${p.port}` };
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("routing through the proxy", () => {
  it("sends the turn to the cheaper model and records which model the agent asked for", async () => {
    const up = await upstream((b, res) => reply(res, String(b.model)));
    const { router } = makeRouter();
    const p = await proxyWith(router, up.url);
    const r = await post(`${p.base}/v1/messages`, turn("rename foo to bar"));
    expect(r.status).toBe(200);
    expect((await r.json()).model).toBe(SONNET);
    expect(up.seen[0]).toMatchObject({ model: SONNET, output_config: { effort: "low" } });
    expect(p.usage[0]).toMatchObject({ model: SONNET, routed_from: FABLE, cache_write_tokens: 200 });
  });

  it("if the cheaper model rejects the request, sends the agent's own request instead and stops routing that pair", async () => {
    const up = await upstream((b, res) => {
      if (b.model === SONNET) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "nope" } }));
      } else reply(res, String(b.model));
    });
    const { router, decisions } = makeRouter();
    const p = await proxyWith(router, up.url);
    const r = await post(`${p.base}/v1/messages`, turn("rename foo to bar"));
    expect(r.status).toBe(200); // the agent never sees the failure
    expect((await r.json()).model).toBe(FABLE);
    expect(up.seen.map((b) => b.model)).toEqual([SONNET, FABLE]);
    expect(up.seen[1]).toEqual(turn("rename foo to bar")); // byte-for-byte the agent's request
    expect(p.usage).toHaveLength(1);
    expect(p.usage[0].routed_from).toBeUndefined();
    expect(decisions.at(-1)).toMatchObject({ kind: "error" });
    await post(`${p.base}/v1/messages`, midTurn("rename foo to bar"));
    expect(up.seen.at(-1)!.model).toBe(FABLE);
  });

  it("a loop caught in a routed conversation moves it up a tier", async () => {
    const up = await upstream((b, res) => reply(res, String(b.model)));
    const { router } = makeRouter();
    const p = await proxyWith(router, up.url);
    await post(`${p.base}/v1/messages`, turn("rename foo"));
    expect(up.seen[0].model).toBe(SONNET);
    // the same failing call over and over, in that conversation
    const msgs: unknown[] = [{ role: "user", content: "rename foo" }];
    for (let i = 0; i < 4; i++) msgs.push({ role: "assistant", content: [{ type: "tool_use", id: `c${i}`, name: "Bash", input: { command: "npm test" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: `c${i}`, is_error: true, content: "FAIL" }] });
    const stuck = { model: FABLE, max_tokens: 100, tools, messages: msgs };
    const held = post(`${p.base}/v1/messages`, stuck); // held: the loop detector paused the agent
    await new Promise((r) => setTimeout(r, 150));
    expect(up.seen).toHaveLength(1);
    expect(p.state.desired).toBe("PAUSE");
    p.state.apply({ desired: "RUN", reason: "" }); // you resume it
    expect((await held).status).toBe(200);
    expect(up.seen[1].model).toBe(OPUS); // the next tier up, not the cheap model that got stuck
  });
});
