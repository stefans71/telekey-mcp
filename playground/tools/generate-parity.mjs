// Generates playground/parity.js by running the REAL Node core in src/.
//
// The point of these vectors is that they are produced by executing
// src/passport.js and src/engine.js, not written by hand. The browser core
// re-runs the same sequence and must reproduce every signature and every
// allow/deny decision exactly. If it can't, the page is not the real engine
// and says so instead of rendering.
//
// Regenerate with:  node playground/tools/generate-parity.mjs
// Checked in CI by test/parity.test.js so it cannot silently drift.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mintRoot, attenuate, verifySignature, sign, hashOf } from "../../src/passport.js";
import { Engine } from "../../src/engine.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// Deterministic inputs — no clocks, no randomness, so signatures are stable.
export const ROOT = {
  sub: "user:alice",
  caps: ["listRepo:repoX", "deleteFile:repoX", "sendEmail:you"],
  budget: { ttl_seconds: 120, max_spend: 0.5, max_tool_calls: 40, max_spawns: 2 },
};
export const CHILD = {
  addActor: "agent:cleanup",
  caps: ["listRepo:repoX", "deleteFile:repoX"],
  budget: { max_tool_calls: 5, max_spend: 0.2 },
};

function outcome(fn) {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, code: e.code, name: e.constructor.name };
  }
}

export function buildVectors() {
  const engine = new Engine();
  const p0 = mintRoot(ROOT);
  const p1 = engine.delegate(p0, CHILD);

  const vectors = [];
  const push = (id, note, res) => vectors.push({ id, note, ...res });

  // --- signature vectors: exact hex must match ---
  push("sig.root", "HMAC over the root passport body", { ok: true, value: p0.sig });
  push("sig.child", "HMAC over the delegated child body", { ok: true, value: p1.sig });
  push("hash.root", "hashOf(p0) — the provenance link", { ok: true, value: hashOf(p0) });
  push("sig.fixed", "HMAC over a fixed nested body (canonicalization)", {
    ok: true,
    value: sign({ z: 1, a: { d: 4, c: [3, { b: 2 }] }, m: null }),
  });

  // --- verification vectors ---
  push("verify.root", "an untampered root verifies", { ok: true, value: verifySignature(p0) });
  push("verify.capsTampered", "caps tampering breaks the signature", {
    ok: true,
    value: verifySignature({ ...p0, caps: [...p0.caps, "deleteFile:repoZ"] }),
  });
  push("verify.budgetTampered", "budget tampering breaks the signature (v0.2.0 fix)", {
    ok: true,
    value: verifySignature({ ...p0, budget: { ...p0.budget, max_tool_calls: 999999 } }),
  });

  // --- the confused-deputy sequence from demo.js, in order ---
  push("call.delete", "cleanup deletes a file — inside its key", outcome(() =>
    engine.authorizeCall(p1, "deleteFile:repoX", { spend: 0.02 }).remaining));
  push("call.injectedEmail", "injected sendEmail:attacker — never in the key", outcome(() =>
    engine.authorizeCall(p1, "sendEmail:attacker", { spend: 0.05 })));
  push("mint.widerKey", "injection tries to mint itself a wider key", outcome(() =>
    attenuate(p1, { addActor: "agent:evil", caps: ["sendEmail:attacker"], budget: { max_tool_calls: 1 } })));
  push("mint.widerBudget", "child budget above parent remaining", outcome(() =>
    attenuate(p1, { addActor: "agent:greedy", caps: ["listRepo:repoX"], budget: { max_tool_calls: 99999 } })));
  push("mint.wildcard", "scoped cap promoted to wildcard", outcome(() =>
    attenuate(p1, { addActor: "agent:wild", caps: ["deleteFile:*"], budget: { max_tool_calls: 1 } })));

  return { root: ROOT, child: CHILD, vectors };
}

// Write ONLY when run directly — see the note in build-standalone.mjs. An
// import that rewrites parity.js would mask exactly the drift the test hunts.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
const data = buildVectors();
const body =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Produced by playground/tools/generate-parity.mjs from the real Node core\n" +
  "// in src/passport.js + src/engine.js. Verified in CI by test/parity.test.js.\n" +
  "export const PARITY = " + JSON.stringify(data, null, 2) + ";\n";
writeFileSync(join(__dir, "..", "parity.js"), body);
console.log(`wrote playground/parity.js — ${data.vectors.length} vectors`);
for (const v of data.vectors) {
  console.log(`  ${v.id.padEnd(22)} ${v.ok ? "ok=" + JSON.stringify(v.value).slice(0, 46) : "throw " + v.code}`);
}
}
