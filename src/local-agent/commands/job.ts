import { AppError } from "../lib/errors";
import { getJob } from "../lib/jobRegistry";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";

import { writeJob } from "./jobShared";

export async function runJobCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const jobId = parsed.positional[0];
  const json = getFlagBoolean(parsed, "json");

  if (!jobId) {
    throw new AppError("BAD_REQUEST", "Usage: gologin-local-agent-browser job <jobId> [--json]", 400);
  }

  const job = getJob(context.config, jobId);
  if (!job) {
    throw new AppError("BAD_REQUEST", `Job ${jobId} was not found`, 404);
  }

  writeJob(context, job, json);
}
