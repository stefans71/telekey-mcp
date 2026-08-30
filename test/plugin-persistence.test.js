// Plugin-path budget metering — the fixture that proves the PreToolUse hook
// carries remaining budget BETWEEN invocations.
//
// These tests deliberately spawn the real hook as a separate OS process, via
// child_process, rather than importing it or driving the Engine in-process.
// That is the whole point: a single in-memory Engine meters correctly even when
// persistence is completely broken, so an in-process test would have passed
// while the plugin path reset every agent's budget to full on every call. If
// these ever get "simplified" into in-process calls, they stop testing anything.
//
// Vehicle is list_repo: policy resolves listRepo:* to "allow" and it is not on
// the never-auto-allow list, so LAYER 1 passes it through and LAYER 2 (passport
// caps + budget) is what actually decides. That isolates metering.

import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintRoot, sign, hashOf } from "../src/passport.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dir, "..", "plugin", "hooks", "pretooluse.js");

// Each test gets its own state file so the suite stays hermetic and can't
// clobber a developer's real .passport-state.json.
function tmpState() {
  return join(mkdtempSync(join(tmpdir(), "telekey-state-")), "state.json");
}

// Spawn the hook exactly as Claude Code would: JSON event on stdin, JSON
// verdict on stdout, exit 0 regardless of the decision.
function runHook(statePath, passport, { tool = "list_repo", input = { repo: "repoX" } } = {}) {
  const event = JSON.stringify({ tool_name: tool, tool_input: { ...input, passport } });
  const r = spawnSync(process.execPath, [HOOK], {
    input: event,
    encoding: "utf8",
    env: { ...process.env, TELEKEY_STATE_PATH: statePath },
  });
  assert.equal(r.status, 0, `hook exited ${r.status}; stderr: ${r.stderr}`);
  assert.ok(r.stdout, `hook produced no stdout; stderr: ${r.stderr}`);
  return JSON.parse(r.stdout).hookSpecificOutput;
}

const passportWith = (budget) =>
  mintRoot({ sub: "user:alice", caps: ["listRepo:repoX"], budget });

test("plugin path: remaining budget survives across separate hook processes", () => {
  const state = tmpState();
  const p = passportWith({ max_tool_calls: 2 });

  assert.equal(runHook(state, p).permissionDecision, "allow", "1st call: budget 2 → allowed");
  assert.equal(runHook(state, p).permissionDecision, "allow", "2nd call: budget 1 → allowed");

  // With a fresh Engine per process (the bug this fixture exists to catch),
  // this third call would ALSO be allowed, because budget would have reset.
  const third = runHook(state, p);
  assert.equal(third.permissionDecision, "deny", "3rd call must be denied: budget exhausted");
  assert.match(third.permissionDecisionReason, /BUDGET_CALLS/);

  rmSync(dirname(state), { recursive: true, force: true });
});

test("plugin path: the state file records the decremented budget", () => {
  const state = tmpState();
  const p = passportWith({ max_tool_calls: 5 });

  runHook(state, p);
  assert.ok(existsSync(state), "hook must write the state file after allowing a call");

  const entries = Object.values(JSON.parse(readFileSync(state, "utf8")));
  assert.equal(entries.length, 1, "one passport seen → one state entry");
  assert.equal(entries[0].remaining.max_tool_calls, 4, "5 − 1 call = 4 remaining, on disk");
  assert.equal(typeof entries[0].issued, "number", "entry is stamped with an issue time");
  assert.equal(typeof entries[0].sig, "string", "entry is signed");

  rmSync(dirname(state), { recursive: true, force: true });
});

test("plugin path: corrupt budget state fails closed, never resets to full", () => {
  const state = tmpState();
  writeFileSync(state, "{ this is not json");

  // Budget is plentiful — the ONLY reason to deny is the unreadable state.
  const r = runHook(state, passportWith({ max_tool_calls: 100 }));
  assert.equal(r.permissionDecision, "deny", "unreadable budget must never mean unlimited");
  assert.match(r.permissionDecisionReason, /fail-closed/);

  rmSync(dirname(state), { recursive: true, force: true });
});

test("plugin path: wrongly-shaped budget state fails closed", () => {
  for (const bad of ['["not","an","object"]', '{"somehash":"not-a-budget"}', "null"]) {
    const state = tmpState();
    writeFileSync(state, bad);
    const r = runHook(state, passportWith({ max_tool_calls: 100 }));
    assert.equal(r.permissionDecision, "deny", `state ${bad} must fail closed`);
    assert.match(r.permissionDecisionReason, /fail-closed/);
    rmSync(dirname(state), { recursive: true, force: true });
  }
});

