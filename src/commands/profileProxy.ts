import { writeJsonStdout } from "./shared";
import { AppError } from "../lib/errors";
import { asObjectPayload, gologinApiRequest } from "../lib/gologinApi";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

function normalizeProxyType(value: string | undefined): { isMobile?: boolean; isDC?: boolean; label: string } {
  const type = value ?? "residential";
  if (type === "mobile") {
    return { isMobile: true, label: "mobile" };
  }
  if (type === "dc" || type === "datacenter") {
    return { isDC: true, label: "datacenter" };
  }
  if (type === "residential") {
    return { label: "residential" };
  }
  throw new AppError("BAD_REQUEST", "--type must be one of residential, mobile, or dc", 400);
}

function parsePage(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("BAD_REQUEST", "--page must be a positive integer", 400);
  }
  return page;
}

function normalizeCountryCode(value: string): string {
  const countryCode = value.toLowerCase();
  if (!/^[a-z]{2}$/.test(countryCode)) {
    throw new AppError("BAD_REQUEST", "--country must be a 2-letter country code, for example us", 400);
  }
  return countryCode;
}

export async function runProfileProxyCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const action = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (action === "list") {
    const payload = await gologinApiRequest<unknown>(context.config, "GET", "/proxy/v2", {
      query: { page: parsePage(getFlagString(parsed, "page")) }
    });
    if (json) {
      writeJsonStdout(context, payload);
      return;
    }
    const value = asObjectPayload(payload);
    const proxies = Array.isArray(value.proxies) ? value.proxies : [];
    context.stdout.write(`proxies=${proxies.length} hasMore=${value.hasMore === true}\n`);
    return;
  }

  if (action === "traffic") {
    const payload = await gologinApiRequest<unknown>(context.config, "GET", "/users-proxies/geolocation/traffic");
    writeJsonStdout(context, payload);
    return;
  }

  if (action === "add-gologin") {
    const profileId = getFlagString(parsed, "profile") ?? parsed.positional[1];
    const countryCode = getFlagString(parsed, "country");
    if (!profileId || !countryCode) {
      throw new AppError(
        "BAD_REQUEST",
        "Usage: gologin-agent-browser profile-proxy add-gologin <profileId> --country <cc> [--city <city>] [--type residential|mobile|dc] [--name <name>] [--json]",
        400
      );
    }

    const proxyType = normalizeProxyType(getFlagString(parsed, "type"));
    const normalizedCountry = normalizeCountryCode(countryCode);
    const body: Record<string, unknown> = {
      countryCode: normalizedCountry,
      profileIdToLink: profileId,
      customName: getFlagString(parsed, "name") ?? `gologin-${normalizedCountry}-${profileId.slice(0, 6)}`
    };
    const city = getFlagString(parsed, "city");
    if (city) {
      body.city = city;
    }
    if (proxyType.isMobile !== undefined) {
      body.isMobile = proxyType.isMobile;
    }
    if (proxyType.isDC !== undefined) {
      body.isDC = proxyType.isDC;
    }

    const payload = await gologinApiRequest<unknown>(context.config, "POST", "/users-proxies/mobile-proxy", { body });
    if (json) {
      writeJsonStdout(context, payload ?? { profileId, countryCode: normalizedCountry, type: proxyType.label });
      return;
    }
    context.stdout.write(`profile=${profileId} proxy=gologin:${normalizedCountry} type=${proxyType.label}\n`);
    return;
  }

  throw new AppError(
    "BAD_REQUEST",
    "Usage: gologin-agent-browser profile-proxy <list|traffic|add-gologin> ...",
    400
  );
}
