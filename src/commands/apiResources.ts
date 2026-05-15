import fs from "node:fs";
import path from "node:path";

import { writeJsonFile, writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs, type ParsedArgs } from "../lib/utils";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RequestBodyMode = "none" | "optional" | "required" | "empty";
type QueryMap = Record<string, string>;

type ResourceAction = {
  action: string;
  aliases?: string[];
  method: HttpMethod;
  path: string | ((args: string[], parsed: ParsedArgs) => string);
  body?: RequestBodyMode;
  query?: QueryMap;
  headers?: QueryMap;
  usage?: string;
  buildBody?: (args: string[], parsed: ParsedArgs) => unknown | undefined;
};

type ResourceRunnerOptions = {
  command: string;
  actions: ResourceAction[];
};

const BODY_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

function idPath(base: string, args: string[], label = "id"): string {
  const id = args[0];
  if (!id) {
    throw new AppError("BAD_REQUEST", `Missing ${label}`, 400);
  }
  return `${base}/${encodeURIComponent(id)}`;
}

function workspacePath(args: string[], suffix = ""): string {
  return `${idPath("/workspaces", args, "workspace id")}${suffix}`;
}

function workspaceMemberPath(args: string[]): string {
  const memberId = args[1];
  if (!memberId) {
    throw new AppError("BAD_REQUEST", "Missing member id", 400);
  }
  return `${workspacePath(args)}/members/${encodeURIComponent(memberId)}`;
}

function findAction(actions: ResourceAction[], action: string | undefined): ResourceAction | undefined {
  if (!action) {
    return undefined;
  }

  return actions.find((candidate) => candidate.action === action || candidate.aliases?.includes(action));
}

function addMappedQuery(
  query: Record<string, string | number | boolean>,
  parsed: ParsedArgs,
  map?: QueryMap,
  includeGenericQuery = true
): void {
  for (const [flagName, queryName] of Object.entries(map ?? {})) {
    const value = getFlagString(parsed, flagName);
    if (value !== undefined) {
      query[queryName] = coerceScalar(value);
    }
  }

  if (includeGenericQuery) {
    const genericQuery = getFlagString(parsed, "query");
    if (genericQuery) {
      addKeyValuePair(query, genericQuery, "--query");
    }
  }
}

function readRequestBody(context: CommandContext, parsed: ParsedArgs): unknown | undefined {
  const data = getFlagString(parsed, "data") ?? getFlagString(parsed, "body");
  if (data !== undefined) {
    return readBodyValue(data, context.cwd);
  }

  const bodyFile = getFlagString(parsed, "body-file");
  if (bodyFile !== undefined) {
    return readJsonFileFromPath(bodyFile, context.cwd);
  }

  return undefined;
}

async function writePayload(context: CommandContext, payload: unknown, parsed: ParsedArgs): Promise<void> {
  const output = getFlagString(parsed, "output");
  const json = getFlagBoolean(parsed, "json");

  if (output) {
    if (typeof payload === "string") {
      const absolutePath = path.isAbsolute(output) ? output : path.resolve(context.cwd, output);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, payload, "utf8");
      context.stdout.write(`${absolutePath}\n`);
      return;
    }

    context.stdout.write(`${writeJsonFile(context, output, payload)}\n`);
    return;
  }

  if (typeof payload === "string" && !json) {
    context.stdout.write(payload.endsWith("\n") ? payload : `${payload}\n`);
    return;
  }

  writeJsonStdout(context, payload);
}

async function runResourceCommand(context: CommandContext, argv: string[], options: ResourceRunnerOptions): Promise<void> {
  const parsed = parseArgs(argv);
  const actionName = parsed.positional[0];
  const action = findAction(options.actions, actionName);
  const actionArgs = parsed.positional.slice(1);

  if (!action) {
    throw new AppError(
      "BAD_REQUEST",
      `Usage: gologin-agent-browser ${options.command} <${options.actions.map((item) => item.action).join("|")}> ...`,
      400
    );
  }

  const query: Record<string, string | number | boolean> = {};
  const headers: Record<string, string | number | boolean> = {};
  addMappedQuery(query, parsed, action.query);
  addMappedQuery(headers, parsed, action.headers, false);

  const genericHeader = getFlagString(parsed, "header");
  if (genericHeader) {
    addKeyValuePair(headers, genericHeader, "--header");
  }

  let body = readRequestBody(context, parsed);
  if (body === undefined && action.buildBody) {
    body = action.buildBody(actionArgs, parsed);
  }

  const bodyMode: RequestBodyMode = action.body ?? (BODY_METHODS.has(action.method) ? "optional" : "none");
  if (bodyMode === "none" && body !== undefined) {
    throw new AppError("BAD_REQUEST", `${options.command} ${action.action} does not accept --data or --body-file`, 400);
  }
  if (bodyMode === "required" && body === undefined) {
    throw new AppError(
      "BAD_REQUEST",
      action.usage ??
        `Usage: gologin-agent-browser ${options.command} ${action.action} ... --data '<json>' or --body-file file.json`,
      400
    );
  }
  if (bodyMode === "empty" && body === undefined) {
    body = {};
  }

  const apiPath = typeof action.path === "string" ? action.path : action.path(actionArgs, parsed);
  const payload = await gologinApiRequest<unknown>(context.config, action.method, apiPath, { query, headers, body });
  await writePayload(context, payload, parsed);
}

