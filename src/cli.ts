#!/usr/bin/env node

import { runBackCommand } from "./commands/back";
import { runApiCommand } from "./commands/api";
import {
  runBrowserApiCommand,
  runDeletedProfileApiCommand,
  runFolderApiCommand,
  runProxyApiCommand,
  runShareApiCommand,
  runTemplateApiCommand,
  runUserApiCommand,
  runWorkspaceApiCommand
} from "./commands/apiResources";
import { runCheckCommand } from "./commands/check";
import { runClickCommand } from "./commands/click";
import { runCloseCommand } from "./commands/close";
import { runCloudUsageCommand } from "./commands/cloudUsage";
import { runCookiesCommand } from "./commands/cookies";
import { runCookiesClearCommand } from "./commands/cookiesClear";
import { runCookiesImportCommand } from "./commands/cookiesImport";
import { runCurrentCommand } from "./commands/current";
import { runDoctorCommand } from "./commands/doctor";
import { runDoubleClickCommand } from "./commands/dblclick";
import { runEvalCommand } from "./commands/eval";
import { runFillCommand } from "./commands/fill";
import { runFindCommand } from "./commands/find";
import { runFocusCommand } from "./commands/focus";
import { runForwardCommand } from "./commands/forward";
import { runGetCommand } from "./commands/get";
import { runHoverCommand } from "./commands/hover";
import { runOpenCommand } from "./commands/open";
import { runPdfCommand } from "./commands/pdf";
import { runPressCommand } from "./commands/press";
import { runProfileCloudCommand } from "./commands/profileCloud";
import { runProfileCookiesCommand } from "./commands/profileCookies";
import { runProfileFingerprintCommand } from "./commands/profileFingerprint";
import { runProfileProxyCommand } from "./commands/profileProxy";
import { runProfileUaCommand } from "./commands/profileUa";
import { runReloadCommand } from "./commands/reload";
import { runScreenshotCommand } from "./commands/screenshot";
import { runScrollCommand } from "./commands/scroll";
import { runScrollIntoViewCommand } from "./commands/scrollIntoView";
import { runStorageClearCommand } from "./commands/storageClear";
import { runStorageExportCommand } from "./commands/storageExport";
import { runStorageImportCommand } from "./commands/storageImport";
import { runSessionsCommand } from "./commands/sessions";
import { runSnapshotCommand } from "./commands/snapshot";
import { runSelectCommand } from "./commands/select";
import { runTabCloseCommand } from "./commands/tabClose";
import { runTabFocusCommand } from "./commands/tabFocus";
import { runTabOpenCommand } from "./commands/tabOpen";
import { runTabsCommand } from "./commands/tabs";
import { runTypeCommand } from "./commands/type";
import { runUncheckCommand } from "./commands/uncheck";
import { runUploadCommand } from "./commands/upload";
import { runWaitCommand } from "./commands/wait";
import { createHealthyDaemonClient } from "./lib/daemon";
import { loadConfig } from "./lib/config";
import { AppError, formatErrorLine } from "./lib/errors";
import { extractRuntimeSelection, runLocalRuntimeCli, shouldRouteToLocalRuntime } from "./lib/runtimeRouting";
import type { CommandContext } from "./lib/types";

type CommandName =
  | "api"
  | "browser"
  | "proxy"
  | "workspace"
  | "share"
  | "template"
  | "folder"
  | "user"
  | "deleted-profile"
  | "open"
  | "doctor"
  | "cloud-usage"
  | "profile-cloud"
  | "profile-cookies"
  | "profile-fingerprint"
  | "profile-proxy"
  | "profile-ua"
  | "tabs"
  | "tabopen"
  | "tabfocus"
  | "tabclose"
  | "cookies"
  | "cookies-import"
  | "cookies-clear"
  | "storage-export"
  | "storage-import"
  | "storage-clear"
  | "eval"
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
  | "back"
  | "forward"
  | "reload"
  | "find"
  | "upload"
  | "pdf"
  | "screenshot"
  | "close"
  | "sessions"
  | "current";

