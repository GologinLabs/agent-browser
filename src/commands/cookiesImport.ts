import { AppError } from "../lib/errors";
import type { BrowserCookie, CommandContext, CookiesImportResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { readJsonFile, resolveSessionId } from "./shared";

export async function runCookiesImportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const cookiesPath = parsed.positional[0];

  if (!cookiesPath) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser cookies-import <cookies.json> [--session <sessionId>]", 400);
  }

  const cookies = readJsonFile<BrowserCookie[]>(context, cookiesPath);
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<CookiesImportResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/cookies-import`,
    { cookies }
  );

  context.stdout.write(
    `imported=${response.imported} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
