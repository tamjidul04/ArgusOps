import type { ChangeSet, FileChange } from "./workspace";

/**
 * Looks at what an agent changed in one turn and reports the signs of sloppy or dishonest work. Pure: it only reads the
 * ChangeSet, so it works the same for every agent and every editor. No model is involved.
 *
 * A finding is a reason to look, not a verdict: each one carries its evidence (the actual lines) so you can judge it.
 */

export type Severity = "INFO" | "WARN" | "CRITICAL";

export interface Finding {
  /** Stable code, e.g. "tests-skipped". */
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Up to a few example lines or names, secrets masked. */
  evidence: string[];
  files: string[];
}

export interface ScanOptions {
  /** A turn that changes more lines than this (added + removed) is flagged as oversized. */
  maxDiffLines?: number;
  maxFiles?: number;
}

const MAX_EVIDENCE = 4;

/* ------------------------------ file categories ------------------------------ */

const TEST_FILE = /(^|\/)(__tests__|tests?|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go|rb)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$|_spec\.rb$/i;
const VENDORED = /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|target)\//;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|go\.sum|bun\.lockb?)$/;
const GENERATED = /\.(min\.(js|css)|map|snap|svg|lock)$/i;
const PROSE = /\.(md|mdx|txt|rst|adoc)$/i;
const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/i;
const ENV_EXAMPLE = /\.(example|sample|template|dist)$/i;

export const isTestFile = (p: string) => TEST_FILE.test(p);
const isCode = (f: FileChange) => !f.binary && !VENDORED.test(f.path) && !LOCKFILE.test(f.path) && !GENERATED.test(f.path);
const isCodeNotProse = (f: FileChange) => isCode(f) && !PROSE.test(f.path);

/* --------------------------------- patterns ---------------------------------- */

