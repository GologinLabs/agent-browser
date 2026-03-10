import test from "node:test";
import assert from "node:assert/strict";

import { formatCurrentLine, formatSessionLine, generateSessionId, isNumericToken, isRefTarget, parseArgs } from "../src/lib/utils";

test("generateSessionId increments from existing ids", () => {
  assert.equal(generateSessionId(["s1", "s2", "s4"]), "s3");
});

test("parseArgs handles flags and positionals", () => {
  const parsed = parseArgs(["https://example.com", "--profile", "p1", "--interactive"]);
  assert.deepEqual(parsed.positional, ["https://example.com"]);
  assert.equal(parsed.flags.profile, "p1");
  assert.equal(parsed.flags.interactive, true);
});

test("parseArgs supports short interactive flag and boolean flags", () => {
  const parsed = parseArgs(["-i", "--exact", "--annotate", "--press-escape", "button"]);
  assert.equal(parsed.flags.interactive, true);
  assert.equal(parsed.flags.exact, true);
  assert.equal(parsed.flags.annotate, true);
  assert.equal(parsed.flags["press-escape"], true);
  assert.deepEqual(parsed.positional, ["button"]);
});

test("formatSessionLine marks active session", () => {
  assert.equal(
    formatSessionLine({
      sessionId: "s1",
      profileId: "profile-1",
      url: "https://example.com",
      active: true,
      hasSnapshot: true,
      staleSnapshot: false
    }),
    "* session=s1 profile=profile-1 url=https://example.com snapshot=fresh"
  );
});

test("formatCurrentLine includes proxy, live view, and artifact metadata", () => {
  assert.equal(
    formatCurrentLine({
      sessionId: "s1",
      profileId: "profile-1",
      url: "https://example.com",
      active: true,
      hasSnapshot: true,
      staleSnapshot: false,
      proxy: {
        mode: "gologin",
        country: "us"
      },
      liveViewUrl: "https://cloudbrowser.gologin.com/browsers/profile/token/",
      idleTimeoutMs: 60000,
      lastScreenshotPath: "/tmp/page.png",
      lastPdfPath: "/tmp/page.pdf"
    }),
    "session=s1 profile=profile-1 url=https://example.com snapshot=fresh proxy=gologin:us idleTimeoutMs=60000 liveview=https://cloudbrowser.gologin.com/browsers/profile/token/ shot=/tmp/page.png pdf=/tmp/page.pdf"
  );
});

test("isRefTarget matches snapshot refs", () => {
  assert.equal(isRefTarget("@e12"), true);
  assert.equal(isRefTarget("#submit"), false);
});

test("isNumericToken detects wait duration tokens", () => {
  assert.equal(isNumericToken("1500"), true);
  assert.equal(isNumericToken("@e1"), false);
});
