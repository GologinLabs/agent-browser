import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/lib/config";

test("loadConfig reads env overrides", () => {
  const originalToken = process.env.GOLOGIN_TOKEN;
  const originalProfile = process.env.GOLOGIN_PROFILE_ID;
  const originalPort = process.env.GOLOGIN_DAEMON_PORT;
  const originalBase = process.env.GOLOGIN_CONNECT_BASE;

  process.env.GOLOGIN_TOKEN = "token";
  process.env.GOLOGIN_PROFILE_ID = "profile";
  process.env.GOLOGIN_DAEMON_PORT = "5555";
  process.env.GOLOGIN_CONNECT_BASE = "https://example.test/connect";

  const config = loadConfig();

  assert.equal(config.token, "token");
  assert.equal(config.defaultProfileId, "profile");
  assert.equal(config.daemonPort, 5555);
  assert.equal(config.connectBase, "https://example.test/connect");

  process.env.GOLOGIN_TOKEN = originalToken;
  process.env.GOLOGIN_PROFILE_ID = originalProfile;
  process.env.GOLOGIN_DAEMON_PORT = originalPort;
  process.env.GOLOGIN_CONNECT_BASE = originalBase;
});
