import { createHealthyDaemonClient, inspectDaemon } from "../lib/daemon";
import type { CommandContext, DoctorResponse, ProfileProxyCheckResponse } from "../lib/types";
import { buildDoctorUseCaseReport, parseSupportedUseCase, supportedUseCaseChoices } from "../lib/useCases";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { writeJsonStdout } from "./shared";

export async function runDoctorCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const json = getFlagBoolean(parsed, "json");
  const checkProxy = getFlagString(parsed, "check-proxy");
  const useCase = parseSupportedUseCase(getFlagString(parsed, "use-case"), "--use-case");
  const report = await inspectDaemon(context.config);
  if (checkProxy) {
    const client = await createHealthyDaemonClient(context.config);
    const proxyCheck = await client.request<ProfileProxyCheckResponse>("GET", `/profiles/${checkProxy}/proxy-check`);
    report.proxyCheck = proxyCheck.check;
  }
  if (useCase) {
    report.useCaseReport = buildDoctorUseCaseReport({
      useCase,
      tokenConfigured: report.tokenConfigured,
      executablePathExists: report.executablePathExists,
      defaultProfileId: report.defaultProfileId,
      headless: context.config.headless,
      proxyCheck: report.proxyCheck
    });
  }

  if (json) {
    writeJsonStdout(context, report);
    return;
  }

  writeDoctorReport(context, report);
}

function writeDoctorReport(context: CommandContext, report: DoctorResponse): void {
  context.stdout.write(`ok=${report.ok}\n`);
  context.stdout.write(`tokenConfigured=${report.tokenConfigured}\n`);
  if (report.defaultProfileId) {
    context.stdout.write(`defaultProfileId=${report.defaultProfileId}\n`);
  }
  if (report.executablePath) {
    context.stdout.write(`executablePath=${report.executablePath}\n`);
  }
  context.stdout.write(`executablePathSource=${report.executablePathSource}\n`);
  context.stdout.write(`executablePathExists=${report.executablePathExists}\n`);
  if (report.executableCheckedPaths.length > 0) {
    context.stdout.write(`executableCheckedPaths=${JSON.stringify(report.executableCheckedPaths)}\n`);
  }
  if (report.executableHint) {
    context.stdout.write(`executableHint=${JSON.stringify(report.executableHint)}\n`);
  }
  if (report.tmpdir) {
    context.stdout.write(`tmpdir=${report.tmpdir}\n`);
  }
  context.stdout.write(`stateDir=${report.stateDir}\n`);
  context.stdout.write(`daemonLogPath=${report.daemonLogPath}\n`);
  if (report.currentProjectRoot) {
    context.stdout.write(`currentProjectRoot=${report.currentProjectRoot}\n`);
  }
  if (report.currentVersion) {
    context.stdout.write(`currentVersion=${report.currentVersion}\n`);
  }

  for (const transport of report.transports) {
    const parts = [`transport=${transport.label}`, `reachable=${transport.reachable}`];
    if (transport.pid !== undefined) {
      parts.push(`pid=${transport.pid}`);
    }
    if (transport.projectRoot) {
      parts.push(`projectRoot=${transport.projectRoot}`);
    }
    if (transport.version) {
      parts.push(`version=${transport.version}`);
    }
    if (transport.startedAt) {
      parts.push(`startedAt=${transport.startedAt}`);
    }
    if (transport.matchesCurrentBuild !== undefined) {
      parts.push(`matchesCurrentBuild=${transport.matchesCurrentBuild}`);
    }
    context.stdout.write(`${parts.join(" ")}\n`);
  }

  if (report.proxyCheck) {
    context.stdout.write(`proxyCheck.profileId=${report.proxyCheck.profileId}\n`);
    context.stdout.write(`proxyCheck.status=${report.proxyCheck.status}\n`);
    context.stdout.write(`proxyCheck.localRegistered=${report.proxyCheck.localRegistered}\n`);
    context.stdout.write(`proxyCheck.remoteAvailable=${report.proxyCheck.remoteAvailable}\n`);
    context.stdout.write(`proxyCheck.localProxy=${report.proxyCheck.localProxyLabel}\n`);
    context.stdout.write(`proxyCheck.remoteProxy=${report.proxyCheck.remoteProxyLabel}\n`);
    if (report.proxyCheck.warning) {
      context.stdout.write(`proxyCheck.warning=${JSON.stringify(report.proxyCheck.warning)}\n`);
    }
  }

  if (report.useCaseReport) {
    context.stdout.write(`useCase=${report.useCaseReport.useCase}\n`);
    context.stdout.write(`useCase.summary=${JSON.stringify(report.useCaseReport.summary)}\n`);
    context.stdout.write(`useCase.preferredRuntime=${report.useCaseReport.preferredRuntime}\n`);
    context.stdout.write(
      `useCase.recommendedProxyStrategy=${JSON.stringify(report.useCaseReport.recommendedProxyStrategy)}\n`
    );
    for (const check of report.useCaseReport.checks) {
      context.stdout.write(
        `useCase.check key=${check.key} status=${check.status} message=${JSON.stringify(check.message)}\n`
      );
    }
    for (const nextStep of report.useCaseReport.nextSteps) {
      context.stdout.write(`useCase.nextStep=${JSON.stringify(nextStep)}\n`);
    }
  }
}
