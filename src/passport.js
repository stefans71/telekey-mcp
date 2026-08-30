// Capability Passport — reference implementation of the normative rule:
//   A child passport is valid ONLY if caps ⊆ parent.caps
//   and every budget counter ≤ the parent's remaining budget.
//
// Signing here uses HMAC-SHA256 for a self-contained demo. In a real
// deployment these are signed JWTs (RFC 9068) with asymmetric keys; the
// verification LOGIC below is what the spec would standardize, not the crypto.

import crypto from "node:crypto";

const SECRET = process.env.PASSPORT_SECRET || "dev-only-secret-not-for-production";

// ---- capability model -------------------------------------------------
// A capability is a string "op:resource" or "op:*" (wildcard resource).
// caps ⊆ parent means: every child cap is COVERED by some parent cap.
// A parent "deleteFile:*" covers child "deleteFile:repoX"; the reverse is
// NOT true (a child may never broaden a scoped parent to a wildcard).

function capCovers(parentCap, childCap) {
  if (parentCap === childCap) return true;
  const [pOp, pRes] = parentCap.split(":");
  const [cOp, cRes] = childCap.split(":");
  if (pOp !== cOp) return false;
  if (pRes === "*") return true;      // parent wildcard covers any child resource
  return pRes === cRes;               // otherwise resources must match exactly
}

export function capsSubset(childCaps, parentCaps) {
  return childCaps.every((c) => parentCaps.some((p) => capCovers(p, c)));
}

// ---- budget model -----------------------------------------------------
// Every counter in the child must be <= the parent's REMAINING budget.
export function budgetWithinParent(childBudget, parentBudget) {
  return Object.entries(childBudget).every(
    ([k, v]) => typeof parentBudget[k] === "number" && v <= parentBudget[k]
  );
}

// ---- signing ----------------------------------------------------------
// Deterministic serialization for signing: keys sorted at EVERY level.
//
// This is recursive for a reason. The obvious one-liner —
//   JSON.stringify(body, Object.keys(body).sort())
// — passes an ARRAY replacer, which JSON.stringify applies as a key filter at
// every nesting level, not just the top. Nested objects whose keys aren't in
// that top-level list serialize as {}. That silently dropped `budget` from the
// signed payload, so a passport's budget could be inflated without breaking
// its signature. Covered now by the budget-tampering fixture in
// test/conformance.test.js.
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

export function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(canonical(body)).digest("hex");
}

export function hashOf(passport) {
  return crypto.createHash("sha256").update(JSON.stringify(passport)).digest("hex").slice(0, 16);
}

// ---- mint root --------------------------------------------------------
export function mintRoot({ sub, caps, budget }) {
  const body = { sub, act: [sub], caps, budget, parent: null };
  return { ...body, sig: sign(body) };
}

// ---- verify a single passport's own signature -------------------------
export function verifySignature(p) {
  const { sig, ...body } = p;
  return sign(body) === sig;
}

// ---- attenuate: mint a child (THIS is the load-bearing operation) -----
// Throws if the requested child would widen caps or budget. There is no
// code path that produces a valid widened passport — widening is
// unrepresentable, not merely refused by policy.
export function attenuate(parent, { addActor, caps, budget }) {
  if (!verifySignature(parent)) {
    throw new PassportError("PARENT_SIG_INVALID", "parent passport signature invalid");
  }
  if (!capsSubset(caps, parent.caps)) {
    const offending = caps.filter((c) => !parent.caps.some((p) => capCovers(p, c)));
    throw new PassportError(
      "CAPS_WIDENED",
      `child caps not a subset of parent; offending: ${offending.join(", ")}`
    );
  }
  if (!budgetWithinParent(budget, parent.budget)) {
    throw new PassportError("BUDGET_WIDENED", "child budget exceeds parent remaining budget");
  }
  const body = {
    sub: parent.sub,                       // sub NEVER changes down the chain
    act: [...parent.act, addActor],        // append-only actor chain
    caps,
    budget,
    parent: hashOf(parent),                // single-artifact provenance link
  };
  return { ...body, sig: sign(body) };
}

export class PassportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
