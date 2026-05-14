import { writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

function parseDays(value: string | undefined): number {
  const days = value ? Number(value) : 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new AppError("BAD_REQUEST", "--days must be an integer from 1 to 30", 400);
  }
  return days;
}

export async function runCloudUsageCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const profileId = getFlagString(parsed, "profile") ?? parsed.positional[0];
  const workspaceId = getFlagString(parsed, "workspace");
  const json = getFlagBoolean(parsed, "json");

  if (profileId && workspaceId) {
    throw new AppError("BAD_REQUEST", "Use either --profile or --workspace, not both", 400);
  }

  if (profileId) {
    const payload = await gologinApiRequest<unknown>(context.config, "GET", `/cloud-usage/profile/${profileId}/stats`);
    if (json) {
      writeJsonStdout(context, payload);
      return;
    }
    context.stdout.write(`profile=${profileId} usage=${JSON.stringify(payload)}\n`);
    return;
  }

  if (!workspaceId) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser cloud-usage --profile <profileId> | --workspace <workspaceId> [--days <1-30>] [--json]",
      400
    );
  }

  const days = parseDays(getFlagString(parsed, "days"));
  const payload = await gologinApiRequest<unknown>(context.config, "GET", "/cloud-usage/stats", {
    query: { workspaceId, days }
  });
  if (json) {
    writeJsonStdout(context, payload);
    return;
  }
  context.stdout.write(`workspace=${workspaceId} days=${days} usage=${JSON.stringify(payload)}\n`);
}
