import { AppError } from "../lib/errors";
import type { CommandContext, FocusResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runFocusCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");

  if (!target) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser focus <target> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<FocusResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/focus`,
    { target }
  );

  writeActionResult(context, "focused", target, response);
}
