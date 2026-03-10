import { AppError } from "../lib/errors";
import type { CommandContext, DoubleClickResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runDoubleClickCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");

  if (!target) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent dblclick <target> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<DoubleClickResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/dblclick`,
    { target }
  );

  writeActionResult(context, "double-clicked", target, response);
}