function scalarBodyFromFlags(parsed: ParsedArgs, fields: QueryMap): Record<string, unknown> | undefined {
  const body: Record<string, unknown> = {};
  for (const [flagName, bodyName] of Object.entries(fields)) {
    const value = getFlagString(parsed, flagName);
    if (value !== undefined) {
      body[bodyName] = coerceScalar(value);
    }
  }

  return Object.keys(body).length > 0 ? body : undefined;
}

function profileIdsBody(args: string[]): Record<string, unknown> | undefined {
  return args.length > 0 ? { browsersIds: args } : undefined;
}

function addGoLoginProxyBody(args: string[], parsed: ParsedArgs): Record<string, unknown> | undefined {
  const profileId = getFlagString(parsed, "profile") ?? args[0];
  const countryCode = getFlagString(parsed, "country");
  if (!profileId || !countryCode) {
    return undefined;
  }

  const normalizedCountry = normalizeCountryCode(countryCode);
  const proxyType = normalizeProxyType(getFlagString(parsed, "type"));
  const body: Record<string, unknown> = {
    countryCode: normalizedCountry,
    profileIdToLink: profileId,
    customName: getFlagString(parsed, "name") ?? `gologin-${normalizedCountry}-${profileId.slice(0, 6)}`
  };

  const city = getFlagString(parsed, "city");
  if (city) {
    body.city = city;
  }
  if (proxyType.isMobile !== undefined) {
    body.isMobile = proxyType.isMobile;
  }
  if (proxyType.isDC !== undefined) {
    body.isDC = proxyType.isDC;
  }

  return body;
}

function normalizeProxyType(value: string | undefined): { isMobile?: boolean; isDC?: boolean } {
  const type = value ?? "residential";
  if (type === "mobile") {
    return { isMobile: true };
  }
  if (type === "dc" || type === "datacenter") {
    return { isDC: true };
  }
  if (type === "residential") {
    return {};
  }
  throw new AppError("BAD_REQUEST", "--type must be one of residential, mobile, or dc", 400);
}

function normalizeCountryCode(value: string): string {
  const countryCode = value.toLowerCase();
  if (!/^[a-z]{2}$/.test(countryCode)) {
    throw new AppError("BAD_REQUEST", "--country must be a 2-letter country code, for example us", 400);
  }
  return countryCode;
}

function addKeyValuePair(query: Record<string, string | number | boolean>, value: string, flagName: string): void {
  const splitAt = value.indexOf("=");
  if (splitAt <= 0) {
    throw new AppError("BAD_REQUEST", `${flagName} must be key=value`, 400);
  }

  const key = value.slice(0, splitAt);
  const rawValue = value.slice(splitAt + 1);
  query[key] = coerceScalar(rawValue);
}

