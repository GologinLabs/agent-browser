import { AppError } from "../lib/errors";
import type { CommandContext, OpenSessionResponse, ProxyConfig } from "../lib/types";
import { formatProxyLabel, getFlagString, parseArgs } from "../lib/utils";

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

function parseProxy(parsed: ReturnType<typeof parseArgs>): ProxyConfig | undefined {
  const country = getFlagString(parsed, "proxy-country");
  const mode = getFlagString(parsed, "proxy-mode");
  const host = getFlagString(parsed, "proxy-host");
  const portRaw = getFlagString(parsed, "proxy-port");
  const username = getFlagString(parsed, "proxy-user");
  const password = getFlagString(parsed, "proxy-pass");

  if (country) {
    throw new AppError(
      "BAD_REQUEST",
      "--proxy-country is not available for temporary cloud profiles yet; use a preconfigured --profile or a custom proxy host/port",
      400
    );
  }

  if (host || portRaw || username || password || mode) {
    const port = Number(portRaw);
    if (!host || !portRaw || !Number.isInteger(port) || port <= 0) {
      throw new AppError("BAD_REQUEST", "Custom proxy requires --proxy-host and a valid --proxy-port", 400);
    }

    const resolvedMode = mode ?? "http";
    if (!["http", "socks4", "socks5"].includes(resolvedMode)) {
      throw new AppError("BAD_REQUEST", "--proxy-mode must be one of http, socks4, or socks5", 400);
    }

    return {
      mode: resolvedMode as ProxyConfig["mode"],
      host,
      port,
      username,
      password
    };
  }

  return undefined;
}

export async function runOpenCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const url = parsed.positional[0];
  const profileId = getFlagString(parsed, "profile");
  const sessionId = getFlagString(parsed, "session");
  const proxy = parseProxy(parsed);
  const idleTimeoutMs = parseIdleTimeout(getFlagString(parsed, "idle-timeout-ms"));

  if (!url) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>] [--proxy-host <host> --proxy-port <port>]",
      400
    );
  }

  const response = await context.client.request<OpenSessionResponse>("POST", "/sessions/open", {
    url,
    profileId,
    sessionId,
    proxy,
    idleTimeoutMs
  });

  const proxyLabel = formatProxyLabel(response.proxy);
  const proxyToken = proxyLabel ? ` proxy=${proxyLabel}` : "";
  const liveView = response.liveViewUrl ? ` liveview=${response.liveViewUrl}` : "";
  const idleTimeout = response.idleTimeoutMs !== undefined ? ` idleTimeoutMs=${response.idleTimeoutMs}` : "";
  context.stdout.write(`session=${response.sessionId} url=${response.url}${proxyToken}${idleTimeout}${liveView}\n`);
}
