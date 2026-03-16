import { AppError } from "../lib/errors";
import type { CloseAllSessionsResponse, CloseSessionResponse, CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

export async function runCloseCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const closeAll = getFlagBoolean(parsed, "all");
  const sessionId = getFlagString(parsed, "session");

  if (closeAll) {
    if (sessionId) {
      throw new AppError("BAD_REQUEST", "--all cannot be combined with --session", 400);
    }

    const response = await context.client.request<CloseAllSessionsResponse>(
      "POST",
      "/sessions/close-all"
    );
    context.stdout.write(`closed ${response.closed} session(s)\n`);
    return;
  }

  const resolvedSessionId =
    sessionId ??
    (await context.client.request<{ sessionId: string }>("GET", "/sessions/current")).sessionId;

  const response = await context.client.request<CloseSessionResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/close`
  );

  context.stdout.write(`closed session=${response.sessionId}\n`);
}
