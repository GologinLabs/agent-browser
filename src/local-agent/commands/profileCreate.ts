import { AppError } from "../lib/errors";
import { parseProxyFlags } from "../lib/proxy";
import { applyProfileCreateTemplate, parseSupportedUseCase, supportedUseCaseChoices } from "../lib/useCases";
import type { CommandContext, ProfileCreateResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { writeProfile } from "./profileShared";
import { parseCsvList } from "./shared";

export async function runProfileCreateCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const name = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (!name) {
    throw new AppError(
      "BAD_REQUEST",
      `Usage: gologin-local-agent-browser profile-create <name> [--template <${supportedUseCaseChoices()}>] [--platform <platform>] [--account <label>] [--region <region>] [--status <status>] [--notes <notes>] [--tags <tag1,tag2>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]`,
      400
    );
  }

  const template = parseSupportedUseCase(getFlagString(parsed, "template"), "--template");
  const response = await context.client.request<ProfileCreateResponse>(
    "POST",
    "/profiles",
    applyProfileCreateTemplate({
    name,
    platform: getFlagString(parsed, "platform"),
    accountLabel: getFlagString(parsed, "account"),
    region: getFlagString(parsed, "region"),
    status: getFlagString(parsed, "status"),
    notes: getFlagString(parsed, "notes"),
    tags: parseCsvList(getFlagString(parsed, "tags")),
    proxy: parseProxyFlags(parsed)
    }, template)
  );

  writeProfile(context, response.profile, json);
}
