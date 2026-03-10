import { AppError } from "../lib/errors";
import type { CommandContext, ScrollIntoViewResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runScrollIntoViewCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");

  if (!target) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent scrollintoview <target> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<ScrollIntoViewResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/scrollintoview`,
    { target }
  );

  writeActionResult(context, "scrolled-into-view", target, response);
}
