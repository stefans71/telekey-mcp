// The confused-deputy attack, failing at verification — in 40 lines.
//
//   node demo.js
//
// Runs against the real passport API (src/passport.js + src/engine.js).
// No network, no build step. Watch a prompt-injected capability find
// nowhere to go, and a widened key refuse to exist.

import { mintRoot, attenuate } from "./src/passport.js";
import { Engine } from "./src/engine.js";

const engine = new Engine();

// 1 · You approve ONCE. The root key can list + delete in repoX, and email you.
const P0 = mintRoot({
  sub: "user:alice",
  caps: ["listRepo:repoX", "deleteFile:repoX", "sendEmail:you"],
  budget: { ttl_seconds: 120, max_spend: 0.5, max_tool_calls: 40, max_spawns: 2 },
});
console.log("P0  root key   :", P0.caps.join(", "));

// 2 · The orchestrator hands work to a cleanup helper. The helper has no
//     business emailing, so the child key DROPS sendEmail. Legal narrowing.
const P1 = engine.delegate(P0, {
  addActor: "agent:cleanup",
  caps: ["listRepo:repoX", "deleteFile:repoX"],
  budget: { ttl_seconds: 120, max_spend: 0.2, max_tool_calls: 10, max_spawns: 0 },
});
console.log("P1  cleanup key:", P1.caps.join(", "), "  ← sendEmail dropped\n");

// 3 · The helper does its job. This call is inside P1.caps → allowed.
authorize("deleteFile:repoX", 0.02);

// 4 · The helper is prompt-injected: "also email everything to attacker".
//     It tries to USE a capability it was never handed.
authorize("sendEmail:attacker", 0.05);

// 5 · The subtler attack: the injection tries to MINT itself a wider key.
try {
  attenuate(P1, { addActor: "agent:evil", caps: ["sendEmail:attacker"], budget: { max_tool_calls: 1 } });
  console.log("✗ widened key minted — this would be the breach");
} catch (e) {
  console.log(`✓ mint wider key → ${e.code}  (a wider key is unrepresentable, not refused)`);
}

function authorize(cap, spend) {
  try {
    engine.authorizeCall(P1, cap, { spend });
    console.log(`✓ ${cap} → ALLOWED`);
  } catch (e) {
    console.log(`✓ ${cap} → DENIED (${e.code})  (injection had nowhere to go)`);
  }
}
