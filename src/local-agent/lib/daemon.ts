import http from "node:http";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config";
import { AppError, fromDaemonError } from "./errors";
import { resolveOrbitaExecutable } from "./runtime";
import type {
  AgentConfig,
  DaemonClient,
  DoctorResponse,
  HealthResponse,
  ResolvedTransport
} from "./types";
import { isDaemonErrorResponse, makeTransportLabel } from "./utils";

function projectRootFromCli(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

function readPackageVersion(projectRoot: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function buildDaemonSpawnCommand(projectRoot: string): { command: string; args: string[] } {
  const distServerPath = path.join(projectRoot, "dist", "local-agent", "daemon", "server.js");
  if (fs.existsSync(distServerPath)) {
    return {
      command: process.execPath,
      args: [distServerPath]
    };
  }

  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const srcServerPath = path.join(projectRoot, "src", "local-agent", "daemon", "server.ts");

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

async function readHealth(transport: ResolvedTransport): Promise<HealthResponse | undefined> {
  try {
    return (await requestOverHttp(transport, "GET", "/health")) as HealthResponse;
  } catch {
    return undefined;
  }
}

export function daemonMatchesExpected(
  health: HealthResponse,
  expectedProjectRoot: string,
  expectedVersion?: string,
  processCommand?: string
): boolean {
  if (health.projectRoot) {
    if (health.projectRoot !== expectedProjectRoot) {
      return false;
    }

    return !expectedVersion || !health.version || health.version === expectedVersion;
  }

  if (!processCommand) {
    return false;
  }

  return processCommand.includes(expectedProjectRoot);
}

export function isLikelyManagedDaemon(processCommand?: string): boolean {
  if (!processCommand) {
    return false;
  }

  return (
    processCommand.includes("gologin-local-agent-browser") ||
    (processCommand.includes("gologin-agent-browser") && processCommand.includes("local-agent/daemon/server")) ||
    processCommand.includes("local-agent/daemon/server")
  );
}

async function readProcessCommand(pid: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }

      const value = stdout.trim();
      resolve(value.length > 0 ? value : undefined);
    });
  });
}

async function waitForTransportToStop(transport: ResolvedTransport, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await probeTransport(transport))) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

async function terminateDaemon(health: HealthResponse, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  try {
    process.kill(health.pid, signal);
  } catch {
    return;
  }
}

export async function inspectDaemon(config: AgentConfig): Promise<DoctorResponse> {
  const currentProjectRoot = projectRootFromCli();
  const currentVersion = readPackageVersion(currentProjectRoot);
  const executable = resolveOrbitaExecutable({
    envPath: process.env.GOLOGIN_EXECUTABLE_PATH,
    configPath: config.executablePathSource === "config" ? config.executablePath : undefined,
  });
  const transports = await Promise.all(
    buildDaemonTransports(config).map(async (transport) => {
      const health = await readHealth(transport);
      let processCommand: string | undefined;
      if (health?.pid) {
        processCommand = await readProcessCommand(health.pid);
      }

      return {
        label: makeTransportLabel(transport),
        reachable: Boolean(health),
        pid: health?.pid,
        projectRoot: health?.projectRoot,
        version: health?.version,
        startedAt: health?.startedAt,
        matchesCurrentBuild: health
          ? daemonMatchesExpected(health, currentProjectRoot, currentVersion, processCommand)
          : false
      };
    })
  );

  const ok = transports.some((transport) => transport.reachable);

  return {
    ok,
    tokenConfigured: Boolean(config.token),
    defaultProfileId: config.defaultProfileId,
    executablePath: config.executablePath,
    executablePathSource: config.executablePathSource,
    executablePathExists: config.executablePathExists,
    executableCheckedPaths: executable.checkedPaths,
    executableHint: buildExecutableHint(config),
    tmpdir: config.tmpdir,
    daemonLogPath: config.logPath,
    stateDir: config.stateDir,
    currentProjectRoot,
    currentVersion,
    transports
  };
}

function buildExecutableHint(config: AgentConfig): string | undefined {
  if (config.executablePath && config.executablePathExists) {
    return undefined;
  }

  if (config.executablePath && !config.executablePathExists) {
    return `Configured Orbita path does not exist: ${config.executablePath}`;
  }

  return "No Orbita executable was detected in env/config or the downloaded SDK cache. The GoLogin SDK may download Orbita on first launch, but if startup keeps failing set GOLOGIN_EXECUTABLE_PATH explicitly.";
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
  const currentProjectRoot = projectRootFromCli();
  const currentVersion = readPackageVersion(currentProjectRoot);

  for (const transport of transports) {
    const health = await readHealth(transport);
    if (!health) {
      continue;
    }

    const processCommand = await readProcessCommand(health.pid);
    if (daemonMatchesExpected(health, currentProjectRoot, currentVersion, processCommand)) {
      return transport;
    }

    if (isLikelyManagedDaemon(processCommand)) {
      await terminateDaemon(health, "SIGTERM");
      let stopped = await waitForTransportToStop(transport, 4_000);
      if (!stopped) {
        await terminateDaemon(health, "SIGKILL");
        stopped = await waitForTransportToStop(transport, 2_000);
      }
      if (!stopped) {
        throw new AppError("DAEMON_UNREACHABLE", `Conflicting daemon pid=${health.pid} did not stop in time`, 503, {
          pid: health.pid,
          transport: makeTransportLabel(transport),
          processCommand
        });
      }
    }
  }

  const command = buildDaemonSpawnCommand(currentProjectRoot);
  let spawnError: Error | undefined;
  const child = spawn(command.command, command.args, {
    cwd: currentProjectRoot,
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
