import type { CommandContext, TabOpenResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runTabOpenCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const url = parsed.positional[0];
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<TabOpenResponse>("POST", `/sessions/${resolvedSessionId}/tabopen`, { url });

  context.stdout.write(
    `tab=${response.tabIndex} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
