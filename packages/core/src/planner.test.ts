import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeCheck, runCheck, runChecks } from "./acceptance";
import { askQuestions, claudePlanner, extractJson, makePlan, planPrompt, projectContext, safeRelativePath, validatePlan, validateQuestions } from "./planner";

const FAKE = path.join(__dirname, "fixtures", "fake-claude.mjs");
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-plan-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const goodPlan = {
  summary: "A tiny CLI",
  steps: [
    { title: "Create the module", instructions: "Write add.js exporting add(a, b).", acceptance: [{ type: "file-exists", path: "add.js" }, { type: "command", command: "node -e \"require('./add')\"" }] },
    { title: "Add tests", instructions: "Write add.test.js and a test script.", acceptance: [{ type: "file-contains", path: "add.test.js", text: "add(" }] },
  ],
};

describe("extractJson", () => {
  it("finds JSON bare, fenced, or with words around it", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here is the plan:\n```json\n{"a": {"b": "}"}}\n```\nGood luck!')).toEqual({ a: { b: "}" } });
    expect(extractJson('Sure! {"questions": []} Let me know.')).toEqual({ questions: [] });
  });
  it("returns null when there is none", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
});

describe("validatePlan", () => {
  it("accepts a good plan and numbers its steps", () => {
    const r = validatePlan(goodPlan);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.steps.map((s) => s.id)).toEqual(["step-1", "step-2"]);
    expect(r.plan.steps[0].acceptance).toHaveLength(2);
  });
  it("keeps a valid step size and drops anything else", () => {
    const r = validatePlan({ steps: [{ title: "a", instructions: "x", size: "small" }, { title: "b", instructions: "y", size: "huge" }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.steps[0].size).toBe("small");
    expect("size" in r.plan.steps[1]).toBe(false);
  });
  it("rejects plans with no steps, too many steps, or steps without instructions", () => {
    expect(validatePlan({ steps: [] }).ok).toBe(false);
    expect(validatePlan({ steps: Array.from({ length: 13 }, (_, i) => ({ title: `s${i}`, instructions: "x" })) }).ok).toBe(false);
    expect(validatePlan({ steps: [{ title: "x" }] }).ok).toBe(false);
    expect(validatePlan("nope").ok).toBe(false);
  });
  it("drops unsafe or malformed checks instead of trusting them", () => {
    const r = validatePlan({
      steps: [
        {
          title: "t",
          instructions: "i",
          acceptance: [
            { type: "file-exists", path: "../../etc/passwd" },
            { type: "file-exists", path: "C:\\Windows\\system.ini" },
            { type: "file-contains", path: "/etc/hosts", text: "x" },
            { type: "command", command: "echo ok\nrm -rf /" },
            { type: "shell-out", command: "x" },
            { type: "file-exists", path: "src/ok.js" },
          ],
        },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.steps[0].acceptance).toEqual([{ type: "file-exists", path: "src/ok.js" }]);
  });
  it("knows which paths are safe", () => {
    expect(safeRelativePath("src/a.js")).toBe(true);
    for (const p of ["../x", "a/../../b", "/etc/x", "C:/x", "~/x", ""]) expect(safeRelativePath(p), p).toBe(false);
  });
});

describe("questions", () => {
  it("keeps at most five short questions", () => {
    expect(validateQuestions({ questions: ["Which language?", "", 5, ...Array(10).fill("More?")] })).toHaveLength(5);
    expect(validateQuestions({})).toEqual([]);
  });
  it("treats a failing or garbled questions call as no questions", async () => {
    expect(await askQuestions("g", "c", async () => "no json")).toEqual([]);
    expect(await askQuestions("g", "c", async () => { throw new Error("down"); })).toEqual([]);
    expect(await askQuestions("g", "c", async () => '{"questions":["Which framework?"]}')).toEqual(["Which framework?"]);
  });
});

describe("makePlan", () => {
  it("retries once, telling the model what was wrong", async () => {
    const prompts: string[] = [];
    const answers = ["not a plan", JSON.stringify(goodPlan)];
    const plan = await makePlan("goal", "ctx", [{ question: "Lang?", answer: "JS" }], async (p) => (prompts.push(p), answers.shift()!));
    expect(plan.steps).toHaveLength(2);
    expect(prompts[1]).toContain("could not be used");
    expect(prompts[0]).toContain("Lang?");
  });
  it("gives up after two bad answers", async () => {
    await expect(makePlan("goal", "ctx", [], async () => '{"steps": []}')).rejects.toThrow(/usable plan/);
  });
  it("writes a prompt that asks for checks and safe commands", () => {
    const p = planPrompt("Build a todo CLI", "empty folder", []);
    expect(p).toContain("acceptance checks");
    expect(p).toMatch(/safe, local and quick/);
  });
});

describe("projectContext", () => {
  it("lists names (never contents) and the project's checks", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    const c = projectContext(root);
    expect(c).toContain("package.json");
    expect(c).toContain("src/");
    expect(c).not.toContain(".env");
    expect(c).not.toContain("SECRET");
    expect(c).toContain("test: npm test");
  });
});

describe("claudePlanner (one-shot Claude call)", () => {
  it("asks Claude with all tools switched off and returns its answer", async () => {
    const cwd = tmp();
    const model = claudePlanner({ command: process.execPath, extraArgs: [FAKE], cwd, model: "claude-haiku-5-5", env: { ...process.env, FAKE_CLAUDE_REPLIES: '{"questions":["Q1"]}' } });
    expect(await model("plan this")).toBe('{"questions":["Q1"]}');
    const log = JSON.parse(fs.readFileSync(path.join(cwd, "fake-claude-oneshot.log"), "utf8").trim());
    expect(log.prompt).toBe("plan this");
    const i = log.argv.indexOf("--tools");
    expect(i).toBeGreaterThan(-1);
    expect(log.argv[i + 1]).toBe("");
    expect(log.argv).toContain("claude-haiku-5-5");
  });
  it("reports an error answer", async () => {
    const model = claudePlanner({ command: process.execPath, extraArgs: [FAKE], cwd: tmp(), env: { ...process.env, FAKE_CLAUDE_REPLIES: "ERROR" } });
    await expect(model("x")).rejects.toThrow(/reported an error/);
  });
  it("runs the whole questions-then-plan flow", async () => {
    const cwd = tmp();
    const model = claudePlanner({ command: process.execPath, extraArgs: [FAKE], cwd, env: { ...process.env, FAKE_CLAUDE_REPLIES: `{"questions":[]}|||${JSON.stringify(goodPlan)}` } });
    expect(await askQuestions("g", "c", model)).toEqual([]);
    expect((await makePlan("g", "c", [], model)).summary).toBe("A tiny CLI");
  });
});

describe("acceptance checks", () => {
  it("checks files and their contents, inside the project only", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.js"), "export const add = (a, b) => a + b;");
    expect((await runCheck({ type: "file-exists", path: "a.js" }, root)).ok).toBe(true);
    expect((await runCheck({ type: "file-exists", path: "b.js" }, root)).detail).toContain("does not exist");
    expect((await runCheck({ type: "file-contains", path: "a.js", text: "a + b" }, root)).ok).toBe(true);
    expect((await runCheck({ type: "file-contains", path: "a.js", text: "a - b" }, root)).detail).toContain("does not contain");
    expect((await runCheck({ type: "file-exists", path: "../outside.txt" }, root)).detail).toContain("not a path inside");
  });
  it("runs commands and keeps the end of a failure's output", async () => {
    const root = tmp();
    const [ok, bad] = await runChecks([{ type: "command", command: 'node -e "process.exit(0)"' }, { type: "command", command: 'node -e "console.log(\'2 failed\'); process.exit(1)"' }], root);
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain("2 failed");
  });
  it("describes checks in plain words", () => {
    expect(describeCheck({ type: "command", command: "npm test" })).toBe("runs `npm test` successfully");
    expect(describeCheck({ type: "file-contains", path: "a", text: "b" })).toBe('a contains "b"');
  });
});
