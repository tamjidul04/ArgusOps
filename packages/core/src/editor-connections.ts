import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { JobError } from "./autopilot-jobs";
import { checkProjectFolder } from "./autopilot-runner";
import { LocalHub } from "./hub";
import { pointWorkspaceAtProxy, removeStaleEntry } from "./ide-settings";
import { loadPrices } from "./prices";
import { runAgent } from "./run";
import type { Store } from "./store";

/**
 * Connecting the Claude Code panel in an editor (VS Code, Antigravity, Cursor) from the app: what `argus ide` does in a
 * terminal. For a project folder, the engine starts a supervising proxy and writes one workspace setting pointing the
 * panel at it. Disconnecting, or closing ArgusOps, puts the settings file back as it was. Folders that were connected
 * are remembered, so a setting left behind by a crash is removed the next time ArgusOps starts.
 */

export interface EditorConnection {
  folder: string;
  url: string;
  since: number;
}

interface Live extends EditorConnection {
  stop: AbortController;
  done: Promise<number>;
  undo: () => void;
}

export function portIsLive(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port });
    const end = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => end(false));
    s.once("connect", () => end(true));
    s.once("error", () => end(false));
  });
}

export class EditorConnections {
  private readonly live = new Map<string, Live>();
  private readonly file: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly o: { store: Store; env?: NodeJS.ProcessEnv; run?: typeof runAgent }) {
    this.file = path.join(o.store.root, "editor-connections.json");
    this.env = o.env ?? process.env;
  }

  private remembered(): string[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  private remember(folders: string[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify([...new Set(folders)], null, 2));
  }

  list(): EditorConnection[] {
    return [...this.live.values()].map(({ folder, url, since }) => ({ folder, url, since }));
  }

  /** Removes settings that point at a proxy that is no longer running, in folders ArgusOps connected before. */
  async cleanupStale(): Promise<string[]> {
    const cleaned: string[] = [];
    const keep: string[] = [];
    for (const folder of this.remembered()) {
      if (this.live.has(folder)) {
        keep.push(folder);
        continue;
      }
      const r = await removeStaleEntry(path.join(folder, ".vscode", "settings.json"), (p) => portIsLive(p));
      if (r.action === "removed") cleaned.push(folder);
      if (r.action === "kept-live") keep.push(folder);
    }
    this.remember(keep);
    return cleaned;
  }

  async connect(input: unknown): Promise<EditorConnection> {
    const checked = checkProjectFolder(input, this.o.store.root);
    if (!checked.ok) throw new JobError(400, checked.error);
    const folder = checked.root;
    const existing = this.live.get(folder);
    if (existing) return { folder, url: existing.url, since: existing.since };

    const store = this.o.store;
    const prices = loadPrices(store.root);
    const stop = new AbortController();
    let url = "";
    const done = (this.o.run ?? runAgent)({
      label: `Claude Code · ${path.basename(folder)} (editor)`,
      type: "CLAUDE",
      args: [],
      provider: "anthropic",
      upstream: this.env.ARGUS_UPSTREAM_ANTHROPIC || "https://api.anthropic.com",
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      cwd: folder,
      hub: new LocalHub(store, prices),
      supervise: { store, root: folder },
      routing: { config: () => store.config().routing, prices, root: folder },
      stopSignal: stop.signal,
      onReady: (u) => (url = u),
      write: () => undefined,
    });
    for (let i = 0; i < 100 && !url; i++) await new Promise((r) => setTimeout(r, 50));
    if (!url) {
      stop.abort();
      await done.catch(() => undefined);
      throw new JobError(500, "Could not start the supervisor for that folder.");
    }
    const pointed = pointWorkspaceAtProxy(folder, url);
    if ("error" in pointed) {
      stop.abort();
      await done.catch(() => undefined);
      throw new JobError(409, `${pointed.error} Use argus ide in that folder, or remove the comments.`);
    }
    const conn: Live = { folder, url, since: Date.now(), stop, done, undo: pointed.undo };
    this.live.set(folder, conn);
    this.remember([...this.remembered(), folder]);
    return { folder, url, since: conn.since };
  }

  async disconnect(input: unknown): Promise<void> {
    const key = typeof input === "string" ? [...this.live.keys()].find((k) => k === input || path.resolve(k) === path.resolve(input)) : undefined;
    const conn = key ? this.live.get(key) : undefined;
    if (!conn || !key) throw new JobError(404, "That folder is not connected.");
    this.live.delete(key);
    conn.undo();
    conn.stop.abort();
    await conn.done.catch(() => undefined);
    this.remember(this.remembered().filter((f) => f !== key));
  }

  /** Disconnects everything (ArgusOps is closing). */
  async close(): Promise<void> {
    for (const folder of [...this.live.keys()]) await this.disconnect(folder).catch(() => undefined);
  }
}
