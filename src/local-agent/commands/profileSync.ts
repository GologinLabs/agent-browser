import { AppError } from "../lib/errors";
import type { CommandContext, ProfileSyncResponse } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";
import { writeProfile } from "./profileShared";

export async function runProfileSyncCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (!profileId) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-local-agent-browser profile-sync <profileId> [--json]", 400);
  }

  const response = await context.client.request<ProfileSyncResponse>("POST", `/profiles/${profileId}/sync`);
  writeProfile(context, response.profile, json);
}
