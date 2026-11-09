import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import * as vscode from "vscode";
import { activate, type ArgusController } from "./extension";
import type { AgentView } from "./model";
import { mock, resetMock } from "../test/vscode-mock";

/* ------------------------------- fake server ------------------------------- */

const GOOD_KEYS = new Set(["argus_live_testkey", "argus_live_fromdevice"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = {
  http: undefined as unknown as http.Server,
  url: "",
  agents: [] as AgentView[],
  calls: [] as Array<{ method: string; path: string; key: string | undefined; body: Record<string, unknown> }>,
  down: false,
  polls: 0,
};

function agent(id: string, name: string, status: string, extra: Partial<AgentView> = {}): AgentView {
  return { id, name, type: "CLAUDE", status, tokensUsed: 12_345, currentTask: null, lastSeen: new Date().toISOString(), suggestion: null, ...extra };
}
const withSuggestion = (id = "rw1", text = "Stop re-running `npm test`; read the error first.") => ({ id, text, observed: "Ran npm test 3 times and it failed each time.", tokensBefore: 42_000, source: "RULES" });

beforeEach(async () => {
  resetMock();
  server.agents = [];
  server.calls = [];
  server.down = false;
  server.polls = 0;
  server.http = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
      } catch {
        /* ignore */
      }
      const key = req.headers["x-argus-key"] as string | undefined;
      const path = req.url ?? "";
      server.calls.push({ method: req.method ?? "", path, key, body });
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (server.down) return json(503, { error: "down" });

      if (path === "/api/device/code") {
        return json(200, { device_code: "dc1", user_code: "ABCD-EFGH", verification_uri: `${server.url}/device`, verification_uri_complete: `${server.url}/device?code=ABCD-EFGH`, expires_in: 5, interval: 0.05 });
      }
      if (path === "/api/device/token") {
        server.polls++;
        return server.polls < 3 ? json(400, { error: "authorization_pending" }) : json(200, { access_token: "argus_live_fromdevice", user: { email: "dev@example.com", name: "Dev" } });
      }
      if (!key || !GOOD_KEYS.has(key)) return json(401, { error: "Authentication required." });
      if (path === "/api/agents") {
        return json(200, { user: { name: "Dev", email: "dev@example.com" }, plan: { name: "Free", maxAgents: 2, tokensRemaining: 180_000 }, unreadNotifications: 0, agents: server.agents });
      }
      if (path === "/api/guardrails") return json(200, { success: true, message: body.action === "TRIGGER_KILL_SWITCH" ? "Agent was marked stopped." : "Agent will resume." });
      if (path === "/api/rewrites") return json(200, { success: true, message: body.action === "apply" ? "Agent will resume with this instruction." : "Dismissed." });
      return json(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.http.listen(0, "127.0.0.1", () => r()));
  server.url = `http://127.0.0.1:${(server.http.address() as { port: number }).port}`;
  mock.config = { serverUrl: server.url, pollIntervalSeconds: 60, notifications: true };
});

afterEach(async () => {
  for (const d of disposables) d.dispose();
  disposables.length = 0;
  server.http.closeAllConnections?.();
  await new Promise<void>((r) => server.http.close(() => r()));
});

/* -------------------------------- harness --------------------------------- */

const disposables: Array<{ dispose(): void }> = [];
const secrets = new Map<string, string>();

async function boot(opts: { signedIn?: boolean } = {}): Promise<ArgusController> {
  secrets.clear();
  if (opts.signedIn) secrets.set("argusops.credentials", JSON.stringify({ url: server.url, key: "argus_live_testkey" }));
  const context = {
    subscriptions: disposables,
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => void secrets.set(k, v),
      delete: async (k: string) => void secrets.delete(k),
    },
  } as unknown as vscode.ExtensionContext;
  const c = activate(context) as ArgusController;
  await sleep(150); // let the first refresh finish
  return c;
}

const children = (c: ArgusController, el?: unknown) => c.getChildren(el as never);
const item = (c: ArgusController, node: unknown) => c.getTreeItem(node as never) as unknown as Record<string, unknown> & { label: string };
const bar = () => mock.statusBars[0] as { text: string; tooltip: string; backgroundColor?: { id: string } };
const refresh = async () => {
  await mock.commands.get("argusops.refresh")!();
};
const tick = () => sleep(80);