test("plugin path: a missing state file is first-run, not a failure", () => {
  const state = tmpState(); // directory exists, file does not
  assert.ok(!existsSync(state));

  const r = runHook(state, passportWith({ max_tool_calls: 1 }));
  assert.equal(r.permissionDecision, "allow", "first run seeds from the signed budget");

  rmSync(dirname(state), { recursive: true, force: true });
});

// --- TTL + entry-signature guards ---------------------------------------
// These bound the delete-reset asymmetry: a file-editor can DELETE state (which
// reseeds from the passport's own signed ceiling, never above it) but cannot
// FORGE a higher remaining budget. Closing deletion entirely is provably
// impossible with local state alone — it needs issuer-held monotonic durable
// state (arXiv:2608.01710). These fixtures prove the bound, not a cure.

// Write a state entry the way the hook would, so we can age or tamper with it.
function writeEntry(statePath, passport, remaining, issuedMs) {
  const h = hashOf(passport);
  const sig = sign({ passportHash: h, remaining, issued: issuedMs });
  writeFileSync(statePath, JSON.stringify({ [h]: { remaining, issued: issuedMs, sig } }, null, 2));
  return h;
}

test("plugin path: an expired entry reseeds instead of carrying stale budget", () => {
  const state = tmpState();
  const p = mintRoot({ sub: "user:alice", caps: ["listRepo:repoX"],
                       budget: { max_tool_calls: 1, ttl_seconds: 60 } });

  // A validly-signed but EXHAUSTED entry, issued two minutes ago against a 60s TTL.
  writeEntry(state, p, { max_tool_calls: 0, ttl_seconds: 60 }, Date.now() - 120_000);

  // Without TTL enforcement the hook would load max_tool_calls:0 and deny.
  const r = runHook(state, p);
  assert.equal(r.permissionDecision, "allow", "expired lease must reseed from the signed budget");

  rmSync(dirname(state), { recursive: true, force: true });
});

test("plugin path: a forged entry claiming more budget is denied", () => {
  const p = mintRoot({ sub: "user:alice", caps: ["listRepo:repoX"],
                       budget: { max_tool_calls: 1 } });

  // (i) raise `remaining` but keep the old signature
  const s1 = tmpState();
  writeEntry(s1, p, { max_tool_calls: 0 }, Date.now());
  const raw = JSON.parse(readFileSync(s1, "utf8"));
  const h = Object.keys(raw)[0];
  raw[h].remaining.max_tool_calls = 500; // sig no longer matches
  writeFileSync(s1, JSON.stringify(raw));
  let r = runHook(s1, p);
  assert.equal(r.permissionDecision, "deny", "inflated remaining with a stale sig must be denied");
  assert.match(r.permissionDecisionReason, /signature invalid|fail-closed/);
  rmSync(dirname(s1), { recursive: true, force: true });

  // (ii) re-sign the inflated entry under a DIFFERENT secret
  const s2 = tmpState();
  const remaining = { max_tool_calls: 500 };
  const issued = Date.now();
  const forged = { remaining, issued,
    sig: createHmac("sha256", "attacker-secret")
           .update(JSON.stringify({ issued, passportHash: hashOf(p), remaining }))
           .digest("hex") };
  writeFileSync(s2, JSON.stringify({ [hashOf(p)]: forged }));
  r = runHook(s2, p);
  assert.equal(r.permissionDecision, "deny", "re-signing without the secret must not work");
  rmSync(dirname(s2), { recursive: true, force: true });
});

test("plugin path: delete-and-reseed never exceeds the signed ceiling", () => {
  const state = tmpState();
  const p = mintRoot({ sub: "user:alice", caps: ["listRepo:repoX"],
                       budget: { max_tool_calls: 2 } });

  assert.equal(runHook(state, p).permissionDecision, "allow");
  assert.equal(runHook(state, p).permissionDecision, "allow");
  assert.equal(runHook(state, p).permissionDecision, "deny", "budget of 2 is spent");

  rmSync(state, { force: true }); // the residual attack: delete the state file

  // Reseeding is allowed — but to the SIGNED ceiling of 2, never higher.
  assert.equal(runHook(state, p).permissionDecision, "allow", "reseed call 1");
  assert.equal(runHook(state, p).permissionDecision, "allow", "reseed call 2");
  assert.equal(runHook(state, p).permissionDecision, "deny",
    "reseed must stop at the signed ceiling, not grant more");

  rmSync(dirname(state), { recursive: true, force: true });
});
