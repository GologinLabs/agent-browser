#!/usr/bin/env node

import { runBatchCommand } from "./commands/batch";
import { runRunCommand } from "./commands/run";
import { runRegisteredCommand } from "./lib/commandRunner";
import { createHealthyDaemonClient } from "./lib/daemon";
import {
  commandRequiresDaemon,
  getAllCommandUsage,
  getCommandUsage,
  resolveCommand,
  type CommandName
} from "./lib/commands";
import { loadConfig } from "./lib/config";
import { AppError, formatErrorLine } from "./lib/errors";
import type { CommandContext } from "./lib/types";

function printUsage(): void {
  process.stderr.write(
    [
      "Gologin Local Agent CLI",
      "",
      "Usage:",
      "  gologin-agent-browser --runtime local <command> [args] [options]",
      "",
      "Commands:",
      ...getAllCommandUsage(),
      "",
      "Environment:",
      "  GOLOGIN_TOKEN",
      "  GOLOGIN_PROFILE_ID",
      "  GOLOGIN_DAEMON_PORT",
      "  GOLOGIN_HEADLESS",
      "  GOLOGIN_EXECUTABLE_PATH",
      "  GOLOGIN_TMPDIR"
    ].join("\n") + "\n"
  );
}

function printCommandUsage(command: CommandName): void {
  process.stderr.write(
    [
      "Usage:",
      `  gologin-agent-browser --runtime local ${getCommandUsage(command)}`,
      "",
      "Tip:",
      "  Use --json when you want machine-readable output."
    ].join("\n") + "\n"
  );
}

export function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

async function runCommand(command: CommandName, context: CommandContext, args: string[]): Promise<void> {
  if (command === "run") {
    await runRunCommand(context, args);
    return;
  }

  if (command === "batch") {
    await runBatchCommand(context, args);
    return;
  }

  await runRegisteredCommand(command, context, args);
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commandArg = argv[0];

  if (!commandArg || commandArg === "--help" || commandArg === "-h") {
    printUsage();
    process.exit(commandArg ? 0 : 1);
  }

  const resolvedCommand = resolveCommand(commandArg, argv.slice(1));

  if (!resolvedCommand) {
    throw new AppError("BAD_REQUEST", `Unknown command: ${commandArg}`, 400);
  }

  if (isHelpRequest(resolvedCommand.args)) {
    printCommandUsage(resolvedCommand.command);
    process.exit(0);
  }

  const config = loadConfig();
  const client = commandRequiresDaemon(resolvedCommand.command)
    ? await createHealthyDaemonClient(config)
    : {
        transport: {
          kind: "http" as const,
          host: config.daemonHost,
          port: config.daemonPort
        },
        async request<TResponse>(): Promise<TResponse> {
          throw new AppError("DAEMON_UNREACHABLE", "This command should not call the daemon client", 500);
        }
      };

  const context: CommandContext = {
    config,
    client,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd()
  };

  await runCommand(resolvedCommand.command, context, resolvedCommand.args);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${formatErrorLine(error)}\n`);
    process.exit(error instanceof AppError ? 1 : 1);
  });
}
