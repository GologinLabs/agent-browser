import { AppError } from "../lib/errors";
import { listJobs, type JobKind, type JobStatus } from "../lib/jobRegistry";
import type { CommandContext } from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

import { writeJobs } from "./jobShared";

function parseKind(value: string | undefined): JobKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "run" || value === "batch") {
    return value;
  }

  throw new AppError("BAD_REQUEST", "--kind must be run or batch", 400);
}

function parseStatus(value: string | undefined): JobStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "running" || value === "ok" || value === "partial" || value === "failed") {
    return value;
  }

  throw new AppError("BAD_REQUEST", "--status must be running, ok, partial, or failed", 400);
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new AppError("BAD_REQUEST", "--limit must be a positive integer", 400);
  }

  return limit;
}

export async function runJobsCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const json = getFlagBoolean(parsed, "json");
  const jobs = listJobs(context.config, {
    kind: parseKind(getFlagString(parsed, "kind")),
    status: parseStatus(getFlagString(parsed, "status")),
    search: getFlagString(parsed, "search"),
    limit: parseLimit(getFlagString(parsed, "limit"))
  });

  writeJobs(context, jobs, json);
}
