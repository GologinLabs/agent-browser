import type { CommandContext, SessionSummary } from "../lib/types";
import { formatCurrentLine, parseArgs } from "../lib/utils";

export async function runCurrentCommand(context: CommandContext, argv: string[]): Promise<void> {
  parseArgs(argv);
  const response = await context.client.request<SessionSummary>("GET", "/sessions/current");
  context.stdout.write(`${formatCurrentLine(response)}\n`);
}
