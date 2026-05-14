import { AppError } from "../lib/errors";
import type { CommandContext, ProfileDeleteResponse } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";

export async function runProfileDeleteCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = parsed.positional[0];
  const remote = getFlagBoolean(parsed, "remote");

  if (!profileId) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser profile-delete <profileId> [--remote]",
      400
    );
  }

  const response = await context.client.request<ProfileDeleteResponse>("DELETE", `/profiles/${profileId}`, {
    remote
  });

  context.stdout.write(
    `removed profile=${response.profileId} remoteDeleted=${response.remoteDeleted}\n`
  );
}
