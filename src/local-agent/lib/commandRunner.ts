import { runCheckCommand } from "../commands/check";
import { runClickCommand } from "../commands/click";
import { runCloseCommand } from "../commands/close";
import { runCookiesCommand } from "../commands/cookies";
import { runCookiesClearCommand } from "../commands/cookiesClear";
import { runCookiesImportCommand } from "../commands/cookiesImport";
import { runCurrentCommand } from "../commands/current";
import { runDoctorCommand } from "../commands/doctor";
import { runDoubleClickCommand } from "../commands/dblclick";
import { runEvalCommand } from "../commands/eval";
import { runFillCommand } from "../commands/fill";
import { runFindCommand } from "../commands/find";
import { runFocusCommand } from "../commands/focus";
import { runGetCommand } from "../commands/get";
import { runHoverCommand } from "../commands/hover";
import { runJobCommand } from "../commands/job";
import { runJobsCommand } from "../commands/jobs";
import { runOpenCommand } from "../commands/open";
import { runProfileCommand } from "../commands/profile";
import { runProfileCreateCommand } from "../commands/profileCreate";
import { runProfileDeleteCommand } from "../commands/profileDelete";
import { runProfileImportCommand } from "../commands/profileImport";
import { runProfilesCommand } from "../commands/profiles";
import { runProfileSyncCommand } from "../commands/profileSync";
import { runProfileUpdateCommand } from "../commands/profileUpdate";
import { runPdfCommand } from "../commands/pdf";
import { runPressCommand } from "../commands/press";
import { runScreenshotCommand } from "../commands/screenshot";
import { runScrollCommand } from "../commands/scroll";
import { runScrollIntoViewCommand } from "../commands/scrollIntoView";
import { runSelectCommand } from "../commands/select";
import { runSessionsCommand } from "../commands/sessions";
import { runSnapshotCommand } from "../commands/snapshot";
import { runStorageClearCommand } from "../commands/storageClear";
import { runStorageExportCommand } from "../commands/storageExport";
import { runStorageImportCommand } from "../commands/storageImport";
import { runTabCloseCommand } from "../commands/tabClose";
import { runTabFocusCommand } from "../commands/tabFocus";
import { runTabOpenCommand } from "../commands/tabOpen";
import { runTabsCommand } from "../commands/tabs";
import { runTypeCommand } from "../commands/type";
import { runUncheckCommand } from "../commands/uncheck";
import { runUploadCommand } from "../commands/upload";
import { runWaitCommand } from "../commands/wait";
import type { CommandName } from "./commands";
import type { CommandContext } from "./types";

export type CommandHandler = (context: CommandContext, argv: string[]) => Promise<void>;

export type RunnableCommandName = Exclude<CommandName, "run" | "batch">;

const commandHandlers: Record<RunnableCommandName, CommandHandler> = {
  open: runOpenCommand,
  jobs: runJobsCommand,
  job: runJobCommand,
  doctor: runDoctorCommand,
  profiles: runProfilesCommand,
  profile: runProfileCommand,
  "profile-create": runProfileCreateCommand,
  "profile-import": runProfileImportCommand,
  "profile-update": runProfileUpdateCommand,
  "profile-delete": runProfileDeleteCommand,
  "profile-sync": runProfileSyncCommand,
  tabs: runTabsCommand,
  tabopen: runTabOpenCommand,
  tabfocus: runTabFocusCommand,
  tabclose: runTabCloseCommand,
  cookies: runCookiesCommand,
  "cookies-import": runCookiesImportCommand,
  "cookies-clear": runCookiesClearCommand,
  "storage-export": runStorageExportCommand,
  "storage-import": runStorageImportCommand,
  "storage-clear": runStorageClearCommand,
  eval: runEvalCommand,
  snapshot: runSnapshotCommand,
  click: runClickCommand,
  dblclick: runDoubleClickCommand,
  focus: runFocusCommand,
  type: runTypeCommand,
  fill: runFillCommand,
  hover: runHoverCommand,
  select: runSelectCommand,
  check: runCheckCommand,
  uncheck: runUncheckCommand,
  press: runPressCommand,
  scroll: runScrollCommand,
  scrollintoview: runScrollIntoViewCommand,
  wait: runWaitCommand,
  get: runGetCommand,
  find: runFindCommand,
  upload: runUploadCommand,
  pdf: runPdfCommand,
  screenshot: runScreenshotCommand,
  close: runCloseCommand,
  sessions: runSessionsCommand,
  current: runCurrentCommand
};

export async function runRegisteredCommand(
  command: RunnableCommandName,
  context: CommandContext,
  argv: string[]
): Promise<void> {
  await commandHandlers[command](context, argv);
}
