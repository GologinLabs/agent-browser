import { AppError } from "../lib/errors";
import type { CommandContext, StorageImportResponse, StorageState } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { parseStorageScope, readJsonFile, resolveSessionId } from "./shared";

export async function runStorageImportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const storagePath = parsed.positional[0];
  const scope = parseStorageScope(getFlagString(parsed, "scope"));
  const clear = getFlagBoolean(parsed, "clear");

  if (!storagePath) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser storage-import <storage.json> [--scope <local|session|both>] [--clear] [--session <sessionId>]",
      400
    );
  }

  const state = readJsonFile<StorageState>(context, storagePath);
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<StorageImportResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/storage-import`,
    { state, scope, clear }
  );

  context.stdout.write(
    `origin=${response.origin} localKeys=${response.localKeys} sessionKeys=${response.sessionKeys} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
