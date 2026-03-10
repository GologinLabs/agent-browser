import { AppError } from "../lib/errors";
import type { CommandContext, FillResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runFillCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const text = parsed.positional.slice(1).join(" ");
  const sessionId = getFlagString(parsed, "session");

  if (!target || !text) {
    throw new AppError("BAD_REQUEST", 'Usage: gologin-agent fill <target> <text> [--session <sessionId>]', 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<FillResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/fill`,
    { target, text }
  );

  writeActionResult(context, "filled", target, response);
}
