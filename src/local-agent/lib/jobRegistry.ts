import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AgentConfig } from "./types";
import { AppError } from "./errors";
import type { BatchTargetResult, RunbookStepResult } from "./runbooks";

export type JobKind = "run" | "batch";
export type JobStatus = "running" | "ok" | "partial" | "failed";

export interface JobRecord {
  jobId: string;
  name: string;
  kind: JobKind;
  status: JobStatus;
  cwd: string;
  args: string[];
  runbookPath: string;
  targetsPath?: string;
  varsPath?: string;
  sessionId?: string;
  profileId?: string;
  continueOnError: boolean;
  runbookDescription?: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  cycleCount?: number;
  failedCycles?: number;
  stepCount?: number;
  failedSteps?: number;
  targetCount?: number;
  failedTargets?: number;
  outputPath: string;
  error?: string;
  steps?: RunbookStepResult[];
  targets?: BatchTargetResult[];
}

export type JobFilters = {
  kind?: JobKind;
  status?: JobStatus;
  search?: string;
  limit?: number;
};

type JobStartInput = {
  name: string;
  kind: JobKind;
  cwd: string;
  args: string[];
  runbookPath: string;
  targetsPath?: string;
  varsPath?: string;
  sessionId?: string;
  profileId?: string;
  continueOnError: boolean;
  runbookDescription?: string;
};

type JobCompletionInput = {
  status: Exclude<JobStatus, "running">;
  durationMs?: number;
  cycleCount?: number;
  failedCycles?: number;
  stepCount?: number;
  failedSteps?: number;
  targetCount?: number;
  failedTargets?: number;
  output?: string;
  error?: string;
  steps?: RunbookStepResult[];
  targets?: BatchTargetResult[];
};

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function jobRecordPath(config: AgentConfig, jobId: string): string {
  return path.join(config.jobsDir, `${jobId}.json`);
}

function jobOutputPath(config: AgentConfig, jobId: string): string {
  return path.join(config.jobsDir, `${jobId}.log`);
}

function ensureJobsDir(config: AgentConfig): void {
  fs.mkdirSync(config.jobsDir, { recursive: true });
}

function writeJobRecord(config: AgentConfig, record: JobRecord): void {
  ensureJobsDir(config);
  fs.writeFileSync(jobRecordPath(config, record.jobId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function readJobRecordFromPath(recordPath: string): JobRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(recordPath, "utf8")) as JobRecord;
  } catch {
    return undefined;
  }
}

function sortJobs(records: JobRecord[]): JobRecord[] {
  return [...records].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function createJob(config: AgentConfig, input: JobStartInput): JobRecord {
  ensureJobsDir(config);
  const timestamp = new Date().toISOString();
  const jobId = `job-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;

  const record: JobRecord = {
    jobId,
    name: normalizeText(input.name) ?? input.kind,
    kind: input.kind,
    status: "running",
    cwd: input.cwd,
    args: [...input.args],
    runbookPath: input.runbookPath,
    targetsPath: input.targetsPath,
    varsPath: input.varsPath,
    sessionId: normalizeText(input.sessionId),
    profileId: normalizeText(input.profileId),
    continueOnError: input.continueOnError,
    runbookDescription: normalizeText(input.runbookDescription),
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    outputPath: jobOutputPath(config, jobId)
  };

  writeJobRecord(config, record);
  return record;
}

export function finalizeJob(config: AgentConfig, jobId: string, input: JobCompletionInput): JobRecord {
  const current = getJob(config, jobId);
  if (!current) {
    throw new AppError("INTERNAL_ERROR", `Job ${jobId} is missing from the local store`, 500);
  }

  const finishedAt = new Date().toISOString();
  if (input.output !== undefined) {
    ensureJobsDir(config);
    fs.writeFileSync(current.outputPath, input.output, "utf8");
  }

  const next: JobRecord = {
    ...current,
    status: input.status,
    updatedAt: finishedAt,
    finishedAt,
    durationMs:
      input.durationMs ??
      Math.max(0, new Date(finishedAt).getTime() - new Date(current.startedAt).getTime()),
    cycleCount: input.cycleCount,
    failedCycles: input.failedCycles,
    stepCount: input.stepCount,
    failedSteps: input.failedSteps,
    targetCount: input.targetCount,
    failedTargets: input.failedTargets,
    error: normalizeText(input.error),
    steps: input.steps ? [...input.steps] : current.steps,
    targets: input.targets ? [...input.targets] : current.targets
  };

  writeJobRecord(config, next);
  return next;
}

export function getJob(config: AgentConfig, jobId: string): JobRecord | undefined {
  const record = readJobRecordFromPath(jobRecordPath(config, jobId));
  return record?.jobId === jobId ? record : undefined;
}

export function listJobs(config: AgentConfig, filters: JobFilters = {}): JobRecord[] {
  if (!fs.existsSync(config.jobsDir)) {
    return [];
  }

  const search = normalizeText(filters.search)?.toLowerCase();
  const kind = normalizeText(filters.kind)?.toLowerCase() as JobKind | undefined;
  const status = normalizeText(filters.status)?.toLowerCase() as JobStatus | undefined;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : undefined;

  const records = fs
    .readdirSync(config.jobsDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJobRecordFromPath(path.join(config.jobsDir, entry)))
    .filter((entry): entry is JobRecord => Boolean(entry));

  const filtered = sortJobs(records).filter((record) => {
    if (kind && record.kind !== kind) {
      return false;
    }
    if (status && record.status !== status) {
      return false;
    }
    if (search) {
      const haystack = [
        record.jobId,
        record.name,
        record.kind,
        record.status,
        record.runbookPath,
        record.targetsPath,
        record.varsPath,
        record.sessionId,
        record.profileId,
        record.error
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  });

  return limit ? filtered.slice(0, limit) : filtered;
}
