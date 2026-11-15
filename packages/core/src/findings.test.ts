import { describe, expect, it } from "vitest";
import { scanChanges, summarizeFindings, worstSeverity, isTestFile, type Finding } from "./findings";
import type { ChangeSet, FileChange } from "./workspace";

const file = (p: string, over: Partial<FileChange> = {}): FileChange => ({ path: p, status: "modified", added: 0, removed: 0, addedLines: [], removedLines: [], binary: false, ...over });
const added = (p: string, lines: string[]) => file(p, { addedLines: lines, added: lines.length });
const changes = (files: FileChange[]): ChangeSet => ({ files, totalAdded: files.reduce((n, f) => n + f.added, 0), totalRemoved: files.reduce((n, f) => n + f.removed, 0), truncated: false });
const codes = (fs: Finding[]) => fs.map((f) => f.code);
const scan = (...files: FileChange[]) => scanChanges(changes(files));

describe("a clean change", () => {
  it("reports nothing for ordinary edits", () => {
    expect(scan(added("src/app.ts", ["export const x = 1;", "console.log(x);"]), added("README.md", ["# Title"]))).toEqual([]);
    expect(summarizeFindings([])).toMatch(/No problems/);
  });
});

describe("tests removed or switched off", () => {
  it("flags deleted test files as critical", () => {
    const f = scan(file("src/app.test.ts", { status: "deleted", removed: 40 }));
    expect(f[0]).toMatchObject({ code: "tests-deleted", severity: "CRITICAL" });
    expect(f[0].evidence[0]).toContain("40 lines");
  });
  it("does not flag a test that was moved or renamed", () => {
    expect(scan(file("a/foo.test.ts", { status: "deleted", removed: 5 }), file("b/foo.test.ts", { status: "added", added: 5 }))).toEqual([]);
  });
  it.each([
    ["it.skip('x', () => {})"],
    ["xit('x', () => {})"],
    ["describe.skip('x', () => {})"],
    ["test.only('x', () => {})"],
    ["@pytest.mark.skip(reason='later')"],
    ["    t.Skip(\"flaky\")"],
    ["#[ignore]"],
  ])("flags %s", (line) => {
    expect(codes(scan(added("src/a.test.ts", [line])))).toContain("tests-skipped");
  });
  it("only looks for skips in test files", () => {
    expect(scan(added("src/not-a-test.ts", ["const it = { skip() {} }; it.skip('x', 1)"]))).toEqual([]);
  });
  it("flags fewer assertions in existing tests, but not a balanced edit", () => {
    const weaker = file("a.test.ts", { removedLines: ["expect(a).toBe(1);", "expect(b).toBe(2);", "expect(c).toBe(3);"], addedLines: ["expect(a).toBeDefined();"] });
    expect(codes(scan(weaker))).toContain("tests-weakened");
    const balanced = file("a.test.ts", { removedLines: ["expect(a).toBe(1);", "expect(b).toBe(2);"], addedLines: ["expect(a).toBe(2);", "expect(b).toBe(3);"] });
    expect(codes(scan(balanced))).not.toContain("tests-weakened");
  });
});

describe("placeholders and shortcuts", () => {
  it.each([["throw new Error('not implemented');"], ["raise NotImplementedError()"], ["todo!()"], ["const data = 'lorem ipsum dolor';"], ["pass  # TODO implement"]])("flags %s", (line) => {
    expect(codes(scan(added("src/a.ts", [line])))).toContain("placeholder");
  });
  it.each([["// ... rest of the code remains the same"], ["# ... existing code ..."], ["/* rest of the implementation */"], ["// same as before"]])("flags the shortcut %s", (line) => {
    expect(codes(scan(added("src/a.ts", [line])))).toContain("elision");
  });
  it("does not mistake an input placeholder for placeholder code", () => {
    expect(scan(added("src/Form.tsx", ['<input placeholder="Search" />', "const placeholder = props.hint;"]))).toEqual([]);
    expect(codes(scan(added("src/a.ts", ["// placeholder implementation, replace later"])))).toContain("placeholder");
  });
  it("mentions TODO notes only when there are several, and never in prose files", () => {
    expect(scan(added("src/a.ts", ["// TODO: tidy"]))).toEqual([]);
    expect(codes(scan(added("src/a.ts", ["// TODO a", "// FIXME b", "// TODO c"])))).toContain("todos");
    expect(scan(added("docs/plan.md", ["TODO: write this", "not implemented yet", "placeholder"]))).toEqual([]);
  });
});

