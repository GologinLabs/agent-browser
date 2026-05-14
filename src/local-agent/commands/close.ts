import type { CloseSessionResponse, CommandContext } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";

export async function runCloseCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId =
    sessionId ??
    (await context.client.request<{ sessionId: string }>("GET", "/sessions/current")).sessionId;

  const response = await context.client.request<CloseSessionResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/close`
  );

  context.stdout.write(`closed session=${response.sessionId}\n`);
}
