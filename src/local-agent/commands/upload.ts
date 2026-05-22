import { AppError } from "../lib/errors";
import type { CommandContext, SnapshotResponse, UploadResponse } from "../lib/types";
import { ensureAbsolutePath, formatSnapshotItem, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

function isDiscoverRequest(target: string | undefined, parsedDiscover: boolean): boolean {
  return parsedDiscover || target === "discover";
}

async function runDiscover(context: CommandContext, sessionId?: string): Promise<void> {
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const snapshot = await context.client.request<SnapshotResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/snapshot`,
    { interactive: true }
  );
  const uploadTargets = snapshot.items.filter((item) => item.flags?.includes("upload"));

  if (uploadTargets.length === 0) {
    context.stdout.write(
      `no upload targets found session=${snapshot.sessionId} url=${snapshot.url}\n` +
        "Try a CSS selector directly, for example: gologin-agent-browser upload 'input[type=\"file\"]' /path/file\n"
    );
    return;
  }

  context.stdout.write(`upload-targets=${uploadTargets.length} session=${snapshot.sessionId} url=${snapshot.url}\n`);
  for (const item of uploadTargets) {
    context.stdout.write(`${formatSnapshotItem(item)}\n`);
  }
  context.stdout.write(`example: gologin-agent-browser upload ${uploadTargets[0]?.ref} /path/file --session ${snapshot.sessionId}\n`);
}

export async function runUploadCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const target = parsed.positional[0];
  const files = parsed.positional.slice(1).map((file) => ensureAbsolutePath(context.cwd, file));
  const sessionId = getFlagString(parsed, "session");
  const discover = isDiscoverRequest(target, getFlagBoolean(parsed, "discover"));

  if (discover) {
    await runDiscover(context, sessionId);
    return;
  }

  if (!target || files.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser upload <target> <file...> [--session <sessionId>] | upload --discover [--session <sessionId>]",
      400
    );
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
