import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

import type { RunnableCommandName } from "./commandRunner";
import { runRegisteredCommand } from "./commandRunner";
import { resolveCommand } from "./commands";
import { AppError } from "./errors";
import { isTerminalSessionErrorCode } from "./sessionSignals";
import type { CommandContext } from "./types";
import { ensureAbsolutePath } from "./utils";

export type RunbookPrimitive = string | number | boolean;

export type RunbookVariables = Record<string, RunbookPrimitive>;

export interface RunbookStepDefinition {
  command: string;
  args?: Array<RunbookPrimitive>;
  flags?: Record<string, RunbookPrimitive>;
  label?: string;
  continueOnError?: boolean;
  retry?: number;
  retryBackoffMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface RunbookDefinition {
  description?: string;
  variables?: RunbookVariables;
  continueOnError?: boolean;
  steps: RunbookStepDefinition[];
}

export interface BatchTargetDefinition {
  name?: string;
  sessionId?: string;
  profileId?: string;
  variables?: RunbookVariables;
  continueOnError?: boolean;
}

export interface BatchDefinition {
  concurrency?: number;
  variables?: RunbookVariables;
  targets: BatchTargetDefinition[];
}

export interface RunbookExecutionOptions {
  sessionId?: string;
  profileId?: string;
  variables?: RunbookVariables;
  continueOnError?: boolean;
  cycle?: number;
}

export interface RunbookStepResult {
  command: string;
  label?: string;
  cycle?: number;
  status: "ok" | "failed";
  durationMs: number;
  attempts: number;
  error?: string;
}

export interface RunbookExecutionResult {
  steps: RunbookStepResult[];
  aborted?: boolean;
  abortReason?: string;
}

export interface BatchTargetResult {
  name: string;
  sessionId: string;
  profileId?: string;
  status: "ok" | "failed";
  durationMs: number;
  output: string;
  error?: string;
  steps: RunbookStepResult[];
}

export class RunbookExecutionError extends AppError {
  readonly steps: RunbookStepResult[];
  readonly cause: unknown;