const commandUsage: Record<CommandName, string> = {
  api: "api <GET|POST|PUT|PATCH|DELETE> <path> [--query k=v] [--header k=v] [--data JSON|@file] [--body-file file] [--output file] [--json]",
  browser: "browser <list|get|create|update|delete|cookies|proxy|cloud-start|cloud-stop|...> [args] [--data JSON|@file] [--header k=v] [--json]",
  proxy: "proxy <list|get|add-gologin|add-many|update|delete|traffic|...> [args] [--data JSON|@file] [--header k=v] [--json]",
  workspace: "workspace <list|get|create|rename|profiles|member-add|...> [args] [--data JSON|@file] [--header k=v] [--json]",
  share: "share <create|delete|create-many|delete-folder> [args] [--data JSON|@file] [--json]",
  template: "template <list|create|update> [args] [--data JSON|@file] [--json]",
  folder: "folder <list|create> [args] [--data JSON|@file] [--json]",
  user: "user <get|dev-token> [--data JSON|@file] [--json]",
  "deleted-profile": "deleted-profile <list|restore> [--workspace <workspaceId>] [--offset <n>] [--data JSON|@file] [--json]",
  open: "open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>] [--proxy-host <host> --proxy-port <port> --proxy-mode <http|socks4|socks5>] (aliases: goto, navigate)",
  doctor: "doctor [--json]",
  "cloud-usage": "cloud-usage --profile <profileId> | --workspace <workspaceId> [--days <1-30>] [--json]",
  "profile-cloud": "profile-cloud <start|stop> <profileId> [--json]",
  "profile-cookies": "profile-cookies <export|import> <profileId> [cookies.json] [--output <path>] [--clean] [--json]",
  "profile-fingerprint": "profile-fingerprint refresh <profileId...> [--json]",
  "profile-proxy": "profile-proxy <list|traffic|add-gologin> ... [--json]",
  "profile-ua": "profile-ua <latest|update> ... [--json]",
  tabs: "tabs [--session <sessionId>]",
  tabopen: "tabopen [url] [--session <sessionId>] (alias: tabnew)",
  tabfocus: "tabfocus <index> [--session <sessionId>] (alias: tabswitch)",
  tabclose: "tabclose [index] [--session <sessionId>]",
  cookies: "cookies [--session <sessionId>] [--output <path>] [--json]",
  "cookies-import": "cookies-import <cookies.json> [--session <sessionId>]",
  "cookies-clear": "cookies-clear [--session <sessionId>]",
  "storage-export": "storage-export [path] [--scope <local|session|both>] [--session <sessionId>] [--json]",
  "storage-import": "storage-import <storage.json> [--scope <local|session|both>] [--clear] [--session <sessionId>]",
  "storage-clear": "storage-clear [--scope <local|session|both>] [--session <sessionId>]",
  eval: "eval <expression> [--json] [--session <sessionId>] (alias: js)",
  snapshot: "snapshot [--session <sessionId>] [--interactive|-i]",
  click: "click <target> [--session <sessionId>]",
  dblclick: "dblclick <target> [--session <sessionId>]",
  focus: "focus <target> [--session <sessionId>]",
  type: "type <target> <text> [--session <sessionId>]",
  fill: "fill <target> <text> [--session <sessionId>]",
  hover: "hover <target> [--session <sessionId>]",
  select: "select <target> <value> [--session <sessionId>]",
  check: "check <target> [--session <sessionId>]",
  uncheck: "uncheck <target> [--session <sessionId>]",
  press: "press <key> [target] [--session <sessionId>] (alias: key)",
  scroll: "scroll <up|down|left|right> [pixels] [--target <target>] [--session <sessionId>]",
  scrollintoview: "scrollintoview <target> [--session <sessionId>] (alias: scrollinto)",
  wait: "wait <target|ms> [--text <text>] [--url <pattern>] [--load <state>] [--session <sessionId>]",
  get: "get <text|value|html|title|url> [target] [--session <sessionId>]",
  back: "back [--session <sessionId>]",
  forward: "forward [--session <sessionId>]",
  reload: "reload [--session <sessionId>]",
  find: "find <role|text|label|placeholder|first|last|nth> ... [--exact]",
  upload: "upload <target> <file...> [--session <sessionId>] | upload --discover [--session <sessionId>]",
  pdf: "pdf <path> [--session <sessionId>]",
  screenshot: "screenshot <path> [--annotate] [--press-escape] [--session <sessionId>]",
  close: "close [--session <sessionId>] [--all] (aliases: quit, exit)",
  sessions: "sessions [--prune] [--older-than-ms <ms>]",
  current: "current"
};

function printUsage(): void {
  process.stderr.write(
    [
      "Gologin Agent CLI",
      "",
      "Usage:",
      "  gologin-agent-browser <command> [args] [options]",
      "  gologin-agent-browser --runtime <cloud|local|auto> <command> [args] [options]",
      "  gologin-agent-browser local <command> [args] [options]",
      "",
      "Commands:",
      ...Object.values(commandUsage).map((usage) => `  ${usage}`),
      "",
      "Environment:",
      "  GOLOGIN_TOKEN",
      "  GOLOGIN_PROFILE_ID",
      "  GOLOGIN_AGENT_BROWSER_RUNTIME",
      "  GOLOGIN_DAEMON_PORT",
      "  GOLOGIN_CONNECT_BASE",
      "  GOLOGIN_EXECUTABLE_PATH (local runtime)"
    ].join("\n") + "\n"
  );
}

function printCommandUsage(command: CommandName): void {
  process.stderr.write(
    [
      "Usage:",
      `  gologin-agent-browser ${commandUsage[command]}`,
      "",
      "Tip:",
      "  Use --json when you want machine-readable output."
    ].join("\n") + "\n"
  );
}

