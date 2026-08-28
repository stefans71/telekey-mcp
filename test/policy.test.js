// Policy-layer fixtures. The critical assertions: a "verified" publisher gets
// LIGHTER PROMPTS and a fuller default budget, but NEVER a lifted ceiling and
// NEVER a silent grant of a dangerous capability. Identity ≠ trust.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, resolve, DEFAULT_POLICY, HARD_CEILING } from "../src/policy.js";
import { publisherStatusOffline } from "../src/publisher.js";

const policy = loadPolicy("/nonexistent-uses-defaults.json");

test("verified publisher gets lighter prompt friction, not more power", () => {
  const v = resolve(policy, "listRepo:repoX", "verified");
  const u = resolve(policy, "listRepo:repoX", "unverified");
  assert.equal(v.prompt, "light");
  assert.equal(u.prompt, "full");
  // both are allowed (listRepo is a safe default), but the verified one isn't
  // granted anything the unverified one is structurally denied.
  assert.equal(v.decision, "allow");
  assert.equal(u.decision, "allow");
});

test("verified publisher does NOT get a dangerous cap auto-allowed", () => {
  // Even if some policy said allow, deleteFile is on never_auto_allow, so a
  // verified publisher still lands on "ask" unless the USER explicitly allowed it.
  const r = resolve(policy, "deleteFile:repoX", "verified");
  assert.notEqual(r.decision, "allow");
});

test("sendEmail stays denied regardless of publisher status", () => {
  assert.equal(resolve(policy, "sendEmail:you", "verified").decision, "deny");
  assert.equal(resolve(policy, "sendEmail:you", "unverified").decision, "deny");
});

test("no publisher status can exceed the hard budget ceiling", () => {
  // craft a user policy asking for absurd budget
  const greedy = {
    defaults: {
      decision: "allow",
      budget: { ttl_seconds: 999999999, max_spend: 999999, max_tool_calls: 999999, max_spawns: 9999 },
    },
    capabilities: { "listRepo:*": "allow" },
  };
  // merge greedy over defaults
  const p = { ...policy, defaults: greedy.defaults, capabilities: { ...policy.capabilities, ...greedy.capabilities } };
  const r = resolve(p, "listRepo:repoX", "verified");
  assert.ok(r.budget.max_spend <= HARD_CEILING.budget.max_spend);
  assert.ok(r.budget.ttl_seconds <= HARD_CEILING.budget.ttl_seconds);
  assert.ok(r.budget.max_tool_calls <= HARD_CEILING.budget.max_tool_calls);
});

test("unverified publisher gets a reduced default budget (friction via scale)", () => {
  const v = resolve(policy, "listRepo:repoX", "verified");
  const u = resolve(policy, "listRepo:repoX", "unverified");
  assert.ok(u.budget.max_tool_calls < v.budget.max_tool_calls);
});

test("user can explicitly allow a dangerous cap (informed opt-in), overriding the backstop", () => {
  const p = { ...policy, capabilities: { ...policy.capabilities, "deleteFile:repoX": "allow" } };
  const r = resolve(p, "deleteFile:repoX", "verified");
  // exact-match user allow is honored — the backstop only blocks *silent* allows
  assert.equal(r.decision, "allow");
});

test("publisher identity lookup fails safe to unverified", () => {
  assert.equal(publisherStatusOffline("com.google/maps", []).status, "unverified");
  assert.equal(publisherStatusOffline("com.google/maps", ["com.google/maps"]).status, "verified");
});
