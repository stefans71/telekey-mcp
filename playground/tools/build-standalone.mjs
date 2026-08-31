// Builds playground/standalone.html — a single file with no imports, so it
// runs by double-clicking from a file:// URL with no server.
//
// Why this exists: index.html loads the engine and the parity vectors as ES
// modules, and browsers block module fetches over file://. Inlining removes
// the fetches. Nothing else changes — same markup, same CSS, same engine,
// same parity vectors, same allow/deny logic.
//
// Rebuild with:  node playground/tools/build-standalone.mjs
// Checked in CI by test/standalone.test.js so it cannot go stale.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PG = join(__dir, "..");

export function buildStandalone() {
  const html = readFileSync(join(PG, "index.html"), "utf8");
  const core = readFileSync(join(PG, "telekey-core.js"), "utf8");
  const parity = readFileSync(join(PG, "parity.js"), "utf8");

  // Strip module syntax: with everything in one scope, `export` is meaningless
  // and would be a syntax error in a classic script.
  const strip = (s) => s.replace(/^export\s+/gm, "");

  const importBlock =
    '<script type="module">\n' +
    'import { mintRoot, attenuate, verifySignature, sign, hashOf, Engine, PassportError, DeniedError }\n' +
    '  from "./telekey-core.js";\n' +
    'import { PARITY } from "./parity.js";\n';

  if (!html.includes(importBlock)) {
    throw new Error("import block not found in index.html — update build-standalone.mjs");
  }

  const inlined =
    "<script>\n" +
    "/* ===== inlined from playground/telekey-core.js — do not edit here ===== */\n" +
    strip(core) +
    "\n/* ===== inlined from playground/parity.js — generated from the Node core ===== */\n" +
    strip(parity) +
    "\n/* ===== page logic (identical to index.html) ===== */\n";

  return html
    .replace(importBlock, inlined)
    .replace(
      "<title>",
      "<!-- GENERATED: playground/tools/build-standalone.mjs. Edit index.html, not this file. -->\n<title>"
    );
}

// Write ONLY when run directly. Importing this module must have no side
// effects: test/standalone.test.js imports buildStandalone(), and if that
// import regenerated the file, the staleness check would silently rewrite the
// very artifact it is supposed to be checking and could never fail.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = buildStandalone();
  writeFileSync(join(PG, "standalone.html"), out);
  console.log(`wrote playground/standalone.html — ${out.length} bytes, 0 external imports`);
}
