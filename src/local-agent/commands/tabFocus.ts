import { AppError } from "../lib/errors";
import type { CommandContext, TabFocusResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

function parseTabIndex(value: string | undefined): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index <= 0) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-local-agent-browser tabfocus <index> [--session <sessionId>]", 400);
  }

  return index;
}

export async function runTabFocusCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const index = parseTabIndex(parsed.positional[0]);
  const response = await context.client.request<TabFocusResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/tabfocus`,
    { index }
  );

  context.stdout.write(`session=${response.sessionId} tab=${response.tabIndex} url=${response.url}\n`);
}
