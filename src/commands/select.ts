import { AppError } from "../lib/errors";
import type { CommandContext, SelectResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeActionResult } from "./shared";

export async function runSelectCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const value = parsed.positional.slice(1).join(" ");
  const sessionId = getFlagString(parsed, "session");

  if (!target || !value) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser select <target> <value> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<SelectResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/select`,
    { target, value }
  );

  writeActionResult(context, "selected", target, response);
}
