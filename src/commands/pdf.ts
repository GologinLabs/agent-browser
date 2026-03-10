import { AppError } from "../lib/errors";
import type { CommandContext, PdfResponse } from "../lib/types";
import { ensureAbsolutePath, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runPdfCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const inputPath = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");

  if (!inputPath) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent pdf <path> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const path = ensureAbsolutePath(context.cwd, inputPath);
  const response = await context.client.request<PdfResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/pdf`,
    { path }
  );

  context.stdout.write(`pdf=${response.path} session=${response.sessionId}\n`);
}
