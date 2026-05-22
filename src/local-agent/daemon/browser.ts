import { execFile as execFileCallback } from "node:child_process";
import { chromium, type Locator, type Page } from "playwright";
import { promisify } from "node:util";

import { AppError } from "../lib/errors";
import { detectLocalOsInfo } from "../lib/runtime";
import type {
  ActionResponse,
  AgentConfig,
  BrowserCookie,
  CookiesResponse,
  EvalResponse,
  GetKind,
  ProxyConfig,
  ProxySummary,
  RefDescriptor,
  ScrollDirection,
  SemanticFindAction,
  SemanticLocatorQuery,
  SessionRecord,
  StorageScope,
  StorageState,
  TabSummary,
  WaitLoadState
} from "../lib/types";

const execFile = promisify(execFileCallback);

function asAriaRole(role?: string): string | undefined {
  return role && role !== "paragraph" ? role : undefined;
}

type GoLoginInstance = {
  create(options: Record<string, unknown>): Promise<string>;
  quickCreateProfile(name?: string): Promise<unknown>;
  setProfileId(profileId: string): Promise<void>;
  start(): Promise<{ wsUrl?: string }>;
  stopLocal(options?: { posting?: boolean }): Promise<void>;
  delete(profileId?: string): Promise<void>;
  update(options: Record<string, unknown>): Promise<unknown>;
  changeProfileProxy(proxyData: Record<string, unknown>): Promise<unknown>;
  getProfile(profileId?: string): Promise<unknown>;
  profiles(): Promise<unknown>;
};

type GoLoginApiInstance = {
  addGologinProxyToProfile(profileId: string, countryCode: string, proxyType?: string): Promise<unknown>;
  createProfileRandomFingerprint(name?: string): Promise<unknown>;
  createProfileWithCustomParams?(options: Record<string, unknown>): Promise<unknown>;
  updateUserAgentToLatestBrowser?(profileIds: string[], workspaceId?: string): Promise<unknown>;
};

type GoLoginModule = {
  default: new (options: Record<string, unknown>) => GoLoginInstance;
  GologinApi?: (params: { token: string }) => GoLoginApiInstance;
};

let gologinModulePromise: Promise<GoLoginModule> | undefined;

function buildProfileName(sessionId: string): string {
  return `gologin-local-agent-browser-${sessionId}`;
}

async function loadGoLoginModule(): Promise<GoLoginModule> {
  gologinModulePromise ??= (import("gologin") as unknown as Promise<GoLoginModule>);
  return gologinModulePromise;
}

async function readMacSysctlOutput(): Promise<string | undefined> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    return undefined;
  }

  try {
    const { stdout } = await execFile("sysctl", ["machdep.cpu"]);
    return stdout;
  } catch {
    return undefined;
  }
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export interface RemoteProfileInfo {
  profileId: string;
  name: string;
  notes?: string;
  proxy?: ProxySummary;
  os?: string;
  userAgent?: string;
}

export function normalizeProxySummary(proxy: unknown, fallback?: ProxyConfig): ProxySummary | undefined {
  if (!proxy || typeof proxy !== "object") {
    return fallback
      ? {
          mode: fallback.mode,
          country: fallback.country,
          host: fallback.host,
          port: fallback.port,
          username: fallback.username
        }
      : undefined;
  }

  const value = proxy as Record<string, unknown>;
  const mode = trimToUndefined(value.mode) ?? fallback?.mode;
  if (!mode) {
    return undefined;
  }

  const host = trimToUndefined(value.host) ?? fallback?.host;
  const country = trimToUndefined(value.autoProxyRegion) ?? trimToUndefined(value.country) ?? fallback?.country;
  const username = trimToUndefined(value.username) ?? fallback?.username;
  const port =
    typeof value.port === "number"
      ? value.port
      : typeof fallback?.port === "number"
        ? fallback.port
        : undefined;

  return {
    mode,
    country,
    host,
    port,
    username
  };
}

async function pickContextAndPage(browser: SessionRecord["browser"]): Promise<{
  context: SessionRecord["context"];
  page: Page;
}> {
  const existingContext = browser.contexts()[0] ?? (await browser.newContext());
  const page = existingContext.pages()[0] ?? (await existingContext.newPage());

  return { context: existingContext, page };
}

