import path from "node:path";

export interface RunSpec {
  offline: boolean;
  label: string;
  type: string;
  command: string;
  args: string[];
  provider: string;
  upstream: string;
  baseUrlEnv: string;
}

export type ParsedRun = { ok: true; spec: RunSpec } | { ok: false; error: string };

const ANTHROPIC_UPSTREAM = "https://api.anthropic.com";

const PRESETS: Record<string, Omit<RunSpec, "offline" | "args">> = {
  claude: {
    label: "Claude Code",
    type: "CLAUDE",
    command: "claude",
    provider: "anthropic",
    upstream: ANTHROPIC_UPSTREAM,
    baseUrlEnv: "ANTHROPIC_BASE_URL",
  },
};

const VALUE_FLAGS = new Set(["--name", "--upstream", "--provider"]);

/**
 * `argus run [options] claude [claude args...]`
 * `argus run [options] -- <command> [args...]`
 * Options must come before the agent; everything after it belongs to the agent.
 */
export function parseRunArgs(argv: string[], env: Record<string, string | undefined> = process.env): ParsedRun {
  let offline = false;
  const values: Record<string, string> = {};
  let i = 0;

  for (; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") break;
    if (!tok.startsWith("--")) break;
    if (tok === "--offline") {
      offline = true;
      continue;
    }
    const eq = tok.indexOf("=");
    const flag = eq === -1 ? tok : tok.slice(0, eq);
    if (!VALUE_FLAGS.has(flag)) return { ok: false, error: `Unknown option ${flag}.` };
    const value = eq === -1 ? argv[++i] : tok.slice(eq + 1);
    if (!value || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    values[flag] = value;
  }

  if (i >= argv.length) return { ok: false, error: "Say what to run, e.g. `argus run claude`." };

  let spec: Omit<RunSpec, "offline">;
  const first = argv[i];

  if (first === "--") {
    const [command, ...args] = argv.slice(i + 1);
    if (!command) return { ok: false, error: "Nothing to run after `--`." };
    const base = path.basename(command).replace(/\.(exe|cmd|bat)$/i, "");
    const type = base.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    spec = {
      label: values["--name"] ?? base,
      type: /^[A-Z][A-Z0-9_]{1,29}$/.test(type) ? type : "AGENT",
      command,
      args,
      provider: values["--provider"] ?? "anthropic",
      upstream: ANTHROPIC_UPSTREAM,
      baseUrlEnv: "ANTHROPIC_BASE_URL",
    };
  } else {
    const preset = PRESETS[first];
    if (!preset) {
      return { ok: false, error: `Unknown agent "${first}". Supported: ${Object.keys(PRESETS).join(", ")}. Or run any command with: argus run -- <command>` };
    }
    spec = { ...preset, label: values["--name"] ?? preset.label, args: argv.slice(i + 1) };
  }

  if (spec.provider !== "anthropic") {
    return { ok: false, error: `Provider "${spec.provider}" isn't supported yet. Supported: anthropic.` };
  }
  const override = values["--upstream"] ?? env.ARGUS_UPSTREAM_ANTHROPIC;
  if (override) {
    try {
      const u = new URL(override);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
      spec.upstream = override.replace(/\/+$/, "");
    } catch {
      return { ok: false, error: `"${override}" isn't a valid URL for --upstream.` };
    }
  }
  return { ok: true, spec: { ...spec, offline } };
}
