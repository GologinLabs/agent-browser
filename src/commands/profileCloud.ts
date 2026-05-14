import { writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { asObjectPayload, gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";

function getActionAndProfile(argv: string[]): { action: string; profileId: string } {
  const parsed = parseArgs(argv);
  const action = parsed.positional[0];
  const profileId = parsed.positional[1];
  if (!action || !profileId || !["start", "stop"].includes(action)) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser profile-cloud <start|stop> <profileId> [--json]", 400);
  }
  return { action, profileId };
}

export async function runProfileCloudCommand(context: CommandContext, argv: string[]): Promise<void> {
  const { action, profileId } = getActionAndProfile(argv);
  const json = getFlagBoolean(parseArgs(argv), "json");

  if (action === "start") {
    const payload = await gologinApiRequest<unknown>(context.config, "POST", `/browser/${profileId}/web`, { body: {} });
    if (json) {
      writeJsonStdout(context, payload ?? {});
      return;
    }
    const value = asObjectPayload(payload);
    const remoteUrl = typeof value.remoteOrbitaUrl === "string" ? ` remote=${value.remoteOrbitaUrl}` : "";
    context.stdout.write(`profile=${profileId} cloud=started${remoteUrl}\n`);
    return;
  }

  await gologinApiRequest<unknown>(context.config, "DELETE", `/browser/${profileId}/web`);
  if (json) {
    writeJsonStdout(context, { profileId, stopped: true });
    return;
  }
  context.stdout.write(`profile=${profileId} cloud=stopped\n`);
}
