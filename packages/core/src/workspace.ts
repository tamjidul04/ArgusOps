import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Knowing exactly what an agent changed. A snapshot records the state of a project folder; comparing two snapshots
 * gives the files added, edited and deleted and the lines that went in and out. Used by the supervisor to judge a turn.
 *
 * In a git repository the snapshot is a git "tree" of the whole working folder (respecting .gitignore), written with a
 * temporary index, so nothing the user can see changes: their index, branches, stash and files are untouched (only
 * some small unreferenced objects land in .git/objects, which git cleans up on its own). Outside git, the folder is
 * read into memory with sensible limits.
 */

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  /** The lines that were added and removed (capped per file), without their line endings. */
  addedLines: string[];
  removedLines: string[];
  binary: boolean;
}

export interface ChangeSet {
  files: FileChange[];
  totalAdded: number;
  totalRemoved: number;
  /** True when limits cut something off (very many files, or a huge diff). The numbers are then lower bounds. */
  truncated: boolean;
}

export type Snapshot = GitSnapshot | FolderSnapshot;
interface GitSnapshot {
  kind: "git";
  root: string;
  tree: string;
  head: string | null;
  takenAt: number;
}
interface FolderSnapshot {
  kind: "folder";
  root: string;
  files: Map<string, string>; // relative path -> text content
  skipped: number;
  takenAt: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".cache", "coverage", "target", "venv", ".venv", "__pycache__", ".turbo", ".gradle", ".idea"]);
const MAX_FOLDER_FILES = 4000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINES_PER_FILE = 2000;
const MAX_CHANGED_FILES = 500;
const GIT_TIMEOUT_MS = 30_000;

export const emptyChangeSet = (): ChangeSet => ({ files: [], totalAdded: 0, totalRemoved: 0, truncated: false });

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-optional-locks", "-c", "core.quotepath=off", "-c", "core.autocrlf=false", ...args],
      { cwd, env: { ...process.env, ...env }, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString()))
    );
  });
}

async function gitToplevel(root: string): Promise<string | null> {
  try {
    return (await git(root, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null; // not a repository, or git is not installed
  }
}

export async function takeSnapshot(root: string, now = Date.now()): Promise<Snapshot> {
  const top = await gitToplevel(root);
  if (top) {
    try {
      return await gitSnapshot(top, now);
    } catch {
      // a repository we cannot read (corrupt, locked): fall back to reading the folder
    }
  }
  return folderSnapshot(root, now);
}

async function gitSnapshot(top: string, now: number): Promise<GitSnapshot> {
  const tmp = path.join(os.tmpdir(), `argus-index-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
  try {
    // start from a copy of the real index so unchanged files are not hashed again, but never write to the real one
    try {
      const real = (await git(top, ["rev-parse", "--git-path", "index"])).trim();
      fs.copyFileSync(path.isAbsolute(real) ? real : path.join(top, real), tmp);
    } catch {
      // no index yet (fresh repository): git add starts from empty
    }
    const env = { GIT_INDEX_FILE: tmp };
    await git(top, ["add", "-A", "--", "."], env);
    const tree = (await git(top, ["write-tree"], env)).trim();
    let head: string | null = null;
    try {
      head = (await git(top, ["rev-parse", "HEAD"])).trim();
    } catch {
      // no commits yet
    }
    return { kind: "git", root: top, tree, head, takenAt: now };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function folderSnapshot(root: string, now: number): FolderSnapshot {
  const files = new Map<string, string>();
  let skipped = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (e.isFile()) {
        if (files.size >= MAX_FOLDER_FILES) {
          skipped++;
          continue;
        }
        try {
          if (fs.statSync(full).size > MAX_FILE_BYTES) {
            skipped++;
            continue;
          }
          const buf = fs.readFileSync(full);
          if (buf.includes(0)) {
            skipped++; // binary
            continue;
          }
          files.set(path.relative(root, full).split(path.sep).join("/"), buf.toString("utf8"));
        } catch {
          skipped++;
        }
      }
    }
  };
  walk(root);
  return { kind: "folder", root, files, skipped, takenAt: now };
}

/* --------------------------------- diffing --------------------------------- */

export async function diffSnapshots(before: Snapshot, after: Snapshot): Promise<ChangeSet> {
  if (before.kind === "git" && after.kind === "git" && before.root === after.root) {
    if (before.tree === after.tree) return emptyChangeSet();
    return gitDiff(before, after);
  }
  if (before.kind === "folder" && after.kind === "folder") return folderDiff(before, after);
  return emptyChangeSet(); // two different kinds of snapshot cannot be compared
}

/** What changed since `before`, taking a fresh snapshot of the same folder. */
export async function changesSince(before: Snapshot): Promise<ChangeSet> {
  const after = await takeSnapshot(before.root);
  return diffSnapshots(before, after);
}

async function gitDiff(a: GitSnapshot, b: GitSnapshot): Promise<ChangeSet> {
  const out = await git(a.root, ["diff", "--no-color", "--no-renames", "-U0", "--text", a.tree, b.tree]);
  const files: FileChange[] = [];
  let current: FileChange | null = null;
  let truncated = false;
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (files.length >= MAX_CHANGED_FILES) {
        truncated = true;
        current = null;
        continue;
      }
      const m = / b\/(.+)$/.exec(line);
      current = { path: m ? m[1] : "?", status: "modified", added: 0, removed: 0, addedLines: [], removedLines: [], binary: false };
      files.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("Binary files")) current.binary = true;
    else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) {
      current.added++;
      if (current.addedLines.length < MAX_LINES_PER_FILE) current.addedLines.push(line.slice(1).replace(/\r$/, ""));
      else truncated = true;
    } else if (line.startsWith("-")) {
      current.removed++;
      if (current.removedLines.length < MAX_LINES_PER_FILE) current.removedLines.push(line.slice(1).replace(/\r$/, ""));
      else truncated = true;
    }
  }
  return finish(files, truncated);
}

/** Lines in `next` that are not in `prev` (counting duplicates), without positions: enough to see what was added. */
function lineDelta(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const counts = new Map<string, number>();
  for (const l of prev) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of next) {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, c] of counts) for (let i = 0; i < c; i++) removed.push(l);
  return { added, removed };
}

const splitLines = (text: string) => (text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

function folderDiff(a: FolderSnapshot, b: FolderSnapshot): ChangeSet {
  const files: FileChange[] = [];
  let truncated = false;
  const names = new Set([...a.files.keys(), ...b.files.keys()]);
  for (const name of [...names].sort()) {
    const was = a.files.get(name);
    const now = b.files.get(name);
    if (was === now) continue;
    if (files.length >= MAX_CHANGED_FILES) {
      truncated = true;
      break;
    }
    const status = was === undefined ? "added" : now === undefined ? "deleted" : "modified";
    const { added, removed } = lineDelta(splitLines(was ?? ""), splitLines(now ?? ""));
    if (added.length > MAX_LINES_PER_FILE || removed.length > MAX_LINES_PER_FILE) truncated = true;
    files.push({ path: name, status, added: added.length, removed: removed.length, addedLines: added.slice(0, MAX_LINES_PER_FILE), removedLines: removed.slice(0, MAX_LINES_PER_FILE), binary: false });
  }
  return finish(files, truncated);
}

function finish(files: FileChange[], truncated: boolean): ChangeSet {
  return { files, totalAdded: files.reduce((n, f) => n + f.added, 0), totalRemoved: files.reduce((n, f) => n + f.removed, 0), truncated };
}
