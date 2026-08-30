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
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintRoot } from "../src/passport.js";

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
  assert.equal(entries[0].max_tool_calls, 4, "5 − 1 call = 4 remaining, on disk");

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
