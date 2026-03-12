import fs from "node:fs";
import path from "node:path";

import type { ActionResponse, CommandContext, StorageScope } from "../lib/types";
import { AppError } from "../lib/errors";
import { ensureAbsolutePath } from "../lib/utils";

export async function resolveSessionId(context: CommandContext, explicitSessionId?: string): Promise<string> {
  if (explicitSessionId) {
    return explicitSessionId;
  }

  return (await context.client.request<{ sessionId: string }>("GET", "/sessions/current")).sessionId;
}

export function writeActionResult(
  context: CommandContext,
  verb: string,
  target: string,
  response: ActionResponse
): void {
  context.stdout.write(
    `${verb} target=${target} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}

export function parseStorageScope(value: string | undefined): StorageScope | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "local" || value === "session" || value === "both") {
    return value;
  }

  throw new AppError("BAD_REQUEST", "--scope must be one of local, session, or both", 400);
}

export function readJsonFile<T>(context: CommandContext, targetPath: string): T {
  const absolutePath = ensureAbsolutePath(context.cwd, targetPath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch (error) {
    throw new AppError(
      "BAD_REQUEST",
      `Failed to read JSON file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

export function writeJsonFile(context: CommandContext, targetPath: string, payload: unknown): string {
  const absolutePath = ensureAbsolutePath(context.cwd, targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

export function writeJsonStdout(context: CommandContext, payload: unknown): void {
  context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
