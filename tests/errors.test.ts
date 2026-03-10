import test from "node:test";
import assert from "node:assert/strict";

import { AppError, formatErrorLine, serializeError } from "../src/lib/errors";

test("serializeError preserves typed error metadata", () => {
  const payload = serializeError(new AppError("SESSION_NOT_FOUND", "missing", 404, { sessionId: "s1" }));

  assert.equal(payload.code, "SESSION_NOT_FOUND");
  assert.equal(payload.status, 404);
  assert.deepEqual(payload.details, { sessionId: "s1" });
});

test("formatErrorLine renders typed errors cleanly", () => {
  assert.equal(formatErrorLine(new AppError("TOKEN_MISSING", "missing token", 400)), "TOKEN_MISSING: missing token");
});
