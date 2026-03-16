import { AppError } from "../lib/errors";
import type { CommandContext, PruneSessionsResponse, SessionsResponse } from "../lib/types";
import { formatSessionLine, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

function parseOlderThanMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError("BAD_REQUEST", "--older-than-ms must be a non-negative integer", 400);
  }

  return parsed;
}

export async function runSessionsCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (getFlagBoolean(parsed, "prune")) {
    const olderThanMs = parseOlderThanMs(getFlagString(parsed, "older-than-ms"));
    const prune = await context.client.request<PruneSessionsResponse>("POST", "/sessions/prune", {
      maxIdleMs: olderThanMs,
    });
    context.stderr.write(`pruned ${prune.closed} session(s) idle for at least ${prune.maxIdleMs}ms\n`);
  }

  const response = await context.client.request<SessionsResponse>("GET", "/sessions");

  if (response.sessions.length === 0) {
    context.stdout.write("no sessions\n");
    return;
  }

  for (const session of response.sessions) {
    context.stdout.write(`${formatSessionLine(session)}\n`);
  }
}
