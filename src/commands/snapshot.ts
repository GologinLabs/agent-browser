import type { CommandContext, SnapshotResponse } from "../lib/types";
import { formatSnapshotItem, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

export async function runSnapshotCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const interactive = getFlagBoolean(parsed, "interactive");
  const resolvedSessionId =
    sessionId ??
    (await context.client.request<{ sessionId: string }>("GET", "/sessions/current")).sessionId;

  const response = await context.client.request<SnapshotResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/snapshot`,
    interactive ? { interactive: true } : {}
  );

  context.stdout.write(`session=${response.sessionId} url=${response.url}\n`);
  for (const item of response.items) {
    context.stdout.write(`${formatSnapshotItem(item)}\n`);
  }
}
