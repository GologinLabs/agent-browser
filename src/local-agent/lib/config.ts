import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentConfig } from "./types";
import { resolveOrbitaExecutable } from "./runtime";

type FileConfig = Partial<
  Pick<AgentConfig, "token" | "defaultProfileId" | "daemonPort" | "headless" | "executablePath" | "tmpdir">
>;

const DEFAULT_DAEMON_PORT = 44778;
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
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
  const baseDir = path.join(homeDir, ".gologin-local-agent-browser");
  const configPath = path.join(baseDir, "config.json");
  const logPath = path.join(baseDir, "daemon.log");
  const registryPath = path.join(baseDir, "registry.json");
  const jobsDir = path.join(baseDir, "jobs");
  const fileConfig = readConfigFile(configPath);
  const daemonPort = parsePort(process.env.GOLOGIN_DAEMON_PORT, fileConfig.daemonPort ?? DEFAULT_DAEMON_PORT);
  const socketPath = path.join(os.tmpdir(), `gologin-local-agent-browser-${daemonPort}.sock`);
  const executable = resolveOrbitaExecutable({
    envPath: process.env.GOLOGIN_EXECUTABLE_PATH,
    configPath: fileConfig.executablePath,
  });

  return {
    token: process.env.GOLOGIN_TOKEN ?? process.env.GOLOGIN_API_TOKEN ?? fileConfig.token,
    defaultProfileId: process.env.GOLOGIN_PROFILE_ID ?? fileConfig.defaultProfileId,
    daemonPort,
    daemonHost: DEFAULT_DAEMON_HOST,
    stateDir: baseDir,
    jobsDir,
    socketPath,
    configPath,
    logPath,
    registryPath,
    headless: parseBoolean(process.env.GOLOGIN_HEADLESS, fileConfig.headless ?? false),
    executablePath: executable.path,
    executablePathSource: executable.source,
    executablePathExists: executable.exists,
    tmpdir: process.env.GOLOGIN_TMPDIR ?? fileConfig.tmpdir,
    navigationTimeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS,
    actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS
  };
}

export function ensureStateDir(config: AgentConfig): void {
  fs.mkdirSync(config.stateDir, { recursive: true });
}
