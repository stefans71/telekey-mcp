#!/usr/bin/env node
// Claude Code PreToolUse hook — the enforcement point.
//
// Claude Code invokes this before every tool call, passing a JSON event on
// stdin. We map the tool call to a requested capability, check it against the
// active passport via the same engine the MCP server uses, and emit a verdict.
//
// Hook contract (Claude Code):
//   stdin  : { "tool_name": "...", "tool_input": { ... }, ... }
//   stdout : { "hookSpecificOutput": { "hookEventName": "PreToolUse",
//              "permissionDecision": "allow" | "deny" | "ask",
//              "permissionDecisionReason": "..." } }
//   exit 0 always (the JSON carries the decision).
//
// The same contract's event names (PreToolUse) are shared by Codex and by
// DeepSeek's compatibility bridge, so this file is the basis for all three.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engine, DeniedError } from "../../src/engine.js";
import { verifySignature } from "../../src/passport.js";
import { loadPolicy, resolve } from "../../src/policy.js";
import { publisherStatusOffline } from "../../src/publisher.js";

const __dir = dirname(fileURLToPath(import.meta.url));

// User-adjustable settings. Absent file → safe defaults (see src/policy.js).
const policy = loadPolicy(join(__dir, "..", "..", "passport-policy.json"));
// Names the operator pinned as registry-verified at install time (offline set).
let VERIFIED_NAMES = [];
try {
  VERIFIED_NAMES = JSON.parse(readFileSync(join(__dir, "verified-publishers.json"), "utf8"));
} catch { /* none pinned */ }

// One engine instance persisted across the session via a tiny state file, so
// budgets actually decrement between calls. (A daemon or socket would be the
// production choice; a state file keeps the demo dependency-free.)
const STATE = join(__dir, ".passport-state.json");

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, "utf8")); // fd 0 = stdin
  } catch {
    return {};
  }
}

// Map a Claude Code tool call to a capability string "op:resource".
// This mapping is the policy surface an operator would configure; the defaults
// below are illustrative for the repo/email demo tools.
function capabilityFor(toolName, input = {}) {
  switch (toolName) {
    case "delete_file":
      return `deleteFile:${input.repo ?? "*"}`;
    case "list_repo":
      return `listRepo:${input.repo ?? "*"}`;
    case "send_email":
      return `sendEmail:${input.to ?? "*"}`;
    // Real deployments would map Bash/Write/Edit/WebFetch etc. here.
    default:
      return `tool:${toolName}`;
  }
}

function allow(reason) {
  return emit("allow", reason);
}
function deny(reason) {
  return emit("deny", reason);
}
function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

const event = readEvent();
const toolName = event.tool_name ?? event.toolName ?? "unknown";
const input = event.tool_input ?? event.toolInput ?? {};

// The passport arrives with the call (agents attach it as a tool_input field),
// or falls back to a session passport an operator provisioned out of band.
const passport =
  input.passport ??
  (() => {
    try {
      return JSON.parse(readFileSync(join(__dir, "session-passport.json"), "utf8"));
    } catch {
      return null;
    }
  })();

// Fail-closed on a security boundary: no passport, no action.
if (!passport) {
  deny("no capability passport present on this call — blocked (fail-closed).");
}
if (!verifySignature(passport)) {
  deny("passport signature invalid — possible tampering.");
}

const engine = new Engine();
// (Budgets reset per hook process here for demo simplicity; see STATE note above
//  for how a persistent engine would carry them across calls.)

const cap = capabilityFor(toolName, input);

// --- LAYER 1: user policy + publisher friction --------------------------
// Publisher status is IDENTITY ONLY and adjusts prompt/budget, never ceiling.
const server = input.__server ?? event.server_name ?? null;
const pub = publisherStatusOffline(server, VERIFIED_NAMES).status;
const decision = resolve(policy, cap, pub);

if (decision.decision === "deny") {
  deny(`policy denies '${cap}' [${decision.reason}].`);
}
if (decision.decision === "ask") {
  // Surface to the user for an explicit choice rather than silently allowing.
  emit("ask", `policy requires confirmation for '${cap}' [${decision.reason}].`);
}
// decision === "allow" → fall through to passport enforcement (LAYER 2)

// --- LAYER 2: passport enforcement (the narrowing invariant) ------------
try {
  engine.authorizeCall(passport, cap, { spend: 0 });
  allow(`policy+passport permit '${cap}' (publisher=${pub}, chain: ${passport.act.join(" → ")}).`);
} catch (e) {
  if (e instanceof DeniedError) {
    deny(`passport does NOT permit '${cap}' (${e.code}). This is enforcement, not a suggestion.`);
  }
  deny(`enforcement error: ${e.message}`);
}
