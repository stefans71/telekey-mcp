// Keeps playground/standalone.html in sync with its sources.
//
// standalone.html is the double-clickable, no-server build. It inlines the
// engine and the parity vectors, which means a stale copy would ship an OLD
// engine while still displaying a green parity badge — the badge would be
// comparing stale vectors against a stale core and agreeing with itself.
// That is exactly the class of silently-wrong artifact this repo keeps
// hunting, so it is pinned here.
//
// Rebuild with: node playground/tools/build-standalone.mjs

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildStandalone } from "../playground/tools/build-standalone.mjs";

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "playground");

test("standalone.html matches a fresh build of its sources", () => {
  const onDisk = readFileSync(join(PG, "standalone.html"), "utf8");
  assert.equal(
    onDisk,
    buildStandalone(),
    "playground/standalone.html is stale — re-run: node playground/tools/build-standalone.mjs"
  );
});

test("standalone.html has no external fetches (it must work from file://)", () => {
  const html = readFileSync(join(PG, "standalone.html"), "utf8");
  assert.ok(!/from\s+"\.\//.test(html), "no relative ES imports may remain");
  assert.ok(!/type="module"/.test(html), "must be a classic script, not a module");
  assert.ok(!/<script[^>]+\bsrc=/.test(html), "must not load any external script");
  // The engine really is in there, not a trimmed-down copy.
  assert.ok(html.includes("function capsSubset"), "engine must be inlined");
  assert.ok(html.includes("CAPS_WIDENED"), "attenuation guard must be inlined");
  assert.ok(html.includes("const PARITY"), "parity vectors must be inlined");
});
