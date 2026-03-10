import test from "node:test";
import assert from "node:assert/strict";

test("live smoke test is gated by env", async (t) => {
  if (!process.env.GOLOGIN_TOKEN) {
    t.skip("GOLOGIN_TOKEN is required for live smoke testing");
    return;
  }

  assert.ok(process.env.GOLOGIN_TOKEN);
});
