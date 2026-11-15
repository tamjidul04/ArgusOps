import { describe, it, expect } from "vitest";
import { clip, desktopCommand, desktopNotify } from "./notify";

const hostile = `"; rm -rf ~ #' $(whoami) \`id\` & calc.exe`;

describe("desktopCommand", () => {
  it("Windows: text travels in environment variables, never inside the script", () => {
    const c = desktopCommand("win32", hostile, hostile)!;
    expect(c.command).toBe("powershell.exe");
    const script = c.args[c.args.length - 1];
    expect(script).not.toContain("rm -rf");
    expect(script).not.toContain("whoami");
    expect(script).toContain("$env:ARGUS_NOTIFY_TITLE");
    expect(c.env?.ARGUS_NOTIFY_TITLE).toContain("rm -rf");
    expect(c.args).toContain("-NonInteractive");
  });

  it("macOS: text is passed as separate arguments to a fixed AppleScript", () => {
    const c = desktopCommand("darwin", hostile, "body")!;
    expect(c.command).toBe("osascript");
    const scriptParts = c.args.filter((_, i) => c.args[i - 1] === "-e");
    expect(scriptParts.join(" ")).not.toContain("rm -rf");
    expect(c.args.slice(-2)[0]).toContain("rm -rf"); // data, not code
  });

  it("Linux: notify-send with the text as arguments", () => {
    expect(desktopCommand("linux", "Agent paused", "body")).toEqual({ command: "notify-send", args: ["--app-name=ArgusOps", "Agent paused", "body"] });
  });

  it("returns null where it doesn't know how", () => {
    expect(desktopCommand("aix", "t", "b")).toBeNull();
  });

  it("keeps notifications short and on one line", () => {
    const c = desktopCommand("linux", "x".repeat(300), "line one\n\nline   two")!;
    expect(c.args[1].length).toBeLessThanOrEqual(80);
    expect(c.args[2]).toBe("line one line two");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});

describe("desktopNotify", () => {
  it("can be switched off with ARGUS_NO_DESKTOP_NOTIFY", () => {
    expect(desktopNotify("t", "b", { ARGUS_NO_DESKTOP_NOTIFY: "1" })).toBe(false);
  });
});