async function ensureLocatorReady(
  locator: Locator,
  description: string,
  timeoutMs: number,
  options: { visible?: boolean } = {}
): Promise<Locator> {
  const count = await locator.count();
  if (count === 0) {
    throw new AppError("BAD_REQUEST", `${description} did not match any element`, 404);
  }

  const resolved = locator.first();
  await resolved.waitFor({ state: options.visible === false ? "attached" : "visible", timeout: timeoutMs });
  return resolved;
}

export function buildHeadlessExtraParams(headless: boolean): string[] {
  return headless ? ["--headless=new"] : [];
}

export function extractProfileId(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.length > 0) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = payload as Record<string, unknown>;
  if (typeof value.id === "string" && value.id.length > 0) {
    return value.id;
  }
  if (typeof value._id === "string" && value._id.length > 0) {
    return value._id;
  }

  return undefined;
}

async function createGoLoginClient(
  config: AgentConfig,
  token: string,
  profileId?: string,
  headless = config.headless
): Promise<GoLoginInstance> {
  const { default: GoLogin } = await loadGoLoginModule();

  return new GoLogin({
    token,
    profile_id: profileId,
    executablePath: config.executablePath,
    tmpdir: config.tmpdir,
    extra_params: buildHeadlessExtraParams(headless)
  });
}

async function createQuickProfile(config: AgentConfig, token: string, sessionId: string): Promise<string> {
  const gologin = await createGoLoginClient(config, token);
  const created = await gologin.quickCreateProfile(buildProfileName(sessionId));
  const profileId = extractProfileId(created);

  if (!profileId) {
    throw new AppError("BROWSER_CONNECTION_FAILED", "Gologin profile creation returned no profile id", 502);
  }

  return profileId;
}

export async function applyProfileProxy(
  config: AgentConfig,
  token: string,
  profileId: string,
  proxy?: ProxyConfig
): Promise<ProxySummary | undefined> {
  if (!proxy) {
    return undefined;
  }

  if (proxy.mode === "gologin") {
    const { GologinApi } = await loadGoLoginModule();
    if (!GologinApi) {
      throw new AppError("BROWSER_CONNECTION_FAILED", "Installed gologin package does not expose GologinApi", 500);
    }

    await GologinApi({ token }).addGologinProxyToProfile(profileId, proxy.country ?? "us");
    return normalizeProxySummary(undefined, proxy);
  }

  const gologin = await createGoLoginClient(config, token, profileId);
  await gologin.changeProfileProxy({
    mode: proxy.mode,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password
  });

  return normalizeProxySummary(undefined, proxy);
}

export async function createManagedProfile(
  config: AgentConfig,
  token: string,
  sessionId: string,
  proxy?: ProxyConfig
): Promise<{ profileId: string; proxy?: ProxySummary }> {
  const profileId = await createQuickProfile(config, token, sessionId);
  try {
    const proxySummary = await applyProfileProxy(config, token, profileId, proxy);

    return {
      profileId,
      proxy: proxySummary
    };
  } catch (error) {
    await deleteProfile(token, profileId).catch(() => undefined);
    throw error;
  }
}

export async function deleteProfile(token: string, profileId: string): Promise<void> {
  const { default: GoLogin } = await loadGoLoginModule();
  const gologin = new GoLogin({ token, profile_id: profileId });
  await gologin.delete(profileId);
}

export async function getProfileProxy(config: AgentConfig, token: string, profileId: string): Promise<ProxySummary | undefined> {
  try {
    const gologin = await createGoLoginClient(config, token, profileId);
    const profile = await gologin.getProfile(profileId);
    if (!profile || typeof profile !== "object") {
      return undefined;
    }

    const value = profile as Record<string, unknown>;
    return normalizeProxySummary(value.proxy);
  } catch {
    return undefined;
  }
}

export function mapRemoteProfile(profile: unknown, fallbackProfileId?: string): RemoteProfileInfo | undefined {
  if (typeof profile === "string") {
    try {
      return mapRemoteProfile(JSON.parse(profile), fallbackProfileId);
    } catch {
      return undefined;
    }
  }

  if (!profile || typeof profile !== "object") {
    return undefined;
  }

  const value = profile as Record<string, unknown>;
  const profileId = trimToUndefined(value.id) ?? trimToUndefined(value._id) ?? fallbackProfileId;
  const name = trimToUndefined(value.name) ?? fallbackProfileId;
  if (!profileId || !name) {
    return undefined;
  }

  const notes = trimToUndefined(value.notes);
  const os = trimToUndefined(value.os);
  const navigatorValue = value.navigator as Record<string, unknown> | undefined;
  const userAgent = navigatorValue ? trimToUndefined(navigatorValue.userAgent) : undefined;

  return {
    profileId,
    name,
    notes,
    proxy: normalizeProxySummary(value.proxy),
    os,
    userAgent
  };
}

