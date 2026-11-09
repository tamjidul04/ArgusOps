import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  apiUrl: string;
  token?: string;
  user?: { id: string; email: string; name: string };
}

export const DEFAULT_API_URL = "http://localhost:3000";

export function configDir(): string {
  return process.env.ARGUS_CONFIG_DIR || path.join(os.homedir(), ".argus");
}
const configFile = () => path.join(configDir(), "config.json");

/** Saved settings, with environment overrides (ARGUS_API_URL, ARGUS_API_KEY) applied on top. */
export function loadConfig(): Config {
  let saved: Partial<Config> = {};
  try {
    saved = JSON.parse(fs.readFileSync(configFile(), "utf8")) as Partial<Config>;
  } catch {
    // no config yet
  }
  return {
    apiUrl: (process.env.ARGUS_API_URL || saved.apiUrl || DEFAULT_API_URL).replace(/\/+$/, ""),
    token: process.env.ARGUS_API_KEY || saved.token,
    user: saved.user,
  };
}

/** The credential file holds a secret, so keep it private to the user. */
export function saveConfig(cfg: Config): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(configFile(), 0o600);
  } catch {
    // not supported on every filesystem (e.g. Windows); the user profile directory is already private
  }
}

export function clearToken(): void {
  const cfg = loadConfig();
  saveConfig({ apiUrl: cfg.apiUrl });
}
