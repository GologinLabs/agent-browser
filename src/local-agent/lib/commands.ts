export type CommandName =
  | "open"
  | "run"
  | "batch"
  | "jobs"
  | "job"
  | "doctor"
  | "profiles"
  | "profile"
  | "profile-create"
  | "profile-import"
  | "profile-update"
  | "profile-delete"
  | "profile-sync"
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
  | "find"
  | "upload"
  | "pdf"
  | "screenshot"
  | "close"
  | "sessions"
  | "current";

export type ResolvedCommand = {
  command: CommandName;
  args: string[];
};

type CommandSpec = {
  usage: string;
  requiresDaemon?: boolean;
};

const commandSpecs: Record<CommandName, CommandSpec> = {
  open: {
    usage:
      "open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>] [--headless|--background|--headed|--visible] [--proxy-country <country> | --proxy-host <host> --proxy-port <port> --proxy-mode <http|socks4|socks5>] (aliases: goto, navigate, open-visible, open-background)"
  },
  run: {
    usage:
      "run <runbook.json> [--session <sessionId>] [--profile <profileId>] [--vars <variables.json>] [--name <jobName>] [--continue-on-error] [--json]"
  },
  batch: {
    usage:
      "batch <runbook.json> --targets <targets.json> [--concurrency <n>] [--vars <variables.json>] [--name <jobName>] [--continue-on-error] [--json]"
  },
  jobs: {
    usage: "jobs [--kind <run|batch>] [--status <running|ok|partial|failed>] [--search <text>] [--limit <n>] [--json] (alias: history)",
    requiresDaemon: false
  },
  job: {
    usage: "job <jobId> [--json]",
    requiresDaemon: false
  },
  doctor: {
    usage: "doctor [--json] [--check-proxy <profileId>] [--use-case <linkedin|ads|facebook|smm|scraping|geo>]",
    requiresDaemon: false
  },
  profiles: {
    usage:
      "profiles [--local|--remote|--all] [--platform <platform>] [--status <status>] [--tag <tag>] [--search <text>] [--json]"
  },
  profile: {
    usage: "profile <profileId> [--local|--remote] [--json]"
  },
  "profile-create": {
    usage:
      "profile-create <name> [--template <linkedin|ads|facebook|smm|scraping|geo>] [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <a,b>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]"
  },
  "profile-import": {
    usage:
      "profile-import <profileId> [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <a,b>]"
  },
  "profile-update": {
    usage:
      "profile-update <profileId> [--template <linkedin|ads|facebook|smm|scraping|geo>] [--name <name>] [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <a,b>] [--add-tags <a,b>] [--remove-tags <a,b>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]"
  },
  "profile-delete": {
    usage: "profile-delete <profileId> [--remote]"
  },
  "profile-sync": {
    usage: "profile-sync <profileId> [--json]"
  },
  tabs: {
    usage: "tabs [--session <sessionId>]"
  },
  tabopen: {
    usage: "tabopen [url] [--session <sessionId>] (alias: tabnew)"
  },
  tabfocus: {
    usage: "tabfocus <index> [--session <sessionId>] (alias: tabswitch)"
  },
  tabclose: {
    usage: "tabclose [index] [--session <sessionId>]"
  },
  cookies: {
    usage: "cookies [--session <sessionId>] [--output <path>] [--json]"
  },
  "cookies-import": {
    usage: "cookies-import <cookies.json> [--session <sessionId>]"
  },
  "cookies-clear": {
    usage: "cookies-clear [--session <sessionId>]"
  },
  "storage-export": {
    usage: "storage-export [path] [--scope <local|session|both>] [--session <sessionId>] [--json]"
  },
  "storage-import": {
    usage: "storage-import <storage.json> [--scope <local|session|both>] [--clear] [--session <sessionId>]"
  },
  "storage-clear": {
    usage: "storage-clear [--scope <local|session|both>] [--session <sessionId>]"
  },
  eval: {
    usage: "eval <expression> [--json] [--session <sessionId>] (alias: js)"
  },
  snapshot: {
    usage: "snapshot [--session <sessionId>] [--interactive|-i]"
  },
  click: {
    usage: "click <target> [--session <sessionId>]"
  },
  dblclick: {
    usage: "dblclick <target> [--session <sessionId>]"
  },
  focus: {
    usage: "focus <target> [--session <sessionId>]"
  },
  type: {
    usage: "type <target> <text> [--session <sessionId>]"
  },
  fill: {
    usage: "fill <target> <text> [--session <sessionId>]"
  },
  hover: {
    usage: "hover <target> [--session <sessionId>]"
  },
  select: {
    usage: "select <target> <value> [--session <sessionId>]"
  },
  check: {
    usage: "check <target> [--session <sessionId>]"
  },
  uncheck: {
    usage: "uncheck <target> [--session <sessionId>]"
  },
  press: {
    usage: "press <key> [target] [--session <sessionId>] (alias: key)"
  },
  scroll: {
    usage: "scroll <up|down|left|right> [pixels] [--target <target>] [--session <sessionId>]"
  },
  scrollintoview: {
    usage: "scrollintoview <target> [--session <sessionId>] (alias: scrollinto)"
  },
  wait: {
    usage: "wait <target|ms> [--text <text>] [--url <pattern>] [--load <state>] [--session <sessionId>]"
  },
  get: {
    usage: "get <text|value|html|title|url> [target] [--session <sessionId>]"
  },
  find: {
    usage: "find <role|text|label|placeholder|first|last|nth> ... [--exact]"
  },
  upload: {
    usage: "upload <target> <file...> [--session <sessionId>]"
  },
  pdf: {
    usage: "pdf <path> [--session <sessionId>]"
  },
  screenshot: {
    usage: "screenshot <path> [--annotate] [--press-escape] [--session <sessionId>]"
  },
  close: {
    usage: "close [--session <sessionId>] (aliases: quit, exit)"
  },
  sessions: {
    usage: "sessions"
  },
  current: {
    usage: "current"
  }
};

