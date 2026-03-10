import http from "node:http";
import fs from "node:fs";

import { loadConfig, ensureStateDir } from "../lib/config";
import { AppError, serializeError } from "../lib/errors";
import type {
  CheckRequest,
  ClickRequest,
  DoubleClickRequest,
  FillRequest,
  FindRequest,
  FocusRequest,
  GetRequest,
  HealthResponse,
  HoverRequest,
  OpenSessionRequest,
  PdfRequest,
  PressRequest,
  ScrollIntoViewRequest,
  ScrollRequest,
  SelectRequest,
  ScreenshotRequest,
  SnapshotResponse,
  TypeRequest,
  UncheckRequest,
  UploadRequest,
  WaitRequest
} from "../lib/types";
import { appendLog, readJsonBody, writeJsonResponse } from "../lib/utils";
import { SessionManager } from "./sessionManager";

const config = loadConfig();
ensureStateDir(config);

const sessionManager = new SessionManager(config);
const activeServers: http.Server[] = [];

function logInfo(message: string): void {
  appendLog(config.logPath, `[INFO] ${message}`);
}

function logError(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? ` ${error.stack ?? error.message}` : error ? ` ${String(error)}` : "";
  appendLog(config.logPath, `[ERROR] ${message}${suffix}`);
}

function matchSessionRoute(pathname: string, suffix: string): string | undefined {
  const match = pathname.match(new RegExp(`^/sessions/([^/]+)/${suffix}$`));
  return match?.[1];
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/health") {
      const payload: HealthResponse = {
        ok: true,
        pid: process.pid,
        transports: process.platform === "win32" ? ["http"] : ["socket", "http"]
      };
      writeJsonResponse(response, 200, payload);
      return;
    }

    if (method === "GET" && pathname === "/sessions") {
      writeJsonResponse(response, 200, await sessionManager.listSessions());
      return;
    }

    if (method === "GET" && pathname === "/sessions/current") {
      writeJsonResponse(response, 200, await sessionManager.currentSession());
      return;
    }

    if (method === "POST" && pathname === "/sessions/open") {
      const body = (await readJsonBody(request)) as OpenSessionRequest;
      writeJsonResponse(response, 200, await sessionManager.open(body));
      return;
    }

    const snapshotSessionId = matchSessionRoute(pathname, "snapshot");
    if (method === "POST" && snapshotSessionId) {
      const body = (await readJsonBody(request)) as { interactive?: boolean } | undefined;
      const payload: SnapshotResponse = await sessionManager.snapshot(snapshotSessionId, body?.interactive === true);
      writeJsonResponse(response, 200, payload);
      return;
    }

    const clickSessionId = matchSessionRoute(pathname, "click");
    if (method === "POST" && clickSessionId) {
      const body = (await readJsonBody(request)) as ClickRequest;
      writeJsonResponse(response, 200, await sessionManager.click(clickSessionId, body.target));
      return;
    }

    const typeSessionId = matchSessionRoute(pathname, "type");
    if (method === "POST" && typeSessionId) {
      const body = (await readJsonBody(request)) as TypeRequest;
      writeJsonResponse(response, 200, await sessionManager.type(typeSessionId, body.target, body.text));
      return;
    }

    const fillSessionId = matchSessionRoute(pathname, "fill");
    if (method === "POST" && fillSessionId) {
      const body = (await readJsonBody(request)) as FillRequest;
      writeJsonResponse(response, 200, await sessionManager.fill(fillSessionId, body.target, body.text));
      return;
    }

    const hoverSessionId = matchSessionRoute(pathname, "hover");
    if (method === "POST" && hoverSessionId) {
      const body = (await readJsonBody(request)) as HoverRequest;
      writeJsonResponse(response, 200, await sessionManager.hover(hoverSessionId, body.target));
      return;
    }

    const focusSessionId = matchSessionRoute(pathname, "focus");
    if (method === "POST" && focusSessionId) {
      const body = (await readJsonBody(request)) as FocusRequest;
      writeJsonResponse(response, 200, await sessionManager.focus(focusSessionId, body.target));
      return;
    }

    const doubleClickSessionId = matchSessionRoute(pathname, "dblclick");
    if (method === "POST" && doubleClickSessionId) {
      const body = (await readJsonBody(request)) as DoubleClickRequest;
      writeJsonResponse(response, 200, await sessionManager.doubleClick(doubleClickSessionId, body.target));
      return;
    }

    const selectSessionId = matchSessionRoute(pathname, "select");
    if (method === "POST" && selectSessionId) {
      const body = (await readJsonBody(request)) as SelectRequest;
      writeJsonResponse(response, 200, await sessionManager.select(selectSessionId, body.target, body.value));
      return;
    }

    const checkSessionId = matchSessionRoute(pathname, "check");
    if (method === "POST" && checkSessionId) {
      const body = (await readJsonBody(request)) as CheckRequest;
      writeJsonResponse(response, 200, await sessionManager.check(checkSessionId, body.target));
      return;
    }

    const uncheckSessionId = matchSessionRoute(pathname, "uncheck");
    if (method === "POST" && uncheckSessionId) {
      const body = (await readJsonBody(request)) as UncheckRequest;
      writeJsonResponse(response, 200, await sessionManager.uncheck(uncheckSessionId, body.target));
      return;
    }

    const pressSessionId = matchSessionRoute(pathname, "press");
    if (method === "POST" && pressSessionId) {
      const body = (await readJsonBody(request)) as PressRequest;
      writeJsonResponse(response, 200, await sessionManager.press(pressSessionId, body.key, body.target));
      return;
    }

    const waitSessionId = matchSessionRoute(pathname, "wait");
    if (method === "POST" && waitSessionId) {
      const body = (await readJsonBody(request)) as WaitRequest;
      writeJsonResponse(response, 200, await sessionManager.wait(waitSessionId, body));
      return;
    }

    const scrollSessionId = matchSessionRoute(pathname, "scroll");
    if (method === "POST" && scrollSessionId) {
      const body = (await readJsonBody(request)) as ScrollRequest;
      writeJsonResponse(response, 200, await sessionManager.scroll(scrollSessionId, body.direction, body.pixels, body.target));
      return;
    }

    const scrollIntoViewSessionId = matchSessionRoute(pathname, "scrollintoview");
    if (method === "POST" && scrollIntoViewSessionId) {
      const body = (await readJsonBody(request)) as ScrollIntoViewRequest;
      writeJsonResponse(response, 200, await sessionManager.scrollIntoView(scrollIntoViewSessionId, body.target));
      return;
    }

    const getSessionId = matchSessionRoute(pathname, "get");
    if (method === "POST" && getSessionId) {
      const body = (await readJsonBody(request)) as GetRequest;
      writeJsonResponse(response, 200, await sessionManager.get(getSessionId, body.kind, body.target));
      return;
    }

    const findSessionId = matchSessionRoute(pathname, "find");
    if (method === "POST" && findSessionId) {
      const body = (await readJsonBody(request)) as FindRequest;
      writeJsonResponse(response, 200, await sessionManager.find(findSessionId, body));
      return;
    }

    const screenshotSessionId = matchSessionRoute(pathname, "screenshot");
    if (method === "POST" && screenshotSessionId) {
      const body = (await readJsonBody(request)) as ScreenshotRequest;
      writeJsonResponse(response, 200, await sessionManager.screenshot(screenshotSessionId, body.path, body.annotate === true));
      return;
    }

    const uploadSessionId = matchSessionRoute(pathname, "upload");
    if (method === "POST" && uploadSessionId) {
      const body = (await readJsonBody(request)) as UploadRequest;
      writeJsonResponse(response, 200, await sessionManager.upload(uploadSessionId, body.target, body.files));
      return;
    }

    const pdfSessionId = matchSessionRoute(pathname, "pdf");
    if (method === "POST" && pdfSessionId) {
      const body = (await readJsonBody(request)) as PdfRequest;
      writeJsonResponse(response, 200, await sessionManager.pdf(pdfSessionId, body.path));
      return;
    }

    const closeSessionId = matchSessionRoute(pathname, "close");
    if (method === "POST" && closeSessionId) {
      writeJsonResponse(response, 200, await sessionManager.close(closeSessionId));
      return;
    }

    throw new AppError("BAD_REQUEST", `Unsupported route ${method} ${pathname}`, 404);
  } catch (error) {
    const payload = serializeError(error);
    logError(`Request failed for ${request.method} ${request.url}`, error);
    writeJsonResponse(response, payload.status, payload);
  }
}

