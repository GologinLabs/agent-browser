import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors";
import type {
  DaemonErrorPayload,
  ProxySummary,
  RefDescriptor,
  ResolvedTransport,
  SessionSummary,
  SnapshotItem
} from "./types";

export type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(["interactive", "exact", "annotate", "press-escape", "json", "clear", "all", "prune"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "-i") {
      flags.interactive = true;
      continue;
    }

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const flagName = token.slice(2);

    if (booleanFlags.has(flagName)) {
      flags[flagName] = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new AppError("BAD_REQUEST", `Missing value for ${token}`, 400);
    }

    flags[flagName] = next;
    index += 1;
  }

  return { positional, flags };
}

export function getFlagString(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function getFlagBoolean(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

export function generateSessionId(existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  let counter = 1;

  while (existing.has(`s${counter}`)) {
    counter += 1;
  }

  return `s${counter}`;
}

export function ensureAbsolutePath(baseDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

export function isRefTarget(target: string): boolean {
  return /^@e\d+$/.test(target);
}

export function isNumericToken(token: string): boolean {
  return /^-?\d+$/.test(token);
}

export function formatSnapshotItem(item: SnapshotItem): string {
  const flags = item.flags && item.flags.length > 0 ? ` ${item.flags.map((flag) => `[${flag}]`).join(" ")}` : "";
  return `- ${item.kind} "${item.text}"${flags} [ref=${item.ref}]`;
}

export function formatProxyLabel(proxy?: ProxySummary): string | undefined {
  if (!proxy) {
    return undefined;
  }

  if (proxy.mode === "none") {
    return undefined;
  }

  if (proxy.mode === "gologin") {
    return proxy.country ? `gologin:${proxy.country}` : "gologin";
  }

  if (proxy.host && proxy.port) {
    return `${proxy.mode}:${proxy.host}:${proxy.port}`;
  }

  return proxy.mode;
}

export function formatSessionLine(session: SessionSummary): string {
  const prefix = session.active ? "*" : "-";
  const profile = session.profileId ? ` profile=${session.profileId}` : "";
  const snapshotState = session.hasSnapshot ? (session.staleSnapshot ? "stale" : "fresh") : "none";
  const proxy = formatProxyLabel(session.proxy);
  const proxyToken = proxy ? ` proxy=${proxy}` : "";
  const idleTimeout = session.idleTimeoutMs !== undefined ? ` idleTimeoutMs=${session.idleTimeoutMs}` : "";
  const liveView = session.liveViewUrl ? ` liveview=${session.liveViewUrl}` : "";
  const screenshot = session.lastScreenshotPath ? ` shot=${session.lastScreenshotPath}` : "";
  const pdf = session.lastPdfPath ? ` pdf=${session.lastPdfPath}` : "";
  return `${prefix} session=${session.sessionId}${profile} url=${session.url} snapshot=${snapshotState}${proxyToken}${idleTimeout}${liveView}${screenshot}${pdf}`;
}

export function formatCurrentLine(session: SessionSummary): string {
  const profile = session.profileId ? ` profile=${session.profileId}` : "";
  const snapshotState = session.hasSnapshot ? (session.staleSnapshot ? "stale" : "fresh") : "none";
  const proxy = formatProxyLabel(session.proxy);
  const proxyToken = proxy ? ` proxy=${proxy}` : "";
  const idleTimeout = session.idleTimeoutMs !== undefined ? ` idleTimeoutMs=${session.idleTimeoutMs}` : "";
  const liveView = session.liveViewUrl ? ` liveview=${session.liveViewUrl}` : "";
  const screenshot = session.lastScreenshotPath ? ` shot=${session.lastScreenshotPath}` : "";
  const pdf = session.lastPdfPath ? ` pdf=${session.lastPdfPath}` : "";
  return `session=${session.sessionId}${profile} url=${session.url} snapshot=${snapshotState}${proxyToken}${idleTimeout}${liveView}${screenshot}${pdf}`;
}

export function writeJsonResponse(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AppError("BAD_REQUEST", "Request body must be valid JSON", 400));
      }
    });
    request.on("error", reject);
  });
}

export function appendLog(logPath: string, line: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

export function buildRefDisplayText(descriptor: RefDescriptor): string {
  return descriptor.accessibleName ?? descriptor.text ?? descriptor.placeholder ?? descriptor.name ?? "";
}

export function makeTransportLabel(transport: ResolvedTransport): string {
  if (transport.kind === "socket") {
    return `socket:${transport.socketPath}`;
  }

  return `http://${transport.host}:${transport.port}`;
}

export function isDaemonErrorResponse(
  payload: unknown
): payload is DaemonErrorPayload & { code: string; message: string; status: number } {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.status === "number"
  );
}
