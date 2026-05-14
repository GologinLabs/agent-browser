import path from "node:path";

import { AppError } from "../lib/errors";
import { createJob, finalizeJob } from "../lib/jobRegistry";
import { runRegisteredCommand } from "../lib/commandRunner";
import {
  executeRunbook,
  loadRunbookDefinition,
  loadVariablesFile,
  type RunbookStepResult,
  type RunbookExecutionError
} from "../lib/runbooks";
import type { CommandContext } from "../lib/types";
import { ensureAbsolutePath, getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";

import { createBufferedStream, writeJsonStdout } from "./shared";

function parsePositiveIntegerFlag(value: string | undefined, flagName: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("BAD_REQUEST", `${flagName} must be a positive integer`, 400);
  }

  return parsed;
}

function parseNonNegativeIntegerFlag(value: string | undefined, flagName: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError("BAD_REQUEST", `${flagName} must be a non-negative integer`, 400);
  }

  return parsed;
}

function pickPauseDelay(minPauseMs: number, maxPauseMs: number): number {
  if (maxPauseMs <= minPauseMs) {
    return minPauseMs;
  }

  return minPauseMs + Math.floor(Math.random() * (maxPauseMs - minPauseMs + 1));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildImplicitSessionId(runbookPath: string): string {
  const stem = path
    .basename(runbookPath, path.extname(runbookPath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);

  const suffix = Math.random().toString(36).slice(2, 8);
  return `run-${stem || "session"}-${suffix}`;
}

async function safeCloseSession(context: CommandContext, sessionId: string): Promise<void> {
  try {
    await runRegisteredCommand("close", context, ["--session", sessionId]);
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "SESSION_NOT_FOUND" || error.code === "SESSION_EXPIRED" || error.code === "SESSION_LOST")
    ) {
      return;
    }

    throw error;
  }
}

function shouldStartAnotherCycle(
  startedAtMs: number,
  attemptedCycles: number,
  repeat: number | undefined,
  durationMs: number | undefined
): boolean {
  if (repeat !== undefined && attemptedCycles >= repeat) {
    return false;
  }

  if (attemptedCycles === 0) {
    return true;
  }

  if (durationMs !== undefined && Date.now() - startedAtMs >= durationMs) {
    return false;
  }

  return true;
}

