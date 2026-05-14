import type { ProfileProxyCheck, ProxySummary } from "./types";
import { formatProxyLabel } from "./utils";

type RemoteState = "available" | "missing" | "unavailable";

export function proxyCheckLabel(proxy?: ProxySummary): string {
  return formatProxyLabel(proxy) ?? "none";
}

export function buildProfileProxyCheck(input: {
  profileId: string;
  localProxy?: ProxySummary;
  remoteProxy?: ProxySummary;
  localRegistered: boolean;
  remoteState: RemoteState;
  remoteWarning?: string;
}): ProfileProxyCheck {
  const localProxyLabel = proxyCheckLabel(input.localProxy);
  const remoteProxyLabel = proxyCheckLabel(input.remoteProxy);

  if (input.localRegistered && input.remoteState === "available") {
    const status = localProxyLabel === remoteProxyLabel ? "match" : "mismatch";
    return {
      profileId: input.profileId,
      status,
      localRegistered: true,
      remoteAvailable: true,
      localProxy: input.localProxy,
      remoteProxy: input.remoteProxy,
      localProxyLabel,
      remoteProxyLabel,
      warning:
        status === "mismatch"
          ? `local registry proxy ${localProxyLabel} differs from remote proxy ${remoteProxyLabel}`
          : undefined
    };
  }

  if (input.localRegistered && input.remoteState === "missing") {
    return {
      profileId: input.profileId,
      status: "local-only",
      localRegistered: true,
      remoteAvailable: false,
      localProxy: input.localProxy,
      localProxyLabel,
      remoteProxyLabel,
      warning: "profile exists in the local registry but is missing remotely"
    };
  }

  if (!input.localRegistered && input.remoteState === "available") {
    return {
      profileId: input.profileId,
      status: "remote-only",
      localRegistered: false,
      remoteAvailable: true,
      remoteProxy: input.remoteProxy,
      localProxyLabel,
      remoteProxyLabel,
      warning: "profile exists remotely but is not registered locally"
    };
  }

  return {
    profileId: input.profileId,
    status: "unavailable",
    localRegistered: input.localRegistered,
    remoteAvailable: input.remoteState === "available",
    localProxy: input.localProxy,
    remoteProxy: input.remoteProxy,
    localProxyLabel,
    remoteProxyLabel,
    warning: input.remoteWarning ?? "remote proxy could not be checked"
  };
}
