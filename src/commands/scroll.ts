import { AppError } from "../lib/errors";
import type { CommandContext, ScrollDirection, ScrollResponse } from "../lib/types";
import { getFlagString, isNumericToken, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

const SCROLL_DIRECTIONS = new Set<ScrollDirection>(["up", "down", "left", "right"]);

export async function runScrollCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const direction = parsed.positional[0] as ScrollDirection | undefined;
  const maybePixels = parsed.positional[1];
  const target = getFlagString(parsed, "target");
  const sessionId = getFlagString(parsed, "session");

  if (!direction || !SCROLL_DIRECTIONS.has(direction)) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser scroll <up|down|left|right> [pixels] [--target <target>] [--session <sessionId>]", 400);
  }

  if (maybePixels && !isNumericToken(maybePixels)) {
    throw new AppError("BAD_REQUEST", "scroll pixels must be a number", 400);
  }

  const pixels = maybePixels ? Number(maybePixels) : undefined;
  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<ScrollResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/scroll`,
    { direction, pixels, target }
  );

  const targetSuffix = response.target ? ` target=${response.target}` : "";
  context.stdout.write(
    `scrolled direction=${response.direction} pixels=${response.pixels}${targetSuffix} session=${response.sessionId} url=${response.url}\n`
  );
}
