import { AppError } from "../lib/errors";
import { parseProxyFlags } from "../lib/proxy";
import { applyProfileUpdateTemplate, parseSupportedUseCase, supportedUseCaseChoices } from "../lib/useCases";
import type { CommandContext, ProfileUpdateResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { writeProfile } from "./profileShared";
import { parseCsvList } from "./shared";

export async function runProfileUpdateCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (!profileId) {
    throw new AppError(
      "BAD_REQUEST",
      `Usage: gologin-local-agent-browser profile-update <profileId> [--template <${supportedUseCaseChoices()}>] [--name <name>] [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <a,b>] [--add-tags <a,b>] [--remove-tags <a,b>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]`,
      400
    );
  }

  const template = parseSupportedUseCase(getFlagString(parsed, "template"), "--template");
  const response = await context.client.request<ProfileUpdateResponse>(
    "PATCH",
    `/profiles/${profileId}`,
    applyProfileUpdateTemplate({
    name: getFlagString(parsed, "name"),
    platform: getFlagString(parsed, "platform"),
    accountLabel: getFlagString(parsed, "account"),
    region: getFlagString(parsed, "region"),
    status: getFlagString(parsed, "status"),
    notes: getFlagString(parsed, "notes"),
    tags: parseCsvList(getFlagString(parsed, "tags")),
    addTags: parseCsvList(getFlagString(parsed, "add-tags")),
    removeTags: parseCsvList(getFlagString(parsed, "remove-tags")),
    proxy: parseProxyFlags(parsed)
    }, template)
  );

  writeProfile(context, response.profile, json);
}
