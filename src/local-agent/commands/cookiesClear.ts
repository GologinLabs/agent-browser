import type { CommandContext, CookiesClearResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runCookiesClearCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<CookiesClearResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/cookies-clear`
  );

  context.stdout.write(
    `session=${response.sessionId} cleared=${response.cleared} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