function coerceScalar(value: string): string | number | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function readBodyValue(value: string, cwd: string): unknown {
  if (value.startsWith("@")) {
    return readJsonFileFromPath(value.slice(1), cwd);
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AppError(
      "BAD_REQUEST",
      `--data must be valid JSON or @file: ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

function readJsonFileFromPath(targetPath: string, cwd: string): unknown {
  const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new AppError(
      "BAD_REQUEST",
      `Failed to read JSON body file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

const browserActions: ResourceAction[] = [
  {
    action: "list",
    method: "GET",
    path: "/browser/v2",
    body: "none",
    query: { search: "search", folder: "folder", page: "page", "sorter-field": "sorterField", "sorter-order": "sorterOrder", tag: "tag" }
  },
  {
    action: "fingerprint",
    aliases: ["random-fingerprint"],
    method: "GET",
    path: "/browser/fingerprint",
    body: "none",
    query: { os: "os", "os-spec": "osSpec", template: "template", workspace: "currentWorkspace" }
  },
  { action: "proxy-many", method: "PATCH", path: "/browser/proxy/many/v2", body: "required" },
  { action: "extensions-many", method: "PATCH", path: "/browser/chrome_extensions/many", body: "required" },
  { action: "bookmarks-many", method: "PATCH", path: "/browser/bookmarks/many", body: "required" },
  { action: "get", method: "GET", path: (args) => idPath("/browser", args), body: "none", query: { workspace: "currentWorkspace" } },
  { action: "delete", method: "DELETE", path: (args) => idPath("/browser", args), body: "none" },
  { action: "update", method: "PUT", path: (args) => idPath("/browser", args), body: "required", query: { workspace: "workspaceId" } },
  { action: "history", method: "GET", path: (args) => `${idPath("/browser", args)}/history`, body: "none" },
  { action: "history-update", method: "PATCH", path: (args) => `${idPath("/browser", args)}/history`, body: "required" },
  { action: "ua-latest-update", aliases: ["update-ua-latest"], method: "PATCH", path: "/browser/update_ua_to_new_browser_v", body: "required", query: { workspace: "currentWorkspace" } },
  { action: "last-archive", method: "GET", path: (args) => `${idPath("/browser", args)}/lastArchive`, body: "none" },
  { action: "cookies", method: "GET", path: (args) => `${idPath("/browser", args)}/cookies`, body: "none" },
  {
    action: "cookies-update",
    aliases: ["cookies-import"],
    method: "POST",
    path: (args) => `${idPath("/browser", args)}/cookies`,
    body: "required",
    query: { "from-user": "fromUser", "clean-cookies": "cleanCookies" }
  },
  { action: "create", method: "POST", path: "/browser", body: "required" },
  { action: "delete-many", method: "DELETE", path: "/browser", body: "required" },
  {
    action: "create-quick",
    method: "POST",
    path: "/browser/quick",
    body: "required",
    query: { workspace: "currentWorkspace" },
    buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name", os: "os" }),
    usage: "Usage: gologin-agent-browser browser create-quick --name <name> --os <mac|win|lin|android> [--workspace <id>] [--json]"
  },
  {
    action: "create-custom",
    method: "POST",
    path: "/browser/custom",
    body: "required",
    query: { workspace: "workspaceId" },
    buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name", os: "os" })
  },
  {
    action: "fingerprints-refresh",
    aliases: ["fingerprint-refresh"],
    method: "PATCH",
    path: "/browser/fingerprints",
    body: "required",
    buildBody: profileIdsBody,
    usage: "Usage: gologin-agent-browser browser fingerprints-refresh <profileId...> [--json]"
  },
  { action: "restore", method: "GET", path: (args) => `${idPath("/browser", args)}/restore`, body: "none" },
  {
    action: "notes",
    method: "PATCH",
    path: (args) => `${idPath("/browser", args)}/notes`,
    body: "required",
    buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { notes: "notes" }),
    usage: "Usage: gologin-agent-browser browser notes <profileId> --notes <text> [--json]"
  },
  { action: "name-many", method: "PATCH", path: "/browser/name/many", body: "required" },
  {
    action: "name",
    method: "PATCH",
    path: (args) => `${idPath("/browser", args)}/name`,
    body: "required",
    buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name" }),
    usage: "Usage: gologin-agent-browser browser name <profileId> --name <name> [--json]"
  },
  { action: "geolocation", method: "PATCH", path: (args) => `${idPath("/browser", args)}/geolocation`, body: "required" },
  { action: "proxy", method: "PATCH", path: (args) => `${idPath("/browser", args)}/proxy`, body: "required" },
  { action: "language", method: "PATCH", path: (args) => `${idPath("/browser", args)}/language`, body: "required" },
  { action: "timezone", method: "PATCH", path: (args) => `${idPath("/browser", args)}/timezone`, body: "required" },
  { action: "resolution", method: "PATCH", path: (args) => `${idPath("/browser", args)}/resolution`, body: "required" },
  { action: "ua", method: "PATCH", path: (args) => `${idPath("/browser", args)}/ua`, body: "required" },
  { action: "clone", method: "POST", path: (args) => `${idPath("/browser", args)}/clone`, body: "optional" },
  { action: "clone-many", method: "POST", path: "/browser/clone_multi", body: "required" },
  { action: "cloud-start", aliases: ["web-start"], method: "POST", path: (args) => `${idPath("/browser", args)}/web`, body: "empty" },
  { action: "cloud-stop", aliases: ["web-stop"], method: "DELETE", path: (args) => `${idPath("/browser", args)}/web`, body: "none" },
  { action: "export", method: "POST", path: "/browser/browsers.csv", body: "required", query: { workspace: "currentWorkspace" } },
  {
    action: "import",
    method: "POST",
    path: "/browser/browser-import",
    body: "required",
    query: { workspace: "currentWorkspace", "folder-name": "folderName" }
  }
];

const proxyActions: ResourceAction[] = [
  { action: "get", method: "GET", path: (args) => idPath("/proxy", args), body: "none" },
  { action: "update", method: "PUT", path: (args) => idPath("/proxy", args), body: "required" },
  { action: "delete", method: "DELETE", path: (args) => idPath("/proxy", args), body: "none" },
  { action: "list", method: "GET", path: "/proxy/v2", body: "none", query: { page: "page" } },
  { action: "shared", method: "GET", path: "/proxy/shared", body: "none" },
  { action: "add-many", method: "POST", path: "/proxy/add_proxies", body: "required" },
  { action: "delete-many", method: "POST", path: "/proxy/delete_proxies", body: "required" },
  {
    action: "add-gologin",
    method: "POST",
    path: "/users-proxies/mobile-proxy",
    body: "required",
    buildBody: addGoLoginProxyBody,
    usage:
      "Usage: gologin-agent-browser proxy add-gologin <profileId> --country <cc> [--city <city>] [--type residential|mobile|dc] [--name <name>] [--json]"
  },
  { action: "traffic", method: "GET", path: "/users-proxies/geolocation/traffic", body: "none" }
];

const workspaceActions: ResourceAction[] = [
  { action: "list", method: "GET", path: "/workspaces", body: "none" },
  { action: "create", method: "POST", path: "/workspaces", body: "required", buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name" }) },
  { action: "get", method: "GET", path: (args) => workspacePath(args), body: "none" },
  { action: "delete", method: "DELETE", path: (args) => workspacePath(args), body: "none" },
  {
    action: "rename",
    method: "PATCH",
    path: (args) => workspacePath(args, "/rename"),
    body: "required",
    buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name" }),
    usage: "Usage: gologin-agent-browser workspace rename <workspaceId> --name <name> [--json]"
  },
  { action: "profiles-count", method: "GET", path: (args) => workspacePath(args, "/profiles-count"), body: "none" },
  {
    action: "profiles",
    method: "GET",
    path: (args) => workspacePath(args, "/profiles"),
    body: "none",
    headers: { country: "cf-ipcountry", "cf-ipcountry": "cf-ipcountry" },
    query: { search: "search", folder: "folder", "folder-id": "folderId", page: "page", "sort-field": "sortField", "sort-order": "sortOrder", tag: "tag", offset: "offset" }
  },
  { action: "delete-profiles", method: "DELETE", path: (args) => workspacePath(args, "/profiles"), body: "required" },
  { action: "transfer-profile", method: "POST", path: (args) => workspacePath(args, "/profiles/transfer"), body: "required" },
  { action: "member-add", method: "POST", path: (args) => workspacePath(args, "/members"), body: "required" },
  { action: "member-update", method: "PATCH", path: workspaceMemberPath, body: "required" },
  { action: "member-remove", method: "DELETE", path: workspaceMemberPath, body: "none" }
];

const shareActions: ResourceAction[] = [
  { action: "create", method: "POST", path: "/share", body: "required" },
  { action: "delete", method: "DELETE", path: "/share", body: "required" },
  { action: "create-many", method: "POST", path: "/share/multi", body: "required" },
  { action: "delete-folder", method: "DELETE", path: (args) => idPath("/share/folder", args, "folder id"), body: "none" }
];

const templateActions: ResourceAction[] = [
  { action: "create", method: "POST", path: "/templates", body: "required" },
  { action: "list", method: "GET", path: "/templates", body: "none" },
  { action: "update", method: "PUT", path: (args) => idPath("/templates", args), body: "required" }
];

const folderActions: ResourceAction[] = [
  { action: "list", method: "GET", path: "/folders", body: "none" },
  { action: "create", method: "POST", path: "/folders/folder", body: "required", buildBody: (_args, parsed) => scalarBodyFromFlags(parsed, { name: "name" }) }
];

const userActions: ResourceAction[] = [
  { action: "get", method: "GET", path: "/user", body: "none" },
  { action: "dev-token", method: "POST", path: "/user/dev", body: "required" }
];

const deletedProfileActions: ResourceAction[] = [
  { action: "list", method: "GET", path: "/deleted-profiles/v2", body: "none", query: { workspace: "currentWorkspace", offset: "offset" } },
  { action: "restore", method: "POST", path: "/deleted-profiles/restore", body: "required" }
];

export async function runBrowserApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "browser", actions: browserActions });
}

export async function runProxyApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "proxy", actions: proxyActions });
}

export async function runWorkspaceApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "workspace", actions: workspaceActions });
}

export async function runShareApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "share", actions: shareActions });
}

export async function runTemplateApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "template", actions: templateActions });
}

export async function runFolderApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "folder", actions: folderActions });
}

export async function runUserApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "user", actions: userActions });
}

export async function runDeletedProfileApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  await runResourceCommand(context, argv, { command: "deleted-profile", actions: deletedProfileActions });
}
