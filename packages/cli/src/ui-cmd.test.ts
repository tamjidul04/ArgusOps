import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../core/src/store";
import { findUiDir, uiCommand } from "./ui-cmd";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "argus-ui-"));
  dirs.push(d);
  return d;
};
const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};

describe("argus ui", () => {
  it("finds the page that ships in the repository", () => {
    const dir = findUiDir();
    expect(dir && fs.existsSync(path.join(dir, "index.html"))).toBe(true);
  });

  it("serves the page, opens it with the token in the fragment, and a second run reuses the first", async () => {
    const store = new Store(tmp());
    const a = io();
    const opened: string[] = [];
    const stop = new AbortController();
    // port 0: any free port
    const first = uiCommand(["--port", "0"], store, a.io, { version: "1", open: (u) => opened.push(u), signal: stop.signal });
    for (let i = 0; i < 100 && !opened.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.hash).toBe(`#t=${store.token()}`);
    expect((await fetch(url.origin + "/")).status).toBe(200);
    expect((await fetch(url.origin + "/api/agents")).status).toBe(401); // the page is public, the data is not
    expect(a.out.join("\n")).not.toContain(store.token()); // the token is never printed when it is opened for you

    const b = io();
    const reopened: string[] = [];
    expect(await uiCommand(["--port", String(url.port)], store, b.io, { version: "1", open: (u) => reopened.push(u) })).toBe(0);
    expect(b.out.join("\n")).toContain("already running");
    expect(reopened[0]).toBe(opened[0]);

    stop.abort();
    expect(await first).toBe(0);
  });

  it("--no-open prints the address (with the token) instead", async () => {
    const store = new Store(tmp());
    const a = io();
    const stop = new AbortController();
    const run = uiCommand(["--port", "0", "--no-open"], store, a.io, { version: "1", signal: stop.signal });
    for (let i = 0; i < 100 && a.out.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(a.out.join("\n")).toContain(`#t=${store.token()}`);
    stop.abort();
    await run;
  });

  it("explains bad options and a missing page", async () => {
    const store = new Store(tmp());
    const a = io();
    expect(await uiCommand(["--bogus"], store, a.io, { version: "1" })).toBe(1);
    expect(await uiCommand(["--port", "99999"], store, a.io, { version: "1" })).toBe(1);
    expect(await uiCommand([], store, a.io, { version: "1", uiDir: null })).toBe(2);
    expect(a.err.join("\n")).toContain("Reinstall");
  });
});
