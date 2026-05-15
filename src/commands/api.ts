import fs from "node:fs";
import path from "node:path";

import { writeJsonFile, writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";

type ApiCommandOptions = {
  method: string;
  path: string;
  query: Record<string, string | number | boolean | undefined>;
  headers: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  output?: string;
  json: boolean;
};

const METHODS_WITH_OPTIONAL_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function parseApiCommandArgs(argv: string[], cwd = process.cwd()): ApiCommandOptions {
  const method = argv[0]?.toUpperCase();
  const apiPath = argv[1];

  if (!method || !apiPath) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser api <GET|POST|PUT|PATCH|DELETE> <path> [--query k=v] [--header k=v] [--data JSON|@file] [--body-file file] [--output file] [--json]",
      400
    );
  }

  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new AppError("BAD_REQUEST", "api method must be GET, POST, PUT, PATCH, or DELETE", 400);
  }

  const query: ApiCommandOptions["query"] = {};
  const headers: ApiCommandOptions["headers"] = {};
  let body: unknown;
  let output: string | undefined;
  let json = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--query" || token === "-q") {
      const value = argv[index + 1];
      if (!value) {
        throw new AppError("BAD_REQUEST", `${token} requires key=value`, 400);
      }
      addQueryPair(query, value);
      index += 1;
      continue;
    }

    if (token === "--header" || token === "-H") {
      const value = argv[index + 1];
      if (!value) {
        throw new AppError("BAD_REQUEST", `${token} requires key=value`, 400);
      }
      addKeyValuePair(headers, value, "--header");
      index += 1;
      continue;
    }

    if (token === "--data" || token === "--body" || token === "-d") {
      const value = argv[index + 1];
      if (!value) {
        throw new AppError("BAD_REQUEST", `${token} requires a JSON string or @file`, 400);
      }
      body = readBodyValue(value, cwd);
      index += 1;
      continue;
    }

    if (token === "--body-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new AppError("BAD_REQUEST", "--body-file requires a file path", 400);
      }
      body = readJsonFileFromPath(value, cwd);
      index += 1;
      continue;
    }

    if (token === "--output" || token === "-o") {
      const value = argv[index + 1];
      if (!value) {
        throw new AppError("BAD_REQUEST", `${token} requires a file path`, 400);
      }
      output = value;
      index += 1;
      continue;
    }

    throw new AppError("BAD_REQUEST", `Unknown api option: ${token}`, 400);
  }

  if (body !== undefined && method === "GET") {
    throw new AppError("BAD_REQUEST", "GET requests cannot use --data or --body-file", 400);
  }

  return {
    method,
    path: normalizeApiPath(apiPath),
    query,
    headers,
    body: body ?? (METHODS_WITH_OPTIONAL_BODY.has(method) ? undefined : undefined),
    output,
    json
  };
}

export async function runApiCommand(context: CommandContext, argv: string[]): Promise<void> {
  const options = parseApiCommandArgs(argv, context.cwd);
  const payload = await gologinApiRequest<unknown>(context.config, options.method, options.path, {
    query: options.query,
    headers: options.headers,
    body: options.body
  });

  if (options.output) {
    if (typeof payload === "string") {
      const absolutePath = path.isAbsolute(options.output) ? options.output : path.resolve(context.cwd, options.output);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, payload, "utf8");
      context.stdout.write(`${absolutePath}\n`);
      return;
    }

    context.stdout.write(`${writeJsonFile(context, options.output, payload)}\n`);
    return;
  }

  if (typeof payload === "string" && !options.json) {
    context.stdout.write(payload.endsWith("\n") ? payload : `${payload}\n`);
    return;
  }

  writeJsonStdout(context, payload);
}

function normalizeApiPath(value: string): string {
  if (value.startsWith("https://api.gologin.com/")) {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    throw new AppError("BAD_REQUEST", "api path must be a GoLogin API path, not an arbitrary URL", 400);
  }

  return value.startsWith("/") ? value : `/${value}`;
}

function addQueryPair(query: ApiCommandOptions["query"], value: string): void {
  addKeyValuePair(query, value, "--query");
}

function addKeyValuePair(query: ApiCommandOptions["query"], value: string, flagName: string): void {
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
