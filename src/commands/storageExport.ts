import type { CommandContext, StorageExportResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { parseStorageScope, resolveSessionId, writeJsonFile, writeJsonStdout } from "./shared";

export async function runStorageExportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const outputPath = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");
  const scope = parseStorageScope(getFlagString(parsed, "scope"));
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<StorageExportResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/storage-export`,
    { scope }
  );

  if (outputPath) {
    const savedPath = writeJsonFile(context, outputPath, response.state);
    context.stdout.write(`${savedPath}\n`);
    return;
  }

  if (json) {
    writeJsonStdout(context, response.state);
    return;
  }

  context.stdout.write(`${JSON.stringify(response.state, null, 2)}\n`);
}