const STUB: RegExp[] = [
  /not\s+implemented/i,
  /\bNotImplementedError\b/,
  /\bunimplemented!\s*\(/,
  /\btodo!\s*\(/,
  /\bpass\s*#\s*(todo|fixme|implement)/i,
  /\bplaceholder (implementation|code|function|logic|body)\b/i,
  /lorem ipsum/i,
  /implement (me|this|later)\b/i,
];
const ELISION: RegExp[] = [
  /(\/\/|#|\/\*|<!--)\s*\.\.\.\s*(rest|remaining|existing|other|same|unchanged)/i,
  /(\/\/|#|\/\*|<!--)\s*(rest of|remaining|existing)\s+(the\s+)?(code|file|implementation|function|logic|component)/i,
  /(\/\/|#|\/\*)\s*(same as before|unchanged|keep (the )?existing)/i,
  /\.\.\.\s*\(?(existing|previous|rest of)\s+(code|implementation)/i,
];
const TODO_MARK = /\b(TODO|FIXME|XXX|HACK)\b/;

const SKIP_MARKS: RegExp[] = [
  /\b(it|test|describe)\.(skip|todo)\s*\(/,
  /\b(xit|xtest|xdescribe)\s*\(/,
  /@pytest\.mark\.(skip|xfail)/,
  /@unittest\.skip/,
  /\bpytest\.skip\s*\(/,
  /\bt\.Skip(f|Now)?\s*\(/,
  /#\[ignore\]/,
  /@(Disabled|Ignore)\b/,
  /\b(it|test|describe)\.only\s*\(/,
];
const ASSERTION = /\b(expect|assert\w*|should|require|verify)\b\s*[.(]|\bassert\s/;

const SUPPRESSIONS: RegExp[] = [
  /eslint-disable/,
  /@ts-(ignore|nocheck|expect-error)/,
  /#\s*noqa\b/,
  /#\s*type:\s*ignore/,
  /#\s*pylint:\s*disable/,
  /#\s*pragma:\s*no cover/,
  /\/\/\s*nolint\b/,
  /#\[allow\(/,
  /\bas\s+any\b.*\/\/\s*(hack|fix|todo)/i,
];

const SECRETS: Array<{ name: string; re: RegExp }> = [
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private key", re: /BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/ },
  { name: "database URL with a password", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{4,}@[^\s/]+/i },
];

const FAKE_DATA: RegExp[] = [/lorem ipsum/i, /\b(fake|dummy|sample|mock)\s+data\b/i, /hard-?coded\b.*\b(for now|temporary|temp|test)\b/i, /\bfoo@(bar|example)\.\w+/i];

const strict = /"strict"\s*:\s*false|"noImplicitAny"\s*:\s*false|"skipLibCheck"\s*:\s*true/;

/* --------------------------------- helpers ----------------------------------- */

const mask = (s: string) => s.replace(/(sk-ant-|sk-proj-|sk-|ghp_|gho_|ghu_|ghs_|ghr_|AKIA|AIza|xox[abprs]-)([A-Za-z0-9_-]{3})[A-Za-z0-9_-]*/g, "$1$2***").replace(/(:\/\/[^:\s]+:)[^@\s]+@/g, "$1***@");
const clip = (s: string, n = 140) => (s.trim().length > n ? s.trim().slice(0, n - 1) + "…" : s.trim());

function collect(files: FileChange[], res: RegExp[], which: "addedLines" | "removedLines" = "addedLines") {
  const hits: Array<{ file: string; line: string }> = [];
  for (const f of files) for (const line of f[which]) if (res.some((r) => r.test(line))) hits.push({ file: f.path, line });
  return hits;
}
const uniqueFiles = (hits: Array<{ file: string }>) => [...new Set(hits.map((h) => h.file))];
const examples = (hits: Array<{ file: string; line: string }>, maskIt = false) => hits.slice(0, MAX_EVIDENCE).map((h) => `${h.file}: ${clip(maskIt ? mask(h.line) : h.line)}`);

/* ---------------------------------- scanner ---------------------------------- */

export function scanChanges(changes: ChangeSet, opts: ScanOptions = {}): Finding[] {
  const out: Finding[] = [];
  const maxLines = opts.maxDiffLines ?? 1500;
  const maxFiles = opts.maxFiles ?? 40;
  const code = changes.files.filter(isCodeNotProse);
  const nonTestCode = code.filter((f) => !isTestFile(f.path));
  const testFiles = changes.files.filter((f) => isTestFile(f.path) && !f.binary);

  // secrets: the most serious, and also in config, docs and tests (a real key is a real key anywhere)
  const secretHits: Array<{ file: string; line: string; name: string }> = [];
  for (const f of changes.files) {
    if (f.binary || LOCKFILE.test(f.path)) continue;
    for (const line of f.addedLines) {
      const hit = SECRETS.find((s) => s.re.test(line));
      if (hit) secretHits.push({ file: f.path, line, name: hit.name });
    }
  }
  if (secretHits.length) {
    out.push({
      code: "secret",
      severity: "CRITICAL",
      title: "A secret was written into a file",
      detail: `${secretHits.length} line${secretHits.length === 1 ? "" : "s"} look like ${[...new Set(secretHits.map((h) => h.name))].join(", ")}. Check before committing or sharing the project.`,
      evidence: examples(secretHits, true),
      files: uniqueFiles(secretHits),
    });
  }
  const envAdded = changes.files.filter((f) => f.status === "added" && ENV_FILE.test(f.path) && !ENV_EXAMPLE.test(f.path));
  if (envAdded.length) {
    out.push({ code: "env-file", severity: "CRITICAL", title: "An environment file with secrets was created", detail: "Files like .env usually hold passwords and keys and must stay out of version control.", evidence: envAdded.map((f) => f.path).slice(0, MAX_EVIDENCE), files: envAdded.map((f) => f.path) });
  }

  // tests removed or switched off: the classic way to make a failing suite "pass"
  const deletedTests = testFiles.filter((f) => f.status === "deleted");
  const addedTests = testFiles.filter((f) => f.status === "added");
  const unreplaced = deletedTests.filter((d) => !addedTests.some((a) => baseName(a.path) === baseName(d.path)));
  if (unreplaced.length) {
    out.push({
      code: "tests-deleted",
      severity: "CRITICAL",
      title: "Test files were deleted",
      detail: `${unreplaced.length} test file${unreplaced.length === 1 ? " was" : "s were"} removed without a replacement. Deleting tests hides failures instead of fixing them.`,
      evidence: unreplaced.map((f) => `${f.path} (${f.removed} lines)`).slice(0, MAX_EVIDENCE),
      files: unreplaced.map((f) => f.path),
    });
  }
  const skipped = collect(testFiles, SKIP_MARKS);
  if (skipped.length) {
    out.push({ code: "tests-skipped", severity: "CRITICAL", title: "Tests were switched off", detail: `${skipped.length} test${skipped.length === 1 ? " was" : "s were"} skipped, disabled or limited with .only. A skipped test cannot fail.`, evidence: examples(skipped), files: uniqueFiles(skipped) });
  }
  const edited = testFiles.filter((f) => f.status === "modified");
  const assertionsRemoved = edited.reduce((n, f) => n + f.removedLines.filter((l) => ASSERTION.test(l)).length, 0);
  const assertionsAdded = edited.reduce((n, f) => n + f.addedLines.filter((l) => ASSERTION.test(l)).length, 0);
  if (assertionsRemoved >= 2 && assertionsRemoved > assertionsAdded + 1) {
    const weak = edited.filter((f) => f.removedLines.some((l) => ASSERTION.test(l)));
    out.push({ code: "tests-weakened", severity: "WARN", title: "Tests check less than before", detail: `${assertionsRemoved} assertions were removed and only ${assertionsAdded} added in existing tests.`, evidence: weak.map((f) => `${f.path}: -${f.removedLines.filter((l) => ASSERTION.test(l)).length} / +${f.addedLines.filter((l) => ASSERTION.test(l)).length} assertions`).slice(0, MAX_EVIDENCE), files: weak.map((f) => f.path) });
  }

  // placeholders and "the rest stays the same" shortcuts
  const stubs = collect(code, STUB);
  if (stubs.length) {
    out.push({ code: "placeholder", severity: "WARN", title: "Placeholder code was added", detail: `${stubs.length} line${stubs.length === 1 ? "" : "s"} say something is not implemented or is a placeholder. The task may look finished while parts are missing.`, evidence: examples(stubs), files: uniqueFiles(stubs) });
  }
  const elisions = collect(code, ELISION);
  if (elisions.length) {
    out.push({ code: "elision", severity: "WARN", title: "Code was replaced by a note like \"rest of the code\"", detail: "A comment standing in for real code usually means part of the file was dropped.", evidence: examples(elisions), files: uniqueFiles(elisions) });
  }
  const todos = collect(code, [TODO_MARK]).filter((h) => !stubs.includes(h));
  if (todos.length >= 3) {
    out.push({ code: "todos", severity: "INFO", title: `${todos.length} TODO notes were left`, detail: "Work was noted for later instead of done.", evidence: examples(todos), files: uniqueFiles(todos) });
  }

  // silencing the checkers instead of fixing what they found
  const suppressed = collect(code, SUPPRESSIONS);
  if (suppressed.length) {
    out.push({ code: "suppression", severity: "WARN", title: "Warnings were silenced instead of fixed", detail: `${suppressed.length} suppression${suppressed.length === 1 ? "" : "s"} (lint or type-check ignores) were added.`, evidence: examples(suppressed), files: uniqueFiles(suppressed) });
  }
  const loosened = collect(changes.files.filter((f) => /(^|\/)(tsconfig[^/]*\.json|\.eslintrc[^/]*|pyproject\.toml|mypy\.ini)$/.test(f.path)), [strict]);
  if (loosened.length) {
    out.push({ code: "strictness", severity: "WARN", title: "Type or lint strictness was relaxed", detail: "A project setting that catches mistakes was turned down.", evidence: examples(loosened), files: uniqueFiles(loosened) });
  }

  // made-up data in real code
  const fake = collect(nonTestCode, FAKE_DATA);
  if (fake.length) {
    out.push({ code: "fake-data", severity: "INFO", title: "Sample or hard-coded data in app code", detail: "Made-up data in the app itself can be mistaken for the real thing.", evidence: examples(fake), files: uniqueFiles(fake) });
  }

  // new dependencies
  const deps = newDependencies(changes.files);
  if (deps.length) {
    out.push({ code: "dependency", severity: deps.length > 5 ? "WARN" : "INFO", title: `${deps.length} new dependenc${deps.length === 1 ? "y" : "ies"}`, detail: "Check that each one is needed and trustworthy.", evidence: deps.slice(0, MAX_EVIDENCE).map((d) => `${d.file}: ${d.name}`), files: [...new Set(deps.map((d) => d.file))] });
  }

  // scope
  const lines = changes.totalAdded + changes.totalRemoved;
  if (lines > maxLines || changes.files.length > maxFiles) {
    out.push({
      code: "oversized",
      severity: "WARN",
      title: "A very large change for one turn",
      detail: `${changes.files.length} files and ${lines} lines changed${changes.truncated ? " (at least)" : ""}. Large rewrites are hard to review and often go beyond what was asked.`,
      evidence: changes.files.slice(0, MAX_EVIDENCE).map((f) => `${f.path} (+${f.added} -${f.removed})`),
      files: changes.files.map((f) => f.path).slice(0, 20),
    });
  }

  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}

const RANK: Record<Severity, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };
const baseName = (p: string) => p.split("/").pop()!.replace(/\.(test|spec)(?=\.)|^test_|_test(?=\.)/g, "").toLowerCase();

function newDependencies(files: FileChange[]): Array<{ file: string; name: string }> {
  const found: Array<{ file: string; name: string }> = [];
  for (const f of files) {
    if (f.binary) continue;
    const name = f.path.split("/").pop() ?? "";
    for (const line of f.addedLines) {
      if (name === "package.json") {
        const m = /^\s*"(@?[\w./-]+)"\s*:\s*"([\^~<>=*]?\d[^"]*|latest|\*|workspace:[^"]*|file:[^"]*|git[^"]*|https?:[^"]*)"/.exec(line);
        if (m && !["version", "node", "npm", "engines"].includes(m[1]) && !/^\d+\.\d+/.test(m[1])) found.push({ file: f.path, name: `${m[1]}@${m[2]}` });
      } else if (/^requirements.*\.txt$/.test(name)) {
        const m = /^([A-Za-z0-9_.-]+)\s*(?:[=<>~!]=?|\[|$)/.exec(line.trim());
        if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) found.push({ file: f.path, name: m[1] });
      } else if (name === "Cargo.toml") {
        const m = /^([A-Za-z0-9_-]+)\s*=\s*(".*"|\{.*version.*\})/.exec(line.trim());
        if (m && !["name", "version", "edition", "authors", "license", "description"].includes(m[1])) found.push({ file: f.path, name: m[1] });
      } else if (name === "go.mod") {
        const m = /^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v[\d.]+/i.exec(line);
        if (m) found.push({ file: f.path, name: m[1] });
      }
    }
  }
  return found;
}

/** One line for a notification or the terminal. */
export function summarizeFindings(findings: Finding[]): string {
  if (findings.length === 0) return "No problems found in this turn's changes.";
  return findings.map((f) => `${f.severity === "CRITICAL" ? "!!" : f.severity === "WARN" ? "! " : "· "} ${f.title}`).join("\n");
}

export const worstSeverity = (findings: Finding[]): Severity | null => findings.reduce<Severity | null>((w, f) => (w === null || RANK[f.severity] > RANK[w] ? f.severity : w), null);