export async function runRunCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const runbookPath = parsed.positional[0];
  const explicitSessionId = getFlagString(parsed, "session");
  const profileId = getFlagString(parsed, "profile");
  const varsPath = getFlagString(parsed, "vars");
  const name = getFlagString(parsed, "name");
  const json = getFlagBoolean(parsed, "json");
  const continueOnErrorRequested = Object.prototype.hasOwnProperty.call(parsed.flags, "continue-on-error");
  const continueOnError = continueOnErrorRequested ? getFlagBoolean(parsed, "continue-on-error") : false;
  const repeat = parsePositiveIntegerFlag(getFlagString(parsed, "repeat"), "--repeat");
  const durationMs = parsePositiveIntegerFlag(getFlagString(parsed, "duration-ms"), "--duration-ms");
  const pauseMinMs = parseNonNegativeIntegerFlag(getFlagString(parsed, "pause-min-ms"), "--pause-min-ms") ?? 0;
  const pauseMaxMs =
    parseNonNegativeIntegerFlag(getFlagString(parsed, "pause-max-ms"), "--pause-max-ms") ?? pauseMinMs;

  if (!runbookPath) {
    throw new AppError(
      "BAD_REQUEST",
      "Usage: gologin-local-agent-browser run <runbook.json> [--session <sessionId>] [--profile <profileId>] [--vars <variables.json>] [--name <jobName>] [--continue-on-error] [--json]",
      400
    );
  }

  if (pauseMaxMs < pauseMinMs) {
    throw new AppError("BAD_REQUEST", "--pause-max-ms must be greater than or equal to --pause-min-ms", 400);
  }

  const absoluteRunbookPath = ensureAbsolutePath(context.cwd, runbookPath);
  const sessionId = explicitSessionId ?? buildImplicitSessionId(absoluteRunbookPath);
  const continueOnErrorDefault = continueOnErrorRequested ? continueOnError : repeat !== undefined || durationMs !== undefined;
  const absoluteVarsPath = varsPath ? ensureAbsolutePath(context.cwd, varsPath) : undefined;
  const runbook = loadRunbookDefinition(context.cwd, runbookPath);
  const variables = varsPath ? loadVariablesFile(context.cwd, varsPath) : undefined;
  const job = createJob(context.config, {
    name: name ?? path.basename(absoluteRunbookPath, path.extname(absoluteRunbookPath)),
    kind: "run",
    cwd: context.cwd,
    args: [...argv],
    runbookPath: absoluteRunbookPath,
    varsPath: absoluteVarsPath,
    sessionId,
    profileId,
    continueOnError: continueOnErrorDefault,
    runbookDescription: runbook.description
  });
  const outputChunks: string[] = [];
  const scopedContext: CommandContext = {
    ...context,
    stdout: createBufferedStream((chunk) => outputChunks.push(chunk), json ? undefined : context.stdout),
    stderr: createBufferedStream((chunk) => outputChunks.push(chunk), json ? undefined : context.stderr)
  };
  const startedAtMs = Date.now();
  const allSteps: RunbookStepResult[] = [];
  let attemptedCycles = 0;
  let failedCycles = 0;

  try {
    while (shouldStartAnotherCycle(startedAtMs, attemptedCycles, repeat, durationMs)) {
      attemptedCycles += 1;
      const cycleVariables = {
        ...(variables ?? {}),
        cycleNumber: attemptedCycles,
        cycleIndex: attemptedCycles - 1
      };
      const result = await executeRunbook(scopedContext, runbook, {
        sessionId,
        profileId,
        variables: cycleVariables,
        continueOnError: continueOnErrorDefault,
        cycle: attemptedCycles
      });
      allSteps.push(...result.steps);
      if (result.steps.some((step) => step.status === "failed")) {
        failedCycles += 1;
      }

      if (result.aborted && !explicitSessionId) {
        await safeCloseSession(scopedContext, sessionId).catch(() => undefined);
      }

      if (shouldStartAnotherCycle(startedAtMs, attemptedCycles, repeat, durationMs)) {
        const pauseDelay = pickPauseDelay(pauseMinMs, pauseMaxMs);
        if (pauseDelay > 0) {
          await sleep(pauseDelay);
        }
      }
    }

    const failed = allSteps.filter((step) => step.status === "failed").length;
    const status = failed > 0 ? "partial" : "ok";
    const summary =
      `job=${job.jobId} runbook=${runbookPath} cycles=${attemptedCycles} failedCycles=${failedCycles} ` +
      `steps=${allSteps.length} failed=${failed} status=${status}\n`;
    outputChunks.push(summary);
    if (!json) {
      context.stdout.write(summary);
    }

    const record = finalizeJob(context.config, job.jobId, {
      status,
      cycleCount: attemptedCycles,
      failedCycles,
      stepCount: allSteps.length,
      failedSteps: failed,
      output: outputChunks.join(""),
      steps: allSteps
    });

    if (json) {
      writeJsonStdout(context, { job: record });
    }
  } catch (error) {
    const partialSteps = error instanceof Error && "steps" in error ? (error as RunbookExecutionError).steps : [];
    failedCycles += attemptedCycles > 0 ? 1 : 0;
    allSteps.push(...partialSteps);
    if (!explicitSessionId) {
      await safeCloseSession(scopedContext, sessionId).catch(() => undefined);
    }
    const summary =
      `job=${job.jobId} runbook=${runbookPath} cycles=${attemptedCycles} failedCycles=${failedCycles} ` +
      `steps=${allSteps.length} failed=${allSteps.filter((step) => step.status === "failed").length} status=failed\n`;
    outputChunks.push(summary);
    const record = finalizeJob(context.config, job.jobId, {
      status: "failed",
      cycleCount: attemptedCycles,
      failedCycles,
      stepCount: allSteps.length,
      failedSteps: allSteps.filter((step) => step.status === "failed").length,
      output: outputChunks.join(""),
      error: error instanceof Error ? error.message : String(error),
      steps: allSteps
    });

    if (json) {
      process.exitCode = 1;
      writeJsonStdout(context, { job: record });
      return;
    }

    throw error;
  }
}
