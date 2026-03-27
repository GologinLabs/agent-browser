import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../src/lib/errors";
import { buildConnectUrl, describeCloudConnectFailure, preflightCloudConnect, toPlaywrightCdpUrl } from "../src/daemon/browser";
import type { AgentConfig } from "../src/lib/types";

const config: AgentConfig = {
  token: undefined,
  defaultProfileId: undefined,
  connectBase: "https://cloudbrowser.gologin.com/connect",
  daemonPort: 44777,
  daemonHost: "127.0.0.1",
  socketPath: "/tmp/gologin-agent-browser.sock",
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

test("describeCloudConnectFailure surfaces 403 guidance", () => {
  assert.equal(
    describeCloudConnectFailure(403, "plan limit reached"),
    "Cloud Browser rejected the session start (403): plan limit reached. Check GOLOGIN_TOKEN, profile access, and plan permissions."
  );
});

test("preflightCloudConnect turns non-ok responses into readable AppError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response("", {
        status: 503,
        headers: {
          "X-Error-Reason": "max parallel cloud launches limit"
        }
      })) as typeof fetch;

    await assert.rejects(
      () => preflightCloudConnect(config, "token-123", "profile-456"),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "BROWSER_CONNECTION_FAILED");
        assert.match(error.message, /max parallel cloud launches limit/i);
        assert.match(error.message, /sessions --prune, close --all/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preflightCloudConnect falls back to CDP path when HTTP probe itself fails", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const connectUrl = await preflightCloudConnect(config, "token-123", "profile-456");
    assert.equal(connectUrl, buildConnectUrl(config, "token-123", "profile-456"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
