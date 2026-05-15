import test from "node:test";
import assert from "node:assert/strict";

import { runApiCommand, parseApiCommandArgs } from "../src/commands/api";
import type { CommandContext, AgentConfig } from "../src/lib/types";

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

function makeContext(): CommandContext & { stdoutText: () => string; stderrText: () => string } {
  let stdout = "";
  let stderr = "";
  return {
    config: makeConfig(),
    client: {
      transport: { kind: "http", host: "127.0.0.1", port: 0 },
      async request() {
        throw new Error("daemon should not be used by api command");
      }
    },
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } } as NodeJS.WritableStream,
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } } as NodeJS.WritableStream,
    cwd: process.cwd(),
    stdoutText: () => stdout,
    stderrText: () => stderr
  };
}

test("parseApiCommandArgs parses method, path, query, and JSON body", () => {
  const parsed = parseApiCommandArgs([
    "PATCH",
    "/browser/p1/proxy",
    "--query",
    "workspaceId=w1",
    "--query",
    "dryRun=true",
    "--data",
    "{\"mode\":\"gologin\"}"
  ]);

  assert.equal(parsed.method, "PATCH");
  assert.equal(parsed.path, "/browser/p1/proxy");
  assert.deepEqual(parsed.query, { workspaceId: "w1", dryRun: true });
  assert.deepEqual(parsed.body, { mode: "gologin" });
});

test("runApiCommand calls arbitrary GoLogin API endpoints without daemon", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "profile-1" }), { status: 200 });
  }) as typeof fetch;

  try {
    const context = makeContext();
    await runApiCommand(context, [
      "GET",
      "/browser/profile-1",
      "--query",
      "includeFolders=false"
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.gologin.com/browser/profile-1?includeFolders=false");
    assert.equal(calls[0].init?.method, "GET");
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer token-123");
    assert.deepEqual(JSON.parse(context.stdoutText()), { id: "profile-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
