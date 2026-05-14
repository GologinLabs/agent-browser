import { AppError } from "../lib/errors";
import { parseProxyFlags } from "../lib/proxy";
import type { CommandContext, OpenSessionResponse } from "../lib/types";
import { formatProxyLabel, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

function parseIdleTimeout(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new AppError("BAD_REQUEST", "--idle-timeout-ms must be a positive integer", 400);
  }

  return timeout;
}

export function parseHeadless(parsed: ReturnType<typeof parseArgs>): boolean | undefined {
  const headless = getFlagBoolean(parsed, "headless");
  const headed = getFlagBoolean(parsed, "headed");
  const visible = getFlagBoolean(parsed, "visible");
  const background = getFlagBoolean(parsed, "background");
  const wantsForeground = headed || visible;
  const wantsBackground = headless || background;

  if (wantsForeground && wantsBackground) {
    throw new AppError(
      "BAD_REQUEST",
      "--headless/--background and --headed/--visible are mutually exclusive",
      400
    );
  }

  if (wantsBackground) {
    return true;
  }

  if (wantsForeground) {
    return false;
  }

  return undefined;
}

export async function runOpenCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const url = parsed.positional[0];
  const profileId = getFlagString(parsed, "profile");
  const sessionId = getFlagString(parsed, "session");
  const proxy = parseProxyFlags(parsed);
  const idleTimeoutMs = parseIdleTimeout(getFlagString(parsed, "idle-timeout-ms"));
  const headless = parseHeadless(parsed);

  if (!url) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>] [--headless|--background|--headed|--visible] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]",
      400
    );
  }

  const response = await context.client.request<OpenSessionResponse>("POST", "/sessions/open", {
    url,
    profileId,
    sessionId,
    proxy,
    idleTimeoutMs,
    headless
  });

  const proxyLabel = formatProxyLabel(response.proxy);
  const proxyToken = proxyLabel ? ` proxy=${proxyLabel}` : "";
  const liveView = response.liveViewUrl ? ` liveview=${response.liveViewUrl}` : "";
  const idleTimeout = response.idleTimeoutMs !== undefined ? ` idleTimeoutMs=${response.idleTimeoutMs}` : "";
  context.stdout.write(`session=${response.sessionId} url=${response.url}${proxyToken}${idleTimeout}${liveView}\n`);
}