function extractRemoteProfileList(payload: unknown): unknown[] {
  if (typeof payload === "string") {
    try {
      return extractRemoteProfileList(JSON.parse(payload));
    } catch {
      return [];
    }
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const value = payload as Record<string, unknown>;
  const directKeys = ["profiles", "browsers", "items", "results", "data"];
  for (const key of directKeys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (value.data && typeof value.data === "object") {
    return extractRemoteProfileList(value.data);
  }

  return [];
}

export function mapRemoteProfiles(payload: unknown): RemoteProfileInfo[] {
  const profiles = new Map<string, RemoteProfileInfo>();

  for (const item of extractRemoteProfileList(payload)) {
    const mapped = mapRemoteProfile(item);
    if (mapped) {
      profiles.set(mapped.profileId, mapped);
    }
  }

  return [...profiles.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function createRemoteProfile(
  config: AgentConfig,
  token: string,
  options: { name: string; notes?: string }
): Promise<string> {
  const { GologinApi } = await loadGoLoginModule();
  let profileId: string | undefined;

  if (GologinApi) {
    const api = GologinApi({ token });
    const osInfo = detectLocalOsInfo({
      sysctlOutput: await readMacSysctlOutput(),
    });

    try {
      if (api.createProfileWithCustomParams) {
        const created = await api.createProfileWithCustomParams({
          name: options.name,
          notes: options.notes,
          os: osInfo.os,
          ...(osInfo.osSpec ? { osSpec: osInfo.osSpec } : {}),
        });
        profileId = extractProfileId(created);
      }
    } catch {
      profileId = undefined;
    }

    if (!profileId) {
      const created = await api.createProfileRandomFingerprint(options.name);
      profileId = extractProfileId(created);
    }

    if (profileId && api.updateUserAgentToLatestBrowser) {
      await api.updateUserAgentToLatestBrowser([profileId]).catch(() => undefined);
    }
  } else {
    const gologin = await createGoLoginClient(config, token);
    const created = await gologin.quickCreateProfile(options.name);
    profileId = extractProfileId(created);
  }

  if (!profileId) {
    throw new AppError("BROWSER_CONNECTION_FAILED", "GoLogin profile creation returned no profile id", 502);
  }

  if (options.notes && options.notes.trim().length > 0) {
    await updateRemoteProfile(config, token, profileId, {
      notes: options.notes
    });
  }

  return profileId;
}

export async function getRemoteProfileInfo(
  config: AgentConfig,
  token: string,
  profileId: string
): Promise<RemoteProfileInfo> {
  const gologin = await createGoLoginClient(config, token, profileId);
  const profile = await gologin.getProfile(profileId);
  const mapped = mapRemoteProfile(profile, profileId);
  if (!mapped) {
    throw new AppError("BAD_REQUEST", `Profile ${profileId} could not be read from GoLogin`, 404, {
      profileId
    });
  }

  return mapped;
}

export async function listRemoteProfiles(config: AgentConfig, token: string): Promise<RemoteProfileInfo[]> {
  const gologin = await createGoLoginClient(config, token);
  return mapRemoteProfiles(await gologin.profiles());
}

export async function updateRemoteProfile(
  config: AgentConfig,
  token: string,
  profileId: string,
  updates: { name?: string; notes?: string }
): Promise<RemoteProfileInfo> {
  const gologin = await createGoLoginClient(config, token, profileId);
  await gologin.update({
    id: profileId,
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.notes !== undefined ? { notes: updates.notes } : {})
  });

  return getRemoteProfileInfo(config, token, profileId);
}

export async function connectToBrowser(
  config: AgentConfig,
  token: string,
  profileId?: string,
  headless?: boolean
): Promise<Pick<SessionRecord, "browser" | "context" | "page" | "connectUrl" | "gologin">> {
  if (!profileId) {
    throw new AppError("BROWSER_CONNECTION_FAILED", "profile id is required for local GoLogin sessions", 500);
  }

  if (config.executablePath && !config.executablePathExists) {
    throw new AppError(
      "BROWSER_CONNECTION_FAILED",
      `Configured Orbita executable was not found at ${config.executablePath}. Set GOLOGIN_EXECUTABLE_PATH to a valid Orbita binary or remove it so the SDK can use the downloaded default runtime.`,
      502,
      {
        profileId,
        executablePath: config.executablePath,
        executablePathSource: config.executablePathSource,
      }
    );
  }

  const gologin = await createGoLoginClient(config, token, profileId, headless);

  try {
    await gologin.setProfileId(profileId);
    const started = await gologin.start();
    const connectUrl = trimToUndefined(started.wsUrl);
    if (!connectUrl) {
      throw new AppError("BROWSER_CONNECTION_FAILED", "Local GoLogin did not return a websocket endpoint", 502, {
        profileId
      });
    }

    const browser = await connectOverCdpWithRetry(connectUrl, 12_000);
    const { context, page } = await pickContextAndPage(browser);
    return {
      browser,
      context,
      page,
      connectUrl,
      gologin: {
        stop: async (posting = true) => gologin.stopLocal({ posting }),
        deleteProfile: async (targetProfileId?: string) => gologin.delete(targetProfileId)
      }
    };
  } catch (error) {
    await gologin.stopLocal({ posting: true }).catch(() => undefined);
    throw new AppError(
      "BROWSER_CONNECTION_FAILED",
      buildBrowserLaunchErrorMessage(error, config.executablePath),
      502,
      {
        profileId,
        executablePath: config.executablePath,
        executablePathSource: config.executablePathSource,
      }
    );
  }
}

function isRetriableBrowserConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|WebSocket error|connect ECONNREFUSED|socket hang up/i.test(message);
}

async function connectOverCdpWithRetry(connectUrl: string, timeoutMs: number) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await chromium.connectOverCDP(connectUrl);
    } catch (error) {
      lastError = error;
      if (!isRetriableBrowserConnectError(error)) {
        throw error;
      }

      attempt += 1;
      const delay = Math.min(250 * attempt, 1_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error
    ? new Error(`Timed out waiting for local Orbita websocket to become reachable at ${connectUrl}. ${lastError.message}`)
    : new Error(`Timed out waiting for local Orbita websocket to become reachable at ${connectUrl}.`);
}

function buildBrowserLaunchErrorMessage(error: unknown, executablePath?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|Timed out waiting for local Orbita websocket/i.test(message)) {
    const executableHint = executablePath
      ? `The CLI tried to launch Orbita from ${executablePath}, but the debugging port never became reachable.`
      : "The CLI tried to launch Orbita through the GoLogin SDK, but the debugging port never became reachable.";
    return `${executableHint} If Orbita is installed outside the default SDK location, set GOLOGIN_EXECUTABLE_PATH explicitly. Otherwise verify that the profile can launch in the GoLogin desktop app and retry.`;
  }

  return message;
}

export async function navigatePage(page: Page, url: string, timeoutMs: number): Promise<string> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    return page.url();
  } catch (error) {
    throw new AppError("NAVIGATION_TIMEOUT", error instanceof Error ? error.message : `Failed to navigate to ${url}`, 504, {
      url
    });
  }
}

