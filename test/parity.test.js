// Guards the playground's parity vectors against drift.
//
// playground/parity.js is generated from the real Node core and shipped to the
// browser, which re-runs the same sequence and must reproduce it exactly. If
// src/ changes and the committed vectors aren't regenerated, the browser would
// be compared against stale expectations — and would "pass parity" against a
// core that no longer exists. This test makes that impossible to miss.
//
// Regenerate with: node playground/tools/generate-parity.mjs

import { test } from "node:test";
import assert from "node:assert";
import { buildVectors } from "../playground/tools/generate-parity.mjs";
import { PARITY } from "../playground/parity.js";

test("committed parity vectors match the current Node core", () => {
  const fresh = buildVectors();
  assert.deepEqual(
    fresh,
    PARITY,
    "playground/parity.js is stale — re-run: node playground/tools/generate-parity.mjs"
  );
});

test("parity vectors actually cover allow, deny and forgery", () => {
  const ids = PARITY.vectors.map((v) => v.id);
  for (const needed of ["sig.root", "call.delete", "call.injectedEmail", "mint.widerKey"]) {
    assert.ok(ids.includes(needed), `parity vectors must include ${needed}`);
  }
  // A vector set with no denials would let a permissive browser core pass.
  const denials = PARITY.vectors.filter((v) => v.ok === false);
  assert.ok(denials.length >= 3, "vectors must include real throws, not just allows");
  assert.ok(
    denials.some((v) => v.code === "CAP_NOT_GRANTED") &&
      denials.some((v) => v.code === "CAPS_WIDENED"),
    "vectors must pin the two headline error codes"
  );
});
