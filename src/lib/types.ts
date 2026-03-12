import type { Browser, BrowserContext, Page } from "playwright";

export type TransportKind = "socket" | "http";

export type SnapshotKind =
  | "heading"
  | "paragraph"
  | "link"
  | "button"
  | "input"
  | "checkbox"
  | "radio"
  | "textarea"
  | "select";

export interface AgentConfig {
  token?: string;
  defaultProfileId?: string;
  connectBase: string;
  daemonPort: number;
  daemonHost: string;
  socketPath: string;
  configPath: string;
  logPath: string;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
}

export interface ResolvedTransport {
  kind: TransportKind;
  socketPath?: string;
  host?: string;
  port?: number;
}

export interface SessionSummary {
  sessionId: string;
  profileId?: string;
  url: string;
  active: boolean;
  hasSnapshot: boolean;
  staleSnapshot: boolean;
  liveViewUrl?: string;
  proxy?: ProxySummary;
  createdAt?: string;
  lastActivityAt?: string;
  idleTimeoutMs?: number;
  lastScreenshotPath?: string;
  lastPdfPath?: string;
}

export type ProxyMode = "gologin" | "http" | "socks4" | "socks5";

export interface ProxyConfig {
  mode: ProxyMode;
  country?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface ProxySummary {
  mode: string;
  country?: string;
  host?: string;
  port?: number;
  username?: string;
}

export interface RefDescriptor {
  ref: string;
  kind: SnapshotKind;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  ariaLabel?: string;
  placeholder?: string;
  inputType?: string;
  name?: string;
  href?: string;
  nth?: number;
  checked?: boolean;
  disabled?: boolean;
  selectedText?: string;
}

export interface SnapshotItem {
  ref: string;
  kind: SnapshotKind;
  text: string;
  role?: string;
  flags?: string[];
}

export interface SnapshotResponse {
  sessionId: string;
  url: string;
  items: SnapshotItem[];
}

export interface SessionRecord {
  sessionId: string;
  profileId?: string;
  autoCreatedProfile: boolean;
  connectUrl: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  currentUrl: string;
  hasSnapshot: boolean;
  staleSnapshot: boolean;
  liveViewUrl?: string;
  proxy?: ProxySummary;
  createdAt: string;
  lastActivityAt: string;
  idleTimeoutMs?: number;
  lastScreenshotPath?: string;
  lastPdfPath?: string;
}

export interface OpenSessionRequest {
  url: string;
  profileId?: string;
  sessionId?: string;
  proxy?: ProxyConfig;
  idleTimeoutMs?: number;
}

export interface OpenSessionResponse {
  sessionId: string;
  profileId?: string;
  url: string;
  liveViewUrl?: string;
  proxy?: ProxySummary;
  idleTimeoutMs?: number;
}

export interface TargetRequest {
  target: string;
}

export interface ClickRequest extends TargetRequest {}

export interface ActionResponse {
  sessionId: string;
  url: string;
  staleSnapshot: boolean;
}

export interface ClickResponse extends ActionResponse {}

export interface TypeRequest extends TargetRequest {
  text: string;
}

export interface TypeResponse extends ActionResponse {}

export interface FillRequest extends TargetRequest {
  text: string;
}

export interface FillResponse extends ActionResponse {}

export interface HoverRequest extends TargetRequest {}

export interface HoverResponse extends ActionResponse {}

export interface FocusRequest extends TargetRequest {}

export interface FocusResponse extends ActionResponse {}

export interface DoubleClickRequest extends TargetRequest {}

export interface DoubleClickResponse extends ActionResponse {}

export interface SelectRequest extends TargetRequest {
  value: string;
}

export interface SelectResponse extends ActionResponse {}

export interface CheckRequest extends TargetRequest {}

export interface CheckResponse extends ActionResponse {}

export interface UncheckRequest extends TargetRequest {}

export interface UncheckResponse extends ActionResponse {}

export interface PressRequest {
  key: string;
  target?: string;
}

export interface PressResponse extends ActionResponse {}

export interface ScreenshotRequest {
  path: string;
  annotate?: boolean;
  pressEscape?: boolean;
}

export interface ScreenshotResponse {
  sessionId: string;
  path: string;
  url: string;
  annotated?: boolean;
  pressedEscape?: boolean;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface CookiesResponse {
  sessionId: string;
  url: string;
  cookies: BrowserCookie[];
}

export interface CookiesImportRequest {
  cookies: BrowserCookie[];
}

export interface CookiesImportResponse extends ActionResponse {
  imported: number;
}

export interface CookiesClearResponse extends ActionResponse {
  cleared: number;
}

export interface CloseSessionResponse {
  sessionId: string;
  closed: true;
}

export interface SessionsResponse {
  activeSessionId?: string;
  sessions: SessionSummary[];
}

export interface TabSummary {
  index: number;
  url: string;
  title?: string;
  active: boolean;
}

export interface TabsResponse {
  sessionId: string;
  tabs: TabSummary[];
}

export interface TabOpenRequest {
  url?: string;
}

export interface TabOpenResponse extends ActionResponse {
  tabIndex: number;
}

export interface TabFocusRequest {
  index: number;
}

export interface TabFocusResponse extends ActionResponse {
  tabIndex: number;
}

export interface TabCloseRequest {
  index?: number;
}

export interface TabCloseResponse extends ActionResponse {
  closedTabIndex: number;
  activeTabIndex: number;
}

export interface DoctorTransportStatus {
  label: string;
  reachable: boolean;
}

export interface DoctorResponse {
  ok: boolean;
  tokenConfigured: boolean;
  defaultProfileId?: string;
  connectBase: string;
  daemonLogPath: string;
  configPath: string;
  transports: DoctorTransportStatus[];
}

export type WaitLoadState = "load" | "domcontentloaded" | "networkidle";

export interface WaitRequest {
  target?: string;
  text?: string;
  urlPattern?: string;
  loadState?: WaitLoadState;
  timeoutMs?: number;
}

export interface WaitResponse {
  sessionId: string;
  url: string;
  waitedFor: string;
}

export type ScrollDirection = "up" | "down" | "left" | "right";

export interface ScrollRequest {
  direction: ScrollDirection;
  pixels?: number;
  target?: string;
}

export interface ScrollResponse {
  sessionId: string;
  url: string;
  target?: string;
  direction: ScrollDirection;
  pixels: number;
}

export interface ScrollIntoViewRequest extends TargetRequest {}

export interface ScrollIntoViewResponse extends ActionResponse {}

export interface UploadRequest extends TargetRequest {
  files: string[];
}

export interface UploadResponse extends ActionResponse {
  files: string[];
}

export interface PdfRequest {
  path: string;
}

export interface PdfResponse {
  sessionId: string;
  path: string;
  url: string;
}

export type GetKind = "text" | "value" | "html" | "title" | "url";

export interface GetRequest {
  kind: GetKind;
  target?: string;
}

export interface GetResponse {
  sessionId: string;
  url: string;
  value: string;
}

export type StorageScope = "local" | "session" | "both";

export interface StorageState {
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface StorageExportRequest {
  scope?: StorageScope;
}

export interface StorageExportResponse {
  sessionId: string;
  url: string;
  state: StorageState;
}

export interface StorageImportRequest {
  state: StorageState;
  scope?: StorageScope;
  clear?: boolean;
}

export interface StorageImportResponse extends ActionResponse {
  origin: string;
  localKeys: number;
  sessionKeys: number;
}

export interface StorageClearRequest {
  scope?: StorageScope;
}

export interface StorageClearResponse extends ActionResponse {
  origin: string;
  scope: StorageScope;
}

export interface EvalRequest {
  expression: string;
}

export interface EvalResponse extends ActionResponse {
  value: unknown;
}

export type SemanticLocatorStrategy = "role" | "text" | "label" | "placeholder" | "first" | "last" | "nth";

export interface SemanticLocatorQuery {
  strategy: SemanticLocatorStrategy;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  selector?: string;
  nth?: number;
  exact?: boolean;
}

export type SemanticFindAction = "click" | "fill" | "type" | "hover" | "text";

export interface FindRequest {
  locator: SemanticLocatorQuery;
  action: SemanticFindAction;
  value?: string;
}

export interface FindResponse extends ActionResponse {
  value?: string;
}

export interface HealthResponse {
  ok: true;
  pid: number;
  transports: TransportKind[];
}

export interface DaemonErrorPayload {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

export interface SnapshotBuildResult {
  items: SnapshotItem[];
  refs: RefDescriptor[];
}

export interface RawSnapshotCandidate {
  kind: SnapshotKind;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  ariaLabel?: string;
  placeholder?: string;
  inputType?: string;
  name?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  selectedText?: string;
}

export interface DaemonClient {
  transport: ResolvedTransport;
  request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse>;
}

export interface CommandContext {
  config: AgentConfig;
  client: DaemonClient;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  cwd: string;
}