async function locatorFromRole(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  const role = asAriaRole(descriptor.role);
  const name = descriptor.accessibleName ?? descriptor.text;

  if (!role || !name) {
    return undefined;
  }

  const locator = page.getByRole(role as never, { name });
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

async function locatorFromFileInput(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  if (descriptor.tag !== "input" || descriptor.inputType?.toLowerCase() !== "file") {
    return undefined;
  }

  const locator = page.locator('input[type="file"]');
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (descriptor.fileInputIndex !== undefined && descriptor.fileInputIndex < count) {
    return locator.nth(descriptor.fileInputIndex);
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

async function locatorFromLabel(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  const label = descriptor.ariaLabel ?? descriptor.accessibleName;
  if (!label) {
    return undefined;
  }

  const locator = page.getByLabel(label);
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

async function locatorFromPlaceholder(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  if (!descriptor.placeholder) {
    return undefined;
  }

  const locator = page.getByPlaceholder(descriptor.placeholder);
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

async function locatorFromTagAndText(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  const text = descriptor.text ?? descriptor.accessibleName;
  if (!text) {
    return undefined;
  }

  const locator = page.locator(descriptor.tag).filter({ hasText: text });
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

async function locatorFromFallbackTag(page: Page, descriptor: RefDescriptor): Promise<Locator | undefined> {
  const locator = page.locator(descriptor.tag);
  const count = await locator.count();
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return locator.first();
  }
  if (descriptor.nth !== undefined && descriptor.nth < count) {
    return locator.nth(descriptor.nth);
  }
  return undefined;
}

export async function resolveDescriptorLocator(page: Page, descriptor: RefDescriptor): Promise<Locator> {
  const strategies = [
    locatorFromFileInput,
    locatorFromRole,
    locatorFromLabel,
    locatorFromPlaceholder,
    locatorFromTagAndText,
    locatorFromFallbackTag
  ];

  for (const strategy of strategies) {
    const locator = await strategy(page, descriptor);
    if (locator) {
      return locator;
    }
  }

  throw new AppError(
    "REF_NOT_FOUND",
    `ref ${descriptor.ref} is stale or unavailable on the current page; run snapshot again`,
    404,
    {
      ref: descriptor.ref
    }
  );
}

export async function resolveSelectorLocator(
  page: Page,
  selector: string,
  timeoutMs: number,
  options: { visible?: boolean } = {}
): Promise<Locator> {
  return ensureLocatorReady(page.locator(selector), `selector ${selector}`, timeoutMs, options);
}

export async function resolveSemanticLocator(
  page: Page,
  query: SemanticLocatorQuery,
  timeoutMs: number
): Promise<Locator> {
  switch (query.strategy) {
    case "role":
      if (!query.role) {
        throw new AppError("BAD_REQUEST", "find role requires a role value", 400);
      }
      return ensureLocatorReady(
        query.name
          ? page.getByRole(query.role as never, { name: query.name, exact: query.exact })
          : page.getByRole(query.role as never),
        `role ${query.role}`,
        timeoutMs
      );
    case "text":
      if (!query.text) {
        throw new AppError("BAD_REQUEST", "find text requires a text value", 400);
      }
      return ensureLocatorReady(page.getByText(query.text, { exact: query.exact }), `text ${query.text}`, timeoutMs);
    case "label":
      if (!query.label) {
        throw new AppError("BAD_REQUEST", "find label requires a label value", 400);
      }
      return ensureLocatorReady(page.getByLabel(query.label, { exact: query.exact }), `label ${query.label}`, timeoutMs);
    case "placeholder":
      if (!query.placeholder) {
        throw new AppError("BAD_REQUEST", "find placeholder requires a placeholder value", 400);
      }
      return ensureLocatorReady(
        page.getByPlaceholder(query.placeholder, { exact: query.exact }),
        `placeholder ${query.placeholder}`,
        timeoutMs
      );
    case "first":
      if (!query.selector) {
        throw new AppError("BAD_REQUEST", "find first requires a selector value", 400);
      }
      return ensureLocatorReady(page.locator(query.selector).first(), `first ${query.selector}`, timeoutMs);
    case "last":
      if (!query.selector) {
        throw new AppError("BAD_REQUEST", "find last requires a selector value", 400);
      }
      return ensureLocatorReady(page.locator(query.selector).last(), `last ${query.selector}`, timeoutMs);
    case "nth":
      if (!query.selector || query.nth === undefined) {
        throw new AppError("BAD_REQUEST", "find nth requires both an index and selector", 400);
      }
      return ensureLocatorReady(page.locator(query.selector).nth(query.nth), `nth ${query.nth} ${query.selector}`, timeoutMs);
  }
}

export async function performLocatorAction(
  page: Page,
  locator: Locator,
  action: SemanticFindAction | "focus" | "dblclick" | "select" | "check" | "uncheck",
  timeoutMs: number,
  value?: string
): Promise<string | undefined> {
  switch (action) {
    case "click":
      await locator.click({ timeout: timeoutMs });
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      return undefined;
    case "fill":
      await locator.fill(value ?? "", { timeout: timeoutMs });
      return undefined;
    case "type":
      await locator.pressSequentially(value ?? "", { timeout: timeoutMs });
      return undefined;
    case "hover":
      await locator.hover({ timeout: timeoutMs });
      return undefined;
    case "focus":
      await locator.focus({ timeout: timeoutMs });
      return undefined;
    case "dblclick":
      await locator.dblclick({ timeout: timeoutMs });
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      return undefined;
    case "select":
      await locator.selectOption(value ?? "", { timeout: timeoutMs });
      return undefined;
    case "check":
      await locator.check({ timeout: timeoutMs });
      return undefined;
    case "uncheck":
      await locator.uncheck({ timeout: timeoutMs });
      return undefined;
    case "text":
      return await locator.innerText({ timeout: timeoutMs });
  }
}

export function actionMutatesSnapshot(action: SemanticFindAction): boolean {
  return action !== "text";
}

export async function pressKey(page: Page, key: string, timeoutMs: number): Promise<void> {
  void timeoutMs;
  await page.keyboard.press(key);
}

export async function waitForTarget(locator: Locator, timeoutMs: number): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
}

export async function waitForPageText(page: Page, text: string, timeoutMs: number, exact = false): Promise<void> {
  await page.getByText(text, { exact }).first().waitFor({ state: "visible", timeout: timeoutMs });
}

export async function waitForPageUrl(page: Page, urlPattern: string, timeoutMs: number): Promise<void> {
  await page.waitForURL(urlPattern, { timeout: timeoutMs });
}

export async function waitForPageLoad(page: Page, state: WaitLoadState, timeoutMs: number): Promise<void> {
  await page.waitForLoadState(state, { timeout: timeoutMs });
}

export async function readLocatorValue(locator: Locator, kind: GetKind, timeoutMs: number): Promise<string> {
  switch (kind) {
    case "text":
      return await locator.innerText({ timeout: timeoutMs });
    case "value":
      return await locator.inputValue({ timeout: timeoutMs });
    case "html":
      return await locator.innerHTML({ timeout: timeoutMs });
    default:
      throw new AppError("BAD_REQUEST", `Unsupported get kind for element target: ${kind}`, 400);
  }
}

function scrollDelta(direction: ScrollDirection, pixels: number): { dx: number; dy: number } {
  switch (direction) {
    case "up":
      return { dx: 0, dy: -pixels };
    case "down":
      return { dx: 0, dy: pixels };
    case "left":
      return { dx: -pixels, dy: 0 };
    case "right":
      return { dx: pixels, dy: 0 };
  }
}

export async function scrollPage(page: Page, direction: ScrollDirection, pixels: number): Promise<void> {
  const { dx, dy } = scrollDelta(direction, pixels);
  await page.mouse.wheel(dx, dy);
}

export async function scrollElement(locator: Locator, direction: ScrollDirection, pixels: number): Promise<void> {
  const { dx, dy } = scrollDelta(direction, pixels);
  await locator.evaluate(
    (element, delta) => {
      if (element instanceof HTMLElement) {
        element.scrollBy(delta.dx, delta.dy);
      }
    },
    { dx, dy }
  );
}

export async function scrollLocatorIntoView(locator: Locator, timeoutMs: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
}

export async function uploadFiles(locator: Locator, files: string[], timeoutMs: number): Promise<void> {
  const resolved = locator.first();
  await resolved.waitFor({ state: "attached", timeout: timeoutMs });
  const isFileInput = await resolved.evaluate((element) => {
    return element instanceof HTMLInputElement && element.type.toLowerCase() === "file";
  });

  if (!isFileInput) {
    throw new AppError(
      "UPLOAD_TARGET_NOT_FILE_INPUT",
      "Upload target is not an input[type=file]. Run `gologin-agent-browser upload --discover` or `snapshot -i`, then use the upload ref or a CSS selector like `input[type=\"file\"]`.",
      400
    );
  }

  await resolved.setInputFiles(files, { timeout: timeoutMs });
}

export async function savePdf(page: Page, targetPath: string): Promise<void> {
  await page.pdf({
    path: targetPath,
    format: "A4",
    printBackground: true
  });
}

export async function captureScreenshot(page: Page, targetPath: string, timeoutMs: number): Promise<void> {
  await page.screenshot({
    path: targetPath,
    fullPage: true,
    timeout: timeoutMs
  });
}

function resolvePageOrigin(page: Page): string {
  const currentUrl = page.url();
  try {
    const origin = new URL(currentUrl).origin;
    if (!origin || origin === "null") {
      throw new Error("non-origin URL");
    }

    return origin;
  } catch {
    throw new AppError(
      "BAD_REQUEST",
      `Current tab URL ${currentUrl || "about:blank"} does not have a usable origin for storage operations`,
      400
    );
  }
}

function normalizeStorageScope(scope?: StorageScope): StorageScope {
  return scope ?? "both";
}

function hasLocalScope(scope: StorageScope): boolean {
  return scope === "local" || scope === "both";
}

function hasSessionScope(scope: StorageScope): boolean {
  return scope === "session" || scope === "both";
}

export async function listTabs(session: SessionRecord): Promise<TabSummary[]> {
  const pages = session.context.pages();

  return Promise.all(
    pages.map(async (page, index) => ({
      index: index + 1,
      url: page.url(),
      title: await page.title().catch(() => undefined),
      active: page === session.page
    }))
  );
}

function requireTabIndex(session: SessionRecord, index: number): Page {
  if (!Number.isInteger(index) || index <= 0) {
    throw new AppError("BAD_REQUEST", "tab index must be a positive integer", 400);
  }

  const page = session.context.pages()[index - 1];
  if (!page) {
    throw new AppError("BAD_REQUEST", `tab ${index} does not exist`, 404, { tabIndex: index });
  }

  return page;
}

export async function openTab(session: SessionRecord, url: string | undefined, timeoutMs: number): Promise<{ page: Page; tabIndex: number }> {
  const page = await session.context.newPage();
  if (url) {
    await navigatePage(page, url, timeoutMs);
  }

  await page.bringToFront().catch(() => undefined);
  const tabIndex = session.context.pages().indexOf(page) + 1;

  return {
    page,
    tabIndex
  };
}

export async function focusTab(session: SessionRecord, index: number): Promise<{ page: Page; tabIndex: number }> {
  const page = requireTabIndex(session, index);
  await page.bringToFront().catch(() => undefined);

  return {
    page,
    tabIndex: index
  };
}

export async function closeTab(
  session: SessionRecord,
  index?: number
): Promise<{ page: Page; closedTabIndex: number; activeTabIndex: number }> {
  const pagesBefore = session.context.pages();
  const currentIndex = pagesBefore.indexOf(session.page) + 1;
  const resolvedIndex = index ?? currentIndex;
  const target = requireTabIndex(session, resolvedIndex);

  if (pagesBefore.length === 1) {
    const replacement = await session.context.newPage();
    await replacement.goto("about:blank").catch(() => undefined);
    await target.close({ runBeforeUnload: false });
    await replacement.bringToFront().catch(() => undefined);
    return {
      page: replacement,
      closedTabIndex: resolvedIndex,
      activeTabIndex: 1
    };
  }

  await target.close({ runBeforeUnload: false });
  const pagesAfter = session.context.pages();
  const nextIndex = Math.min(resolvedIndex, pagesAfter.length);
  const page = pagesAfter[nextIndex - 1];
  if (!page) {
    throw new AppError("INTERNAL_ERROR", "No tab remained after close", 500);
  }

  await page.bringToFront().catch(() => undefined);
  return {
    page,
    closedTabIndex: resolvedIndex,
    activeTabIndex: nextIndex
  };
}

export async function readCookies(session: SessionRecord): Promise<CookiesResponse["cookies"]> {
  const cookies = await session.context.cookies();

  return cookies
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite
    }))
    .sort((left, right) =>
      `${left.domain}|${left.path}|${left.name}`.localeCompare(`${right.domain}|${right.path}|${right.name}`)
    );
}

export async function importCookies(session: SessionRecord, cookies: BrowserCookie[]): Promise<number> {
  await session.context.addCookies(cookies as never);
  return cookies.length;
}

export async function clearCookies(session: SessionRecord): Promise<number> {
  const existing = await session.context.cookies();
  await session.context.clearCookies();
  return existing.length;
}

export async function exportStorageState(page: Page, scope?: StorageScope): Promise<StorageState> {
  const resolvedScope = normalizeStorageScope(scope);
  const origin = resolvePageOrigin(page);

  const state = await page.evaluate((requestedScope) => {
    const localEntries: Array<[string, string]> = [];
    const sessionEntries: Array<[string, string]> = [];

    if (requestedScope === "local" || requestedScope === "both") {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key !== null) {
          localEntries.push([key, localStorage.getItem(key) ?? ""]);
        }
      }
      localEntries.sort(([left], [right]) => left.localeCompare(right));
    }

    if (requestedScope === "session" || requestedScope === "both") {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key !== null) {
          sessionEntries.push([key, sessionStorage.getItem(key) ?? ""]);
        }
      }
      sessionEntries.sort(([left], [right]) => left.localeCompare(right));
    }

    return {
      localStorage: Object.fromEntries(localEntries),
      sessionStorage: Object.fromEntries(sessionEntries)
    };
  }, resolvedScope);

  return {
    origin,
    localStorage: state.localStorage,
    sessionStorage: state.sessionStorage
  };
}