/* --------------------------------- tests ---------------------------------- */

describe("signed out", () => {
  it("shows an empty tree and a sign-in status bar", async () => {
    const c = await boot();
    expect(c.signedIn).toBe(false);
    expect(children(c)).toEqual([]);
    expect(bar().text).toContain("sign in");
    expect(mock.contexts["argusops.signedIn"]).toBe(false);
    expect(server.calls).toHaveLength(0); // nothing is sent without credentials
  });

  it("registers all its commands", async () => {
    await boot();
    for (const id of ["signIn", "signOut", "refresh", "resumeAgent", "stopAgent", "openDashboard", "showAgents"]) expect(mock.commands.has(`argusops.${id}`), id).toBe(true);
  });
});

describe("signing in", () => {
  it("with a key: validates it, stores it for this server only, and loads agents", async () => {
    server.agents = [agent("a1", "Claude Code · app", "ACTIVE")];
    const c = await boot();
    mock.quickPick = (items) => (items as Array<{ id: string }>).find((i) => i.id === "key");
    mock.inputs = ["argus_live_testkey"];
    await mock.commands.get("argusops.signIn")!();
    await tick();

    expect(c.signedIn).toBe(true);
    expect(JSON.parse(secrets.get("argusops.credentials")!)).toEqual({ url: server.url, key: "argus_live_testkey" });
    expect(children(c)).toHaveLength(1);
    expect(mock.shown.some((m) => m.level === "info" && m.text.includes("dev@example.com"))).toBe(true);
    expect(mock.inputOptions[0].password).toBe(true);
    expect((mock.inputOptions[0].validateInput as (v: string) => string | undefined)("nope")).toContain("argus_live_");
  });

  it("rejects a bad key without storing anything", async () => {
    const c = await boot();
    mock.quickPick = (items) => (items as Array<{ id: string }>).find((i) => i.id === "key");
    mock.inputs = ["argus_live_wrong"];
    await mock.commands.get("argusops.signIn")!();
    expect(c.signedIn).toBe(false);
    expect(secrets.size).toBe(0);
    expect(mock.shown.some((m) => m.level === "error" && m.text.includes("isn't valid"))).toBe(true);
  });

  it("with the browser: opens the approval page, waits for approval, then stores the key", async () => {
    server.agents = [agent("a1", "Claude Code · app", "ACTIVE")];
    const c = await boot();
    mock.quickPick = (items) => (items as Array<{ id: string }>).find((i) => i.id === "browser");
    await mock.commands.get("argusops.signIn")!();
    await tick();

    expect(mock.opened).toEqual([`${server.url}/device?code=ABCD-EFGH`]);
    expect(mock.progressTitles[0]).toContain("ABCD-EFGH");
    expect(server.polls).toBe(3); // two "pending" answers, then approved
    expect(c.signedIn).toBe(true);
    expect(JSON.parse(secrets.get("argusops.credentials")!)).toEqual({ url: server.url, key: "argus_live_fromdevice" });
    expect(children(c)).toHaveLength(1);
  });

  it("says so when the server can't be reached", async () => {
    await boot();
    server.down = true;
    mock.quickPick = (items) => (items as Array<{ id: string }>).find((i) => i.id === "browser");
    await mock.commands.get("argusops.signIn")!();
    expect(mock.shown.some((m) => m.level === "error" && m.text.includes("couldn't reach"))).toBe(true);
    expect(mock.opened).toHaveLength(0);
  });

  it("signing out forgets the key", async () => {
    const c = await boot({ signedIn: true });
    expect(c.signedIn).toBe(true);
    await mock.commands.get("argusops.signOut")!();
    expect(c.signedIn).toBe(false);
    expect(secrets.size).toBe(0);
    expect(children(c)).toEqual([]);
  });
});

