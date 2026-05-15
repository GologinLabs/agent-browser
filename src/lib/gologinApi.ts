import { AppError } from "./errors";
import type { AgentConfig } from "./types";

export const GOLOGIN_API_BASE = "https://api.gologin.com";

type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function requireToken(config: AgentConfig): string {
  if (!config.token) {
    throw new AppError("TOKEN_MISSING", "GOLOGIN_TOKEN is required", 401);
  }

  return config.token;
}

function buildApiUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${GOLOGIN_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : undefined;
  }

  const value = payload as Record<string, unknown>;
  for (const key of ["message", "error", "reason"]) {
    if (typeof value[key] === "string" && value[key].length > 0) {
      return value[key];
    }
  }

  return undefined;
}

export async function gologinApiRequest<T>(
  config: AgentConfig,
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const token = requireToken(config);
  const hasBody = options.body !== undefined;
  const extraHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) {
      extraHeaders[key] = String(value);
    }
  }

  const response = await fetch(buildApiUrl(path, options.query), {
    method,
    headers: {
      ...extraHeaders,
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {})
    },
    body: hasBody ? JSON.stringify(options.body) : undefined
  });

  const payload = await readPayload(response);
  if (!response.ok) {
    const reason = extractErrorMessage(payload);
    throw new AppError(
      "GOLOGIN_API_FAILED",
      `GoLogin API ${method} ${path} failed with ${response.status}${reason ? `: ${reason}` : ""}`,
      response.status,
      {
        path,
        method,
        status: response.status,
        payload
      }
    );
  }

  return payload as T;
}

export function asObjectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
