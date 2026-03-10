import { AppError } from "../lib/errors";
import type { CommandContext, UploadResponse } from "../lib/types";
import { ensureAbsolutePath, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runUploadCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const files = parsed.positional.slice(1).map((file) => ensureAbsolutePath(context.cwd, file));
  const sessionId = getFlagString(parsed, "session");

  if (!target || files.length === 0) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser upload <target> <file...> [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<UploadResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/upload`,
    { target, files }
  );

  context.stdout.write(
    `uploaded files=${response.files.length} target=${target} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
