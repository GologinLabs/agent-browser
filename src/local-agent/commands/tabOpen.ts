import type { CommandContext, TabOpenResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runTabOpenCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const url = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<TabOpenResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/tabopen`,
    url ? { url } : {}
  );

  context.stdout.write(`session=${response.sessionId} tab=${response.tabIndex} url=${response.url}\n`);
}
