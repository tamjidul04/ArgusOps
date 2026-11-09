/** Integration tests: suggested instructions ("prompt rewrite") for stuck agents, against the real database. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { prisma } from "@/lib/prisma";
import { POST as syncPOST } from "@/app/api/cli/sync/route";
import { GET as rwGET, POST as rwPOST } from "@/app/api/rewrites/route";
import { createTestKit, requirePlansSeeded, type TestUser } from "./helpers";

const kit = createTestKit("rwt");
const { makeUser, withKey, withSession } = kit;

const unit = ['Bash({"command":"npm test","description":"run tests"})', "error: FAIL expected 200 got 500"];
const incident = (evidence: unknown = { unit, repeats: 3 }) => ({
  type: "incident",
  kind: "LOOP",
  loop_type: "EXACT_TOOL_LOOP",
  action: "PAUSED",
  score: 0.94,
  detail: "Repeated 3 times: Bash(npm test) -> error: FAIL",
  interception_ms: 1,
  ...(evidence === undefined ? {} : { evidence }),
});
const run = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ run: { id, agent: { name, type: "claude" }, ...extra } });
const sync = async (u: TestUser, body: unknown) => (await syncPOST(withKey(u, "/api/cli/sync", body))).json();

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  await requirePlansSeeded();
  alice = await makeUser("alice");
  bob = await makeUser("bob");
}, 60_000);

afterEach(() => {
  delete process.env.ARGUS_REWRITE_API_KEY;
  delete process.env.ARGUS_REWRITE_API_URL;
});

afterAll(async () => {
  await kit.cleanup();
  await prisma.$disconnect();
}, 60_000);

/** Starts an agent, records three real ~14k-token calls, then reports a loop. */
async function stuckAgent(u: TestUser, name: string, evidence?: unknown) {
  await sync(u, run(`r-${name}`, name, { start: true }));
  const usage = [13_000, 14_000, 15_000].map((n) => ({ type: "usage", model: "claude-sonnet-4-5", input_tokens: n, output_tokens: 0 }));
  await sync(u, { ...run(`r-${name}`, name), events: usage });
  const reply = await sync(u, { ...run(`r-${name}`, name), events: [incident(evidence)] });
  const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: u.id }, name } });
  return { reply, agent };
}

describe("suggested instruction on a loop", () => {
  it("writes a specific instruction with the real cost, keeps the agent paused, and says so in the notification", async () => {
    const { reply, agent } = await stuckAgent(alice, "Tester");
    expect(reply.desired).toBe("PAUSE");
    expect(agent.status).toBe("PAUSED_NUDGE");

    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { user_id: alice.id, agent_id: agent.agent_id } });
    expect(rw).toMatchObject({ status: "PROPOSED", source: "RULES", repeats: 3, auto_applied: false });
    expect(rw.rewritten_prompt).toContain("Stop re-running the command `npm test`");
    expect(rw.rewritten_prompt).toContain('"FAIL expected 200 got 500"');
    expect(rw.rationale).toContain("about 14,000 tokens"); // average of the agent's real calls
    expect(rw.tokens_before).toBe(42_000); // 3 repeats x 14k
    expect(rw.tokens_after).toBeGreaterThan(0);
    expect(rw.tokens_after).toBeLessThan(250);

    const note = await prisma.notification.findFirstOrThrow({ where: { user_id: alice.id, title: "Tester was paused" } });
    expect(note.body).toContain("A suggested instruction is ready");
  });

  it("the dashboard can fetch the open suggestion, but not someone else's", async () => {
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Tester" } });
    const mine = await (await rwGET(withSession(alice, `/api/rewrites?agentId=${agent.agent_id}`))).json();
    expect(mine.suggestion).toMatchObject({ status: "PROPOSED", tokensBefore: 42_000 });
    expect(mine.suggestion.text).toContain("npm test");
    const theirs = await (await rwGET(withSession(bob, `/api/rewrites?agentId=${agent.agent_id}`))).json();
    expect(theirs.suggestion).toBeNull();
  });

  it("approving an edited suggestion resumes the agent and the CLI receives that exact text once", async () => {
    const agent = await prisma.agent.findFirstOrThrow({ where: { cluster: { user_id: alice.id }, name: "Tester" } });
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id, status: "PROPOSED" } });

    expect((await rwPOST(withSession(bob, "/api/rewrites", { action: "apply", id: rw.id }))).status).toBe(404); // nor other users

    const edited = "Skip the flaky test, then run the build.";
    const res = await rwPOST(withSession(alice, "/api/rewrites", { action: "apply", id: rw.id, text: edited }));
    expect(res.status).toBe(200);

    const next = await sync(alice, run("r-Tester", "Tester"));
    expect(next).toMatchObject({ desired: "RUN", hint: edited });
    expect((await sync(alice, run("r-Tester", "Tester"))).hint).toBeUndefined();

    const after = await prisma.promptRewrite.findUniqueOrThrow({ where: { id: rw.id } });
    expect(after).toMatchObject({ status: "APPLIED", rewritten_prompt: edited });
    expect((await rwPOST(withSession(alice, "/api/rewrites", { action: "apply", id: rw.id }))).status).toBe(409);
  });

  it("dismissing keeps the agent paused; a newer loop replaces an older open suggestion", async () => {
    const { agent } = await stuckAgent(alice, "Dismisser");
    const first = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id, status: "PROPOSED" } });

    await sync(alice, { ...run("r-Dismisser", "Dismisser"), events: [incident({ unit: ['Read({"file_path":"a.ts"})'], repeats: 4 })] });
    expect((await prisma.promptRewrite.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SUPERSEDED");
    const second = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id, status: "PROPOSED" } });
    expect(second.rewritten_prompt).toContain("reading a.ts");

    const d = await rwPOST(withSession(alice, "/api/rewrites", { action: "dismiss", id: second.id }));
    expect(d.status).toBe(200);
    expect((await prisma.promptRewrite.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("REJECTED");
    expect((await prisma.agent.findUniqueOrThrow({ where: { agent_id: agent.agent_id } })).status).toBe("PAUSED_NUDGE");
  });

  it("works with an older CLI that only sends a summary", async () => {
    const { agent } = await stuckAgent(alice, "OldCli", undefined);
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id, status: "PROPOSED" } });
    expect(rw.rewritten_prompt.length).toBeGreaterThan(40);
  });
});

