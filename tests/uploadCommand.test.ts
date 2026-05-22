import test from "node:test";
import assert from "node:assert/strict";

import { runUploadCommand } from "../src/commands/upload";
import type { AgentConfig, CommandContext } from "../src/lib/types";

function makeConfig(): AgentConfig {
  return {
    token: "token-123",
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

function makeContext(): CommandContext & {
  stdoutText: () => string;
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  let stdout = "";
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  return {
    config: makeConfig(),
    client: {
      transport: { kind: "http", host: "127.0.0.1", port: 0 },
      async request<TResponse>(method: string, path: string, body?: unknown): Promise<TResponse> {
        calls.push({ method, path, body });
        if (path === "/sessions/current") {
          return { sessionId: "s1" } as TResponse;
        }
        if (path === "/sessions/s1/snapshot") {
          return {
            sessionId: "s1",
            url: "https://example.com/upload",
            items: [
              { ref: "@e1", kind: "button", text: "Choose file" },
              { ref: "@e2", kind: "input", text: "file upload", flags: ["upload", "file-input", "hidden"] }
            ]
          } as TResponse;
        }
        throw new Error(`unexpected request ${method} ${path}`);
      }
    },
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } } as NodeJS.WriteStream,
    stderr: { write: () => true } as NodeJS.WriteStream,
    cwd: process.cwd(),
    stdoutText: () => stdout,
    calls
  };
}

test("upload --discover prints upload refs from interactive snapshot", async () => {
  const context = makeContext();

  await runUploadCommand(context, ["--discover"]);

  assert.deepEqual(context.calls, [
    { method: "GET", path: "/sessions/current", body: undefined },
    { method: "POST", path: "/sessions/s1/snapshot", body: { interactive: true } }
  ]);
  assert.match(context.stdoutText(), /upload-targets=1 session=s1/);
  assert.match(context.stdoutText(), /- input "file upload" \[upload\] \[file-input\] \[hidden\] \[ref=@e2\]/);
  assert.match(context.stdoutText(), /gologin-agent-browser upload @e2 \/path\/file --session s1/);
});
