import { runAgent } from "../../core/src/run";
import { ANTHROPIC_UPSTREAM, DEFAULT_PROXY_PORT } from "../../cli/src/args";
import { LocalHub } from "../../core/src/hub";
import { loadPrices } from "../../core/src/prices";
import { Store } from "../../core/src/store";

const VAR = "ANTHROPIC_BASE_URL";

export interface EnvEntry {
  name: string;
  value: string;
}

/** Adds (or replaces) our variable and leaves every other entry as it was. */
export function withProxyEntry(list: unknown, baseUrl: string): EnvEntry[] {
  return [...withoutProxyEntry(list), { name: VAR, value: baseUrl }];
}

/** Removes only our variable, and only when it points at the local proxy; anything the user set themselves stays. */
export function withoutProxyEntry(list: unknown): EnvEntry[] {
  const entries = Array.isArray(list) ? (list as EnvEntry[]) : [];
  return entries.filter((e) => !(e?.name === VAR && typeof e.value === "string" && e.value.startsWith("http://127.0.0.1:")));
}

export interface SuperviseHost {
  readEnv(): unknown;
  writeEnv(list: EnvEntry[] | undefined): Promise<void>;
  log(text: string): void;
}

/**
 * Runs the ArgusOps proxy inside the editor and points the Claude Code panel at it, so there is nothing to start by
 * hand. The setting is only present while the proxy is running, so Claude Code never points at something that is gone.
 */
/** The paused extension now records to the same local store as the CLI. */
function localHub(): LocalHub {
  const store = new Store();
  return new LocalHub(store, loadPrices(store.root));
}

export class Supervisor {
  private abort: AbortController | null = null;
  private done: Promise<number> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wrote = false; // only undo the setting if this window is the one that wrote it
  private wanted: { url: string; key: string } | null = null;

  constructor(
    private readonly host: SuperviseHost,
    private readonly port = DEFAULT_PROXY_PORT
  ) {}

  get running(): boolean {
    return this.abort !== null;
  }

  /** Start for these credentials (or stop when null). Safe to call repeatedly. */
  async set(creds: { url: string; key: string } | null): Promise<void> {
    if (!creds) return this.stop();
    if (this.wanted?.key === creds.key && this.wanted.url === creds.url && (this.running || this.retry)) return;
    await this.stop();
    this.wanted = creds;
    await this.start();
  }

  private async start(): Promise<void> {
    const creds = this.wanted;
    if (!creds) return;
    const abort = new AbortController();
    this.abort = abort;
    const baseUrl = `http://127.0.0.1:${this.port}`;
    this.done = runAgent({
      label: "Claude Code (IDE)",
      type: "CLAUDE",
      args: [],
      provider: "anthropic",
      upstream: ANTHROPIC_UPSTREAM,
      baseUrlEnv: VAR,
      cwd: "ide",
      hub: localHub(),
      port: this.port,
      stopSignal: abort.signal,
      write: (t) => {
        this.host.log(t);
        if (!this.wrote && t.includes("Supervising")) {
          this.wrote = true;
          void this.host.writeEnv(withProxyEntry(this.host.readEnv(), baseUrl));
        }
      },
    }).then(async (code) => {
      if (this.abort === abort) {
        this.abort = null;
        if (this.wrote) await this.host.writeEnv(this.cleaned());
        this.wrote = false;
        // Couldn't start (most likely another VS Code window already runs it): try again later, it may free up.
        if (code === 2 && this.wanted) this.retry = setTimeout(() => ((this.retry = null), void this.start()), 10_000);
      }
      return code;
    });
  }

  private cleaned(): EnvEntry[] | undefined {
    const rest = withoutProxyEntry(this.host.readEnv());
    return rest.length ? rest : undefined;
  }

  async stop(): Promise<void> {
    this.wanted = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const abort = this.abort;
    if (!abort) return;
    this.abort = null;
    abort.abort();
    if (this.wrote) await this.host.writeEnv(this.cleaned());
    this.wrote = false;
    await this.done?.catch(() => undefined);
    this.done = null;
  }
}
