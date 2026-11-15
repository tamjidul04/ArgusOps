import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changesSince, diffSnapshots, takeSnapshot } from "./workspace";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-ws-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const write = (root: string, rel: string, text: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

function repo() {
  const root = tmp();
  git(root, "init", "-q");
  write(root, "src/app.ts", "export const a = 1;\nexport const b = 2;\n");
  write(root, "src/app.test.ts", "test('a', () => {});\n");
  write(root, ".gitignore", "node_modules\nsecret.log\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

describe("workspace changes in a git repository", () => {
  it("sees nothing when nothing changed", async () => {
    const root = repo();
    const before = await takeSnapshot(root);
    expect((await changesSince(before)).files).toEqual([]);
  });

  it("reports edited, added and deleted files with the lines that moved", async () => {
    const root = repo();
    const before = await takeSnapshot(root);
    write(root, "src/app.ts", "export const a = 1;\nexport const b = 3;\n// TODO later\n");
    write(root, "src/new.ts", "export {};\n");
    fs.rmSync(path.join(root, "src/app.test.ts"));
    const c = await changesSince(before);
    const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
    expect(by["src/app.ts"]).toMatchObject({ status: "modified", added: 2, removed: 1 });
    expect(by["src/app.ts"].addedLines).toEqual(["export const b = 3;", "// TODO later"]);
    expect(by["src/app.ts"].removedLines).toEqual(["export const b = 2;"]);
    expect(by["src/new.ts"].status).toBe("added");
    expect(by["src/app.test.ts"]).toMatchObject({ status: "deleted", removed: 1 });
    expect(c.totalAdded).toBe(3);
  });

  it("counts only this turn's changes when the tree was already dirty", async () => {
    const root = repo();
    write(root, "src/app.ts", "export const a = 1;\nexport const b = 2;\n// my own edit\n"); // user's work before the turn
    const before = await takeSnapshot(root);
    write(root, "src/app.ts", "export const a = 1;\nexport const b = 2;\n// my own edit\nconsole.log('agent');\n");
    const c = await changesSince(before);
    expect(c.files).toHaveLength(1);
    expect(c.files[0].addedLines).toEqual(["console.log('agent');"]);
  });

  it("includes new untracked files but ignores ignored ones", async () => {
    const root = repo();
    const before = await takeSnapshot(root);
    write(root, "notes.md", "hi\n");
    write(root, "secret.log", "ignored\n");
    write(root, "node_modules/x/index.js", "ignored\n");
    expect((await changesSince(before)).files.map((f) => f.path)).toEqual(["notes.md"]);
  });

  it("leaves the user's index, branch and files exactly as they were", async () => {
    const root = repo();
    write(root, "src/app.ts", "export const a = 9;\n");
    git(root, "add", "src/app.ts"); // staged by the user
    write(root, "loose.txt", "untracked\n");
    const statusBefore = git(root, "status", "--porcelain");
    const headBefore = git(root, "rev-parse", "HEAD");
    const refsBefore = git(root, "for-each-ref");
    await takeSnapshot(root);
    await takeSnapshot(root);
    expect(git(root, "status", "--porcelain")).toBe(statusBefore);
    expect(git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(root, "for-each-ref")).toBe(refsBefore);
    expect(fs.readFileSync(path.join(root, "loose.txt"), "utf8")).toBe("untracked\n");
  });

  it("works in a repository with no commits yet, and from a subfolder", async () => {
    const root = tmp();
    git(root, "init", "-q");
    write(root, "a.txt", "one\n");
    const before = await takeSnapshot(path.join(root));
    write(root, "sub/b.txt", "two\n");
    const sub = await takeSnapshot(path.join(root, "sub"));
    expect(sub.kind).toBe("git");
    expect((await changesSince(before)).files.map((f) => f.path)).toEqual(["sub/b.txt"]);
  });

  it("copes with spaces, unicode and CRLF files", async () => {
    const root = repo();
    const before = await takeSnapshot(root);
    write(root, "my notes/résumé ✓.txt", "line one\r\nline two\r\n");
    const c = await changesSince(before);
    expect(c.files[0].path).toBe("my notes/résumé ✓.txt");
    expect(c.files[0].addedLines).toEqual(["line one", "line two"]);
  });

  it("flags binary files without dumping them", async () => {
    const root = repo();
    const before = await takeSnapshot(root);
    fs.writeFileSync(path.join(root, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    const f = (await changesSince(before)).files[0];
    expect(f.path).toBe("logo.bin");
    expect(f.addedLines.length).toBeLessThanOrEqual(1);
  });
});

describe("workspace changes outside git", () => {
  it("reports edits, additions and deletions", async () => {
    const root = tmp();
    write(root, "a.py", "x = 1\ny = 2\n");
    write(root, "b.py", "keep\n");
    write(root, "gone.py", "bye\n");
    const before = await takeSnapshot(root);
    expect(before.kind).toBe("folder");
    write(root, "a.py", "x = 1\ny = 3\nz = 4\n");
    write(root, "c.py", "new\n");
    fs.rmSync(path.join(root, "gone.py"));
    const c = await changesSince(before);
    const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
    expect(by["a.py"]).toMatchObject({ status: "modified", added: 2, removed: 1 });
    expect(by["c.py"].status).toBe("added");
    expect(by["gone.py"].status).toBe("deleted");
    expect(by["b.py"]).toBeUndefined();
  });

  it("skips dependency and build folders, binaries and huge files", async () => {
    const root = tmp();
    const before = await takeSnapshot(root);
    write(root, "node_modules/p/i.js", "x\n");
    write(root, "dist/out.js", "x\n");
    write(root, ".git/config", "x\n");
    fs.writeFileSync(path.join(root, "pic.png"), Buffer.from([0, 1, 2]));
    write(root, "big.txt", "a".repeat(300 * 1024));
    write(root, "real.txt", "ok\n");
    expect((await changesSince(before)).files.map((f) => f.path)).toEqual(["real.txt"]);
  });

  it("two kinds of snapshot are never compared", async () => {
    const g = await takeSnapshot(repo());
    const f = await takeSnapshot(tmp());
    expect((await diffSnapshots(g, f)).files).toEqual([]);
  });
});
