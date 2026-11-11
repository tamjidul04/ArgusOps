import fs from "node:fs";
import path from "node:path";

const KEY = "claudeCode.environmentVariables";
const VAR = "ANTHROPIC_BASE_URL";

type Entry = { name: string; value: string };

/**
 * Points the Claude Code panel at the proxy by writing the workspace setting, and returns a function that puts the
 * file back as it was. Returns null (and does nothing) when the settings file has comments or other things we could
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

  const list = Array.isArray(json[KEY]) ? (json[KEY] as Entry[]).filter((e) => e?.name !== VAR) : [];
  json[KEY] = [...list, { name: VAR, value: baseUrl }];

  const createdFolder = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");

  return {
    undo() {
      try {
        if (original === null) {
          fs.rmSync(file, { force: true });
          if (createdFolder) fs.rmdirSync(folder);
        } else fs.writeFileSync(file, original);
      } catch {
        /* best effort */
      }
    },
  };
}

export function snippet(baseUrl: string): string {
  return JSON.stringify({ [KEY]: [{ name: VAR, value: baseUrl }] }, null, 2);
}
