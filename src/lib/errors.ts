import type { DaemonErrorPayload } from "./types";

export type ErrorCode =
  | "DAEMON_UNREACHABLE"
  | "TOKEN_MISSING"
  | "PROFILE_MISSING"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "REF_NOT_FOUND"
  | "BROWSER_CONNECTION_FAILED"
  | "NAVIGATION_TIMEOUT"
  | "SCREENSHOT_FAILED"
  | "PDF_FAILED"
  | "UPLOAD_FAILED"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isDaemonErrorPayload(value: unknown): value is DaemonErrorPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.status === "number"
  );
}

export function serializeError(error: unknown): DaemonErrorPayload {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
      status: 500
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: String(error),
    status: 500
  };
}

export function fromDaemonError(payload: DaemonErrorPayload): AppError {
  return new AppError(payload.code as ErrorCode, payload.message, payload.status, payload.details);
}

export function formatErrorLine(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return `INTERNAL_ERROR: ${String(error)}`;
}
