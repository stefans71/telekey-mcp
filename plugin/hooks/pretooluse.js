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

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engine, DeniedError } from "../../src/engine.js";
import { verifySignature, sign } from "../../src/passport.js";
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

// --- budget persistence -------------------------------------------------
// Claude Code spawns a FRESH process for every tool call, so remaining budget
// has to outlive the process or metering is theatre. State is a small JSON map
// of hashOf(passport) -> remaining budget, mirroring Engine.remaining exactly.
//
// CONCURRENCY: last-write-wins, deliberately, and NOT transactional. Two hook
// processes whose lifetimes overlap can both read the same remaining budget,
// and the later write clobbers the earlier — so a burst of parallel tool calls
// can under-count spend. There is no lock, no compare-and-swap, no atomic
// rename here. A production deployment would put this behind a daemon or a
// file lock. This is stated out loud because an unstated race is worse than a
// known one.
//
// The path is overridable so tests can run hermetically; unset in normal use.
const STATE = process.env.TELEKEY_STATE_PATH || join(__dir, ".passport-state.json");

// Each entry is { remaining, issued, sig }, where sig is an HMAC over
// {passportHash, remaining, issued} under the same PASSPORT_SECRET that signs
// passports. That buys the macaroon "backtracking" property, and the bound is
// worth stating exactly rather than hand-waving:
//
//   Someone who can WRITE this file cannot forge a HIGHER remaining budget,
//   because they cannot produce a valid signature without the secret. What
//   they CAN do is delete the file or an entry, which reseeds that passport
//   from its own signed ceiling — never above it, and only until the TTL
//   would have reset it anyway.
//
// So deletion is the residual vector, and it is BOUNDED, not closed. Closing
// it outright is provably impossible with local state alone: it requires the
// issuer to hold monotonic durable state (arXiv:2608.01710, CapLease). See
// docs/ROADMAP.md — that is the authoritative-mode upgrade, not something a
// state file can fix.
//
// FAIL CLOSED, without exception: an unreadable budget must never mean
// "unlimited". A missing file is the one benign case (first run — nothing has
// been spent yet, and each passport then seeds from its own SIGNED budget).
// Corrupt JSON, a wrong shape, a bad signature, or a failed write all refuse
// the call, because "reset to full" is exactly what an attacker scribbling on
// this file wants.

const ISSUED = new Map(); // passportHash -> wall-clock ms of the FIRST write

function entrySignature(passportHash, remaining, issued) {
  return sign({ passportHash, remaining, issued });
}

function loadState() {
  let raw;
  try {
    raw = readFileSync(STATE, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {}; // first run
    deny(`budget state unreadable (${e.code}) — refusing rather than resetting (fail-closed).`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    deny("budget state is corrupt JSON — refusing rather than resetting the budget (fail-closed).");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    deny("budget state is not an object — refusing rather than resetting the budget (fail-closed).");
  }

  const now = Date.now();
  const live = {};
  for (const [h, entry] of Object.entries(parsed)) {
    const shapeOk =
      entry && typeof entry === "object" && !Array.isArray(entry) &&
      entry.remaining && typeof entry.remaining === "object" && !Array.isArray(entry.remaining) &&
      typeof entry.issued === "number" && typeof entry.sig === "string";
    if (!shapeOk) {
      deny("budget state has a malformed entry — refusing rather than resetting (fail-closed).");
    }
    // Anti-forgery: a raised `remaining` cannot be fabricated without the secret.
    if (entrySignature(h, entry.remaining, entry.issued) !== entry.sig) {
      deny("budget state entry signature invalid — refusing rather than trusting it (fail-closed).");
    }
    // TTL: an expired lease is dropped, so this passport reseeds from its own
    // signed budget — deliberately the same path as a missing file. This is
    // what bounds the delete-reset window: a reseeded budget was about to be
    // reseeded by expiry anyway.
    const ttl = entry.remaining.ttl_seconds;
    if (typeof ttl === "number" && (now - entry.issued) / 1000 > ttl) continue;

    ISSUED.set(h, entry.issued);
    live[h] = entry.remaining;
  }
  return live;
}

// A budget we cannot record is a budget we cannot enforce on the next call, so
// a failed write denies too. The on-disk state is left untouched in that case.
// `issued` is stamped once and carried forward, never refreshed — otherwise the
// TTL window would slide on every call and the lease would never expire.
function saveState() {
  const now = Date.now();
  const out = {};
  for (const [h, remaining] of engine.remaining) {
    const issued = ISSUED.get(h) ?? now;
    out[h] = { remaining, issued, sig: entrySignature(h, remaining, issued) };
  }
  try {
    writeFileSync(STATE, JSON.stringify(out, null, 2));
  } catch (e) {
    deny(`could not persist budget state (${e.code}) — refusing (fail-closed).`);
  }
}

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
// Seed remaining budgets from the previous invocation. Entries for other
// passports in the chain are carried through untouched so they keep metering.
for (const [h, budget] of Object.entries(loadState())) {
  engine.remaining.set(h, { ...budget });
}

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
  saveState(); // before emit() — emit() exits the process
  allow(`policy+passport permit '${cap}' (publisher=${pub}, chain: ${passport.act.join(" → ")}).`);
} catch (e) {
  if (e instanceof DeniedError) {
    deny(`passport does NOT permit '${cap}' (${e.code}). This is enforcement, not a suggestion.`);
  }
  deny(`enforcement error: ${e.message}`);
}
