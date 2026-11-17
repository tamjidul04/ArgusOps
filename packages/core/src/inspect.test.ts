import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowProject, detectGates } from "./gates";
import { formatReport, inspectSince, recordReport, watchWorkspace, type CheckReport } from "./inspect";
import { Store } from "./store";
import { snapshotFromRef, takeSnapshot } from "./workspace";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-insp-"));
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
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

/** A tiny project whose "test" script passes or fails depending on a file. */
function project(passing = true) {
  const root = tmp();
  git(root, "init", "-q");
  write(root, "package.json", JSON.stringify({ scripts: { test: 'node -e "process.exit(require(\'fs\').existsSync(\'BROKEN\') ? 1 : 0)"' } }));
  write(root, "src/app.ts", "export const a = 1;\n");
  write(root, "src/app.test.ts", "// test\n");
  if (!passing) write(root, "BROKEN", "x");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

describe("inspectSince", () => {
  it("reports findings and says checks were not run until the project is allowed", async () => {
    const store = new Store(tmp());
    const root = project();
    const before = await takeSnapshot(root);
    write(root, "src/app.ts", "export const a = 1;\nthrow new Error('not implemented');\n");
    fs.rmSync(path.join(root, "src/app.test.ts"));
    const r = await inspectSince(store, before);
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["tests-deleted", "placeholder"]));
    expect(r.worst).toBe("CRITICAL");
    expect(r.gates).toMatchObject({ state: "unknown", results: null });
    const text = formatReport(r);
    expect(text).toContain("Checks were not run");
    expect(text).toContain("test: npm test");
    expect(text).toContain("argus project allow");
  });

  it("runs the checks once allowed, and a failing check is a critical finding even if no file looks wrong", async () => {
    const store = new Store(tmp());
    const root = project();
    await allowProject(store, root, detectGates(root));
    const before = await takeSnapshot(root);
    write(root, "BROKEN", "now it fails");
    const r = await inspectSince(store, before);
    expect(r.gates.state).toBe("allowed");
    expect(r.gates.results?.[0]).toMatchObject({ name: "test", ok: false });
    expect(r.findings.some((f) => f.code === "gate-test" && f.severity === "CRITICAL")).toBe(true);
    expect(formatReport(r)).toMatch(/FAILED\s+test/);
  });

  it("passes cleanly when the checks pass", async () => {
    const store = new Store(tmp());
    const root = project();
    await allowProject(store, root, detectGates(root));
    const before = await takeSnapshot(root);
    write(root, "src/app.ts", "export const a = 2;\n");
    const r = await inspectSince(store, before);
    expect(r.findings).toEqual([]);
    expect(r.worst).toBeNull();
    expect(formatReport(r)).toMatch(/ok\s+test/);
  });

  it("never runs checks when told not to, or when the commands changed after consent", async () => {
    const store = new Store(tmp());
    const root = project();
    await allowProject(store, root, detectGates(root));
    const before = await takeSnapshot(root);
    write(root, "x.txt", "1");
    expect((await inspectSince(store, before, { runGates: false })).gates.results).toBeNull();
    write(root, "package.json", JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('PWNED','1')\"" } }));
    const r = await inspectSince(store, before);
    expect(r.gates.state).toBe("changed");
    expect(fs.existsSync(path.join(root, "PWNED"))).toBe(false); // the changed command was not run
    expect(formatReport(r)).toContain("changed since you allowed");
  });

  it("says when no checks exist", async () => {
    const store = new Store(tmp());
    const root = tmp();
    git(root, "init", "-q");
    const before = await takeSnapshot(root);
    write(root, "a.txt", "1");
    expect(formatReport(await inspectSince(store, before))).toContain("none found");
  });

  it("compares against a commit with snapshotFromRef", async () => {
    const root = project();
    const head = await snapshotFromRef(root, "HEAD");
    expect(head).not.toBeNull();
    write(root, "src/app.ts", "export const a = 1;\n// TODO\n");
    const r = await inspectSince(new Store(tmp()), head!);
    expect(r.changes.files.map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(await snapshotFromRef(root, "no-such-ref")).toBeNull();
    expect(await snapshotFromRef(tmp(), "HEAD")).toBeNull();
  });
});

describe("recordReport", () => {
  it("writes an incident and an alert when something needs attention", async () => {
    const store = new Store(tmp());
    const root = project();
    const before = await takeSnapshot(root);
    fs.rmSync(path.join(root, "src/app.test.ts"));
    const r = await inspectSince(store, before);
    const seen: string[] = [];
    const note = recordReport(store, r, (n) => seen.push(n.title));
    expect(note?.level).toBe("CRITICAL");
    expect(store.incidents()[0]).toMatchObject({ kind: "FINDING", severity: "CRITICAL" });
    expect(store.incidents()[0].findings?.[0].code).toBe("tests-deleted");
    expect(seen[0]).toMatch(/Workspace .* 1 problem/);
  });

  it("stays quiet for informational findings only, or for no findings", async () => {
    const store = new Store(tmp());
    const root = project();
    const before = await takeSnapshot(root);
    write(root, "src/a.ts", "// TODO a\n// TODO b\n// TODO c\n");
    const r = await inspectSince(store, before);
    expect(r.findings.map((f) => f.severity)).toEqual(["INFO"]);
    expect(recordReport(store, r)).toBeNull();
    expect(store.incidents()).toHaveLength(0);
  });
});

describe("watchWorkspace", () => {
  it("checks after files settle, covers only what changed since the last check, and stays quiet for idle folders", async () => {
    const store = new Store(tmp());
    const root = project();
    const reports: CheckReport[] = [];
    const w = await watchWorkspace({ store, root, debounceMs: 300, runGates: false, onReport: (r) => reports.push(r) });
    try {
      write(root, "src/new.ts", "// ... rest of the code stays the same\n");
      for (let i = 0; i < 100 && reports.length < 1; i++) await new Promise((r) => setTimeout(r, 100));
      expect(reports).toHaveLength(1);
      expect(reports[0].findings.map((f) => f.code)).toContain("elision");

      write(root, "src/other.ts", "export const ok = true;\n");
      for (let i = 0; i < 100 && reports.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
      expect(reports).toHaveLength(2);
      expect(reports[1].changes.files.map((f) => f.path)).toEqual(["src/other.ts"]); // not the earlier file again
      expect(store.incidents().length).toBe(1); // the second report had nothing worth an alert

      await new Promise((r) => setTimeout(r, 900));
      expect(reports).toHaveLength(2);
    } finally {
      w.stop();
    }
  }, 20_000);

  it("ignores changes inside node_modules and .git", async () => {
    const store = new Store(tmp());
    const root = project();
    const reports: CheckReport[] = [];
    const w = await watchWorkspace({ store, root, debounceMs: 200, runGates: false, onReport: (r) => reports.push(r) });
    try {
      write(root, "node_modules/pkg/index.js", "x");
      await new Promise((r) => setTimeout(r, 1200));
      expect(reports).toHaveLength(0);
    } finally {
      w.stop();
    }
  }, 15_000);
});
