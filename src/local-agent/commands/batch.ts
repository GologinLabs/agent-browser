import path from "node:path";

import { AppError } from "../lib/errors";
import { createJob, finalizeJob } from "../lib/jobRegistry";
import {
  executeBatch,
  loadBatchDefinition,
  loadRunbookDefinition,
  loadVariablesFile,
  prefixMultiline
} from "../lib/runbooks";
import type { CommandContext } from "../lib/types";
import { ensureAbsolutePath, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

import { writeJsonStdout } from "./shared";

function parseConcurrency(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new AppError("BAD_REQUEST", "--concurrency must be a positive integer", 400);
  }

  return concurrency;
}

export async function runBatchCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const runbookPath = parsed.positional[0];
  const targetsPath = getFlagString(parsed, "targets");
  const varsPath = getFlagString(parsed, "vars");
  const name = getFlagString(parsed, "name");
  const json = getFlagBoolean(parsed, "json");
  const concurrency = parseConcurrency(getFlagString(parsed, "concurrency"));
  const continueOnError = getFlagBoolean(parsed, "continue-on-error");

  if (!runbookPath || !targetsPath) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser batch <runbook.json> --targets <targets.json> [--concurrency <n>] [--vars <variables.json>] [--name <jobName>] [--continue-on-error] [--json]",
      400
    );
  }

  const absoluteRunbookPath = ensureAbsolutePath(context.cwd, runbookPath);
  const absoluteTargetsPath = ensureAbsolutePath(context.cwd, targetsPath);
  const absoluteVarsPath = varsPath ? ensureAbsolutePath(context.cwd, varsPath) : undefined;
  const runbook = loadRunbookDefinition(context.cwd, runbookPath);
  const batch = loadBatchDefinition(context.cwd, targetsPath);
  const variables = varsPath ? loadVariablesFile(context.cwd, varsPath) : undefined;
  const job = createJob(context.config, {
    name: name ?? path.basename(absoluteRunbookPath, path.extname(absoluteRunbookPath)),
    kind: "batch",
    cwd: context.cwd,
    args: [...argv],
    runbookPath: absoluteRunbookPath,
    targetsPath: absoluteTargetsPath,
    varsPath: absoluteVarsPath,
    continueOnError,
    runbookDescription: runbook.description
  });

  try {
    const results = await executeBatch(context, runbook, batch, {
      concurrency,
      variables,
      continueOnError
    });
    const ordered = [...results].sort((left, right) => left.name.localeCompare(right.name));
    const outputLines: string[] = [];

    for (const result of ordered) {
      outputLines.push(
        `target=${result.name} session=${result.sessionId} status=${result.status} durationMs=${result.durationMs}`
      );
      if (result.output.trim().length > 0) {
        outputLines.push(prefixMultiline(result.output, "  "));
      }
      if (result.error) {
        outputLines.push(`  error=${result.error}`);
      }
    }

    const failed = ordered.filter((result) => result.status === "failed").length;
    const summary = `job=${job.jobId} batch targets=${ordered.length} failed=${failed} status=${failed > 0 ? "partial" : "ok"}`;
    outputLines.push(summary);
    const output = `${outputLines.join("\n")}\n`;

    if (!json) {
      context.stdout.write(output);
    }

    const record = finalizeJob(context.config, job.jobId, {
      status: failed > 0 ? "partial" : "ok",
      targetCount: ordered.length,
      failedTargets: failed,
      stepCount: ordered.reduce((total, target) => total + target.steps.length, 0),
      failedSteps: ordered.reduce(
        (total, target) => total + target.steps.filter((step) => step.status === "failed").length,
        0
      ),
      output,
      targets: ordered
    });

    if (json) {
      writeJsonStdout(context, { job: record });
    }
  } catch (error) {
    const record = finalizeJob(context.config, job.jobId, {
      status: "failed",
      output: `job=${job.jobId} batch status=failed\n`,
      error: error instanceof Error ? error.message : String(error)
    });

    if (json) {
      process.exitCode = 1;
      writeJsonStdout(context, { job: record });
      return;
    }

    throw error;
  }
}
