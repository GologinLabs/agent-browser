import { AppError } from "../lib/errors";
import type { CommandContext, ProfileResponse } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";
import { parseProfileSource, writeProfile } from "./profileShared";

export async function runProfileCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");
  const source = parseProfileSource(parsed);

  if (!profileId) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-local-agent-browser profile <profileId> [--json]", 400);
  }

  const suffix = source !== "auto" ? `?${new URLSearchParams({ source }).toString()}` : "";
  const response = await context.client.request<ProfileResponse>("GET", `/profiles/${profileId}${suffix}`);
  writeProfile(context, response.profile, json);
}