describe("silenced checkers and relaxed settings", () => {
  it.each([["// eslint-disable-next-line no-explicit-any"], ["// @ts-ignore"], ["const x = y as any; // @ts-expect-error"], ["import x  # noqa"], ["x = f()  # type: ignore"]])("flags %s", (line) => {
    expect(codes(scan(added("src/a.ts", [line])))).toContain("suppression");
  });
  it("flags turning strict off in tsconfig", () => {
    expect(codes(scan(added("tsconfig.json", ['  "strict": false,'])))).toContain("strictness");
    expect(codes(scan(added("tsconfig.json", ['  "strict": true,'])))).not.toContain("strictness");
  });
});

describe("secrets", () => {
  it("flags key formats as critical and masks them in the evidence", () => {
    const key = "sk-ant-api03-" + "A".repeat(40);
    const f = scan(added("src/config.ts", [`const k = "${key}";`]));
    expect(f[0]).toMatchObject({ code: "secret", severity: "CRITICAL" });
    expect(JSON.stringify(f)).not.toContain(key);
    expect(f[0].evidence[0]).toContain("sk-ant-api***");
  });
  it.each([["ghp_" + "a".repeat(36)], ["AKIA" + "ABCDEFGHIJKLMNOP"], ["-----BEGIN RSA PRIVATE KEY-----"], ["mysql://admin:hunter22pass@db.internal:3306/app"]])("flags %s", (s) => {
    expect(codes(scan(added("notes.txt", [s])))).toContain("secret");
  });
  it("masks database passwords", () => {
    const f = scan(added("a.ts", ["const u = 'postgres://app:supersecret99@host/db';"]));
    expect(JSON.stringify(f)).not.toContain("supersecret99");
  });
  it("flags a created .env file but not .env.example", () => {
    expect(codes(scan(file(".env", { status: "added", added: 2 })))).toContain("env-file");
    expect(scan(file(".env.example", { status: "added", added: 2 }))).toEqual([]);
  });
  it("ignores lock files", () => {
    expect(scan(added("package-lock.json", ["\"resolved\": \"https://user:pass1234@registry/x\""]))).toEqual([]);
  });
});

describe("dependencies and size", () => {
  it("lists new npm dependencies", () => {
    const f = scan(added("package.json", ['    "left-pad": "^1.3.0",', '    "@scope/pkg": "2.0.0",', '  "version": "1.2.3",']));
    expect(f[0]).toMatchObject({ code: "dependency", severity: "INFO" });
    expect(f[0].title).toBe("2 new dependencies");
  });
  it("lists python and rust dependencies", () => {
    expect(codes(scan(added("requirements.txt", ["requests==2.31.0", "# comment", "-r base.txt"])))).toContain("dependency");
    expect(codes(scan(added("Cargo.toml", ['serde = "1.0"', 'name = "x"'])))).toContain("dependency");
  });
  it("flags an oversized turn", () => {
    const big = file("src/big.ts", { added: 1600, addedLines: Array(10).fill("x") });
    expect(codes(scan(big))).toContain("oversized");
    const many = Array.from({ length: 41 }, (_, i) => added(`src/f${i}.ts`, ["x"]));
    expect(codes(scan(...many))).toContain("oversized");
    expect(codes(scanChanges(changes([big]), { maxDiffLines: 5000 }))).not.toContain("oversized");
  });
});

describe("ordering and helpers", () => {
  it("puts the most serious first and reports the worst severity", () => {
    const f = scan(added("src/a.ts", ["// TODO a", "// TODO b", "// TODO c", "throw new Error('not implemented')"]), file("x.test.ts", { status: "deleted", removed: 3 }));
    expect(f[0].severity).toBe("CRITICAL");
    expect(worstSeverity(f)).toBe("CRITICAL");
    expect(worstSeverity([])).toBeNull();
    expect(summarizeFindings(f).split("\n")[0]).toMatch(/^!!/);
  });
  it("recognises test file names across languages", () => {
    for (const p of ["a.test.ts", "a.spec.js", "src/__tests__/x.ts", "tests/test_x.py", "pkg/x_test.go", "FooTest.java", "spec/x_spec.rb"]) expect(isTestFile(p), p).toBe(true);
    for (const p of ["src/contest.ts", "latest.ts", "src/attest.py"]) expect(isTestFile(p), p).toBe(false);
  });
});