export async function importStorageState(
  page: Page,
  state: StorageState,
  scope?: StorageScope,
  clear = false
): Promise<{ origin: string; localKeys: number; sessionKeys: number }> {
  const resolvedScope = normalizeStorageScope(scope);
  const origin = resolvePageOrigin(page);
  if (origin !== state.origin) {
    throw new AppError(
      "BAD_REQUEST",
      `Storage state origin ${state.origin} does not match current tab origin ${origin}`,
      400,
      {
        expectedOrigin: origin,
        actualOrigin: state.origin
      }
    );
  }

  const localStorageState = hasLocalScope(resolvedScope) ? state.localStorage : {};
  const sessionStorageState = hasSessionScope(resolvedScope) ? state.sessionStorage : {};

  await page.evaluate(
    ({ incoming, requestedScope, shouldClear }) => {
      if (shouldClear) {
        if (requestedScope === "local" || requestedScope === "both") {
          localStorage.clear();
        }
        if (requestedScope === "session" || requestedScope === "both") {
          sessionStorage.clear();
        }
      }

      if (requestedScope === "local" || requestedScope === "both") {
        for (const [key, value] of Object.entries(incoming.localStorage)) {
          localStorage.setItem(key, value);
        }
      }

      if (requestedScope === "session" || requestedScope === "both") {
        for (const [key, value] of Object.entries(incoming.sessionStorage)) {
          sessionStorage.setItem(key, value);
        }
      }
    },
    {
      incoming: {
        localStorage: localStorageState,
        sessionStorage: sessionStorageState
      },
      requestedScope: resolvedScope,
      shouldClear: clear
    }
  );

  return {
    origin,
    localKeys: Object.keys(localStorageState).length,
    sessionKeys: Object.keys(sessionStorageState).length
  };
}

