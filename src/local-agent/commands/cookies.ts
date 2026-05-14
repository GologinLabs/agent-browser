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
    context.stdout.write(`session=${response.sessionId} cookies=${response.cookies.length} path=${savedPath}\n`);
    return;
  }

  if (json) {
    writeJsonStdout(context, response.cookies);
    return;
  }

  context.stdout.write(`session=${response.sessionId} cookies=${response.cookies.length} url=${response.url}\n`);
  for (const cookie of response.cookies) {
    const sameSite = cookie.sameSite ? ` sameSite=${cookie.sameSite}` : "";
    context.stdout.write(
      `- cookie name=${cookie.name} domain=${cookie.domain} path=${cookie.path} secure=${cookie.secure} httpOnly=${cookie.httpOnly} expires=${cookie.expires}${sameSite}\n`
    );
  }
}
