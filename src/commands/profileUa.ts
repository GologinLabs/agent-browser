import { writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

function detectHostOs(): string {
  if (process.platform === "darwin") {
    return "mac";
  }
  if (process.platform === "win32") {
    return "win";
  }
  return "lin";
}

function normalizeOs(value: string | undefined): string {
  const os = value ?? detectHostOs();
  if (!["lin", "mac", "win", "android", "android-cloud"].includes(os)) {
    throw new AppError("BAD_REQUEST", "--os must be one of lin, mac, win, android, or android-cloud", 400);
  }
  return os;
}

export async function runProfileUaCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const action = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (action === "latest") {
    const os = normalizeOs(getFlagString(parsed, "os"));
    const payload = await gologinApiRequest<unknown>(context.config, "GET", "/browser/latest-useragent", {
      query: { os }
    });
    if (json) {
      writeJsonStdout(context, payload);
      return;
    }
    context.stdout.write(`os=${os} latestUserAgent=${typeof payload === "string" ? payload : JSON.stringify(payload)}\n`);
    return;
  }

  if (action === "update") {
    const profileIds = parsed.positional.slice(1);
    const allProfiles = getFlagBoolean(parsed, "all-profiles");
    if (profileIds.length === 0 && !allProfiles) {
      throw new AppError(
        "BAD_REQUEST",
        "Usage: gologin-agent-browser profile-ua update <profileId...> [--all-profiles] [--workspace <id>] [--json]",
        400
      );
    }
    const payload = await gologinApiRequest<unknown>(context.config, "PATCH", "/browser/update_ua_to_new_browser_v", {
      query: {
        currentWorkspace: getFlagString(parsed, "workspace")
      },
      body: {
        browserIds: profileIds,
        updateUaToNewBrowserV: true,
        updateAllProfiles: allProfiles
      }
    });
    if (json) {
      writeJsonStdout(context, payload ?? { updated: true, profileIds, allProfiles });
      return;
    }
    context.stdout.write(
      allProfiles ? "updatedUserAgent=allProfiles\n" : `updatedUserAgentProfiles=${profileIds.length} profiles=${profileIds.join(",")}\n`
    );
    return;
  }

  throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser profile-ua <latest|update> ...", 400);
}
