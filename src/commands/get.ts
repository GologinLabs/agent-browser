import { AppError } from "../lib/errors";
import type { CommandContext, GetKind, GetResponse } from "../lib/types";
import { getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

const GET_KINDS = new Set<GetKind>(["text", "value", "html", "title", "url"]);

export async function runGetCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const kind = parsed.positional[0] as GetKind | undefined;
  const target = parsed.positional[1];
  const sessionId = getFlagString(parsed, "session");

  if (!kind || !GET_KINDS.has(kind)) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-agent get <text|value|html|title|url> [target] [--session <sessionId>]", 400);
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<GetResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/get`,
    { kind, target }
  );

  context.stdout.write(`${response.value}\n`);
}
