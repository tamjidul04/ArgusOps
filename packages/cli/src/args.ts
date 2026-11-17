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

export const ANTHROPIC_UPSTREAM = "https://api.anthropic.com";
export const OPENAI_UPSTREAM = "https://api.openai.com";

/** The provider's defaults. Add a provider here and in core/src/adapters.ts. */
const PROVIDERS: Record<string, { upstream: string; baseUrlEnv: string; overrideEnv: string; type: string }> = {
  anthropic: { upstream: ANTHROPIC_UPSTREAM, baseUrlEnv: "ANTHROPIC_BASE_URL", overrideEnv: "ARGUS_UPSTREAM_ANTHROPIC", type: "CLAUDE" },
  openai: { upstream: OPENAI_UPSTREAM, baseUrlEnv: "OPENAI_BASE_URL", overrideEnv: "ARGUS_UPSTREAM_OPENAI", type: "OPENAI" },
};

function pickUpstream(provider: string, flag: string | undefined, env: Record<string, string | undefined>): { ok: true; upstream: string } | { ok: false; error: string } {
  const p = PROVIDERS[provider];
  if (!p) return { ok: false, error: `Provider "${provider}" isn't supported yet. Supported: ${Object.keys(PROVIDERS).join(", ")}.` };
  const override = flag ?? env[p.overrideEnv];
  if (!override) return { ok: true, upstream: p.upstream };
  try {
    const u = new URL(override);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
    return { ok: true, upstream: override.replace(/\/+$/, "") };
  } catch {
    return { ok: false, error: `"${override}" isn't a valid URL for --upstream.` };
  }
}

/**
 * Codex ignores OPENAI_BASE_URL (verified with codex-cli 0.169: it went straight to api.openai.com), so it is pointed
 * at the proxy with its own provider settings. `{ARGUSOPS_BASE_URL}` is filled in with the proxy's address at launch.
 * It authenticates with OPENAI_API_KEY; a ChatGPT sign-in uses a different OpenAI service and is not supported yet.
 */
export const CODEX_PROVIDER_ARGS = [
  "-c",
  'model_providers.argusops={ name="ArgusOps", base_url="{ARGUSOPS_BASE_URL}", wire_api="responses", env_key="OPENAI_API_KEY" }',
  "-c",
  'model_provider="argusops"',
];

const PRESETS: Record<string, Omit<RunSpec, "offline" | "args"> & { presetArgs?: string[] }> = {
  claude: {
    label: "Claude Code",
    type: "CLAUDE",
    command: "claude",
    provider: "anthropic",
    upstream: ANTHROPIC_UPSTREAM,
    baseUrlEnv: "ANTHROPIC_BASE_URL",
  },
  codex: {
    label: "OpenAI Codex",
    type: "CODEX",
    command: "codex",
    provider: "openai",
    upstream: OPENAI_UPSTREAM,
    baseUrlEnv: "OPENAI_BASE_URL",
    presetArgs: CODEX_PROVIDER_ARGS,
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
      baseUrlEnv: (PROVIDERS[values["--provider"] ?? "anthropic"] ?? PROVIDERS.anthropic).baseUrlEnv,
    };
  } else {
    const preset = PRESETS[first];
    if (!preset) {
      return { ok: false, error: `Unknown agent "${first}". Supported: ${Object.keys(PRESETS).join(", ")}. Or run any command with: argus run -- <command>` };
    }
    const { presetArgs, ...rest } = preset;
    spec = { ...rest, label: values["--name"] ?? preset.label, args: [...(presetArgs ?? []), ...argv.slice(i + 1)] };
  }

  const picked = pickUpstream(spec.provider, values["--upstream"], env);
  if (!picked.ok) return picked;
  spec.upstream = picked.upstream;
  spec.baseUrlEnv = PROVIDERS[spec.provider].baseUrlEnv;
  return { ok: true, spec: { ...spec, offline } };
}

/* ----------------------------------- argus proxy ----------------------------------- */

/** An unusual, fixed port so it can be written once into an editor setting and stay valid. */
export const DEFAULT_PROXY_PORT = 47821;

export interface ProxySpec {
  offline: boolean;
  label: string;
  type: string;
  provider: string;
  upstream: string;
  baseUrlEnv: string;
  port: number;
}

export type ParsedProxy = { ok: true; spec: ProxySpec } | { ok: false; error: string };

/**
 * `argus proxy [--provider anthropic|openai] [--port <n>] [--name <label>] [--offline] [--upstream <url>]`
 * Runs the supervising proxy on its own, for an agent that something else launches (the Claude Code panel in
 * VS Code, for example) and that is pointed here with ANTHROPIC_BASE_URL.
 */
export function parseProxyArgs(argv: string[], env: Record<string, string | undefined> = process.env): ParsedProxy {
  let offline = false;
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) return { ok: false, error: `Unexpected "${tok}". \`argus proxy\` takes only options. To run an agent yourself, use \`argus run claude\`.` };
    if (tok === "--offline") {
      offline = true;
      continue;
    }
    const eq = tok.indexOf("=");
    const flag = eq === -1 ? tok : tok.slice(0, eq);
    if (!["--port", "--name", "--upstream", "--provider"].includes(flag)) return { ok: false, error: `Unknown option ${flag}.` };
    const value = eq === -1 ? argv[++i] : tok.slice(eq + 1);
    if (!value || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    values[flag] = value;
  }

  const port = values["--port"] === undefined ? DEFAULT_PROXY_PORT : Number(values["--port"]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: "--port must be a whole number between 1024 and 65535." };

  const provider = values["--provider"] ?? "anthropic";
  const picked = pickUpstream(provider, values["--upstream"], env);
  if (!picked.ok) return picked;
  const prov = PROVIDERS[provider];

  return {
    ok: true,
    spec: { offline, label: values["--name"] ?? (provider === "anthropic" ? "Claude Code (IDE)" : "OpenAI agent (IDE)"), type: prov.type, provider, upstream: picked.upstream, baseUrlEnv: prov.baseUrlEnv, port },
  };
}
