import fs from "node:fs";
import path from "node:path";

/**
 * The list of AI coding agents ArgusOps knows about, as plain data so adding one is a small change (and users can add
 * their own in `<home>/agents.json`).
 *
 * `support` is deliberately conservative and describes the TRAFFIC layer (usage, loops, pause, stop, instructions):
 *   supported - proven with a real run of this agent
 *   possible  - the agent has a base-URL setting, so it should work, but it has not been proven yet (or needs an adapter we lack)
 *   observe   - no way to route its traffic through ArgusOps; only the workspace checks (argus watch / check) apply
 * Whatever the support level, the workspace layer works for any agent that edits files.
 */

export type Support = "supported" | "possible" | "observe";

export interface AgentEntry {
  id: string;
  name: string;
  /** Extension ids (publisher.name) in VS Code-style editors. */
  extensionIds: string[];
  /** Program names when the agent is a command-line tool or runs as a process (lower case, no .exe). */
  binaries: string[];
  support: Support;
  /** The API format its traffic uses, which decides which ArgusOps proxy adapter it needs. */
  api?: "anthropic" | "openai" | "gemini";
  /** Whether ArgusOps can start it itself and talk to it (Autopilot). */
  spawnable: boolean;
  /** How to route it through ArgusOps, when that can be done automatically. */
  connect?: { kind: "vscode-env"; setting: string; envVar: string };
  /** Plain-language note shown to the user. */
  note: string;
}

export const BUILT_IN_AGENTS: AgentEntry[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    extensionIds: ["anthropic.claude-code"],
    binaries: ["claude"],
    support: "supported",
    api: "anthropic",
    spawnable: true,
    connect: { kind: "vscode-env", setting: "claudeCode.environmentVariables", envVar: "ANTHROPIC_BASE_URL" },
    note: "Full supervision: usage, loops, pause, stop, instructions, and checks after each turn. Connect an editor panel with: argus ide",
  },
  {
    id: "roo-code",
    name: "Roo Code",
    extensionIds: ["rooveterinaryinc.roo-cline"],
    binaries: [],
    support: "possible",
    api: "anthropic",
    spawnable: false,
    note: "Has a custom base URL option for its Anthropic provider; set it to your ArgusOps proxy (argus proxy) in the extension's settings. Not verified yet. The workspace checks (argus watch) work now.",
  },
  {
    id: "cline",
    name: "Cline",
    extensionIds: ["saoudrizwan.claude-dev"],
    binaries: [],
    support: "possible",
    api: "anthropic",
    spawnable: false,
    note: "Has a custom base URL option for its Anthropic provider; set it to your ArgusOps proxy (argus proxy) in the extension's settings. Not verified yet. The workspace checks (argus watch) work now.",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    extensionIds: ["openai.chatgpt"],
    binaries: ["codex"],
    support: "possible",
    api: "openai",
    spawnable: false,
    note: "ArgusOps now speaks the OpenAI formats: run it with `argus run codex`, or point it at `argus proxy --provider openai`. Built from the published API and tested with simulated traffic, not yet run with a real Codex session. If Codex is signed in with ChatGPT instead of an API key, it may use a service that ignores the base URL. The workspace checks (argus watch) work either way.",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    extensionIds: [],
    binaries: ["gemini"],
    support: "possible",
    api: "gemini",
    spawnable: false,
    note: "Should accept a base URL, but ArgusOps does not speak the Gemini API format yet, so only the workspace checks (argus watch) work for now.",
  },
  {
    id: "continue",
    name: "Continue",
    extensionIds: ["continue.continue"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "Models are set in its own config file; ArgusOps cannot route it automatically. The workspace checks (argus watch) work.",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    extensionIds: ["github.copilot", "github.copilot-chat"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "Talks only to GitHub's service, so only the workspace checks (argus watch) apply.",
  },
  {
    id: "gemini-code-assist",
    name: "Gemini Code Assist",
    extensionIds: ["google.geminicodeassist"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "Talks only to Google's service, so only the workspace checks (argus watch) apply.",
  },
  {
    id: "antigravity-agent",
    name: "Antigravity agent",
    extensionIds: ["google.google-antigravity"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "The editor's built-in agent has no base URL setting, so only the workspace checks (argus watch) apply.",
  },
  {
    id: "cody",
    name: "Sourcegraph Cody",
    extensionIds: ["sourcegraph.cody-ai"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "Talks only to Sourcegraph's service, so only the workspace checks (argus watch) apply.",
  },
  {
    id: "amazon-q",
    name: "Amazon Q",
    extensionIds: ["amazonwebservices.amazon-q-vscode"],
    binaries: [],
    support: "observe",
    spawnable: false,
    note: "Talks only to AWS, so only the workspace checks (argus watch) apply.",
  },
];

const SUPPORTS = new Set<Support>(["supported", "possible", "observe"]);

function validEntry(e: unknown): e is AgentEntry {
  const x = e as Partial<AgentEntry> | null;
  return (
    !!x &&
    typeof x.id === "string" &&
    /^[a-z0-9][a-z0-9-]{0,40}$/.test(x.id) &&
    typeof x.name === "string" &&
    Array.isArray(x.extensionIds) &&
    x.extensionIds.every((s) => typeof s === "string") &&
    Array.isArray(x.binaries) &&
    x.binaries.every((s) => typeof s === "string") &&
    SUPPORTS.has(x.support as Support) &&
    typeof x.note === "string"
  );
}

/** The built-in agents plus any the user listed in `<home>/agents.json` (same shape; a matching id replaces the built-in). */
export function loadRegistry(home?: string): AgentEntry[] {
  let extra: AgentEntry[] = [];
  if (home) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(home, "agents.json"), "utf8"));
      if (Array.isArray(parsed)) {
        extra = parsed.filter(validEntry).map((e) => ({
          ...e,
          // a user-added entry can claim "possible" or "observe" but never "supported": only a real run proves that
          support: e.support === "supported" ? "possible" : e.support,
          spawnable: !!e.spawnable,
          // and may not install a connect recipe that writes settings (that is code we ship, not data a file can add)
          connect: undefined,
        }));
      }
    } catch {
      // no file, or not valid JSON: built-in agents only
    }
  }
  const override = new Set(extra.map((e) => e.id));
  return [...BUILT_IN_AGENTS.filter((a) => !override.has(a.id)), ...extra];
}
