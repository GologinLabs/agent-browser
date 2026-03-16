import fs from "node:fs";
import path from "node:path";

import { AppError } from "../lib/errors";
import { generateSessionId, isRefTarget } from "../lib/utils";
import type {
  ActionResponse,
  AgentConfig,
  BrowserCookie,
  CheckResponse,
  ClickResponse,
  CloseSessionResponse,
  CloseAllSessionsResponse,
  CookiesClearResponse,
  CookiesImportResponse,
  CookiesResponse,
  DoubleClickResponse,
  EvalResponse,
  FillResponse,
  FindRequest,
  FindResponse,
  FocusResponse,
  GetKind,
  GetResponse,
  HoverResponse,
  OpenSessionRequest,
  OpenSessionResponse,
  PdfResponse,
  PressResponse,
  PruneSessionsResponse,
  ScrollDirection,
  ScrollIntoViewResponse,
  ScrollResponse,
  ScreenshotResponse,
  SelectResponse,
  SessionRecord,
  SessionSummary,
  SessionsResponse,
  SnapshotResponse,
  StorageClearResponse,
  StorageExportResponse,
  StorageImportResponse,
  StorageScope,
  StorageState,
  TabCloseResponse,
  TabFocusResponse,
  TabOpenResponse,
  TabsResponse,
  TypeResponse,
  UncheckResponse,
  UploadResponse,
  WaitLoadState,
  WaitResponse
} from "../lib/types";
import {
  actionMutatesSnapshot,
  annotatePageWithRefs,
  captureScreenshot,
  clearPageAnnotations,
  clearCookies,
  clearStorageState,
  closeSessionHandles,
  connectToBrowser,
  createManagedProfile,
  deleteProfile,
  evaluateExpression,
  exportStorageState,
  focusTab,
  getCloudProfileProxy,
  importCookies,
  importStorageState,
  listTabs,
  navigatePage,
  navigateHistory,
  openTab,
  performLocatorAction,
  pressKey,
  readLocatorValue,
  readCookies,
  resolveDescriptorLocator,
  resolveSelectorLocator,
  resolveSemanticLocator,
  savePdf,
  closeTab,
  scrollElement,
  scrollLocatorIntoView,
  scrollPage,
  uploadFiles,
  waitForPageLoad,
  waitForPageText,
  waitForPageUrl,
  waitForTarget
} from "./browser";
import { RefStore } from "./refStore";
import { buildSnapshot } from "./snapshot";

export class SessionManager {
  private static readonly DEFAULT_PRUNE_IDLE_MS = 10 * 60 * 1000;
  private static readonly CLOUD_SLOT_RELEASE_WAIT_MS = 3_000;
  private readonly sessions = new Map<string, SessionRecord>();
  private activeSessionId?: string;
  private readonly refStore = new RefStore();

  constructor(private readonly config: AgentConfig) {}

  private nowIso(): string {
    return new Date().toISOString();
  }

  private requireToken(): string {
    if (!this.config.token) {
      throw new AppError("TOKEN_MISSING", "GOLOGIN_TOKEN is required for open", 400);
    }

    return this.config.token;
  }

  private sessionExpired(session: SessionRecord): boolean {
    if (session.idleTimeoutMs === undefined) {
      return false;
    }

    const lastActivityAt = Date.parse(session.lastActivityAt);
    if (Number.isNaN(lastActivityAt)) {
      return false;
    }

    return Date.now() - lastActivityAt > session.idleTimeoutMs;
  }

  private sessionIdleMs(session: SessionRecord): number {
    const lastActivityAt = Date.parse(session.lastActivityAt);
    if (Number.isNaN(lastActivityAt)) {
      return 0;
    }

    return Math.max(0, Date.now() - lastActivityAt);
  }

  private isCloudSlotLimitError(error: unknown): error is AppError {
    return (
      error instanceof AppError &&
      error.code === "BROWSER_CONNECTION_FAILED" &&
      /max parallel cloud launches limit/i.test(error.message)
    );
  }

  private async pruneInactiveSessions(maxIdleMs = SessionManager.DEFAULT_PRUNE_IDLE_MS): Promise<string[]> {
    const closedSessionIds: string[] = [];

    for (const session of Array.from(this.sessions.values())) {
      if (this.sessionIdleMs(session) < maxIdleMs) {
        continue;
      }

      closedSessionIds.push(session.sessionId);
      await this.destroySession(session);
    }

    return closedSessionIds;
  }

