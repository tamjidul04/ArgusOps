import { describe, it, expect } from "vitest";
import { parseRunArgs } from "./args";

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
