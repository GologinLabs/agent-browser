import type { CommandContext, StorageClearResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { parseStorageScope, resolveSessionId } from "./shared";

export async function runStorageClearCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const scope = parseStorageScope(getFlagString(parsed, "scope"));
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<StorageClearResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/storage-clear`,
    { scope }
  );

  context.stdout.write(
    `origin=${response.origin} scope=${response.scope} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
