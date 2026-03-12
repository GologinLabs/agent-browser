import { AppError } from "../lib/errors";
import type { CommandContext, TabCloseResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runTabCloseCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const rawIndex = parsed.positional[0];
  let index: number | undefined;

  if (rawIndex !== undefined) {
    index = Number(rawIndex);
    if (!Number.isInteger(index) || index <= 0) {
      throw new AppError("BAD_REQUEST", "tab index must be a positive integer", 400);
    }
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<TabCloseResponse>("POST", `/sessions/${resolvedSessionId}/tabclose`, { index });

  context.stdout.write(
    `closedTab=${response.closedTabIndex} activeTab=${response.activeTabIndex} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
