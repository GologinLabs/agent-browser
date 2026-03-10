import { AppError } from "../lib/errors";
import type { CommandContext, WaitResponse } from "../lib/types";
import { getFlagString, isNumericToken, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

export async function runWaitCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const first = parsed.positional[0];
  const sessionId = getFlagString(parsed, "session");
  const text = getFlagString(parsed, "text");
  const urlPattern = getFlagString(parsed, "url");
  const loadState = getFlagString(parsed, "load");

  const body: {
    target?: string;
    text?: string;
    urlPattern?: string;
    loadState?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  } = {};

  if (first) {
    if (isNumericToken(first)) {
      body.timeoutMs = Number(first);
    } else {
      body.target = first;
    }
  }

  if (text) {
    body.text = text;
  }
  if (urlPattern) {
    body.urlPattern = urlPattern;
  }
  if (loadState === "load" || loadState === "domcontentloaded" || loadState === "networkidle") {
    body.loadState = loadState;
  } else if (loadState) {
    throw new AppError("BAD_REQUEST", "wait --load must be load, domcontentloaded, or networkidle", 400);
  }

  if (!body.target && !body.text && !body.urlPattern && !body.loadState && body.timeoutMs === undefined) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser wait <target|ms> [--text <text>] [--url <pattern>] [--load <state>] [--session <sessionId>]",
      400
    );
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<WaitResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/wait`,
    body
  );

  context.stdout.write(`waited session=${response.sessionId} url=${response.url} for=${response.waitedFor}\n`);
}
