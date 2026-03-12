import type { CommandContext, CookiesResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeJsonFile, writeJsonStdout } from "./shared";

export async function runCookiesCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const outputPath = getFlagString(parsed, "output");
  const json = getFlagBoolean(parsed, "json");
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<CookiesResponse>("GET", `/sessions/${resolvedSessionId}/cookies`);

  if (outputPath) {
    const savedPath = writeJsonFile(context, outputPath, response.cookies);
    context.stdout.write(`${savedPath}\n`);
    return;
  }

  if (json) {
    writeJsonStdout(context, response.cookies);
    return;
  }

  context.stdout.write(`${JSON.stringify(response.cookies, null, 2)}\n`);
}
