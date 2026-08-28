// Conformance fixtures for the Capability Passport extension.
// Each test maps to a documented 2026 agent-security failure mode and asserts
// the passport rule turns it from "emergent risk" into "unrepresentable".
//
//   npm test
//
// These are the reusable fixtures the proposal calls for: an over-broad child
// MUST fail verification; a metered budget MUST refuse at zero; provenance MUST
// be single-artifact. When the open spec ships its conformance server, these
// same assertions can be pointed at it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mintRoot, attenuate, PassportError, verifySignature } from "../src/passport.js";
import { Engine, DeniedError } from "../src/engine.js";

function rootP() {
  return mintRoot({
    sub: "user:alice",
    caps: ["listRepo:repoX", "deleteFile:repoX", "sendEmail:you"],
    budget: { ttl_seconds: 120, max_spend: 0.5, max_tool_calls: 40, max_spawns: 2 },
  });
}

// --- FIXTURE 1: over-broad delegation (confused deputy / privilege escalation)
test("child cannot widen caps beyond parent (CAPS_WIDENED)", () => {
  const p0 = rootP();
  assert.throws(
    () =>
      attenuate(p0, {
        addActor: "agent:cleanup",
        caps: ["deleteFile:repoZ"], // repoZ was never granted
        budget: { max_tool_calls: 10 },
      }),
    (e) => e instanceof PassportError && e.code === "CAPS_WIDENED"
  );
});

// --- FIXTURE 2: scoped parent cannot be broadened to a wildcard
test("child cannot promote a scoped cap to wildcard", () => {
  const p0 = rootP();
  assert.throws(
    () => attenuate(p0, { addActor: "a", caps: ["deleteFile:*"], budget: { max_tool_calls: 1 } }),
    (e) => e.code === "CAPS_WIDENED"
  );
});

// --- FIXTURE 3: legal narrowing succeeds and drops unneeded caps
test("child may narrow: cleanup helper loses sendEmail", () => {
  const p0 = rootP();
  const p1 = attenuate(p0, {
    addActor: "agent:cleanup",
    caps: ["listRepo:repoX", "deleteFile:repoX"], // sendEmail intentionally dropped
    budget: { ttl_seconds: 60, max_spend: 0.2, max_tool_calls: 20, max_spawns: 0 },
  });
  assert.ok(verifySignature(p1));
  assert.deepEqual(p1.act, ["user:alice", "agent:cleanup"]);
  assert.equal(p1.sub, "user:alice"); // sub immutable
  assert.ok(!p1.caps.includes("sendEmail:you"));
});

// --- FIXTURE 4: budget cannot be widened
test("child budget cannot exceed parent (BUDGET_WIDENED)", () => {
  const p0 = rootP();
  assert.throws(
    () => attenuate(p0, { addActor: "a", caps: ["listRepo:repoX"], budget: { max_tool_calls: 999 } }),
    (e) => e.code === "BUDGET_WIDENED"
  );
});

// --- FIXTURE 5: engine denies an ungranted call (missing per-action authz)
test("engine denies a capability not in the passport", () => {
  const eng = new Engine();
  const p1 = attenuate(rootP(), {
    addActor: "agent:cleanup",
    caps: ["deleteFile:repoX"],
    budget: { max_tool_calls: 5, max_spend: 0.5 },
  });
  assert.throws(
    () => eng.authorizeCall(p1, "sendEmail:you"), // helper never had email
    (e) => e instanceof DeniedError && e.code === "CAP_NOT_GRANTED"
  );
});

// --- FIXTURE 6: metered budget refuses at zero (runaway fan-out / cost)
test("engine refuses once tool-call budget is exhausted", () => {
  const eng = new Engine();
  const p1 = attenuate(rootP(), {
    addActor: "agent:cleanup",
    caps: ["deleteFile:repoX"],
    budget: { max_tool_calls: 2, max_spend: 0.5 },
  });
  eng.authorizeCall(p1, "deleteFile:repoX", { spend: 0.02 });
  eng.authorizeCall(p1, "deleteFile:repoX", { spend: 0.02 });
  assert.throws(
    () => eng.authorizeCall(p1, "deleteFile:repoX", { spend: 0.02 }),
    (e) => e.code === "BUDGET_CALLS"
  );
});

// --- FIXTURE 7: spawn budget caps sub-agent fan-out
test("engine refuses delegation past spawn budget", () => {
  const eng = new Engine();
  const p0 = rootP(); // max_spawns: 2
  const mk = (n) => ({ addActor: "a" + n, caps: ["listRepo:repoX"], budget: { max_tool_calls: 1 } });
  eng.delegate(p0, mk(1));
  eng.delegate(p0, mk(2));
  assert.throws(() => eng.delegate(p0, mk(3)), (e) => e.code === "BUDGET_SPAWNS");
});

// --- FIXTURE 8: tampered passport fails signature (forgery / replay)
test("tampering with caps invalidates the signature", () => {
  const eng = new Engine();
  const p0 = rootP();
  const forged = { ...p0, caps: [...p0.caps, "deleteFile:repoZ"] };
  assert.equal(verifySignature(forged), false);
  assert.throws(() => eng.authorizeCall(forged, "deleteFile:repoZ"), (e) => e.code === "SIG_INVALID");
});

// --- FIXTURE 9: single-artifact provenance chain
test("provenance is verifiable from one artifact (sub + act chain + parent hash)", () => {
  const p0 = rootP();
  const p1 = attenuate(p0, { addActor: "agent:orch", caps: ["deleteFile:repoX"], budget: { max_tool_calls: 5 } });
  const p2 = attenuate(p1, { addActor: "agent:cleanup", caps: ["deleteFile:repoX"], budget: { max_tool_calls: 3 } });
  assert.deepEqual(p2.act, ["user:alice", "agent:orch", "agent:cleanup"]);
  assert.equal(p2.sub, "user:alice");
  assert.ok(p2.parent, "child links to parent hash");
});
