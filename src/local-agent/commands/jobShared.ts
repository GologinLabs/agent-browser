import type { CommandContext } from "../lib/types";
import type { JobRecord } from "../lib/jobRegistry";

import { writeJsonStdout } from "./shared";

function formatBaseJobLine(job: JobRecord): string {
  const name = job.name ? ` name=${JSON.stringify(job.name)}` : "";
  const session = job.sessionId ? ` session=${job.sessionId}` : "";
  const profile = job.profileId ? ` profile=${job.profileId}` : "";
  const duration = job.durationMs !== undefined ? ` durationMs=${job.durationMs}` : "";
  const steps = job.stepCount !== undefined ? ` steps=${job.stepCount}` : "";
  const failedSteps = job.failedSteps !== undefined ? ` failedSteps=${job.failedSteps}` : "";
  const targets = job.targetCount !== undefined ? ` targets=${job.targetCount}` : "";
  const failedTargets = job.failedTargets !== undefined ? ` failedTargets=${job.failedTargets}` : "";
  return `- job=${job.jobId} kind=${job.kind} status=${job.status}${name}${session}${profile}${duration}${steps}${failedSteps}${targets}${failedTargets} started=${job.startedAt}`;
}

export function writeJobs(context: CommandContext, jobs: JobRecord[], json = false): void {
  if (json) {
    writeJsonStdout(context, {
      total: jobs.length,
      jobs
    });
    return;
  }

  if (jobs.length === 0) {
    context.stdout.write("no jobs\n");
    return;
  }

  for (const job of jobs) {
    context.stdout.write(`${formatBaseJobLine(job)}\n`);
  }
}

export function writeJob(context: CommandContext, job: JobRecord, json = false): void {
  if (json) {
    writeJsonStdout(context, { job });
    return;
  }

  context.stdout.write(
    `job=${job.jobId} kind=${job.kind} status=${job.status} name=${JSON.stringify(job.name)} started=${job.startedAt}\n`
  );
  context.stdout.write(`runbook=${job.runbookPath}\n`);
  if (job.targetsPath) {
    context.stdout.write(`targets=${job.targetsPath}\n`);
  }
  if (job.varsPath) {
    context.stdout.write(`vars=${job.varsPath}\n`);
  }
  if (job.sessionId) {
    context.stdout.write(`session=${job.sessionId}\n`);
  }
  if (job.profileId) {
    context.stdout.write(`profile=${job.profileId}\n`);
  }
  if (job.finishedAt) {
    context.stdout.write(`finished=${job.finishedAt}\n`);
  }
  if (job.durationMs !== undefined) {
    context.stdout.write(`durationMs=${job.durationMs}\n`);
  }
  if (job.stepCount !== undefined) {
    context.stdout.write(`steps=${job.stepCount} failedSteps=${job.failedSteps ?? 0}\n`);
  }
  if (job.targetCount !== undefined) {
    context.stdout.write(`targets=${job.targetCount} failedTargets=${job.failedTargets ?? 0}\n`);
  }
  context.stdout.write(`output=${job.outputPath}\n`);
  if (job.error) {
    context.stdout.write(`error=${job.error}\n`);
  }
  if (job.steps && job.steps.length > 0) {
    for (const step of job.steps) {
      const label = step.label ? ` label=${JSON.stringify(step.label)}` : "";
      const error = step.error ? ` error=${JSON.stringify(step.error)}` : "";
      context.stdout.write(
        `  step command=${step.command} status=${step.status} durationMs=${step.durationMs}${label}${error}\n`
      );
    }
  }
  if (job.targets && job.targets.length > 0) {
    for (const target of job.targets) {
      const profile = target.profileId ? ` profile=${target.profileId}` : "";
      const error = target.error ? ` error=${JSON.stringify(target.error)}` : "";
      context.stdout.write(
        `  target name=${JSON.stringify(target.name)} session=${target.sessionId}${profile} status=${target.status} durationMs=${target.durationMs}${error}\n`
      );
    }
  }
}
