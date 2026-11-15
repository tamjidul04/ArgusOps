import fs from "node:fs";
import path from "node:path";

const KEY = "claudeCode.environmentVariables";
const VAR = "ANTHROPIC_BASE_URL";

type Entry = { name: string; value: string };

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/;

/** Is this one of ArgusOps' entries: the base-URL variable pointing at a port on this machine? */
export function isLoopbackEntry(e: unknown): e is Entry {
  const x = e as Partial<Entry> | null;
  return !!x && x.name === VAR && typeof x.value === "string" && LOOPBACK.test(x.value);
}

/** The settings object without ArgusOps' entry (and without the list if that leaves it empty). Entries the user wrote stay. */
export function withoutLoopbackEntry(json: Record<string, unknown>): Record<string, unknown> {
  const list = json[KEY];
  if (!Array.isArray(list) || !list.some(isLoopbackEntry)) return json;
  const rest = (list as unknown[]).filter((e) => !isLoopbackEntry(e));
  const out = { ...json };
  if (rest.length) out[KEY] = rest;
  else delete out[KEY];
  return out;
}

/**
 * Points the Claude Code panel at the proxy by writing the workspace setting, and returns a function that puts the
 * file back as it was. Returns an error (and does nothing) when the settings file has comments or other things we could
 * not safely rewrite; the caller then prints the snippet instead.
 */
export function pointWorkspaceAtProxy(dir: string, baseUrl: string): { undo: () => void } | { error: string } {
  const folder = path.join(dir, ".vscode");
  const file = path.join(folder, "settings.json");
  const existed = fs.existsSync(file);
  const original = existed ? fs.readFileSync(file, "utf8") : null;

  let json: Record<string, unknown> = {};
  if (original !== null && original.trim() !== "") {
    try {
      json = JSON.parse(original);
    } catch {
      return { error: ".vscode/settings.json has comments, so it was left alone." };
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) return { error: ".vscode/settings.json isn't an object." };
  }

  // A crash can leave our entry behind. It must not be remembered as the user's "original" and put back on exit.
  const cleaned = withoutLoopbackEntry(json);
  const restoreText = original === null || cleaned === json ? original : JSON.stringify(cleaned, null, 2) + "\n";

  const list = Array.isArray(json[KEY]) ? (json[KEY] as Entry[]).filter((e) => e?.name !== VAR) : [];
  json[KEY] = [...list, { name: VAR, value: baseUrl }];

  const createdFolder = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");

  return {
    undo() {
      try {
        if (restoreText === null) {
          fs.rmSync(file, { force: true });
          if (createdFolder) fs.rmdirSync(folder);
        } else fs.writeFileSync(file, restoreText);
      } catch {
        /* best effort */
      }
    },
  };
}

export function snippet(baseUrl: string): string {
  return JSON.stringify({ [KEY]: [{ name: VAR, value: baseUrl }] }, null, 2);
}

export type DisconnectResult = { file: string; action: "removed" | "kept-live" | "needs-manual" | "none"; url?: string };

/**
 * Removes ArgusOps' entry from a settings file when it points at a proxy that is no longer running (a crash or a
 * closed terminal left it behind, and the editor's agent would fail to connect). `force` removes it even if the proxy
 * is running. A file with comments is not rewritten (that could lose them); the caller shows what to delete instead.
 */
export async function removeStaleEntry(file: string, isLive: (port: number) => Promise<boolean>, force = false): Promise<DisconnectResult> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { file, action: "none" };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    // comments or trailing commas: we will not rewrite it, but we can tell the user if our entry is in there
    const m = /"value"\s*:\s*"(https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^"]*)"/.exec(text);
    return m && text.includes(VAR) ? { file, action: "needs-manual", url: m[1] } : { file, action: "none" };
  }
  const list = json?.[KEY];
  const ours = Array.isArray(list) ? list.find(isLoopbackEntry) : undefined;
  if (!ours) return { file, action: "none" };
  const port = Number(LOOPBACK.exec(ours.value)![1]);
  if (!force && (await isLive(port))) return { file, action: "kept-live", url: ours.value };
  const next = withoutLoopbackEntry(json);
  fs.writeFileSync(file, Object.keys(next).length === 0 ? "{}\n" : JSON.stringify(next, null, 2) + "\n");
  return { file, action: "removed", url: ours.value };
}
