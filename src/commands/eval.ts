import { AppError } from "../lib/errors";
import type { CommandContext, EvalResponse } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId, writeJsonStdout } from "./shared";

export async function runEvalCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const json = getFlagBoolean(parsed, "json");
  const expression = parsed.positional.join(" ").trim();

  if (!expression) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-agent-browser eval <expression> [--json] [--session <sessionId>]",
      400
    );
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<EvalResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/eval`,
    { expression }
  );

  if (json) {
    writeJsonStdout(context, response.value);
    return;
  }

  if (typeof response.value === "string") {
    context.stdout.write(`${response.value}\n`);
    return;
  }

  if (response.value === undefined) {
    context.stdout.write("undefined\n");
    return;
  }

  context.stdout.write(`${JSON.stringify(response.value)}\n`);
}