  private async waitForCloudSlotRelease(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SessionManager.CLOUD_SLOT_RELEASE_WAIT_MS));
  }

  private async destroySession(session: SessionRecord): Promise<void> {
    await closeSessionHandles(session).catch(() => undefined);
    this.sessions.delete(session.sessionId);
    this.refStore.clear(session.sessionId);

    if (session.autoCreatedProfile && session.profileId && this.config.token) {
      await deleteProfile(this.config.token, session.profileId).catch(() => undefined);
    }

    if (this.activeSessionId === session.sessionId) {
      this.activeSessionId = Array.from(this.sessions.keys()).at(-1);
    }
  }

  private async getSessionOrThrow(sessionId?: string): Promise<SessionRecord> {
    const resolvedId = sessionId ?? this.activeSessionId;
    if (!resolvedId) {
      throw new AppError("SESSION_NOT_FOUND", "no active session", 404);
    }

    const session = this.sessions.get(resolvedId);
    if (!session) {
      throw new AppError("SESSION_NOT_FOUND", `session ${resolvedId} does not exist`, 404, { sessionId: resolvedId });
    }

    if (this.sessionExpired(session)) {
      const idleTimeoutMs = session.idleTimeoutMs;
      await this.destroySession(session);
      throw new AppError(
        "SESSION_EXPIRED",
        `session ${resolvedId} expired after ${idleTimeoutMs}ms of inactivity`,
        404,
        { sessionId: resolvedId, idleTimeoutMs }
      );
    }

    return session;
  }

  private async evictExpiredSessions(): Promise<void> {
    for (const session of Array.from(this.sessions.values())) {
      if (this.sessionExpired(session)) {
        await this.destroySession(session);
      }
    }
  }

  private toSummary(session: SessionRecord): SessionSummary {
    return {
      sessionId: session.sessionId,
      profileId: session.profileId,
      url: session.currentUrl,
      active: session.sessionId === this.activeSessionId,
      hasSnapshot: session.hasSnapshot,
      staleSnapshot: session.staleSnapshot,
      liveViewUrl: session.liveViewUrl,
      proxy: session.proxy,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      idleTimeoutMs: session.idleTimeoutMs,
      lastScreenshotPath: session.lastScreenshotPath,
      lastPdfPath: session.lastPdfPath
    };
  }

  private touchSession(session: SessionRecord): void {
    session.currentUrl = session.page.url();
    session.lastActivityAt = this.nowIso();
    this.activeSessionId = session.sessionId;
  }

  private markSessionState(session: SessionRecord, staleSnapshot = session.staleSnapshot): void {
    this.touchSession(session);
    session.staleSnapshot = staleSnapshot;
  }

  private resetSnapshotState(session: SessionRecord, staleSnapshot = false): void {
    session.hasSnapshot = false;
    session.staleSnapshot = staleSnapshot;
    this.refStore.clear(session.sessionId);
  }

  private activatePage(session: SessionRecord, page: SessionRecord["page"], staleSnapshot = false): void {
    session.page = page;
    this.resetSnapshotState(session, staleSnapshot);
    this.touchSession(session);
  }

  private validateIdleTimeout(idleTimeoutMs: number | undefined): void {
    if (idleTimeoutMs === undefined) {
      return;
    }

    if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
      throw new AppError("BAD_REQUEST", "--idle-timeout-ms must be a positive integer", 400);
    }
  }

  private async createSessionRecord(
    token: string,
    sessionId: string,
    profileId: string | undefined,
    request: OpenSessionRequest,
    createdAt: string,
    resolvedProxy: SessionRecord["proxy"],
    autoCreatedProfile: boolean
  ): Promise<SessionRecord> {
    const connection = await connectToBrowser(this.config, token, profileId);
    const currentUrl = await navigatePage(connection.page, request.url, this.config.navigationTimeoutMs);
    const lastActivityAt = this.nowIso();
    if (!resolvedProxy && profileId) {
      resolvedProxy = await getCloudProfileProxy(token, profileId).catch(() => undefined);
    }

    return {
      sessionId,
      profileId,
      autoCreatedProfile,
      connectUrl: connection.connectUrl,
      browser: connection.browser,
      context: connection.context,
      page: connection.page,
      currentUrl,
      hasSnapshot: false,
      staleSnapshot: false,
      proxy: resolvedProxy,
      createdAt,
      lastActivityAt,
      idleTimeoutMs: request.idleTimeoutMs
    };
  }

  private async resolveTargetLocator(session: SessionRecord, target: string) {
    if (isRefTarget(target)) {
      const descriptor = this.refStore.get(session.sessionId, target);
      if (!descriptor) {
        throw new AppError(
          "REF_NOT_FOUND",
          `ref ${target} is stale or unavailable in session ${session.sessionId}; run snapshot again`,
          404,
          {
            ref: target,
            sessionId: session.sessionId
          }
        );
      }

      return resolveDescriptorLocator(session.page, descriptor);
    }

    return resolveSelectorLocator(session.page, target, this.config.actionTimeoutMs);
  }

  private async runTargetAction(
    session: SessionRecord,
    target: string,
    action: "click" | "fill" | "type" | "hover" | "focus" | "dblclick" | "select" | "check" | "uncheck",
    value?: string
  ): Promise<ActionResponse> {
    const locator = await this.resolveTargetLocator(session, target);
    await performLocatorAction(session.page, locator, action, this.config.actionTimeoutMs, value);
    this.markSessionState(session, true);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true
    };
  }

  async open(request: OpenSessionRequest): Promise<OpenSessionResponse> {
    const token = this.requireToken();
    this.validateIdleTimeout(request.idleTimeoutMs);
    await this.pruneInactiveSessions();

    if (request.profileId && request.proxy) {
      throw new AppError("BAD_REQUEST", "proxy flags cannot be combined with --profile", 400);
    }

    if (request.sessionId && this.sessions.has(request.sessionId)) {
      const existing = await this.getSessionOrThrow(request.sessionId);
      if (request.profileId && existing.profileId && request.profileId !== existing.profileId) {
        throw new AppError("BAD_REQUEST", `session ${existing.sessionId} already uses profile ${existing.profileId}`, 400);
      }

      if (request.proxy) {
        throw new AppError("BAD_REQUEST", `session ${existing.sessionId} already exists; proxy cannot be changed`, 400);
      }

      if (request.idleTimeoutMs !== undefined) {
        existing.idleTimeoutMs = request.idleTimeoutMs;
      }

      existing.currentUrl = await navigatePage(existing.page, request.url, this.config.navigationTimeoutMs);
      this.resetSnapshotState(existing, true);
      this.touchSession(existing);

      return {
        sessionId: existing.sessionId,
        profileId: existing.profileId,
        url: existing.currentUrl,
        liveViewUrl: existing.liveViewUrl,
        proxy: existing.proxy,
        idleTimeoutMs: existing.idleTimeoutMs
      };
    }

    let profileId = request.profileId ?? this.config.defaultProfileId;
    let autoCreatedProfile = false;
    let resolvedProxy: SessionRecord["proxy"];
    const sessionId = request.sessionId ?? generateSessionId(this.sessions.keys());
    const createdAt = this.nowIso();

    if (!profileId) {
      const created = await createManagedProfile(token, sessionId, request.proxy);
      profileId = created.profileId;
      resolvedProxy = created.proxy;
      autoCreatedProfile = true;
    }

    try {
      let session: SessionRecord;
      try {
        session = await this.createSessionRecord(
          token,
          sessionId,
          profileId,
          request,
          createdAt,
          resolvedProxy,
          autoCreatedProfile
        );
      } catch (error) {
        if (!this.isCloudSlotLimitError(error)) {
          throw error;
        }

        if (this.sessions.size === 0) {
          throw new AppError(
            "BROWSER_CONNECTION_FAILED",
            `${error.message}. No tracked local sessions were available to close. Wait for cloud slots to free up or close stale sessions from another daemon, then retry.`,
            error.status,
            error.details
          );
        }

        const closedSessionIds = (await this.closeAll()).closedSessionIds;
        await this.waitForCloudSlotRelease();

        try {
          session = await this.createSessionRecord(
            token,
            sessionId,
            profileId,
            request,
            createdAt,
            resolvedProxy,
            autoCreatedProfile
          );
        } catch (retryError) {
          if (retryError instanceof AppError && retryError.code === "BROWSER_CONNECTION_FAILED") {
            throw new AppError(
              retryError.code,
              `${retryError.message}. Closed tracked sessions (${closedSessionIds.join(", ")}) and retried once, but the cloud slot was still unavailable.`,
              retryError.status,
              retryError.details
            );
          }

          throw retryError;
        }
      }

      this.sessions.set(sessionId, session);
      this.activeSessionId = sessionId;
      this.refStore.clear(sessionId);

      return {
        sessionId,
        profileId,
        url: session.currentUrl,
        proxy: session.proxy,
        idleTimeoutMs: session.idleTimeoutMs
      };
    } catch (error) {
      if (autoCreatedProfile && profileId) {
        await deleteProfile(token, profileId).catch(() => undefined);
      }

      throw error;
    }
  }

  async snapshot(sessionId?: string, interactive = false): Promise<SnapshotResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const snapshot = await buildSnapshot(session.page, { interactive });

    this.refStore.set(session.sessionId, snapshot.refs);
    session.currentUrl = session.page.url();
    session.hasSnapshot = true;
    session.staleSnapshot = false;
    session.lastActivityAt = this.nowIso();
    this.activeSessionId = session.sessionId;

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      items: snapshot.items
    };
  }

  async tabs(sessionId?: string): Promise<TabsResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    this.touchSession(session);

    return {
      sessionId: session.sessionId,
      tabs: await listTabs(session)
    };
  }

  async tabOpen(sessionId: string | undefined, url?: string): Promise<TabOpenResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const opened = await openTab(session, url, this.config.navigationTimeoutMs);
    this.activatePage(session, opened.page);

    return {
      sessionId: session.sessionId,
      tabIndex: opened.tabIndex,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot
    };
  }

  async tabFocus(sessionId: string | undefined, index: number): Promise<TabFocusResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const focused = await focusTab(session, index);
    this.activatePage(session, focused.page);

    return {
      sessionId: session.sessionId,
      tabIndex: focused.tabIndex,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot
    };
  }

  async tabClose(sessionId: string | undefined, index?: number): Promise<TabCloseResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const closed = await closeTab(session, index);
    this.activatePage(session, closed.page);

    return {
      sessionId: session.sessionId,
      closedTabIndex: closed.closedTabIndex,
      activeTabIndex: closed.activeTabIndex,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot
    };
  }

  async click(sessionId: string | undefined, target: string): Promise<ClickResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "click");
  }

  async type(sessionId: string | undefined, target: string, text: string): Promise<TypeResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "type", text);
  }

  async fill(sessionId: string | undefined, target: string, text: string): Promise<FillResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "fill", text);
  }

  async hover(sessionId: string | undefined, target: string): Promise<HoverResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "hover");
  }

  async focus(sessionId: string | undefined, target: string): Promise<FocusResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "focus");
  }

  async doubleClick(sessionId: string | undefined, target: string): Promise<DoubleClickResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "dblclick");
  }

  async select(sessionId: string | undefined, target: string, value: string): Promise<SelectResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "select", value);
  }

  async check(sessionId: string | undefined, target: string): Promise<CheckResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "check");
  }

  async uncheck(sessionId: string | undefined, target: string): Promise<UncheckResponse> {
    return this.runTargetAction(await this.getSessionOrThrow(sessionId), target, "uncheck");
  }

  async press(sessionId: string | undefined, key: string, target?: string): Promise<PressResponse> {
    const session = await this.getSessionOrThrow(sessionId);

    if (target) {
      const locator = await this.resolveTargetLocator(session, target);
      await locator.focus({ timeout: this.config.actionTimeoutMs });
    }

    await pressKey(session.page, key, this.config.actionTimeoutMs);
    this.markSessionState(session, true);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true
    };
  }

  async scroll(
    sessionId: string | undefined,
    direction: ScrollDirection,
    pixels = 500,
    target?: string
  ): Promise<ScrollResponse> {
    const session = await this.getSessionOrThrow(sessionId);

    if (target) {
      const locator = await this.resolveTargetLocator(session, target);
      await scrollElement(locator, direction, pixels);
    } else {
      await scrollPage(session.page, direction, pixels);
    }

    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      target,
      direction,
      pixels
    };
  }

  async scrollIntoView(sessionId: string | undefined, target: string): Promise<ScrollIntoViewResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const locator = await this.resolveTargetLocator(session, target);
    await scrollLocatorIntoView(locator, this.config.actionTimeoutMs);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot
    };
  }

  async upload(sessionId: string | undefined, target: string, files: string[]): Promise<UploadResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const locator = await this.resolveTargetLocator(session, target);
    try {
      await uploadFiles(locator, files, this.config.actionTimeoutMs);
    } catch (error) {
      throw new AppError("UPLOAD_FAILED", error instanceof Error ? error.message : String(error), 500, {
        files
      });
    }
    this.markSessionState(session, true);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true,
      files
    };
  }

  async wait(
    sessionId: string | undefined,
    request: {
      target?: string;
      text?: string;
      urlPattern?: string;
      loadState?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    }
  ): Promise<WaitResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const timeoutMs = request.timeoutMs ?? this.config.navigationTimeoutMs;

    if (request.timeoutMs && !request.target && !request.text && !request.urlPattern && !request.loadState) {
      await new Promise((resolve) => setTimeout(resolve, request.timeoutMs));
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        waitedFor: `${request.timeoutMs}ms`
      };
    }

    if (request.target) {
      const locator = await this.resolveTargetLocator(session, request.target);
      await waitForTarget(locator, timeoutMs);
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        waitedFor: request.target
      };
    }

    if (request.text) {
      await waitForPageText(session.page, request.text, timeoutMs);
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        waitedFor: `text:${request.text}`
      };
    }

    if (request.urlPattern) {
      await waitForPageUrl(session.page, request.urlPattern, timeoutMs);
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        waitedFor: `url:${request.urlPattern}`
      };
    }

    if (request.loadState) {
      await waitForPageLoad(session.page, request.loadState as WaitLoadState, timeoutMs);
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        waitedFor: `load:${request.loadState}`
      };
    }

    throw new AppError("BAD_REQUEST", "wait requires a target, timeout, --text, --url, or --load", 400);
  }

  async get(sessionId: string | undefined, kind: GetKind, target?: string): Promise<GetResponse> {
    const session = await this.getSessionOrThrow(sessionId);

    if (kind === "url") {
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        value: session.currentUrl
      };
    }

    if (kind === "title") {
      const value = await session.page.title();
      this.markSessionState(session);
      return {
        sessionId: session.sessionId,
        url: session.currentUrl,
        value
      };
    }

    const resolvedTarget = target ?? (kind === "text" || kind === "html" ? "body" : undefined);

    if (!resolvedTarget) {
      throw new AppError("BAD_REQUEST", `get ${kind} requires a target`, 400);
    }

    const locator = await this.resolveTargetLocator(session, resolvedTarget);
    const value = await readLocatorValue(locator, kind, this.config.actionTimeoutMs);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      value
    };
  }

  async back(sessionId?: string): Promise<ActionResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    session.currentUrl = await navigateHistory(session.page, "back", this.config.navigationTimeoutMs);
    this.resetSnapshotState(session, true);
    this.touchSession(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true
    };
  }

  async forward(sessionId?: string): Promise<ActionResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    session.currentUrl = await navigateHistory(session.page, "forward", this.config.navigationTimeoutMs);
    this.resetSnapshotState(session, true);
    this.touchSession(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true
    };
  }

  async reload(sessionId?: string): Promise<ActionResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    session.currentUrl = await navigateHistory(session.page, "reload", this.config.navigationTimeoutMs);
    this.resetSnapshotState(session, true);
    this.touchSession(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: true
    };
  }

  async cookies(sessionId?: string): Promise<CookiesResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const cookies = await readCookies(session);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      cookies
    };
  }

  async cookiesImport(sessionId: string | undefined, cookies: BrowserCookie[]): Promise<CookiesImportResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const imported = await importCookies(session, cookies);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      imported
    };
  }

  async cookiesClear(sessionId?: string): Promise<CookiesClearResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const cleared = await clearCookies(session);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      cleared
    };
  }

  async storageExport(sessionId: string | undefined, scope?: StorageScope): Promise<StorageExportResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const state = await exportStorageState(session.page, scope);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      state
    };
  }

  async storageImport(
    sessionId: string | undefined,
    state: StorageState,
    scope?: StorageScope,
    clear = false
  ): Promise<StorageImportResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const imported = await importStorageState(session.page, state, scope, clear);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      origin: imported.origin,
      localKeys: imported.localKeys,
      sessionKeys: imported.sessionKeys
    };
  }

  async storageClear(sessionId: string | undefined, scope?: StorageScope): Promise<StorageClearResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const cleared = await clearStorageState(session.page, scope);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      origin: cleared.origin,
      scope: cleared.scope
    };
  }

  async eval(sessionId: string | undefined, expression: string): Promise<EvalResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const value = await evaluateExpression(session.page, expression);
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      value
    };
  }

  async find(sessionId: string | undefined, request: FindRequest): Promise<FindResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const locator = await resolveSemanticLocator(session.page, request.locator, this.config.actionTimeoutMs);
    const value = await performLocatorAction(session.page, locator, request.action, this.config.actionTimeoutMs, request.value);
    const staleSnapshot = actionMutatesSnapshot(request.action);
    this.markSessionState(session, staleSnapshot ? true : session.staleSnapshot);

    return {
      sessionId: session.sessionId,
      url: session.currentUrl,
      staleSnapshot: session.staleSnapshot,
      value
    };
  }

  async screenshot(
    sessionId: string | undefined,
    targetPath: string,
    annotate = false,
    pressEscape = false
  ): Promise<ScreenshotResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    let pressedEscape = false;

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      if (pressEscape) {
        await pressKey(session.page, "Escape", this.config.actionTimeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 200));
        pressedEscape = true;
      }

      if (annotate) {
        const snapshot = await buildSnapshot(session.page, { interactive: true });
        this.refStore.set(session.sessionId, snapshot.refs);
        session.hasSnapshot = true;
        session.staleSnapshot = false;

        const labels: Array<{ ref: string; x: number; y: number }> = [];
        for (const descriptor of snapshot.refs) {
          const locator = await resolveDescriptorLocator(session.page, descriptor).catch(() => undefined);
          if (!locator) {
            continue;
          }

          const box = await locator.boundingBox().catch(() => null);
          if (!box) {
            continue;
          }

          labels.push({
            ref: descriptor.ref,
            x: box.x,
            y: box.y
          });
        }

        await annotatePageWithRefs(session.page, labels);
      }

      await captureScreenshot(session.page, targetPath, this.config.navigationTimeoutMs);

      if (annotate) {
        await clearPageAnnotations(session.page).catch(() => undefined);
      }
    } catch (error) {
      if (annotate) {
        await clearPageAnnotations(session.page).catch(() => undefined);
      }
      const baseMessage = error instanceof Error ? error.message : String(error);
      const hint = pressEscape
        ? "Screenshot timed out or failed even after pressing Escape"
        : "Screenshot timed out or failed; try pressing Escape first or re-run with --press-escape";
      throw new AppError("SCREENSHOT_FAILED", `${hint}: ${baseMessage}`, 500, {
        path: targetPath,
        pressEscape
      });
    }

    if (pressedEscape && !annotate && session.hasSnapshot) {
      session.staleSnapshot = true;
    }

    session.lastScreenshotPath = targetPath;
    this.touchSession(session);

    return {
      sessionId: session.sessionId,
      path: targetPath,
      url: session.currentUrl,
      annotated: annotate,
      pressedEscape
    };
  }

  async pdf(sessionId: string | undefined, targetPath: string): Promise<PdfResponse> {
    const session = await this.getSessionOrThrow(sessionId);

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      await savePdf(session.page, targetPath);
    } catch (error) {
      throw new AppError("PDF_FAILED", error instanceof Error ? error.message : String(error), 500, {
        path: targetPath
      });
    }

    session.lastPdfPath = targetPath;
    this.markSessionState(session);

    return {
      sessionId: session.sessionId,
      path: targetPath,
      url: session.currentUrl
    };
  }

  async close(sessionId?: string): Promise<CloseSessionResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    await this.destroySession(session);

    return {
      sessionId: session.sessionId,
      closed: true
    };
  }

  async listSessions(): Promise<SessionsResponse> {
    await this.evictExpiredSessions();

    return {
      activeSessionId: this.activeSessionId,
      sessions: Array.from(this.sessions.values()).map((session) => this.toSummary(session))
    };
  }

  async currentSession(): Promise<SessionSummary> {
    return this.toSummary(await this.getSessionOrThrow());
  }

  async pruneSessions(maxIdleMs = SessionManager.DEFAULT_PRUNE_IDLE_MS): Promise<PruneSessionsResponse> {
    const closedSessionIds = await this.pruneInactiveSessions(maxIdleMs);
    return {
      closed: closedSessionIds.length,
      closedSessionIds,
      maxIdleMs,
    };
  }

  async closeAll(): Promise<CloseAllSessionsResponse> {
    const closedSessionIds: string[] = [];
    for (const session of Array.from(this.sessions.values())) {
      closedSessionIds.push(session.sessionId);
      await this.destroySession(session);
    }

    this.sessions.clear();
    this.activeSessionId = undefined;
    return {
      closed: closedSessionIds.length,
      closedSessionIds,
    };
  }
}
