import { AppError } from "../lib/errors";
import type { CommandContext, ProfileImportResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { writeProfile } from "./profileShared";
import { parseCsvList } from "./shared";

export async function runProfileImportCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (!profileId) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser profile-import <profileId> [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <tag1,tag2>]",
      400
    );
  }

  const response = await context.client.request<ProfileImportResponse>("POST", "/profiles/import", {
    profileId,
    platform: getFlagString(parsed, "platform"),
    accountLabel: getFlagString(parsed, "account"),
    region: getFlagString(parsed, "region"),
    status: getFlagString(parsed, "status"),
    notes: getFlagString(parsed, "notes"),
    tags: parseCsvList(getFlagString(parsed, "tags"))
  });

  writeProfile(context, response.profile, json);
}
