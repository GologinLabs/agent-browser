import type { BrowserContext } from "playwright";

import { AppError } from "./errors";

type PlaywrightCookie = Parameters<BrowserContext["addCookies"]>[0][number];
type CookieRecord = Record<string, unknown>;

const SAME_SITE_VALUES = new Map<string, PlaywrightCookie["sameSite"]>([
  ["strict", "Strict"],
  ["lax", "Lax"],
  ["none", "None"],
  ["no_restriction", "None"],
  ["no_restrictions", "None"]
]);

export function extractCookieArray(value: unknown, source = "Cookie import file"): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value.cookies)) {
    return value.cookies;
  }

  throw new AppError("BAD_REQUEST", `${source} must contain a JSON array of cookies or an object with a cookies array`, 400);
}

export function normalizeCookiesForPlaywright(value: unknown): PlaywrightCookie[] {
  return extractCookieArray(value, "cookies").map((cookie, index) => normalizeCookieForPlaywright(cookie, index));
}

function normalizeCookieForPlaywright(value: unknown, index: number): PlaywrightCookie {
  if (!isRecord(value)) {
    throw new AppError("BAD_REQUEST", `cookie[${index}] must be an object`, 400);
  }

  const name = readRequiredString(value, "name", index);
  const cookieValue = readCookieValue(value, index);
  const domain = readOptionalString(value, ["domain", "host", "hostname", "hostName"]);
  const url = readOptionalString(value, ["url"]);

  const cookie: PlaywrightCookie = {
    name,
    value: cookieValue
  };

  if (domain) {
    cookie.domain = normalizeDomain(domain, index);
    cookie.path = normalizePath(readOptionalString(value, ["path"]));
  } else if (url) {
    cookie.url = normalizeUrl(url, index);
  } else {
    throw new AppError(
      "BAD_REQUEST",
      `cookie[${index}] "${name}" must have either url or domain. GoLogin exports should include domain.`,
      400
    );
  }

  const expires = normalizeExpires(readOptionalNumber(value, ["expires", "expirationDate", "expiry", "expiration"]), value.session, index);
  if (expires !== undefined) {
    cookie.expires = expires;
  }

  const httpOnly = readOptionalBoolean(value, ["httpOnly", "http_only"]);
  if (httpOnly !== undefined) {
    cookie.httpOnly = httpOnly;
  }

  const secure = readOptionalBoolean(value, ["secure"]);
  if (secure !== undefined) {
    cookie.secure = secure;
  }

  const sameSite = normalizeSameSite(value.sameSite, index);
  if (sameSite) {
    cookie.sameSite = sameSite;
  }

  return cookie;
}

function isRecord(value: unknown): value is CookieRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(record: CookieRecord, field: string, index: number): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("BAD_REQUEST", `cookie[${index}] must have a non-empty ${field}`, 400);
  }
  return value;
}

function readCookieValue(record: CookieRecord, index: number): string {
  if (!Object.prototype.hasOwnProperty.call(record, "value")) {
    throw new AppError("BAD_REQUEST", `cookie[${index}] must have a value`, 400);
  }

  const value = record.value;
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  throw new AppError("BAD_REQUEST", `cookie[${index}] value must be a string, number, boolean, or null`, 400);
}

function readOptionalString(record: CookieRecord, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readOptionalNumber(record: CookieRecord, fields: string[]): number | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function readOptionalBoolean(record: CookieRecord, fields: string[]): boolean | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number" && (value === 0 || value === 1)) {
      return Boolean(value);
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no"].includes(normalized)) {
        return false;
      }
    }
  }
  return undefined;
}

function normalizeDomain(domain: string, index: number): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    try {
      return new URL(domain).hostname;
    } catch {
      throw new AppError("BAD_REQUEST", `cookie[${index}] domain is not a valid URL/domain`, 400);
    }
  }

  if (domain.includes("/")) {
    throw new AppError("BAD_REQUEST", `cookie[${index}] domain must not include a path`, 400);
  }

  return domain.startsWith("*.") ? `.${domain.slice(2)}` : domain;
}

function normalizePath(path?: string): string {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new AppError("BAD_REQUEST", `cookie[${index}] url must be a valid http(s) URL`, 400);
  }
}

function normalizeExpires(expires: number | undefined, session: unknown, index: number): number | undefined {
  const isSessionCookie = session === true || session === "true" || session === 1 || session === "1";
  if (isSessionCookie) {
    return -1;
  }

  if (expires === undefined) {
    return undefined;
  }

  if (!Number.isFinite(expires)) {
    throw new AppError("BAD_REQUEST", `cookie[${index}] expires/expirationDate must be a finite number`, 400);
  }

  if (expires <= 0) {
    return -1;
  }

  return expires > 10_000_000_000 ? expires / 1000 : expires;
}

function normalizeSameSite(value: unknown, index: number): PlaywrightCookie["sameSite"] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AppError("BAD_REQUEST", `cookie[${index}] sameSite must be a string`, 400);
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "" || normalized === "unspecified" || normalized === "not_set") {
    return undefined;
  }

  const sameSite = SAME_SITE_VALUES.get(normalized);
  if (!sameSite) {
    throw new AppError(
      "BAD_REQUEST",
      `cookie[${index}] sameSite "${value}" is not supported. Expected Strict, Lax, None, no_restriction, or unspecified.`,
      400
    );
  }

  return sameSite;
}
