import type { CommandContext, TabsResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runTabsCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<TabsResponse>("GET", `/sessions/${resolvedSessionId}/tabs`);

  context.stdout.write(`session=${response.sessionId} tabs=${response.tabs.length}\n`);
  for (const tab of response.tabs) {
    const prefix = tab.active ? "*" : "-";
    const title = tab.title ? ` title=${JSON.stringify(tab.title)}` : "";
    context.stdout.write(`${prefix} tab=${tab.index} url=${tab.url}${title}\n`);
  }
}
