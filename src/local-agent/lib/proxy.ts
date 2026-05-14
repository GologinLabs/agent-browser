import { AppError } from "./errors";
import type { ProxyConfig } from "./types";
import { getFlagString, parseArgs } from "./utils";

export function parseProxyFlags(parsed: ReturnType<typeof parseArgs>): ProxyConfig | undefined {
  const country = getFlagString(parsed, "proxy-country");
  const mode = getFlagString(parsed, "proxy-mode");
  const host = getFlagString(parsed, "proxy-host");
  const portRaw = getFlagString(parsed, "proxy-port");
  const username = getFlagString(parsed, "proxy-user");
  const password = getFlagString(parsed, "proxy-pass");

  if (country && (host || portRaw || username || password)) {
    throw new AppError(
      "BAD_REQUEST",
      "--proxy-country cannot be combined with --proxy-host/--proxy-port",
      400
    );
  }

  if (country) {
    if (mode && mode !== "gologin") {
      throw new AppError("BAD_REQUEST", "--proxy-country requires --proxy-mode gologin or no --proxy-mode", 400);
    }

    return {
      mode: "gologin",
      country: country.toLowerCase()
    };
  }

  if (host || portRaw || username || password || mode) {
    if (mode === "gologin") {
      throw new AppError("BAD_REQUEST", "--proxy-mode gologin requires --proxy-country", 400);
    }

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
