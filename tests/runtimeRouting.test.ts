import test from "node:test";
import assert from "node:assert/strict";

import { extractRuntimeSelection, shouldRouteToLocalRuntime } from "../src/lib/runtimeRouting";

test("extractRuntimeSelection supports global and inline runtime flags", () => {
  assert.deepEqual(extractRuntimeSelection(["--runtime", "local", "open", "https://example.com"]), {
    runtime: "local",
    args: ["open", "https://example.com"]
  });
  assert.deepEqual(extractRuntimeSelection(["open", "https://example.com", "--runtime=cloud"]), {
    runtime: "cloud",
    args: ["open", "https://example.com"]
  });
  assert.deepEqual(extractRuntimeSelection(["local", "open", "https://example.com"]), {
    runtime: "local",
    args: ["open", "https://example.com"]
  });
});

test("shouldRouteToLocalRuntime routes explicit local and local-only commands", () => {
  assert.equal(shouldRouteToLocalRuntime({ runtime: "local", args: ["snapshot"] }), true);
  assert.equal(shouldRouteToLocalRuntime({ runtime: "cloud", args: ["profile-create"] }), false);
  assert.equal(shouldRouteToLocalRuntime({ args: ["profile-create", "account"] }), true);
  assert.equal(shouldRouteToLocalRuntime({ args: ["open", "https://example.com"] }), false);
});

test("shouldRouteToLocalRuntime keeps REST API commands on the global CLI", () => {
  assert.equal(shouldRouteToLocalRuntime({ runtime: "local", args: ["api", "GET", "/user"] }), false);
  assert.equal(shouldRouteToLocalRuntime({ runtime: "local", args: ["profile-proxy", "list"] }), false);
  assert.equal(shouldRouteToLocalRuntime({ runtime: "local", args: ["profile-ua", "latest"] }), false);
});
