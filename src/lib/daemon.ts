import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config";
import { AppError, fromDaemonError } from "./errors";
import type {
  AgentConfig,
  DaemonClient,
  DoctorResponse,
  HealthResponse,
  ResolvedTransport,
  SessionsResponse,
  SessionSummary
} from "./types";
import { isDaemonErrorResponse, makeTransportLabel } from "./utils";

function projectRootFromCli(): string {
  return path.resolve(__dirname, "..", "..");
}

function buildDaemonSpawnCommand(projectRoot: string): { command: string; args: string[] } {
  const distServerPath = path.join(projectRoot, "dist", "daemon", "server.js");
  if (fs.existsSync(distServerPath)) {
    return {
      command: process.execPath,
      args: [distServerPath]
    };
  }

  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const srcServerPath = path.join(projectRoot, "src", "daemon", "server.ts");

  if (fs.existsSync(tsxCli) && fs.existsSync(srcServerPath)) {
    return {
      command: process.execPath,
      args: [tsxCli, srcServerPath]
    };
  }

  throw new AppError(
    "DAEMON_UNREACHABLE",
    "Daemon entrypoint is missing. Run npm install and npm run build first.",
    500
  );
}

export function buildDaemonTransports(config: AgentConfig): ResolvedTransport[] {
  const transports: ResolvedTransport[] = [];
  if (process.platform !== "win32") {
    transports.push({
      kind: "socket",
      socketPath: config.socketPath
    });
  }
  transports.push({
    kind: "http",
    host: config.daemonHost,
    port: config.daemonPort
  });

  return transports;
}

export function createDaemonClient(transport: ResolvedTransport): DaemonClient {
  return {
    transport,
    async request<TResponse>(method: string, requestPath: string, body?: unknown): Promise<TResponse> {
      return (await requestOverHttp(transport, method, requestPath, body)) as TResponse;
    }
  };
}

export function requestOverHttp(
  transport: ResolvedTransport,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const options: http.RequestOptions =
      transport.kind === "socket"
        ? {
            socketPath: transport.socketPath,
            path: requestPath,
            method,
            headers: payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.length)
                }
              : undefined
          }
        : {
            host: transport.host,
            port: transport.port,
            path: requestPath,
            method,
            headers: payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(payload.length)
                }
              : undefined
          };

    const request = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "{}";
        const parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;

        if ((response.statusCode ?? 500) >= 400) {
          if (isDaemonErrorResponse(parsed)) {
            reject(fromDaemonError(parsed));
            return;
          }

          reject(new AppError("INTERNAL_ERROR", `Daemon request failed with status ${response.statusCode}`, 500));
          return;
        }

        resolve(parsed);
      });
    });

    request.on("error", (error) => reject(error));

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

export async function probeTransport(transport: ResolvedTransport): Promise<boolean> {
  try {
    await requestOverHttp(transport, "GET", "/health");
    return true;
  } catch {
    return false;
  }
}

export async function inspectDaemon(config: AgentConfig): Promise<DoctorResponse> {
  const resolvedTransports = buildDaemonTransports(config);
  const transports = await Promise.all(
    resolvedTransports.map(async (transport) => ({
      label: makeTransportLabel(transport),
      reachable: await probeTransport(transport)
    }))
  );
  const reachableTransport = resolvedTransports.find((transport, index) => transports[index]?.reachable);
  let trackedSessions: number | undefined;
  let activeSessionId: string | undefined;

  if (reachableTransport) {
    try {
      const sessions = (await requestOverHttp(reachableTransport, "GET", "/sessions")) as SessionsResponse;
      trackedSessions = sessions.sessions.length;
      activeSessionId = sessions.activeSessionId;
    } catch {
      try {
        const current = (await requestOverHttp(reachableTransport, "GET", "/sessions/current")) as SessionSummary;
        trackedSessions = trackedSessions ?? 1;
        activeSessionId = current.sessionId;
      } catch {
        // Ignore session-inspection failures. Transport reachability is the primary doctor signal.
      }
    }
  }

  return {
    ok: transports.some((transport) => transport.reachable),
    tokenConfigured: Boolean(config.token),
    defaultProfileId: config.defaultProfileId,
    connectBase: config.connectBase,
    daemonLogPath: config.logPath,
    configPath: config.configPath,
    reachableTransport: reachableTransport ? makeTransportLabel(reachableTransport) : undefined,
    trackedSessions,
    activeSessionId,
    transports
  };
}

async function waitForDaemon(transports: ResolvedTransport[], timeoutMs: number): Promise<ResolvedTransport | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const transport of transports) {
      if (await probeTransport(transport)) {
        return transport;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return undefined;
}

export async function ensureDaemon(config: ReturnType<typeof loadConfig>): Promise<ResolvedTransport> {
  const transports = buildDaemonTransports(config);

  for (const transport of transports) {
    if (await probeTransport(transport)) {
      return transport;
    }
  }

  const projectRoot = projectRootFromCli();
  const command = buildDaemonSpawnCommand(projectRoot);
  let spawnError: Error | undefined;
  const child = spawn(command.command, command.args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  child.unref();

  const resolved = await waitForDaemon(transports, 5_000);
  if (!resolved) {
    const labels = transports.map((transport) => makeTransportLabel(transport)).join(", ");
    const commandText = [command.command, ...command.args].join(" ");
    const message = [
      "Local daemon did not start in time.",
      `checked=${labels}`,
      `spawn=${JSON.stringify(commandText)}`,
      `log=${config.logPath}`
    ].join(" ");

    throw new AppError("DAEMON_UNREACHABLE", message, 503, {
      checkedTransports: labels,
      spawn: commandText,
      logPath: config.logPath,
      spawnError: spawnError?.message
    });
  }

  return resolved;
}

export async function createHealthyDaemonClient(config: AgentConfig): Promise<DaemonClient> {
  const transport = await ensureDaemon(config);
  const client = createDaemonClient(transport);
  const health = await client.request<HealthResponse>("GET", "/health");
  if (!health.ok) {
    throw new AppError("DAEMON_UNREACHABLE", "Daemon health probe failed", 503);
  }

  return client;
}
