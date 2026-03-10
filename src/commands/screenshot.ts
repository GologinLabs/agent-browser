import { AppError } from "../lib/errors";
import type { CommandContext, ScreenshotResponse } from "../lib/types";
import { ensureAbsolutePath, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runScreenshotCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const inputPath = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");
  const annotate = getFlagBoolean(parsed, "annotate");

  if (!inputPath) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser screenshot <path> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const targetPath = ensureAbsolutePath(context.cwd, inputPath);
  const response = await context.client.request<ScreenshotResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/screenshot`,
    { path: targetPath, annotate }
  );

  const annotated = response.annotated ? " annotated=yes" : "";
  context.stdout.write(`screenshot=${response.path} session=${response.sessionId}${annotated}\n`);
}