function createServer(): http.Server {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      const payload = serializeError(error);
      logError("Unhandled request failure", error);
      writeJsonResponse(response, payload.status, payload);
    });
  });
}

async function startServers(): Promise<void> {
  if (process.platform !== "win32" && fs.existsSync(config.socketPath)) {
    fs.unlinkSync(config.socketPath);
  }

  if (process.platform !== "win32") {
    const socketServer = createServer();
    activeServers.push(socketServer);
    await new Promise<void>((resolve, reject) => {
      socketServer.once("error", reject);
      socketServer.listen(config.socketPath, () => resolve());
    });
    logInfo(`Socket server listening at ${config.socketPath}`);
  }

  const httpServer = createServer();
  activeServers.push(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.daemonPort, config.daemonHost, () => resolve());
  });
  logInfo(`HTTP server listening at http://${config.daemonHost}:${config.daemonPort}`);
}

async function shutdown(signal: string): Promise<void> {
  logInfo(`Received ${signal}, shutting down`);
  await sessionManager.closeAll();
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );

  if (process.platform !== "win32" && fs.existsSync(config.socketPath)) {
    fs.unlinkSync(config.socketPath);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT").finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").finally(() => process.exit(0));
});

startServers()
  .then(() => {
    logInfo("GoLogin Agent daemon started");
  })
  .catch((error) => {
    logError("Failed to start daemon", error);
    process.exit(1);
  });
