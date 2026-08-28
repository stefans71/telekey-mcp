// Policy layer — the user-adjustable settings the hook consults.
//
// Design principle, aligned with the MCP Registry's own stance:
//   "Registry verification establishes provenance. It does NOT establish trust.
//    A legitimate publisher can release vulnerable code."
//
// Therefore publisher identity adjusts FRICTION and DEFAULTS only. It never
// removes the ceiling and never auto-grants "wide open". Every resolved policy
// is still bounded by hard caps that no publisher status can lift.

import { readFileSync } from "node:fs";

// ---- hard ceilings: no publisher, verified or not, may exceed these -------
// These are the backstop. Templates and user settings can only go NARROWER.
export const HARD_CEILING = {
  budget: {
    ttl_seconds: 86_400,      // 24h max lifetime, period
    max_spend: 25.0,          // $25 absolute cap
    max_tool_calls: 5_000,
    max_spawns: 50,
  },
  // capabilities that are NEVER auto-allowed by any template, only by explicit
  // user opt-in per call ("ask") or explicit allow. Add to taste.
  never_auto_allow: ["deleteFile:*", "sendEmail:*", "exec:*", "writeFile:*"],
};

// ---- default policy shipped with the plugin --------------------------------
// "ask" = prompt each time · "allow" = permit silently · "deny" = block
export const DEFAULT_POLICY = {
  defaults: {
    decision: "ask",
    budget: { ttl_seconds: 3600, max_spend: 0.5, max_tool_calls: 100, max_spawns: 2 },
  },
  capabilities: {
    "listRepo:*": "allow",
    "readFile:*": "allow",
    "deleteFile:*": "ask",
    "writeFile:*": "ask",
    "sendEmail:*": "deny",
    "exec:*": "ask",
  },
  // Publisher status affects PROMPT FRICTION and starting budget — never ceiling.
  publishers: {
    verified: { prompt: "light", budgetScale: 1.0 },   // verified in MCP registry
    unverified: { prompt: "full", budgetScale: 0.25 }, // unknown / unverified
  },
};

// clamp a budget so no field exceeds the hard ceiling
function clampBudget(budget) {
  const out = {};
  for (const [k, v] of Object.entries(budget)) {
    const cap = HARD_CEILING.budget[k];
    out[k] = cap === undefined ? v : Math.min(v, cap);
  }
  return out;
}

export function loadPolicy(path) {
  let user = {};
  try {
    user = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // no user policy → defaults only
  }
  return {
    defaults: { ...DEFAULT_POLICY.defaults, ...(user.defaults || {}) },
    capabilities: { ...DEFAULT_POLICY.capabilities, ...(user.capabilities || {}) },
    publishers: { ...DEFAULT_POLICY.publishers, ...(user.publishers || {}) },
  };
}

// Resolve the decision + effective budget for a capability, given publisher status.
// Returns { decision: "allow"|"ask"|"deny", budget, reason }.
export function resolve(policy, cap, publisherStatus = "unverified") {
  // exact match wins, else wildcard on the op, else default
  const [op] = cap.split(":");
  const decision =
    policy.capabilities[cap] ??
    policy.capabilities[`${op}:*`] ??
    policy.defaults.decision;

  const pub = policy.publishers[publisherStatus] ?? policy.publishers.unverified;

  // budget = default budget scaled by publisher factor, then clamped to ceiling
  const scaled = {};
  for (const [k, v] of Object.entries(policy.defaults.budget)) {
    scaled[k] = Math.floor(v * (pub.budgetScale ?? 1) * 100) / 100;
  }
  const budget = clampBudget(scaled);

  // Safety backstop: a capability on the never-auto-allow list can't be silently
  // allowed by publisher status alone — it's downgraded to "ask" unless the USER
  // explicitly set "allow" for that exact capability in their own policy.
  const userExplicitAllow = policy.capabilities[cap] === "allow";
  let finalDecision = decision;
  if (
    decision === "allow" &&
    !userExplicitAllow &&
    HARD_CEILING.never_auto_allow.some((p) => p === cap || p === `${op}:*`)
  ) {
    finalDecision = "ask";
  }

  return {
    decision: finalDecision,
    budget,
    prompt: pub.prompt,
    reason:
      `cap='${cap}' publisher='${publisherStatus}' → ${finalDecision}` +
      (finalDecision !== decision ? ` (downgraded from '${decision}' by never-auto-allow backstop)` : ""),
  };
}