export async function clearStorageState(page: Page, scope?: StorageScope): Promise<{ origin: string; scope: StorageScope }> {
  const resolvedScope = normalizeStorageScope(scope);
  const origin = resolvePageOrigin(page);

  await page.evaluate((requestedScope) => {
    if (requestedScope === "local" || requestedScope === "both") {
      localStorage.clear();
    }
    if (requestedScope === "session" || requestedScope === "both") {
      sessionStorage.clear();
    }
  }, resolvedScope);

  return {
    origin,
    scope: resolvedScope
  };
}

export async function evaluateExpression(page: Page, expression: string): Promise<EvalResponse["value"]> {
  try {
    return await page.evaluate((userExpression) => {
      const fn = new Function(`return (${userExpression});`);
      return fn();
    }, expression);
  } catch (error) {
    throw new AppError("BAD_REQUEST", error instanceof Error ? error.message : String(error), 400, {
      expression
    });
  }
}

export async function annotatePageWithRefs(
  page: Page,
  refs: Array<{ ref: string; x: number; y: number }>
): Promise<void> {
  await page.evaluate((labels) => {
    document.getElementById("__gologin-local-agent-browser-annotations")?.remove();

    const root = document.createElement("div");
    root.id = "__gologin-local-agent-browser-annotations";
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.pointerEvents = "none";
    root.style.zIndex = "2147483647";

    for (const label of labels) {
      const node = document.createElement("div");
      node.textContent = label.ref;
      node.style.position = "absolute";
      node.style.left = `${Math.max(0, label.x)}px`;
      node.style.top = `${Math.max(0, label.y)}px`;
      node.style.padding = "2px 6px";
      node.style.borderRadius = "999px";
      node.style.background = "#ffcf33";
      node.style.color = "#111";
      node.style.font = "600 12px/1.2 Menlo, Monaco, monospace";
      node.style.boxShadow = "0 1px 2px rgba(0,0,0,0.3)";
      node.style.border = "1px solid rgba(0,0,0,0.35)";
      root.appendChild(node);
    }

    document.body.appendChild(root);
  }, refs);
}

export async function clearPageAnnotations(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("__gologin-local-agent-browser-annotations")?.remove();
  });
}

export async function closeSessionHandles(session: SessionRecord): Promise<void> {
  try {
    await session.browser.close().catch(async () => {
      await session.page.close().catch(() => undefined);
      await session.context.close().catch(() => undefined);
    });
  } finally {
    await session.gologin?.stop(true).catch(() => undefined);
  }
}
