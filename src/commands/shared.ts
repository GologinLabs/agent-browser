import type { ActionResponse, CommandContext } from "../lib/types";

export async function resolveSessionId(context: CommandContext, explicitSessionId?: string): Promise<string> {
  if (explicitSessionId) {
    return explicitSessionId;
  }

  return (await context.client.request<{ sessionId: string }>("GET", "/sessions/current")).sessionId;
}

export function writeActionResult(
  context: CommandContext,
  verb: string,
  target: string,
  response: ActionResponse
): void {
  context.stdout.write(
    `${verb} target=${target} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