  constructor(error: unknown, steps: RunbookStepResult[]) {
    if (error instanceof AppError) {
      super(error.code, error.message, error.status, error.details);
    } else {
      super("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), 500);
    }

    this.name = "RunbookExecutionError";
    this.steps = [...steps];
    this.cause = error;
  }
}

const SESSION_SCOPED_COMMANDS = new Set<RunnableCommandName>([
  "open",
  "tabs",
  "tabopen",
  "tabfocus",
  "tabclose",
  "cookies",
  "cookies-import",
  "cookies-clear",
  "storage-export",
  "storage-import",
  "storage-clear",
  "eval",
  "snapshot",
  "click",
  "dblclick",
  "focus",
  "type",
  "fill",
  "hover",
  "select",
  "check",
  "uncheck",
  "press",
  "scroll",
  "scrollintoview",
  "wait",
  "get",
  "find",
  "upload",
  "pdf",
  "screenshot",
  "close"
]);

function isPrimitive(value: unknown): value is RunbookPrimitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function readJsonFile(absolutePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
  } catch (error) {
    throw new AppError(
      "BAD_REQUEST",
      `Failed to read JSON file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

function parseVariables(raw: unknown, fieldName: string): RunbookVariables | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("BAD_REQUEST", `${fieldName} must be an object of string/number/boolean values`, 400);
  }

  const variables: RunbookVariables = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPrimitive(value)) {
      throw new AppError("BAD_REQUEST", `${fieldName}.${key} must be a string, number, or boolean`, 400);
    }

    variables[key] = value;
  }

  return variables;
}

function parseRunbookStep(raw: unknown, index: number): RunbookStepDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("BAD_REQUEST", `steps[${index}] must be an object`, 400);
  }

  const value = raw as Record<string, unknown>;
  if (typeof value.command !== "string" || value.command.length === 0) {
    throw new AppError("BAD_REQUEST", `steps[${index}].command must be a non-empty string`, 400);
  }

  const args = value.args;
  if (args !== undefined && (!Array.isArray(args) || args.some((item) => !isPrimitive(item)))) {
    throw new AppError("BAD_REQUEST", `steps[${index}].args must be an array of string/number/boolean values`, 400);
  }

  const flags = value.flags;
  if (flags !== undefined && (!flags || typeof flags !== "object" || Array.isArray(flags))) {
    throw new AppError("BAD_REQUEST", `steps[${index}].flags must be an object`, 400);
  }

  const parsedFlags: Record<string, RunbookPrimitive> = {};
  if (flags) {
    for (const [key, flagValue] of Object.entries(flags as Record<string, unknown>)) {
      if (!isPrimitive(flagValue)) {
        throw new AppError("BAD_REQUEST", `steps[${index}].flags.${key} must be a string, number, or boolean`, 400);
      }

      parsedFlags[key] = flagValue;
    }
  }

  const retry = parseOptionalNonNegativeInteger(value.retry, `steps[${index}].retry`);
  const retryBackoffMs = parseOptionalNonNegativeInteger(value.retryBackoffMs, `steps[${index}].retryBackoffMs`);
  const minDelayMs = parseOptionalNonNegativeInteger(value.minDelayMs, `steps[${index}].minDelayMs`);
  const maxDelayMs = parseOptionalNonNegativeInteger(value.maxDelayMs, `steps[${index}].maxDelayMs`);

  if (minDelayMs !== undefined && maxDelayMs !== undefined && maxDelayMs < minDelayMs) {
    throw new AppError("BAD_REQUEST", `steps[${index}].maxDelayMs must be greater than or equal to minDelayMs`, 400);
  }

  return {
    command: value.command,
    args: (args as Array<RunbookPrimitive> | undefined) ?? [],
    flags: parsedFlags,
    label: typeof value.label === "string" ? value.label : undefined,
    continueOnError: value.continueOnError === true,
    retry,
    retryBackoffMs,
    minDelayMs,
    maxDelayMs
  };
}

function parseOptionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("BAD_REQUEST", `${fieldName} must be a non-negative integer`, 400);
  }

  return value;
}

export function loadRunbookDefinition(baseDir: string, filePath: string): RunbookDefinition {
  const absolutePath = ensureAbsolutePath(baseDir, filePath);
  const raw = readJsonFile(absolutePath);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("BAD_REQUEST", `Runbook ${absolutePath} must be a JSON object`, 400);
  }

  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new AppError("BAD_REQUEST", `Runbook ${absolutePath} must contain a non-empty steps array`, 400);
  }

  return {
    description: typeof value.description === "string" ? value.description : undefined,
    variables: parseVariables(value.variables, "variables"),
    continueOnError: value.continueOnError === true,
    steps: value.steps.map((step, index) => parseRunbookStep(step, index))
  };
}

export function loadBatchDefinition(baseDir: string, filePath: string): BatchDefinition {
  const absolutePath = ensureAbsolutePath(baseDir, filePath);
  const raw = readJsonFile(absolutePath);

  if (Array.isArray(raw)) {
    return {
      targets: raw.map((target, index) => parseBatchTarget(target, index))
    };
  }

  if (!raw || typeof raw !== "object") {
    throw new AppError("BAD_REQUEST", `Batch target file ${absolutePath} must be a JSON object or array`, 400);
  }

  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new AppError("BAD_REQUEST", `Batch target file ${absolutePath} must contain a non-empty targets array`, 400);
  }

  const concurrency = value.concurrency;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || Number(concurrency) <= 0)) {
    throw new AppError("BAD_REQUEST", `Batch target file ${absolutePath} has an invalid concurrency value`, 400);
  }

  return {
    concurrency: typeof concurrency === "number" ? concurrency : undefined,
    variables: parseVariables(value.variables, "variables"),
    targets: value.targets.map((target, index) => parseBatchTarget(target, index))
  };
}

function parseBatchTarget(raw: unknown, index: number): BatchTargetDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("BAD_REQUEST", `targets[${index}] must be an object`, 400);
  }

  const value = raw as Record<string, unknown>;
  if (value.name !== undefined && typeof value.name !== "string") {
    throw new AppError("BAD_REQUEST", `targets[${index}].name must be a string`, 400);
  }
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") {
    throw new AppError("BAD_REQUEST", `targets[${index}].sessionId must be a string`, 400);
  }
  if (value.profileId !== undefined && typeof value.profileId !== "string") {
    throw new AppError("BAD_REQUEST", `targets[${index}].profileId must be a string`, 400);
  }

  return {
    name: typeof value.name === "string" ? value.name : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    profileId: typeof value.profileId === "string" ? value.profileId : undefined,
    variables: parseVariables(value.variables, `targets[${index}].variables`),
    continueOnError: value.continueOnError === true
  };
}

function resolveTemplate(value: string, variables: RunbookVariables): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, rawName: string) => {
    const name = rawName.trim();
    const resolved = variables[name];
    if (resolved === undefined) {
      throw new AppError("BAD_REQUEST", `Missing runbook variable: ${name}`, 400);
    }

    return String(resolved);
  });
}

function resolvePrimitive(value: RunbookPrimitive, variables: RunbookVariables): RunbookPrimitive {
  if (typeof value !== "string") {
    return value;
  }

  return resolveTemplate(value, variables);
}

function flagPresent(argv: string[], flagName: string): boolean {
  return argv.includes(`--${flagName}`);
}

function serializeFlags(flags: Record<string, RunbookPrimitive>): string[] {
  const argv: string[] = [];

  for (const [name, value] of Object.entries(flags)) {
    if (typeof value === "boolean") {
      if (value) {
        argv.push(`--${name}`);
      }
      continue;
    }

    argv.push(`--${name}`, String(value));
  }

  return argv;
}

function toRunnableCommandName(command: string, argv: string[]): { command: RunnableCommandName; args: string[] } {
  const resolved = resolveCommand(command, argv);
  if (!resolved) {
    throw new AppError("BAD_REQUEST", `Unknown runbook command: ${command}`, 400);
  }
  if (resolved.command === "run" || resolved.command === "batch") {
    throw new AppError("BAD_REQUEST", `Runbook command ${command} is not allowed inside runbooks`, 400);
  }

  return {
    command: resolved.command,
    args: resolved.args
  };
}

export function buildStepInvocation(
  step: RunbookStepDefinition,
  variables: RunbookVariables,
  options?: Pick<RunbookExecutionOptions, "sessionId" | "profileId">
): { command: RunnableCommandName; argv: string[] } {
  const resolvedArgs = (step.args ?? []).map((arg) => String(resolvePrimitive(arg, variables)));
  const resolvedFlags: Record<string, RunbookPrimitive> = {};

  for (const [name, value] of Object.entries(step.flags ?? {})) {
    resolvedFlags[name] = resolvePrimitive(value, variables);
  }

  const normalized = toRunnableCommandName(step.command, resolvedArgs);
  const argv = [...normalized.args, ...serializeFlags(resolvedFlags)];

  if (options?.sessionId && SESSION_SCOPED_COMMANDS.has(normalized.command) && !flagPresent(argv, "session")) {
    argv.push("--session", options.sessionId);
  }

  if (
    options?.profileId &&
    normalized.command === "open" &&
    !flagPresent(argv, "profile")
  ) {
    argv.push("--profile", options.profileId);
  }

  return {
    command: normalized.command,
    argv
  };
}

function createBufferStream(onChunk: (chunk: string) => void): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      onChunk(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      callback();
    }
  });
}

function makeStepError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function pickDelay(minDelayMs: number, maxDelayMs: number): number {
  if (maxDelayMs <= minDelayMs) {
    return minDelayMs;
  }

  return minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
}

function computeRetryDelay(baseMs: number, retryIndex: number): number {
  if (baseMs <= 0) {
    return 0;
  }

  return baseMs * Math.max(1, 2 ** retryIndex);
}

async function applyStepDelay(step: RunbookStepDefinition): Promise<void> {
  const minDelayMs = step.minDelayMs ?? step.maxDelayMs ?? 0;
  const maxDelayMs = step.maxDelayMs ?? step.minDelayMs ?? minDelayMs;
  const delayMs = pickDelay(minDelayMs, maxDelayMs);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

export async function executeRunbook(
  context: CommandContext,
  runbook: RunbookDefinition,
  options: RunbookExecutionOptions = {}
): Promise<RunbookExecutionResult> {
  const variables = {
    ...(runbook.variables ?? {}),
    ...(options.variables ?? {})
  };
  const continueOnError = options.continueOnError ?? runbook.continueOnError ?? false;
  const steps: RunbookStepResult[] = [];

  for (const step of runbook.steps) {
    const startedAt = Date.now();
    const invocation = buildStepInvocation(step, variables, {
      sessionId: options.sessionId,
      profileId: options.profileId
    });
    const maxAttempts = (step.retry ?? 0) + 1;
    let attempts = 0;
    let lastError: unknown;

    try {
      await applyStepDelay(step);

      for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        attempts = attemptIndex + 1;

        try {
          await runRegisteredCommand(invocation.command, context, invocation.argv);
          steps.push({
            command: step.command,
            label: step.label,
            cycle: options.cycle,
            status: "ok",
            durationMs: Date.now() - startedAt,
            attempts
          });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attemptIndex < maxAttempts - 1) {
            const retryDelay = computeRetryDelay(step.retryBackoffMs ?? 0, attemptIndex);
            if (retryDelay > 0) {
              await sleep(retryDelay);
            }
            continue;
          }

          throw error;
        }
      }
    } catch (error) {
      const message = makeStepError(error);
      steps.push({
        command: step.command,
        label: step.label,
        cycle: options.cycle,
        status: "failed",
        durationMs: Date.now() - startedAt,
        attempts: Math.max(attempts, 1),
        error: message
      });

      if ((step.continueOnError || continueOnError) && error instanceof AppError && isTerminalSessionErrorCode(error.code)) {
        return {
          steps,
          aborted: true,
          abortReason: message
        };
      }

      if (!(step.continueOnError || continueOnError)) {
        throw new RunbookExecutionError(lastError ?? error, steps);
      }
    }
  }

  return { steps };
}

function sanitizeSessionId(name: string, index: number): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return normalized.length > 0 ? normalized : `batch-${index + 1}`;
}

export async function executeBatch(
  context: CommandContext,
  runbook: RunbookDefinition,
  batch: BatchDefinition,
  options?: {
    concurrency?: number;
    variables?: RunbookVariables;
    continueOnError?: boolean;
  }
): Promise<BatchTargetResult[]> {
  const concurrency = options?.concurrency ?? batch.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new AppError("BAD_REQUEST", "--concurrency must be a positive integer", 400);
  }

  const mergedBatchVariables = {
    ...(batch.variables ?? {}),
    ...(options?.variables ?? {})
  };

  const queue = batch.targets.map((target, index) => ({ target, index }));
  const results: BatchTargetResult[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }

      const { target, index } = next;
      const name = target.name ?? `target-${index + 1}`;
      const sessionId = target.sessionId ?? sanitizeSessionId(name, index);
      const profileId = target.profileId;
      const outputChunks: string[] = [];
      const stdout = createBufferStream((chunk) => outputChunks.push(chunk));
      const stderr = createBufferStream((chunk) => outputChunks.push(chunk));
      const scopedContext: CommandContext = {
        ...context,
        stdout,
        stderr
      };
      const variables = {
        ...mergedBatchVariables,
        ...(target.variables ?? {}),
        targetName: name,
        sessionId,
        ...(profileId ? { profileId } : {})
      };
      const startedAt = Date.now();

      try {
        const result = await executeRunbook(scopedContext, runbook, {
          sessionId,
          profileId,
          variables,
          continueOnError: target.continueOnError ?? options?.continueOnError
        });
        results.push({
          name,
          sessionId,
          profileId,
          status: result.steps.some((step) => step.status === "failed") ? "failed" : "ok",
          durationMs: Date.now() - startedAt,
          output: outputChunks.join(""),
          steps: result.steps
        });
      } catch (error) {
        const steps = error instanceof RunbookExecutionError ? error.steps : [];
        results.push({
          name,
          sessionId,
          profileId,
          status: "failed",
          durationMs: Date.now() - startedAt,
          output: outputChunks.join(""),
          error: makeStepError(error),
          steps
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker()));
  return results;
}

export function prefixMultiline(text: string, prefix: string): string {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function loadVariablesFile(baseDir: string, filePath: string): RunbookVariables {
  const absolutePath = ensureAbsolutePath(baseDir, filePath);
  const raw = readJsonFile(absolutePath);
  return parseVariables(raw, path.basename(absolutePath)) ?? {};
}