describe("the agents view", () => {
  it("lists paused agents first, expands them, and explains why with the suggestion", async () => {
    server.agents = [
      agent("r", "Runner", "ACTIVE"),
      agent("p", "Looper", "PAUSED_NUDGE", { currentTask: "Repeated 3 times: Bash(npm test)", suggestion: withSuggestion() }),
      agent("s", "Done", "KILLED_LOOP"),
    ];
    const c = await boot({ signedIn: true });
    const roots = children(c);
    expect(roots.map((n) => (n as { agent: AgentView }).agent.name)).toEqual(["Looper", "Runner", "Done"]);

    const looper = item(c, roots[0]);
    expect(looper).toMatchObject({ label: "Looper", description: "Paused", contextValue: "agent.paused", collapsibleState: 2 });
    expect(item(c, roots[1])).toMatchObject({ description: "Running", contextValue: "agent.running", collapsibleState: 1 });
    expect(item(c, roots[2])).toMatchObject({ description: "Stopped", contextValue: "agent.stopped" });

    const kids = children(c, roots[0]);
    expect(kids.map((k) => item(c, k).label)).toEqual(["Suggested instruction", "Why", "Tokens used", "Last seen"]);
    const sug = item(c, kids[0]);
    expect(sug.contextValue).toBe("suggestion");
    expect(String(sug.description)).toContain("Stop re-running");
    expect((sug.command as { command: string }).command).toBe("argusops.resumeAgent");
    expect(item(c, kids[2]).description).toBe("12.3K");
    expect(children(c, kids[0])).toEqual([]); // leaves have no children
  });

  it("shows the plan and tokens left next to the view title", async () => {
    await boot({ signedIn: true });
    expect(mock.treeViews[0].description).toBe("Free · 180K tokens left");
  });

  it("tells the sidebar when there are no agents", async () => {
    await boot({ signedIn: true });
    expect(mock.contexts["argusops.noAgents"]).toBe(true);
    expect(mock.contexts["argusops.signedIn"]).toBe(true);
  });
});

describe("status bar", () => {
  it("turns amber when an agent is paused and calm when none is", async () => {
    server.agents = [agent("r", "Runner", "ACTIVE")];
    await boot({ signedIn: true });
    expect(bar().text).toBe("$(shield) ArgusOps: 1 running");
    expect(bar().backgroundColor).toBeUndefined();

    server.agents = [agent("r", "Runner", "ACTIVE"), agent("p", "Looper", "PAUSED_NUDGE")];
    await refresh();
    expect(bar().text).toBe("$(warning) ArgusOps: 1 paused");
    expect(bar().backgroundColor?.id).toBe("statusBarItem.warningBackground");
  });

  it("shows offline when the server stops answering, and keeps the last agents", async () => {
    server.agents = [agent("r", "Runner", "ACTIVE")];
    const c = await boot({ signedIn: true });
    server.down = true;
    await refresh();
    expect(bar().text).toContain("offline");
    expect(children(c)).toHaveLength(1);
    server.down = false;
    await refresh();
    expect(bar().text).toContain("1 running");
  });
});

