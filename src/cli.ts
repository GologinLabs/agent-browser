#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runCheckCommand } from "./commands/check";
import { runClickCommand } from "./commands/click";
import { runCloseCommand } from "./commands/close";
import { runCurrentCommand } from "./commands/current";
import { runDoubleClickCommand } from "./commands/dblclick";
import { runFillCommand } from "./commands/fill";
import { runFindCommand } from "./commands/find";
import { runFocusCommand } from "./commands/focus";
import { runGetCommand } from "./commands/get";
import { runHoverCommand } from "./commands/hover";
import { runOpenCommand } from "./commands/open";
import { runPdfCommand } from "./commands/pdf";
import { runPressCommand } from "./commands/press";
import { runScreenshotCommand } from "./commands/screenshot";
import { runScrollCommand } from "./commands/scroll";
import { runScrollIntoViewCommand } from "./commands/scrollIntoView";
import { runSessionsCommand } from "./commands/sessions";
import { runSnapshotCommand } from "./commands/snapshot";
import { runSelectCommand } from "./commands/select";
import { runTypeCommand } from "./commands/type";
import { runUncheckCommand } from "./commands/uncheck";
import { runUploadCommand } from "./commands/upload";
import { runWaitCommand } from "./commands/wait";
import { loadConfig } from "./lib/config";
import { AppError, formatErrorLine, fromDaemonError } from "./lib/errors";
import type {
  CommandContext,
  DaemonClient,
  HealthResponse,
  ResolvedTransport
} from "./lib/types";
import { isDaemonErrorResponse } from "./lib/utils";

type CommandName =
  | "open"
  | "snapshot"
  | "click"
  | "dblclick"
  | "focus"
  | "type"
  | "fill"
  | "hover"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  | "scroll"
  | "scrollintoview"
  | "wait"
  | "get"
  | "find"
  | "upload"
  | "pdf"
  | "screenshot"
  | "close"
  | "sessions"
  | "current";

function printUsage(): void {
  process.stderr.write(
    [
      "GoLogin Agent CLI",
      "",
      "Usage:",
      "  gologin-agent <command> [args] [options]",
      "",
      "Commands:",
      "  open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>] [--proxy-host <host> --proxy-port <port> --proxy-mode <http|socks4|socks5>] (aliases: goto, navigate)",
      "  snapshot [--session <sessionId>] [--interactive|-i]",
      "  click <target> [--session <sessionId>]",
      "  dblclick <target> [--session <sessionId>]",
      "  focus <target> [--session <sessionId>]",
      "  type <target> <text> [--session <sessionId>]",
      "  fill <target> <text> [--session <sessionId>]",
      "  hover <target> [--session <sessionId>]",
      "  select <target> <value> [--session <sessionId>]",
      "  check <target> [--session <sessionId>]",
      "  uncheck <target> [--session <sessionId>]",
      "  press <key> [target] [--session <sessionId>] (alias: key)",
      "  scroll <up|down|left|right> [pixels] [--target <target>] [--session <sessionId>]",
      "  scrollintoview <target> [--session <sessionId>] (alias: scrollinto)",
      "  wait <target|ms> [--text <text>] [--url <pattern>] [--load <state>] [--session <sessionId>]",
      "  get <text|value|html|title|url> [target] [--session <sessionId>]",
      "  find <role|text|label|placeholder|first|last|nth> ... [--exact]",
      "  upload <target> <file...> [--session <sessionId>]",
      "  pdf <path> [--session <sessionId>]",
      "  screenshot <path> [--annotate] [--session <sessionId>]",
      "  close [--session <sessionId>] (aliases: quit, exit)",
      "  sessions",
      "  current",
      "",
      "Environment:",
      "  GOLOGIN_TOKEN",
      "  GOLOGIN_PROFILE_ID",
      "  GOLOGIN_DAEMON_PORT",
      "  GOLOGIN_CONNECT_BASE"
    ].join("\n") + "\n"
  );
}

function projectRootFromCli(): string {
  return path.resolve(__dirname, "..");
}

function buildDaemonSpawnCommand(projectRoot: string): { command: string; args: string[] } {
  const distServerPath = path.join(projectRoot, "dist", "daemon", "server.js");
  if (fs.existsSync(distServerPath)) {
    return {
      command: process.execPath,
      args: [distServerPath]
    };
  }

  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const srcServerPath = path.join(projectRoot, "src", "daemon", "server.ts");

  if (fs.existsSync(tsxCli) && fs.existsSync(srcServerPath)) {
    return {
      command: process.execPath,
      args: [tsxCli, srcServerPath]
    };
  }

  throw new AppError(
    "DAEMON_UNREACHABLE",
    "Daemon entrypoint is missing. Run npm install and npm run build first.",
    500
  );
}

function requestOverHttp(
  transport: ResolvedTransport,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const options: http.RequestOptions =
      transport.kind === "socket"
        ? {
            socketPath: transport.socketPath,
            path: requestPath,
            method,
            headers: payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.length)
                }
              : undefined
          }
        : {
            host: transport.host,
            port: transport.port,
            path: requestPath,
            method,
            headers: payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.length)
                }
              : undefined
          };

    const request = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "{}";
        const parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;

        if ((response.statusCode ?? 500) >= 400) {
          if (isDaemonErrorResponse(parsed)) {
            reject(fromDaemonError(parsed));
            return;
          }

          reject(new AppError("INTERNAL_ERROR", `Daemon request failed with status ${response.statusCode}`, 500));
          return;
        }

        resolve(parsed);
      });
    });

    request.on("error", (error) => reject(error));

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