describe("auto-resume policy", () => {
  it("resumes the agent at once with the suggestion, then only once per 30 minutes", async () => {
    const carol = await makeUser("carol");
    await prisma.policy.update({ where: { user_id: carol.id }, data: { auto_apply_rewrites: true } });

    const { reply, agent } = await stuckAgent(carol, "Auto");
    expect(reply.desired).toBe("RUN"); // never paused
    expect(reply.hint).toContain("Stop re-running the command `npm test`");
    expect(agent.status).toBe("ACTIVE");
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id } });
    expect(rw).toMatchObject({ status: "APPLIED", auto_applied: true });
    expect(await prisma.notification.count({ where: { user_id: carol.id, title: "Auto was un-stuck automatically" } })).toBe(1);

    // a second loop within 30 minutes waits for a human
    const again = await sync(carol, { ...run("r-Auto", "Auto"), events: [incident()] });
    expect(again.desired).toBe("PAUSE");
    expect(await prisma.promptRewrite.count({ where: { agent_id: agent.agent_id, status: "PROPOSED" } })).toBe(1);
  });
});

describe("optional AI wording (server's own key)", () => {
  let fake: http.Server;
  let mode: "ok" | "fail" = "ok";
  let lastBody = "";
  let lastKey = "";

  beforeAll(async () => {
    fake = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        lastBody = Buffer.concat(parts).toString("utf8");
        lastKey = String(req.headers["x-api-key"] ?? "");
        if (mode === "fail") {
          res.writeHead(500);
          return res.end("{}");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: '"Stop running npm test. Fix the 500 in the handler first, then test once."' }] }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  });
  afterAll(() => fake.close());

  it("uses the polished text when configured, sending only the repeated steps", async () => {
    process.env.ARGUS_REWRITE_API_KEY = "server-own-key";
    process.env.ARGUS_REWRITE_API_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    mode = "ok";
    const dana = await makeUser("dana");
    const { agent } = await stuckAgent(dana, "Polished");
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id } });
    expect(rw.source).toBe("AI");
    expect(rw.rewritten_prompt).toBe("Stop running npm test. Fix the 500 in the handler first, then test once.");
    expect(lastKey).toBe("server-own-key");
    expect(lastBody).toContain("npm test");
    expect(lastBody).not.toContain("sk-ant"); // never the user's credentials
  });

  it("falls back to the rules version if the model fails", async () => {
    process.env.ARGUS_REWRITE_API_KEY = "server-own-key";
    process.env.ARGUS_REWRITE_API_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
    mode = "fail";
    const erin = await makeUser("erin");
    const { agent } = await stuckAgent(erin, "Fallback");
    const rw = await prisma.promptRewrite.findFirstOrThrow({ where: { agent_id: agent.agent_id } });
    expect(rw.source).toBe("RULES");
    expect(rw.rewritten_prompt).toContain("Stop re-running");
  });
});