describe("alerts", () => {
  it("alerts once when an agent becomes paused, with the suggestion, and Approve sends it as written", async () => {
    server.agents = [agent("p", "Looper", "ACTIVE")];
    await boot({ signedIn: true });
    expect(mock.shown).toHaveLength(0);

    server.agents = [agent("p", "Looper", "PAUSED_NUDGE", { currentTask: "Repeated 3 times: Bash(npm test)", suggestion: withSuggestion() })];
    mock.respond = (_t, items) => (items.includes("Approve suggestion") ? "Approve suggestion" : undefined);
    await refresh();
    await tick();

    const alert = mock.shown.find((m) => m.level === "warn")!;
    expect(alert.text).toContain("Looper was paused");
    expect(alert.text).toContain("Suggested next step");
    expect(alert.items).toEqual(["Approve suggestion", "Edit…", "Stop"]);
    const apply = server.calls.find((c) => c.path === "/api/rewrites")!;
    expect(apply.body).toMatchObject({ action: "apply", id: "rw1" });
    expect(apply.key).toBe("argus_live_testkey");

    // polling again while it is still paused does not repeat the alert
    const before = mock.shown.length;
    await refresh();
    expect(mock.shown.filter((m) => m.level === "warn").length).toBe(before - mock.shown.filter((m) => m.level !== "warn").length);
  });

  it("without a suggestion it offers Resume…, Review and Stop", async () => {
    server.agents = [agent("p", "Looper", "ACTIVE")];
    await boot({ signedIn: true });
    server.agents = [agent("p", "Looper", "PAUSED_NUDGE")];
    await refresh();
    expect(mock.shown.find((m) => m.level === "warn")!.items).toEqual(["Resume…", "Review", "Stop"]);
  });

  it("on startup, one summary for agents already waiting; old stops are not announced", async () => {
    server.agents = [agent("p", "Looper", "PAUSED_NUDGE"), agent("s", "Old", "KILLED_LOOP")];
    await boot({ signedIn: true });
    const warns = mock.shown.filter((m) => m.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].text).toBe("1 agent is waiting for you in ArgusOps.");
    expect(mock.shown.some((m) => m.level === "info")).toBe(false);
  });

  it("announces a stop it watched happen", async () => {
    server.agents = [agent("p", "Looper", "PAUSED_NUDGE")];
    await boot({ signedIn: true });
    mock.shown = [];
    server.agents = [agent("p", "Looper", "KILLED_LOOP")];
    await refresh();
    expect(mock.shown).toEqual([expect.objectContaining({ level: "info", text: "Looper was stopped." })]);
  });

  it("stays quiet when notifications are turned off", async () => {
    mock.config.notifications = false;
    server.agents = [agent("p", "Looper", "ACTIVE")];
    await boot({ signedIn: true });
    server.agents = [agent("p", "Looper", "PAUSED_NUDGE")];
    await refresh();
    expect(mock.shown).toHaveLength(0);
    expect(bar().text).toContain("1 paused"); // the status bar still tells the truth
  });
});

