import test from "node:test";
import assert from "node:assert/strict";

import { isHelpRequest } from "../src/cli";

test("isHelpRequest detects subcommand help flags", () => {
  assert.equal(isHelpRequest(["--help"]), true);
  assert.equal(isHelpRequest(["open", "-h"]), true);
  assert.equal(isHelpRequest(["https://example.com"]), false);
});
