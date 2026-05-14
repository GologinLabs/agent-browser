import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExecutablePathSource = "env" | "config" | "detected" | "unset";

export interface ExecutableResolution {
  path?: string;
  source: ExecutablePathSource;
  exists: boolean;
  checkedPaths: string[];
}

export function resolveOrbitaExecutable(options: {
  envPath?: string;
  configPath?: string;
}): ExecutableResolution {
  const envPath = normalizePath(options.envPath);
  if (envPath) {
    return {
      path: envPath,
      source: "env",
      exists: fs.existsSync(envPath),
      checkedPaths: [envPath],
    };
  }

  const configPath = normalizePath(options.configPath);
  if (configPath) {
    return {
      path: configPath,
      source: "config",
      exists: fs.existsSync(configPath),
      checkedPaths: [configPath],
    };
  }

  const candidates = discoverDownloadedOrbitaExecutables();
  const detected = candidates[0];
  if (detected) {
    return {
      path: detected,
      source: "detected",
      exists: true,
      checkedPaths: candidates,
    };
  }

  return {
    path: undefined,
    source: "unset",
    exists: false,
    checkedPaths: candidates,
  };
}

export interface LocalOsInfo {
  os: "mac" | "win" | "lin";
  osSpec?: string;
}

export function detectLocalOsInfo(options: {
  platform?: NodeJS.Platform;
  arch?: string;
  sysctlOutput?: string;
} = {}): LocalOsInfo {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  if (platform === "darwin") {
    return {
      os: "mac",
      osSpec: arch === "arm64" ? parseMacOsSpec(options.sysctlOutput) : undefined,
    };
  }

  if (platform === "win32") {
    return {
      os: "win",
    };
  }

  return {
    os: "lin",
  };
}

function parseMacOsSpec(sysctlOutput?: string): string | undefined {
  const match = sysctlOutput?.match(/Apple\s+(M\d)/i);
  return match?.[1]?.toUpperCase();
}

function normalizePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function discoverDownloadedOrbitaExecutables(): string[] {
  const browserRoot = path.join(os.homedir(), ".gologin", "browser");
  if (!fs.existsSync(browserRoot)) {
    return [];
  }

  const candidates = fs
    .readdirSync(browserRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .map((name) => ({
      name,
      match: name.match(/^orbita-browser-(\d+)$/),
    }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => Boolean(entry.match))
    .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))
    .map((entry) => buildOrbitaExecutablePath(browserRoot, entry.name))
    .filter((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));

  return candidates;
}

function buildOrbitaExecutablePath(browserRoot: string, directoryName: string): string | undefined {
  switch (process.platform) {
    case "darwin":
      return path.join(browserRoot, directoryName, "Orbita-Browser.app", "Contents", "MacOS", "Orbita");
    case "win32":
      return path.join(browserRoot, directoryName, "chrome.exe");
    default:
      return path.join(browserRoot, directoryName, "chrome");
  }
}
