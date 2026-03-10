import test from "node:test";
import assert from "node:assert/strict";

import { buildConnectUrl, toPlaywrightCdpUrl } from "../src/daemon/browser";
import type { AgentConfig } from "../src/lib/types";

const config: AgentConfig = {
  token: undefined,
  defaultProfileId: undefined,
  connectBase: "https://cloudbrowser.gologin.com/connect",
  daemonPort: 44777,
  daemonHost: "127.0.0.1",
  socketPath: "/tmp/gologin-agent.sock",
  configPath: "/tmp/config.json",
  logPath: "/tmp/daemon.log",
  navigationTimeoutMs: 30_000,
  actionTimeoutMs: 10_000
};

test("buildConnectUrl includes profile when provided", () => {
  const url = new URL(buildConnectUrl(config, "token-123", "profile-456"));
  assert.equal(url.searchParams.get("token"), "token-123");
  assert.equal(url.searchParams.get("profile"), "profile-456");
});

test("buildConnectUrl omits profile when not provided", () => {
  const url = new URL(buildConnectUrl(config, "token-123"));
  assert.equal(url.searchParams.get("token"), "token-123");
  assert.equal(url.searchParams.has("profile"), false);
});

test("toPlaywrightCdpUrl converts https endpoint to wss", () => {
  const cdpUrl = new URL(toPlaywrightCdpUrl("https://cloudbrowser.gologin.com/connect?token=token-123"));
  assert.equal(cdpUrl.protocol, "wss:");
  assert.equal(cdpUrl.host, "cloudbrowser.gologin.com");
  assert.equal(cdpUrl.pathname, "/connect");
});
