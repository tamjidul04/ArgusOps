import { describe, it, expect } from "vitest";
import { DEFAULT_PROXY_PORT, parseProxyArgs, parseRunArgs } from "./args";

const ok = (argv: string[], env: Record<string, string> = {}) => {
  const r = parseRunArgs(argv, env);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};
const bad = (argv: string[], env: Record<string, string> = {}) => {
  const r = parseRunArgs(argv, env);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("argus run", () => {
  it("runs Claude Code and passes everything after it to the agent", () => {
    const s = ok(["claude", "--resume", "--model", "opus"]);
    expect(s).toMatchObject({ label: "Claude Code", type: "CLAUDE", command: "claude", provider: "anthropic", baseUrlEnv: "ANTHROPIC_BASE_URL", offline: false });
    expect(s.args).toEqual(["--resume", "--model", "opus"]);
    expect(s.upstream).toBe("https://api.anthropic.com");
  });

  it("takes argus options only before the agent", () => {
    const s = ok(["--offline", "--name", "Fixer", "claude", "--offline"]);
    expect(s.offline).toBe(true);
    expect(s.label).toBe("Fixer");
    expect(s.args).toEqual(["--offline"]); // belongs to claude
    expect(ok(["--name=Fixer", "claude"]).label).toBe("Fixer");
  });

  it("runs any command after --", () => {
    const s = ok(["--", "node", "agent.js", "--flag"]);
    expect(s).toMatchObject({ command: "node", args: ["agent.js", "--flag"], label: "node", type: "NODE" });
    expect(ok(["--", "C:\\tools\\My-Agent.exe"]).type).toBe("MY_AGENT");
    expect(ok(["--", "9lives"]).type).toBe("AGENT"); // can't start with a digit
  });

  it("lets the upstream be overridden, with validation", () => {
    expect(ok(["--upstream", "http://127.0.0.1:9999/", "claude"]).upstream).toBe("http://127.0.0.1:9999");
    expect(ok(["claude"], { ARGUS_UPSTREAM_ANTHROPIC: "https://gw.example.com" }).upstream).toBe("https://gw.example.com");
    expect(bad(["--upstream", "ftp://x", "claude"])).toContain("valid URL");
    expect(bad(["--upstream", "nonsense", "claude"])).toContain("valid URL");
  });

  it("explains mistakes", () => {
    expect(bad([])).toContain("Say what to run");
    expect(bad(["--offline"])).toContain("Say what to run");
    expect(bad(["--"])).toContain("Nothing to run");
    expect(bad(["codex"])).toContain('Unknown agent "codex"');
    expect(bad(["--bogus", "claude"])).toContain("Unknown option --bogus");
    expect(bad(["--name"])).toContain("needs a value");
    expect(bad(["--name", "--offline", "claude"])).toContain("needs a value");
    expect(bad(["--provider", "openai", "--", "x"])).toContain("isn't supported yet");
  });
});

describe("argus proxy", () => {
  const okp = (argv: string[], env: Record<string, string> = {}) => {
    const r = parseProxyArgs(argv, env);
    if (!r.ok) throw new Error(r.error);
    return r.spec;
  };
  const badp = (argv: string[], env: Record<string, string> = {}) => {
    const r = parseProxyArgs(argv, env);
    if (r.ok) throw new Error("expected an error");
    return r.error;
  };

  it("has sensible defaults: a fixed unusual port and a name for the IDE", () => {
    expect(okp([])).toMatchObject({ port: DEFAULT_PROXY_PORT, label: "Claude Code (IDE)", type: "CLAUDE", provider: "anthropic", offline: false, baseUrlEnv: "ANTHROPIC_BASE_URL", upstream: "https://api.anthropic.com" });
    expect(DEFAULT_PROXY_PORT).toBe(47821);
  });

  it("accepts a port, name, offline and upstream", () => {
    const s = okp(["--port", "50123", "--name=VS Code", "--offline", "--upstream", "http://127.0.0.1:9000/"]);
    expect(s).toMatchObject({ port: 50123, label: "VS Code", offline: true, upstream: "http://127.0.0.1:9000" });
    expect(okp([], { ARGUS_UPSTREAM_ANTHROPIC: "http://localhost:8787" }).upstream).toBe("http://localhost:8787");
  });

  it("rejects a bad port, an unknown option and anything that is not an option", () => {
    for (const p of ["80", "70000", "abc", "1.5", "-1"]) expect(badp(["--port", p])).toMatch(/port/i);
    expect(badp(["--port"])).toMatch(/needs a value/);
    expect(badp(["--nope"])).toMatch(/Unknown option/);
    expect(badp(["claude"])).toMatch(/argus run claude/);
    expect(badp(["--upstream", "ftp://x"])).toMatch(/valid URL/);
  });
});
