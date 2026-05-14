import type { CommandContext, StorageExportResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { parseStorageScope, resolveSessionId, writeJsonFile, writeJsonStdout } from "./shared";

export async function runStorageExportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const outputPath = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");
  const scope = parseStorageScope(getFlagString(parsed, "scope"));
  const json = getFlagBoolean(parsed, "json");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<StorageExportResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/storage-export`,
    scope ? { scope } : {}
  );

  if (outputPath) {
    const savedPath = writeJsonFile(context, outputPath, response.state);
    context.stdout.write(
      `session=${response.sessionId} origin=${response.state.origin} local=${Object.keys(response.state.localStorage).length} sessionStore=${Object.keys(response.state.sessionStorage).length} path=${savedPath}\n`
    );
    return;
  }

  if (json || !outputPath) {
    writeJsonStdout(context, response.state);
  }
}
