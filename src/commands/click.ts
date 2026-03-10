import { AppError } from "../lib/errors";
import type { ClickResponse, CommandContext } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runClickCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");

  if (!target) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent click <target> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<ClickResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/click`,
    { target }
  );

  writeActionResult(context, "clicked", target, response);
}
