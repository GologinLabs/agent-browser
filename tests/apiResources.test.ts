import test from "node:test";
import assert from "node:assert/strict";

import {
  runBrowserApiCommand,
  runProxyApiCommand,
  runWorkspaceApiCommand
} from "../src/commands/apiResources";
import type { AgentConfig, CommandContext } from "../src/lib/types";

function makeConfig(token = "token-123"): AgentConfig {
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

function makeContext(): CommandContext & { stdoutText: () => string } {
  let stdout = "";
  return {
    config: makeConfig(),
    client: {
      transport: { kind: "http", host: "127.0.0.1", port: 0 },
      async request() {
        throw new Error("daemon should not be used by API resource commands");
      }
    },
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } } as NodeJS.WriteStream,
    stderr: { write: () => true } as NodeJS.WriteStream,
    cwd: process.cwd(),
    stdoutText: () => stdout
  };
}

test("browser resource exposes first-class profile list and query flags", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ profiles: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runBrowserApiCommand(context, ["list", "--search", "reddit", "--page", "2"]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.gologin.com/browser/v2?search=reddit&page=2");
    assert.equal(calls[0].init?.method, "GET");
    assert.deepEqual(JSON.parse(context.stdoutText()), { profiles: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser resource builds named action bodies without raw api command", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runBrowserApiCommand(context, ["name", "profile-1", "--name", "Main Reddit"]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.gologin.com/browser/profile-1/name");
    assert.equal(calls[0].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "Main Reddit" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy resource supports managed GoLogin proxy creation as an action", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runProxyApiCommand(context, ["add-gologin", "profile-1", "--country", "US", "--type", "mobile"]);

    assert.equal(calls[0].url, "https://api.gologin.com/users-proxies/mobile-proxy");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      countryCode: "us",
      profileIdToLink: "profile-1",
      customName: "gologin-us-profil",
      isMobile: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace resource maps member actions to workspace API paths", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runWorkspaceApiCommand(context, [
      "member-update",
      "workspace-1",
      "member-1",
      "--data",
      "{\"role\":\"admin\"}"
    ]);

    assert.equal(calls[0].url, "https://api.gologin.com/workspaces/workspace-1/members/member-1");
    assert.equal(calls[0].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { role: "admin" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workspace profiles passes required GoLogin API country header", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ profiles: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runWorkspaceApiCommand(context, ["profiles", "workspace-1", "--country", "US", "--offset", "10"]);

    assert.equal(calls[0].url, "https://api.gologin.com/workspaces/workspace-1/profiles?offset=10");
    assert.equal(calls[0].init?.method, "GET");
    assert.equal((calls[0].init?.headers as Record<string, string>)["cf-ipcountry"], "US");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
