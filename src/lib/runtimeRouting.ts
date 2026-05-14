import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors";

export type AgentRuntime = "cloud" | "local" | "auto";

export type RuntimeSelection = {
  runtime?: AgentRuntime;
  args: string[];
};

const localOnlyCommands = new Set([
  "run",
  "batch",
  "jobs",
  "job",
  "history",
  "profiles",
  "profile",
  "profile-create",
  "profile-import",
  "profile-update",
  "profile-delete",
  "profile-sync",
  "open-visible",
  "open-background"
]);

function normalizeRuntime(value: string): AgentRuntime {
  if (value === "cloud" || value === "local" || value === "auto") {
    return value;
  }

  throw new AppError("BAD_REQUEST", "--runtime must be one of cloud, local, or auto", 400);
}

function runtimeFromEnv(): AgentRuntime | undefined {
  const value = process.env.GOLOGIN_AGENT_BROWSER_RUNTIME?.trim().toLowerCase();
  return value ? normalizeRuntime(value) : undefined;
}

function runtimeFromInvocation(): AgentRuntime | undefined {
  const invokedAs = path.basename(process.argv[1] ?? "");
  return invokedAs.includes("gologin-local-agent-browser") ? "local" : undefined;
}

export function extractRuntimeSelection(argv: string[]): RuntimeSelection {
  const args: string[] = [];
  let runtime: AgentRuntime | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (index === 0 && (token === "local" || token === "cloud")) {
      runtime = token;
      continue;
    }

    if (token === "--local") {
      runtime = "local";
      continue;
    }

    if (token === "--cloud") {
      runtime = "cloud";
      continue;
    }

    if (token === "--runtime") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new AppError("BAD_REQUEST", "Missing value for --runtime", 400);
      }
      runtime = normalizeRuntime(next);
      index += 1;
      continue;
    }

    if (token.startsWith("--runtime=")) {
      runtime = normalizeRuntime(token.slice("--runtime=".length));
      continue;
    }

    args.push(token);
  }

  return {
    runtime: runtime ?? runtimeFromEnv() ?? runtimeFromInvocation(),
    args
  };
}

export function shouldRouteToLocalRuntime(selection: RuntimeSelection): boolean {
  if (selection.runtime === "local") {
    return true;
  }

  if (selection.runtime === "cloud") {
    return false;
  }

  const command = selection.args[0];
  return Boolean(command && localOnlyCommands.has(command));
}

function projectRootFromCli(): string {
  return path.resolve(__dirname, "..", "..");
}

function buildLocalCliSpawnCommand(projectRoot: string): { command: string; args: string[] } {
  const distCliPath = path.join(projectRoot, "dist", "local-agent", "cli.js");
  if (fs.existsSync(distCliPath)) {
    return {
      command: process.execPath,
      args: [distCliPath]
    };
  }

  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const srcCliPath = path.join(projectRoot, "src", "local-agent", "cli.ts");
  if (fs.existsSync(tsxCli) && fs.existsSync(srcCliPath)) {
    return {
      command: process.execPath,
      args: [tsxCli, srcCliPath]
    };
  }

  throw new AppError("BAD_REQUEST", "Local runtime is not bundled. Run npm install and npm run build first.", 500);
}

export async function runLocalRuntimeCli(args: string[]): Promise<void> {
  const projectRoot = projectRootFromCli();
  const command = buildLocalCliSpawnCommand(projectRoot);
  const child = spawn(command.command, [...command.args, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOLOGIN_AGENT_BROWSER_RUNTIME: "local"
    },
    stdio: "inherit"
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  if (exit.signal) {
    process.kill(process.pid, exit.signal);
    return;
  }

  if (exit.code && exit.code !== 0) {
    process.exit(exit.code);
  }
}
