import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pointWorkspaceAtProxy } from "./ide-settings";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "argus-ide-"));
const read = (d: string) => JSON.parse(fs.readFileSync(path.join(d, ".vscode", "settings.json"), "utf8"));

describe("pointWorkspaceAtProxy", () => {
  it("creates the setting and removes everything on undo", () => {
    const d = tmp();
    const r = pointWorkspaceAtProxy(d, "http://127.0.0.1:1");
    if (!("undo" in r)) throw new Error("expected success");
    expect(read(d)["claudeCode.environmentVariables"]).toEqual([{ name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:1" }]);
    r.undo();
    expect(fs.existsSync(path.join(d, ".vscode"))).toBe(false);
  });

  it("merges into existing settings and restores them byte for byte", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, ".vscode"));
    const orig = '{\n  "editor.tabSize": 2,\n  "claudeCode.environmentVariables": [{"name":"FOO","value":"1"}]\n}\n';
    fs.writeFileSync(path.join(d, ".vscode", "settings.json"), orig);
    const r = pointWorkspaceAtProxy(d, "http://127.0.0.1:2");
    if (!("undo" in r)) throw new Error("expected success");
    const s = read(d);
    expect(s["editor.tabSize"]).toBe(2);
    expect(s["claudeCode.environmentVariables"]).toHaveLength(2);
    r.undo();
    expect(fs.readFileSync(path.join(d, ".vscode", "settings.json"), "utf8")).toBe(orig);
  });

  it("leaves a settings file with comments alone", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, ".vscode"));
    const orig = '{\n  // mine\n  "a": 1\n}';
    fs.writeFileSync(path.join(d, ".vscode", "settings.json"), orig);
    expect("error" in pointWorkspaceAtProxy(d, "http://127.0.0.1:3")).toBe(true);
    expect(fs.readFileSync(path.join(d, ".vscode", "settings.json"), "utf8")).toBe(orig);
  });
});
