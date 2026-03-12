import { AppError } from "../lib/errors";
import type { CommandContext, TabFocusResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runTabFocusCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const rawIndex = parsed.positional[0];

  if (!rawIndex) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser tabfocus <index> [--session <sessionId>]", 400);
  }

  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index <= 0) {
    throw new AppError("BAD_REQUEST", "tab index must be a positive integer", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<TabFocusResponse>("POST", `/sessions/${resolvedSessionId}/tabfocus`, { index });

  context.stdout.write(
    `tab=${response.tabIndex} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