function commandRequiresDaemon(command: CommandName): boolean {
  return !new Set<CommandName>([
    "api",
    "browser",
    "proxy",
    "workspace",
    "share",
    "template",
    "folder",
    "user",
    "deleted-profile",
    "doctor",
    "cloud-usage",
    "profile-cloud",
    "profile-cookies",
    "profile-fingerprint",
    "profile-proxy",
    "profile-ua"
  ]).has(command);
}

export function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

async function runCommand(command: CommandName, context: CommandContext, args: string[]): Promise<void> {
  switch (command) {
    case "api":
      await runApiCommand(context, args);
      return;
    case "browser":
      await runBrowserApiCommand(context, args);
      return;
    case "proxy":
      await runProxyApiCommand(context, args);
      return;
    case "workspace":
      await runWorkspaceApiCommand(context, args);
      return;
    case "share":
      await runShareApiCommand(context, args);
      return;
    case "template":
      await runTemplateApiCommand(context, args);
      return;
    case "folder":
      await runFolderApiCommand(context, args);
      return;
    case "user":
      await runUserApiCommand(context, args);
      return;
    case "deleted-profile":
      await runDeletedProfileApiCommand(context, args);
      return;
    case "open":
      await runOpenCommand(context, args);
      return;
    case "doctor":
      await runDoctorCommand(context, args);
      return;
    case "cloud-usage":
      await runCloudUsageCommand(context, args);
      return;
    case "profile-cloud":
      await runProfileCloudCommand(context, args);
      return;
    case "profile-cookies":
      await runProfileCookiesCommand(context, args);
      return;
    case "profile-fingerprint":
      await runProfileFingerprintCommand(context, args);
      return;
    case "profile-proxy":
      await runProfileProxyCommand(context, args);
      return;
    case "profile-ua":
      await runProfileUaCommand(context, args);
      return;
    case "tabs":
      await runTabsCommand(context, args);
      return;
    case "tabopen":
      await runTabOpenCommand(context, args);
      return;
    case "tabfocus":
      await runTabFocusCommand(context, args);
      return;
    case "tabclose":
      await runTabCloseCommand(context, args);
      return;
    case "cookies":
      await runCookiesCommand(context, args);
      return;
    case "cookies-import":
      await runCookiesImportCommand(context, args);
      return;
    case "cookies-clear":
      await runCookiesClearCommand(context, args);
      return;
    case "storage-export":
      await runStorageExportCommand(context, args);
      return;
    case "storage-import":
      await runStorageImportCommand(context, args);
      return;
    case "storage-clear":
      await runStorageClearCommand(context, args);
      return;
    case "eval":
      await runEvalCommand(context, args);
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
    case "back":
      await runBackCommand(context, args);
      return;
    case "forward":
      await runForwardCommand(context, args);
      return;
    case "reload":
      await runReloadCommand(context, args);
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
    tabnew: "tabopen",
    tabswitch: "tabfocus",
    js: "eval",
    key: "press",
    scrollinto: "scrollintoview",
    quit: "close",
    exit: "close"
  };

  if (aliases[commandArg]) {
    return aliases[commandArg];
  }

  const directCommands = new Set<CommandName>([
    "api",
    "browser",
    "proxy",
    "workspace",
    "share",
    "template",
    "folder",
    "user",
    "deleted-profile",
    "open",
    "doctor",
    "cloud-usage",
    "profile-cloud",
    "profile-cookies",
    "profile-fingerprint",
    "profile-proxy",
    "profile-ua",
    "tabs",
    "tabopen",
    "tabfocus",
    "tabclose",
    "cookies",
    "cookies-import",
    "cookies-clear",
    "storage-export",
    "storage-import",
    "storage-clear",
    "eval",
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
    "back",
    "forward",
    "reload",
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

export async function main(): Promise<void> {
  const selection = extractRuntimeSelection(process.argv.slice(2));
  if (shouldRouteToLocalRuntime(selection)) {
    await runLocalRuntimeCli(selection.args);
    return;
  }

  const argv = selection.args;
  const commandArg = argv[0];

  if (!commandArg || commandArg === "--help" || commandArg === "-h") {
    printUsage();
    process.exit(commandArg ? 0 : 1);
  }

  const command = normalizeCommand(commandArg);

  if (!command) {
    throw new AppError("BAD_REQUEST", `Unknown command: ${commandArg}`, 400);
  }

  if (isHelpRequest(argv.slice(1))) {
    printCommandUsage(command);
    process.exit(0);
  }

  const config = loadConfig();
  const client = commandRequiresDaemon(command)
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

  await runCommand(command, context, argv.slice(1));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${formatErrorLine(error)}\n`);
    process.exit(error instanceof AppError ? 1 : 1);
  });
}
