import {
  chromium,
  type Locator,
  type Page
} from "playwright";

import { AppError } from "../lib/errors";
import type {
  ActionResponse,
  AgentConfig,
  GetKind,
  ProxyConfig,
  ProxySummary,
  RefDescriptor,
  ScrollDirection,
  SemanticFindAction,
  SemanticLocatorQuery,
  SessionRecord,
  WaitLoadState
} from "../lib/types";

function asAriaRole(role?: string): string | undefined {
  return role && role !== "paragraph" ? role : undefined;
}

const GOLOGIN_API_BASE = "https://api.gologin.com";

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeProxySummary(proxy: unknown, fallback?: ProxyConfig): ProxySummary | undefined {
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

function buildCloudProfileBody(sessionId: string, proxy?: ProxyConfig): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `gologin-agent-browser-${sessionId}`,
    os: "lin"
  };

  if (!proxy) {
    return body;
  }

  if (proxy.mode === "gologin") {
    body.proxy = {
      mode: "gologin",
      autoProxyRegion: (proxy.country ?? "us").toLowerCase()
    };
    return body;
  }

  body.proxy = {
    mode: proxy.mode,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username ?? "",
    password: proxy.password ?? ""
  };

  return body;
}

async function pickContextAndPage(browser: SessionRecord["browser"]): Promise<{
  context: SessionRecord["context"];
  page: Page;
}> {
  const existingContext = browser.contexts()[0] ?? (await browser.newContext());
  const page = existingContext.pages()[0] ?? (await existingContext.newPage());

  return { context: existingContext, page };
}

async function ensureLocatorReady(locator: Locator, description: string, timeoutMs: number): Promise<Locator> {
  const count = await locator.count();
  if (count === 0) {
    throw new AppError("BAD_REQUEST", `${description} did not match any element`, 404);
  }

  const resolved = locator.first();
  await resolved.waitFor({ state: "visible", timeout: timeoutMs });
  return resolved;
}

export function buildConnectUrl(config: AgentConfig, token: string, profileId?: string): string {
  const url = new URL(config.connectBase);
  url.searchParams.set("token", token);
  if (profileId) {
    url.searchParams.set("profile", profileId);
  }
  return url.toString();
}

export function toPlaywrightCdpUrl(connectUrl: string): string {
  const url = new URL(connectUrl);

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  return url.toString();
}

function extractProfileId(payload: unknown): string | undefined {
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

export async function createQuickProfile(token: string, sessionId: string): Promise<string> {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/quick`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `gologin-agent-browser-${sessionId}`,
      os: "lin"
    })
  });

  if (!response.ok) {
    throw new AppError("BROWSER_CONNECTION_FAILED", `Failed to create Gologin profile: ${response.status}`, 502);
  }

  const payload = (await response.json()) as unknown;
  const profileId = extractProfileId(payload);
  if (!profileId) {
    throw new AppError("BROWSER_CONNECTION_FAILED", "Gologin profile creation returned no profile id", 502);
  }

  return profileId;
}

export async function createManagedProfile(
  token: string,
  sessionId: string,
  proxy?: ProxyConfig
): Promise<{ profileId: string; proxy?: ProxySummary }> {
  if (!proxy) {
    return {
      profileId: await createQuickProfile(token, sessionId)
    };
  }

  const response = await fetch(`${GOLOGIN_API_BASE}/browser/custom`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildCloudProfileBody(sessionId, proxy))
  });

  if (!response.ok) {
    throw new AppError("BROWSER_CONNECTION_FAILED", `Failed to create Gologin cloud profile: ${response.status}`, 502);
  }

  const payload = (await response.json()) as unknown;
  const profileId = extractProfileId(payload);
  if (!profileId) {
    throw new AppError("BROWSER_CONNECTION_FAILED", "Gologin profile creation returned no profile id", 502);
  }

  let proxySummary: ProxySummary | undefined;
  if (payload && typeof payload === "object") {
    proxySummary = normalizeProxySummary((payload as Record<string, unknown>).proxy, proxy);
  }

  return {
    profileId,
    proxy: proxySummary ?? normalizeProxySummary(undefined, proxy)
  };
}

export async function deleteProfile(token: string, profileId: string): Promise<void> {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/${profileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new AppError("BROWSER_CONNECTION_FAILED", `Failed to delete Gologin profile ${profileId}`, 502, {
      profileId
    });
  }
}

export async function getCloudLiveViewUrl(token: string, profileId: string): Promise<string | undefined> {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/${profileId}/web`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return trimToUndefined(payload.remoteOrbitaUrl);
}

export async function getCloudProfileProxy(token: string, profileId: string): Promise<ProxySummary | undefined> {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/${profileId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeProxySummary(payload.proxy);
}

export async function connectToBrowser(
  config: AgentConfig,
  token: string,
  profileId?: string
): Promise<Pick<SessionRecord, "browser" | "context" | "page" | "connectUrl">> {
  const connectUrl = toPlaywrightCdpUrl(buildConnectUrl(config, token, profileId));

  try {
    const browser = await chromium.connectOverCDP(connectUrl);
    const { context, page } = await pickContextAndPage(browser);
    return { browser, context, page, connectUrl };
  } catch (error) {
    throw new AppError("BROWSER_CONNECTION_FAILED", error instanceof Error ? error.message : String(error), 502, {
      profileId
    });
  }
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

export async function resolveSelectorLocator(page: Page, selector: string, timeoutMs: number): Promise<Locator> {
  return ensureLocatorReady(page.locator(selector), `selector ${selector}`, timeoutMs);
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
  await locator.setInputFiles(files, { timeout: timeoutMs });
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

export async function annotatePageWithRefs(
  page: Page,
  refs: Array<{ ref: string; x: number; y: number }>
): Promise<void> {
  await page.evaluate((labels) => {
    document.getElementById("__gologin-agent-browser-annotations")?.remove();

    const root = document.createElement("div");
    root.id = "__gologin-agent-browser-annotations";
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
    document.getElementById("__gologin-agent-browser-annotations")?.remove();
  });
}

export async function closeSessionHandles(session: SessionRecord): Promise<void> {
  await session.browser.close().catch(async () => {
    await session.page.close().catch(() => undefined);
    await session.context.close().catch(() => undefined);
  });
}
