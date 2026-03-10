import { AppError } from "../lib/errors";
import type { CommandContext, PressResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runPressCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const key = parsed.positional[0];
  const target = parsed.positional[1];
  const sessionId = getFlagString(parsed, "session");

  if (!key) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent press <key> [target] [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<PressResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/press`,
    { key, target }
  );

  const targetSuffix = target ? ` target=${target}` : "";
  context.stdout.write(
    `pressed key=${key}${targetSuffix} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
