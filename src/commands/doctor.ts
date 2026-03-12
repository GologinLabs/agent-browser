import { inspectDaemon } from "../lib/daemon";
import type { CommandContext, DoctorResponse } from "../lib/types";
import { getFlagBoolean, parseArgs } from "../lib/utils";

function writeJson(context: CommandContext, payload: unknown): void {
  context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeDoctorReport(context: CommandContext, report: DoctorResponse): void {
  context.stdout.write(`ok=${report.ok}\n`);
  context.stdout.write(`tokenConfigured=${report.tokenConfigured}\n`);
  if (report.defaultProfileId) {
    context.stdout.write(`defaultProfileId=${report.defaultProfileId}\n`);
  }
  context.stdout.write(`connectBase=${report.connectBase}\n`);
  context.stdout.write(`configPath=${report.configPath}\n`);
  context.stdout.write(`daemonLogPath=${report.daemonLogPath}\n`);

  for (const transport of report.transports) {
    context.stdout.write(`transport=${transport.label} reachable=${transport.reachable}\n`);
  }
}

export async function runDoctorCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const json = getFlagBoolean(parsed, "json");
  const report = await inspectDaemon(context.config);

  if (json) {
    writeJson(context, report);
    return;
  }

  writeDoctorReport(context, report);
}
