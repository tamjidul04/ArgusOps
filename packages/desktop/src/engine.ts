import { startControlApi } from "../../core/src/control-api";
import type { Store } from "../../core/src/store";
import { webhookNotifier } from "../../core/src/webhooks";

export interface Engine {
  /** http://127.0.0.1:<port> */
  url: string;
  /** The address to open: the page with the private token in the fragment (never sent to any server). */
  openUrl: string;
  /** True when this app started the engine and should stop it; false when an engine was already running (for example one started by `argus serve`). */
  owned: boolean;
  close(): Promise<void>;
}

/** Uses the ArgusOps engine already running on this port, or starts one that serves the app's page. */
export async function ensureEngine(store: Store, opts: { port?: number; uiDir: string; version: string }): Promise<Engine> {
  const port = opts.port ?? store.config().apiPort;
  const token = store.token();
  if (port > 0) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      const j = (await r.json()) as { app?: string };
      if (j.app === "argusops") {
        const url = `http://127.0.0.1:${port}`;
        return { url, openUrl: `${url}/#t=${token}`, owned: false, close: async () => undefined };
      }
    } catch {
      // nothing there: start one
    }
  }
  const api = await startControlApi({ store, port, version: opts.version, uiDir: opts.uiDir, onNotification: webhookNotifier(store) });
  return { url: api.url, openUrl: `${api.url}/#t=${token}`, owned: true, close: () => api.close() };
}

/** How many agents are paused and waiting for you (a run that stopped checking in does not count). */
export function agentsNeedingYou(store: Store, now = Date.now()): number {
  return store.agents().filter((a) => a.status === "PAUSED" && now - a.lastSeen <= 30_000).length;
}
