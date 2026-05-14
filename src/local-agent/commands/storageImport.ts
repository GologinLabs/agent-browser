import { AppError } from "../lib/errors";
import type { CommandContext, StorageImportResponse, StorageState } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { parseStorageScope, readJsonFile, resolveSessionId } from "./shared";

export async function runStorageImportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const statePath = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");
  const scope = parseStorageScope(getFlagString(parsed, "scope"));
  const clear = getFlagBoolean(parsed, "clear");

  if (!statePath) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser storage-import <storage.json> [--scope <local|session|both>] [--clear] [--session <sessionId>]",
      400
    );
  }

  const state = readJsonFile<StorageState>(context, statePath);
  if (!state || typeof state !== "object" || typeof state.origin !== "string") {
    throw new AppError("BAD_REQUEST", `${statePath} must contain a valid storage export`, 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<StorageImportResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/storage-import`,
    {
      state,
      scope,
      clear
    }
  );

  context.stdout.write(
    `session=${response.sessionId} origin=${response.origin} local=${response.localKeys} sessionStore=${response.sessionKeys} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
