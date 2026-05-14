import { AppError } from "../lib/errors";
import type { CommandContext, TabCloseResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

function parseOptionalTabIndex(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const index = Number(value);
  if (!Number.isInteger(index) || index <= 0) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-local-agent-browser tabclose [index] [--session <sessionId>]", 400);
  }

  return index;
}

export async function runTabCloseCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const index = parseOptionalTabIndex(parsed.positional[0]);
  const response = await context.client.request<TabCloseResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/tabclose`,
    index ? { index } : {}
  );

  context.stdout.write(
    `closed tab=${response.closedTabIndex} session=${response.sessionId} current=${response.activeTabIndex} url=${response.url}\n`
  );
}
