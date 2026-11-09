import type { SyncReply } from "./state";

export class CloudError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface SyncPayload {
  run: { id: string; start?: boolean; end?: boolean; agent: { name: string; type: string } };
  events: unknown[];
  telemetry?: { ram_mb?: number; cpu_percent?: number; current_task?: string };
}

export interface SyncResponse extends SyncReply {
  ok: boolean;
  agentId?: string;
  quota?: { remaining: number };
}

const TIMEOUT_MS = 8000;

/** Talks to the ArgusOps cloud. Only usage numbers and incidents are ever sent: never prompts or code. */
export class CloudClient {
  constructor(
    private baseUrl: string,
    private token?: string
  ) {}

  private async request<T>(path: string, init: { method: string; body?: unknown; auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "argus-cli" };
    if (init.auth !== false && this.token) headers["x-argus-key"] = this.token;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new CloudError(0, "network", e instanceof Error ? e.message : "network error");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(json.error ?? "http_" + res.status);
      throw new CloudError(res.status, code, String(json.message ?? json.error_description ?? json.error ?? res.statusText));
    }
    return json as T;
  }

  deviceCode(name: string) {
    return this.request<DeviceCode>("/api/device/code", { method: "POST", body: { name }, auth: false });
  }

  pollToken(deviceCode: string) {
    return this.request<{ access_token: string; user: { id: string; email: string; name: string } }>("/api/device/token", {
      method: "POST",
      body: { device_code: deviceCode },
      auth: false,
    });
  }

  me() {
    return this.request<{ user: { id: string; email: string; name: string }; subscription: { plan_name: string; max_agents: number } | null; active_agents: number }>(
      "/api/auth/me",
      { method: "GET" }
    );
  }

  sync(payload: SyncPayload) {
    return this.request<SyncResponse>("/api/cli/sync", { method: "POST", body: payload });
  }
}
