import { AppError } from "../lib/errors";
import type { CommandContext, ProfileSourceMode, ProfileView } from "../lib/types";
import type { ParsedArgs } from "../lib/utils";
import { formatProxyLabel } from "../lib/utils";
import { writeJsonStdout } from "./shared";

export function parseProfileSource(parsed: ParsedArgs, options?: { allowAll?: boolean }): ProfileSourceMode {
  const allowAll = options?.allowAll === true;
  const flags = [
    parsed.flags.local === true ? "local" : undefined,
    parsed.flags.remote === true ? "remote" : undefined,
    allowAll && parsed.flags.all === true ? "all" : undefined
  ].filter(Boolean) as ProfileSourceMode[];

  if (flags.length > 1) {
    throw new AppError("BAD_REQUEST", "--local, --remote, and --all are mutually exclusive", 400);
  }

  return flags[0] ?? "auto";
}

export function writeProfiles(context: CommandContext, profiles: ProfileView[], json = false): void {
  if (json) {
    writeJsonStdout(context, profiles);
    return;
  }

  if (profiles.length === 0) {
    context.stdout.write("no profiles\n");
    return;
  }

  for (const profile of profiles) {
    const registered = profile.registered !== false;
    const platform = profile.platform ? ` platform=${profile.platform}` : "";
    const account = profile.accountLabel ? ` account=${profile.accountLabel}` : "";
    const region = profile.region ? ` region=${profile.region}` : "";
    const tags = profile.tags.length > 0 ? ` tags=${profile.tags.join(",")}` : "";
    const proxy = formatProxyLabel(profile.proxy);
    const proxyToken = proxy ? ` proxy=${proxy}` : "";
    const registrationToken = registered ? "" : " registered=false";
    const source = profile.source === "remote" ? " source=remote" : "";
    context.stdout.write(
      `profile=${profile.profileId} name=${JSON.stringify(profile.name)} status=${profile.status}${platform}${account}${region}${tags}${proxyToken}${registrationToken}${source}\n`
    );
  }
}

export function writeProfile(context: CommandContext, profile: ProfileView, json = false): void {
  if (json) {
    writeJsonStdout(context, profile);
    return;
  }

  writeProfiles(context, [profile], false);
  if (profile.notes) {
    context.stdout.write(`notes=${JSON.stringify(profile.notes)}\n`);
  }
  if (profile.userAgent) {
    context.stdout.write(`userAgent=${JSON.stringify(profile.userAgent)}\n`);
  }
  if (profile.os) {
    context.stdout.write(`os=${profile.os}\n`);
  }
  if (profile.registered === false) {
    context.stdout.write("registered=false\n");
  }
  context.stdout.write(
    `source=${profile.source}${profile.createdAt ? ` createdAt=${profile.createdAt}` : ""}${profile.updatedAt ? ` updatedAt=${profile.updatedAt}` : ""}${profile.lastSyncedAt ? ` lastSyncedAt=${profile.lastSyncedAt}` : ""}\n`
  );
}
