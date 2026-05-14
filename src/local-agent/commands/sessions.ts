import type { CommandContext, SessionsResponse } from "../lib/types";
import { formatSessionLine, parseArgs } from "../lib/utils";

export async function runSessionsCommand(context: CommandContext, argv: string[]): Promise<void> {
  parseArgs(argv);
  const response = await context.client.request<SessionsResponse>("GET", "/sessions");

  if (response.sessions.length === 0) {
    context.stdout.write("no sessions\n");
    return;
  }

  for (const session of response.sessions) {
    context.stdout.write(`${formatSessionLine(session)}\n`);
  }
}
