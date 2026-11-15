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

describe("crash safety", () => {
  const entry = { name: "ANTHROPIC_BASE_URL", value: "http://127.0.0.1:47821" };
  const KEYNAME = "claudeCode.environmentVariables";

  it("does not put a stale entry from an earlier crash back on exit", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, ".vscode"));
    const file = path.join(d, ".vscode", "settings.json");
    fs.writeFileSync(file, JSON.stringify({ "editor.tabSize": 2, [KEYNAME]: [{ name: "FOO", value: "1" }, entry] }));
    const r = pointWorkspaceAtProxy(d, "http://127.0.0.1:47822");
    if (!("undo" in r)) throw new Error("expected success");
    r.undo();
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after["editor.tabSize"]).toBe(2);
    expect(after[KEYNAME]).toEqual([{ name: "FOO", value: "1" }]); // the user's entry stays, the stale one is gone
  });

  it("isLoopbackEntry only matches our own kind of entry", async () => {
    const { isLoopbackEntry } = await import("./ide-settings");
    expect(isLoopbackEntry(entry)).toBe(true);
    expect(isLoopbackEntry({ name: "ANTHROPIC_BASE_URL", value: "http://localhost:9" })).toBe(true);
    expect(isLoopbackEntry({ name: "ANTHROPIC_BASE_URL", value: "https://gateway.example.com" })).toBe(false);
    expect(isLoopbackEntry({ name: "FOO", value: "http://127.0.0.1:1" })).toBe(false);
    expect(isLoopbackEntry(null)).toBe(false);
  });

  it("removeStaleEntry removes a dead entry, keeps a live one unless forced, and leaves the user's own entries", async () => {
    const { removeStaleEntry } = await import("./ide-settings");
    const d = tmp();
    const file = path.join(d, "settings.json");
    const write = () => fs.writeFileSync(file, JSON.stringify({ a: 1, [KEYNAME]: [{ name: "FOO", value: "1" }, entry] }));
    write();
    expect((await removeStaleEntry(file, async () => true)).action).toBe("kept-live");
    expect(fs.readFileSync(file, "utf8")).toContain("47821");
    expect((await removeStaleEntry(file, async () => false)).action).toBe("removed");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ a: 1, [KEYNAME]: [{ name: "FOO", value: "1" }] });
    write();
    expect((await removeStaleEntry(file, async () => true, true)).action).toBe("removed");
    expect((await removeStaleEntry(file, async () => false)).action).toBe("none");
  });

  it("removeStaleEntry leaves a settings file with comments alone and says so", async () => {
    const { removeStaleEntry } = await import("./ide-settings");
    const d = tmp();
    const file = path.join(d, "settings.json");
    const text = `{\n // mine\n "${KEYNAME}": [{"name":"ANTHROPIC_BASE_URL","value":"http://127.0.0.1:47821"}]\n}`;
    fs.writeFileSync(file, text);
    expect(await removeStaleEntry(file, async () => false)).toMatchObject({ action: "needs-manual", url: "http://127.0.0.1:47821" });
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect((await removeStaleEntry(path.join(d, "missing.json"), async () => false)).action).toBe("none");
  });
});