async function probeTransport(transport: ResolvedTransport): Promise<boolean> {
  try {
    await requestOverHttp(transport, "GET", "/health");
    return true;
  } catch {
    return false;
  }
}

async function waitForDaemon(transports: ResolvedTransport[], timeoutMs: number): Promise<ResolvedTransport | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const transport of transports) {
      if (await probeTransport(transport)) {
        return transport;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return undefined;
}

async function ensureDaemon(config: ReturnType<typeof loadConfig>): Promise<ResolvedTransport> {
  const transports: ResolvedTransport[] = [];
  if (process.platform !== "win32") {
    transports.push({
      kind: "socket",
      socketPath: config.socketPath
    });
  }
  transports.push({
    kind: "http",
    host: config.daemonHost,
    port: config.daemonPort
  });

  for (const transport of transports) {
    if (await probeTransport(transport)) {
      return transport;
    }
  }

  const projectRoot = projectRootFromCli();
  const command = buildDaemonSpawnCommand(projectRoot);
  const child = spawn(command.command, command.args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();

  const resolved = await waitForDaemon(transports, 5_000);
  if (!resolved) {
    throw new AppError("DAEMON_UNREACHABLE", "Local daemon did not start in time", 503);
  }

  return resolved;
}

function createDaemonClient(transport: ResolvedTransport): DaemonClient {
  return {
    transport,
    async request<TResponse>(method: string, requestPath: string, body?: unknown): Promise<TResponse> {
      return (await requestOverHttp(transport, method, requestPath, body)) as TResponse;
    }
  };
}

async function runCommand(command: CommandName, context: CommandContext, args: string[]): Promise<void> {
  switch (command) {
    case "open":
      await runOpenCommand(context, args);
      return;
    case "snapshot":
      await runSnapshotCommand(context, args);
      return;
    case "click":
      await runClickCommand(context, args);
      return;
    case "dblclick":
      await runDoubleClickCommand(context, args);
      return;
    case "focus":
      await runFocusCommand(context, args);
      return;
    case "type":
      await runTypeCommand(context, args);
      return;
    case "fill":
      await runFillCommand(context, args);
      return;
    case "hover":
      await runHoverCommand(context, args);
      return;
    case "select":
      await runSelectCommand(context, args);
      return;
    case "check":
      await runCheckCommand(context, args);
      return;
    case "uncheck":
      await runUncheckCommand(context, args);
      return;
    case "press":
      await runPressCommand(context, args);
      return;
    case "scroll":
      await runScrollCommand(context, args);
      return;
    case "scrollintoview":
      await runScrollIntoViewCommand(context, args);
      return;
    case "wait":
      await runWaitCommand(context, args);
      return;
    case "get":
      await runGetCommand(context, args);
      return;
    case "find":
      await runFindCommand(context, args);
      return;
    case "upload":
      await runUploadCommand(context, args);
      return;
    case "pdf":
      await runPdfCommand(context, args);
      return;
    case "screenshot":
      await runScreenshotCommand(context, args);
      return;
    case "close":
      await runCloseCommand(context, args);
      return;
    case "sessions":
      await runSessionsCommand(context, args);
      return;
    case "current":
      await runCurrentCommand(context, args);
      return;
  }
}

function normalizeCommand(commandArg: string): CommandName | undefined {
  const aliases: Record<string, CommandName> = {
    goto: "open",
    navigate: "open",
    dblclick: "dblclick",
    key: "press",
    scrollinto: "scrollintoview",
    quit: "close",
    exit: "close"
  };

  if (aliases[commandArg]) {
    return aliases[commandArg];
  }

  const directCommands = new Set<CommandName>([
    "open",
    "snapshot",
    "click",
    "dblclick",
    "focus",
    "type",
    "fill",
    "hover",
    "select",
    "check",
    "uncheck",
    "press",
    "scroll",
    "scrollintoview",
    "wait",
    "get",
    "find",
    "upload",
    "pdf",
    "screenshot",
    "close",
    "sessions",
    "current"
  ]);

  return directCommands.has(commandArg as CommandName) ? (commandArg as CommandName) : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commandArg = argv[0];

  if (!commandArg || commandArg === "--help" || commandArg === "-h") {
    printUsage();
    process.exit(commandArg ? 0 : 1);
  }

  const command = normalizeCommand(commandArg);

  if (!command) {
    throw new AppError("BAD_REQUEST", `Unknown command: ${commandArg}`, 400);
  }

  const config = loadConfig();
  const transport = await ensureDaemon(config);
  const client = createDaemonClient(transport);

  const health = await client.request<HealthResponse>("GET", "/health");
  if (!health.ok) {
    throw new AppError("DAEMON_UNREACHABLE", "Daemon health probe failed", 503);
  }

  const context: CommandContext = {
    client,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd()
  };

  await runCommand(command, context, argv.slice(1));
}

main().catch((error) => {
  process.stderr.write(`${formatErrorLine(error)}\n`);
  process.exit(error instanceof AppError ? 1 : 1);
});
