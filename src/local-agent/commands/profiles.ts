import type { CommandContext, ProfilesResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { parseProfileSource, writeProfiles } from "./profileShared";

export async function runProfilesCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const json = getFlagBoolean(parsed, "json");
  const source = parseProfileSource(parsed, { allowAll: true });
  const platform = getFlagString(parsed, "platform");
  const status = getFlagString(parsed, "status");
  const tag = getFlagString(parsed, "tag");
  const search = getFlagString(parsed, "search");

  const query = new URLSearchParams();
  if (source !== "auto") {
    query.set("source", source);
  }
  if (platform) {
    query.set("platform", platform);
  }
  if (status) {
    query.set("status", status);
  }
  if (tag) {
    query.set("tag", tag);
  }
  if (search) {
    query.set("search", search);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await context.client.request<ProfilesResponse>("GET", `/profiles${suffix}`);
  writeProfiles(context, response.profiles, json);
}
