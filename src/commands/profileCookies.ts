import { readJsonFile, writeJsonFile, writeJsonStdout } from "./shared";
import { extractCookieArray } from "../lib/cookieNormalizer";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

type ProfileCookie = Record<string, unknown>;

export async function runProfileCookiesCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const action = parsed.positional[0];
  const profileId = parsed.positional[1];
  const json = getFlagBoolean(parsed, "json");

  if (!action || !profileId || !["export", "import"].includes(action)) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser profile-cookies <export|import> <profileId> [cookies.json] [--output <path>] [--clean] [--json]",
      400
    );
  }

  if (action === "export") {
    const cookies = await gologinApiRequest<ProfileCookie[]>(context.config, "GET", `/browser/${profileId}/cookies`);
    const outputPath = getFlagString(parsed, "output");
    if (outputPath) {
      context.stdout.write(`${writeJsonFile(context, outputPath, cookies)}\n`);
      return;
    }
    if (json) {
      writeJsonStdout(context, { profileId, cookies });
      return;
    }
    writeJsonStdout(context, cookies);
    return;
  }

  const cookiesPath = parsed.positional[2];
  if (!cookiesPath) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser profile-cookies import <profileId> <cookies.json> [--clean]", 400);
  }
  const cookies = extractCookieArray(readJsonFile<unknown>(context, cookiesPath)) as ProfileCookie[];
  const cleanCookies = getFlagBoolean(parsed, "clean");
  await gologinApiRequest<unknown>(context.config, "POST", `/browser/${profileId}/cookies`, {
    query: {
      fromUser: true,
      cleanCookies: cleanCookies || undefined
    },
    body: cookies
  });

  if (json) {
    writeJsonStdout(context, { profileId, imported: cookies.length, cleanCookies });
    return;
  }
  context.stdout.write(`profile=${profileId} importedCookies=${cookies.length}${cleanCookies ? " clean=true" : ""}\n`);
}
