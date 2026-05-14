import { writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";

export async function runProfileFingerprintCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const action = parsed.positional[0];
  const profileIds = parsed.positional.slice(1);
  const json = getFlagBoolean(parsed, "json");

  if (action !== "refresh" || profileIds.length === 0) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser profile-fingerprint refresh <profileId...> [--json]", 400);
  }

  const payload = await gologinApiRequest<unknown>(context.config, "PATCH", "/browser/fingerprints", {
    body: {
      browsersIds: profileIds
    }
  });
  if (json) {
    writeJsonStdout(context, payload);
    return;
  }
  context.stdout.write(`refreshedFingerprints=${profileIds.length} profiles=${profileIds.join(",")}\n`);
}
