import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../src/lib/errors";
import { gologinApiRequest } from "../src/lib/gologinApi";
import type { AgentConfig } from "../src/lib/types";

function makeConfig(token?: string): AgentConfig {
  return {
    token,
    connectBase: "https://cloudbrowser.gologin.com/connect",
    daemonPort: 0,
    daemonHost: "127.0.0.1",
    socketPath: "/tmp/gologin-agent.sock",
    configPath: "/tmp/config.json",
    logPath: "/tmp/agent.log",
    navigationTimeoutMs: 30000,
    actionTimeoutMs: 10000
  };
}

test("gologinApiRequest sends bearer token, query, and JSON body", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const payload = await gologinApiRequest<{ ok: boolean }>(makeConfig("token-123"), "POST", "/browser/test", {
      query: { workspaceId: "w1", days: 7, empty: undefined },
      headers: { "cf-ipcountry": "US", skipped: undefined },
      body: { hello: "world" }
    });

    assert.deepEqual(payload, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.gologin.com/browser/test?workspaceId=w1&days=7");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer token-123");
    assert.equal((calls[0].init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal((calls[0].init?.headers as Record<string, string>)["cf-ipcountry"], "US");
    assert.equal((calls[0].init?.headers as Record<string, string>).skipped, undefined);
    assert.equal(calls[0].init?.body, "{\"hello\":\"world\"}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gologinApiRequest surfaces API error payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "profile is already running" }), { status: 409 })) as typeof fetch;

  try {
    await assert.rejects(
      () => gologinApiRequest(makeConfig("token-123"), "DELETE", "/browser/p1/web"),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "GOLOGIN_API_FAILED");
        assert.equal(error.status, 409);
        assert.match(error.message, /profile is already running/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gologinApiRequest requires GOLOGIN_TOKEN", async () => {
  await assert.rejects(
    () => gologinApiRequest(makeConfig(), "GET", "/browser/latest-useragent"),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "TOKEN_MISSING");
      return true;
    }
  );
});
