import type { AgentView } from "./model";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export interface AgentsResponse {
  user: { name: string; email: string };
  plan: { name: string; maxAgents: number; tokensRemaining: number } | null;
  unreadNotifications: number;
  agents: AgentView[];
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

const TIMEOUT_MS = 8000;

/** Talks to the ArgusOps server with a device key. Never sends anything but control commands and reads. */
export class ArgusClient {
  constructor(
    private baseUrl: string,
    private key?: string
  ) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "argusops-vscode" };
    if (init.auth !== false && this.key) headers["x-argus-key"] = this.key;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual", // never follow a redirect with the key attached
      });
    } catch (e) {
      throw new ApiError(0, "network", e instanceof Error ? e.message : "network error");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, String(json.error ?? `http_${res.status}`), String(json.message ?? json.error ?? res.statusText));
    return json as T;
  }

  agents() {
    return this.call<AgentsResponse>("/api/agents");
  }

  /** Resume a paused agent, optionally telling it something. */
  resume(agentId: string, hint?: string) {
    return this.call<{ message?: string }>("/api/guardrails", { body: { action: "SEND_NUDGE", agentId, hintText: hint?.trim() || undefined } });
  }

  stop(agentId: string) {
    return this.call<{ message?: string }>("/api/guardrails", { body: { action: "TRIGGER_KILL_SWITCH", agentId } });
  }

  approveSuggestion(id: string, text?: string) {
    return this.call<{ message?: string }>("/api/rewrites", { body: { action: "apply", id, text } });
  }

  dismissSuggestion(id: string) {
    return this.call<{ message?: string }>("/api/rewrites", { body: { action: "dismiss", id } });
  }

  deviceCode(name: string) {
    return this.call<DeviceCode>("/api/device/code", { body: { name }, auth: false });
  }

  pollToken(deviceCode: string) {
    return this.call<{ access_token: string; user: { email: string; name: string } }>("/api/device/token", { body: { device_code: deviceCode }, auth: false });
  }
}
