import test from "node:test";
import assert from "node:assert/strict";

import { buildSnapshotModel } from "../src/daemon/snapshot";
import type { RawSnapshotCandidate } from "../src/lib/types";

const candidates: RawSnapshotCandidate[] = [
  {
    kind: "heading",
    tag: "h1",
    role: "heading",
    text: "Example Domain",
    accessibleName: "Example Domain"
  },
  {
    kind: "paragraph",
    tag: "p",
    text: "This domain is for use in illustrative examples."
  },
  {
    kind: "link",
    tag: "a",
    role: "link",
    text: "More information...",
    accessibleName: "More information...",
    href: "https://example.com/more"
  },
  {
    kind: "checkbox",
    tag: "input",
    role: "checkbox",
    accessibleName: "Accept terms",
    checked: true
  },
  {
    kind: "select",
    tag: "select",
    role: "combobox",
    accessibleName: "Plan",
    selectedText: "Pro"
  }
];

test("buildSnapshotModel assigns deterministic refs", () => {
  const snapshot = buildSnapshotModel(candidates);

  assert.deepEqual(
    snapshot.items.map((item) => item.ref),
    ["@e1", "@e2", "@e3", "@e4", "@e5"]
  );
  assert.equal(snapshot.items[0]?.text, "Example Domain");
});

test("buildSnapshotModel filters to interactive elements", () => {
  const snapshot = buildSnapshotModel(candidates, { interactive: true });

  assert.deepEqual(
    snapshot.items.map((item) => item.kind),
    ["link", "checkbox", "select"]
  );
});

test("buildSnapshotModel includes flags for control state", () => {
  const snapshot = buildSnapshotModel(candidates, { interactive: true });

  assert.deepEqual(snapshot.items[1]?.flags, ["checked"]);
  assert.deepEqual(snapshot.items[2]?.flags, ["selected=Pro"]);
});