describe("resuming and stopping", () => {
  const paused = (extra: Partial<AgentView> = {}) => agent("p", "Looper", "PAUSED_NUDGE", { currentTask: "stuck", ...extra });

  it("resume with a suggestion: prefilled, editable, sends the edited text", async () => {
    server.agents = [paused({ suggestion: withSuggestion() })];
    const c = await boot({ signedIn: true });
    mock.inputs = ["Skip the flaky test and run the build."];
    await mock.commands.get("argusops.resumeAgent")!(children(c)[0]);
    expect(mock.inputOptions[0].value).toContain("Stop re-running");
    const apply = server.calls.find((x) => x.path === "/api/rewrites")!;
    expect(apply.body).toEqual({ action: "apply", id: "rw1", text: "Skip the flaky test and run the build." });
    expect(mock.shown.some((m) => m.level === "info" && m.text.includes("resume"))).toBe(true);
  });

  it("cancelling the box sends nothing", async () => {
    server.agents = [paused({ suggestion: withSuggestion() })];
    const c = await boot({ signedIn: true });
    mock.inputs = [undefined];
    await mock.commands.get("argusops.resumeAgent")!(children(c)[0]);
    expect(server.calls.some((x) => x.path === "/api/rewrites")).toBe(false);
  });

  it("resume without a suggestion: optional hint; empty means just resume", async () => {
    server.agents = [paused()];
    const c = await boot({ signedIn: true });
    mock.inputs = ["  Use pnpm.  "];
    await mock.commands.get("argusops.resumeAgent")!(children(c)[0]);
    expect(server.calls.find((x) => x.path === "/api/guardrails")!.body).toEqual({ action: "SEND_NUDGE", agentId: "p", hintText: "Use pnpm." });

    server.calls = [];
    mock.inputs = [""];
    await mock.commands.get("argusops.resumeAgent")!(children(c)[0]);
    expect(server.calls.find((x) => x.path === "/api/guardrails")!.body).toEqual({ action: "SEND_NUDGE", agentId: "p" });
  });

  it("stop asks for confirmation first, and only then stops", async () => {
    server.agents = [paused()];
    const c = await boot({ signedIn: true });

    mock.respond = () => undefined; // dismissed
    await mock.commands.get("argusops.stopAgent")!(children(c)[0]);
    expect(mock.shown.find((m) => m.modal)!.text).toContain("Stop Looper?");
    expect(server.calls.some((x) => x.path === "/api/guardrails")).toBe(false);

    mock.respond = (_t, items) => (items.includes("Stop agent") ? "Stop agent" : undefined);
    await mock.commands.get("argusops.stopAgent")!(children(c)[0]);
    expect(server.calls.find((x) => x.path === "/api/guardrails")!.body).toEqual({ action: "TRIGGER_KILL_SWITCH", agentId: "p" });
  });

  it("from the command palette it picks the agent: automatically if there is one, by menu if several", async () => {
    server.agents = [paused(), agent("r", "Runner", "ACTIVE")];
    await boot({ signedIn: true });
    mock.inputs = [""];
    await mock.commands.get("argusops.resumeAgent")!(); // only one paused: no menu
    expect(mock.quickPickItems).toHaveLength(0);
    expect(server.calls.find((x) => x.path === "/api/guardrails")!.body.agentId).toBe("p");

    server.agents = [paused(), agent("q", "Second", "PAUSED_NUDGE")];
    await refresh();
    mock.quickPick = (items) => (items as Array<{ label: string }>).find((i) => i.label === "Second");
    mock.inputs = [""];
    await mock.commands.get("argusops.resumeAgent")!();
    expect(mock.quickPickItems).toHaveLength(1);
    expect(server.calls.filter((x) => x.path === "/api/guardrails").pop()!.body.agentId).toBe("q");
  });

  it("explains a failure in plain words and keeps working", async () => {
    server.agents = [paused()];
    const c = await boot({ signedIn: true });
    mock.inputs = [""];
    server.down = true;
    await mock.commands.get("argusops.resumeAgent")!(children(c)[0]);
    expect(mock.shown.some((m) => m.level === "error" && m.text.startsWith("ArgusOps:"))).toBe(true);
  });

  it("tells you when there is nothing to act on", async () => {
    await boot({ signedIn: true });
    await mock.commands.get("argusops.stopAgent")!();
    expect(mock.shown.some((m) => m.level === "info" && m.text.includes("No agents"))).toBe(true);
  });

  it("asks you to sign in if you try without being signed in", async () => {
    await boot();
    mock.quickPick = () => undefined;
    await mock.commands.get("argusops.resumeAgent")!();
    expect(mock.quickPickItems).toHaveLength(1); // the sign-in menu
  });
});

describe("credential safety", () => {
  it("a key is never sent to a different server than the one that issued it", async () => {
    secrets.set("argusops.credentials", JSON.stringify({ url: "http://other.example.com", key: "argus_live_testkey" }));
    const c = await boot();
    secrets.set("argusops.credentials", JSON.stringify({ url: "http://other.example.com", key: "argus_live_testkey" }));
    await refresh();
    expect(c.signedIn).toBe(false);
    expect(server.calls.some((x) => x.key === "argus_live_testkey")).toBe(false);
  });

  it("a revoked key signs you out and offers to sign in again", async () => {
    server.agents = [agent("r", "Runner", "ACTIVE")];
    const c = await boot({ signedIn: true });
    GOOD_KEYS.delete("argus_live_testkey");
    try {
      await refresh();
    } finally {
      GOOD_KEYS.add("argus_live_testkey");
    }
    expect(c.signedIn).toBe(false);
    expect(secrets.size).toBe(0);
    expect(mock.shown.some((m) => m.level === "warn" && m.text.includes("no longer valid") && m.items.includes("Sign in"))).toBe(true);
  });

  it("the dashboard link uses the configured server", async () => {
    await boot({ signedIn: true });
    await mock.commands.get("argusops.openDashboard")!();
    expect(mock.opened).toEqual([`${server.url}/dashboard/guardrails`]);
  });

  it("falls back to the default server if the setting is not a safe URL", async () => {
    mock.config.serverUrl = "javascript:alert(1)";
    await boot();
    await mock.commands.get("argusops.openDashboard")!();
    expect(mock.opened).toEqual(["http://localhost:3000/dashboard/guardrails"]);
  });
});
