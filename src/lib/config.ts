import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentConfig } from "./types";

type FileConfig = Partial<Pick<AgentConfig, "token" | "defaultProfileId" | "connectBase" | "daemonPort">>;

const DEFAULT_CONNECT_BASE = "https://cloudbrowser.gologin.com/connect";
const DEFAULT_DAEMON_PORT = 44777;
const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function readConfigFile(configPath: string): FileConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as FileConfig;
    return parsed;
  } catch {
    return {};
  }
}

export function loadConfig(): AgentConfig {
  const homeDir = os.homedir();
  const baseDir = path.join(homeDir, ".gologin-agent-browser");
  const configPath = path.join(baseDir, "config.json");
  const logPath = path.join(baseDir, "daemon.log");
  const socketPath = path.join(os.tmpdir(), "gologin-agent-browser.sock");
  const fileConfig = readConfigFile(configPath);

  return {
    token: process.env.GOLOGIN_TOKEN ?? fileConfig.token,
    defaultProfileId: process.env.GOLOGIN_PROFILE_ID ?? fileConfig.defaultProfileId,
    connectBase: process.env.GOLOGIN_CONNECT_BASE ?? fileConfig.connectBase ?? DEFAULT_CONNECT_BASE,
    daemonPort: parsePort(process.env.GOLOGIN_DAEMON_PORT, fileConfig.daemonPort ?? DEFAULT_DAEMON_PORT),
    daemonHost: DEFAULT_DAEMON_HOST,
    socketPath,
    configPath,
    logPath,
    navigationTimeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS,
    actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS
  };
}

export function ensureStateDir(config: AgentConfig): void {
  fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
}