const directCommands = new Set<CommandName>([
  "open",
  "run",
  "batch",
  "jobs",
  "job",
  "doctor",
  "profiles",
  "profile",
  "profile-create",
  "profile-import",
  "profile-update",
  "profile-delete",
  "profile-sync",
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
  "find",
  "upload",
  "pdf",
  "screenshot",
  "close",
  "sessions",
  "current"
]);

const commandAliases: Record<string, CommandName> = {
  goto: "open",
  navigate: "open",
  history: "jobs",
  js: "eval",
  tabnew: "tabopen",
  tabswitch: "tabfocus",
  key: "press",
  scrollinto: "scrollintoview",
  quit: "close",
  exit: "close"
};

const commandWithInjectedArgs: Record<string, ResolvedCommand> = {
  "open-visible": {
    command: "open",
    args: ["--visible"]
  },
  "open-background": {
    command: "open",
    args: ["--background"]
  }
};

export function resolveCommand(commandArg: string, argv: string[]): ResolvedCommand | undefined {
  const injected = commandWithInjectedArgs[commandArg];
  if (injected) {
    return {
      command: injected.command,
      args: [...argv, ...injected.args]
    };
  }

  const alias = commandAliases[commandArg];
  if (alias) {
    return {
      command: alias,
      args: argv
    };
  }

  if (directCommands.has(commandArg as CommandName)) {
    return {
      command: commandArg as CommandName,
      args: argv
    };
  }

  return undefined;
}

export function commandRequiresDaemon(command: CommandName): boolean {
  return commandSpecs[command].requiresDaemon !== false;
}

export function getCommandUsage(command: CommandName): string {
  return commandSpecs[command].usage;
}

export function getAllCommandUsage(): string[] {
  return (Object.keys(commandSpecs) as CommandName[]).map((command) => `  ${commandSpecs[command].usage}`);
}
