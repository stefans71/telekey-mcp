// TeleKey core, adapted for the browser.
//
// PROVENANCE: this is src/passport.js + src/engine.js from this repo, with
// exactly ONE substantive change — Node's synchronous node:crypto HMAC/SHA
// is replaced by Web Crypto (crypto.subtle), which is async-only. That forces
// sign/hashOf/mintRoot/verifySignature/attenuate/authorizeCall/delegate to
// become async. That is a mechanical transformation, not a logic change:
// every comparison, branch, threshold and arithmetic operation below is
// character-identical to the Node original.
//
// capCovers / capsSubset / budgetWithinParent / canonical are pure and are
// copied verbatim — they contain the actual narrowing invariant.
//
// The parity check in index.html exists to prove this claim rather than
// assert it: it re-runs Node-generated vectors through this code and compares
// signatures AND allow/deny decisions. If they diverge, the page refuses to
// render the demo.

const SECRET = "dev-only-secret-not-for-production"; // matches the Node default

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
// Recursive on purpose — the array-replacer one-liner filters keys at every
// nesting level, which silently dropped `budget` from the signed payload.
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

// --- THE CRYPTO SHIM: the only place this file departs from the Node core ---
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Single guard, returning the subtle instance so every caller goes through it.
// It must be evaluated BEFORE any crypto.subtle member access — see sign().
function requireSubtle() {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Web Crypto (crypto.subtle) unavailable — this page requires a secure context (https or localhost)."
    );
  }
  return globalThis.crypto.subtle;
}

let _key = null;
function hmacKey() {
  const subtle = requireSubtle();
  // Node: crypto.createHmac("sha256", SECRET) — same key, same algorithm.
  if (!_key) {
    _key = subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return _key;
}

// Node: crypto.createHmac("sha256", SECRET).update(canonical(body)).digest("hex")
export async function sign(body) {
  // Resolve the key first, on purpose. Written as
  //   crypto.subtle.sign("HMAC", await hmacKey(), ...)
  // JS evaluates the crypto.subtle.sign member access before awaiting the
  // argument, so a missing crypto.subtle threw "Cannot read properties of
  // undefined (reading 'sign')" and the guard below never got the chance to
  // report what was actually wrong.
  const key = await hmacKey();
  const mac = await requireSubtle().sign("HMAC", key, enc.encode(canonical(body)));
  return toHex(mac);
}

// Node: crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0,16)
export async function hashOf(passport) {
  const d = await requireSubtle().digest("SHA-256", enc.encode(JSON.stringify(passport)));
  return toHex(d).slice(0, 16);
}
// --- end crypto shim -------------------------------------------------------

// ---- mint root --------------------------------------------------------
export async function mintRoot({ sub, caps, budget }) {
  const body = { sub, act: [sub], caps, budget, parent: null };
  return { ...body, sig: await sign(body) };
}

// ---- verify a single passport's own signature -------------------------
export async function verifySignature(p) {
  const { sig, ...body } = p;
  return (await sign(body)) === sig;
}

// ---- attenuate: mint a child (THIS is the load-bearing operation) -----
// Throws if the requested child would widen caps or budget. There is no
// code path that produces a valid widened passport — widening is
// unrepresentable, not merely refused by policy.
export async function attenuate(parent, { addActor, caps, budget }) {
  if (!(await verifySignature(parent))) {
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
    parent: await hashOf(parent),          // single-artifact provenance link
  };
  return { ...body, sig: await sign(body) };
}

export class PassportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ===== engine.js ==========================================================

export class DeniedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class Engine {
  constructor() {
    this.ledger = [];                 // append-only provenance log
    this.remaining = new Map();       // passportHash -> mutable remaining budget
    this.steps = [];                  // browser-only: which engine step fired
  }

  async _remainingFor(p) {
    const h = await hashOf(p);
    if (!this.remaining.has(h)) {
      this.remaining.set(h, { ...p.budget });
    }
    return this.remaining.get(h);
  }

  // Step 1 + 2 + 4: authorize and meter a tool call under a passport.
  async authorizeCall(passport, requestedCap, costHint = {}) {
    this.steps = [];
    // 1 · verify
    this.steps.push("verify");
    if (!(await verifySignature(passport))) {
      throw new DeniedError("SIG_INVALID", "passport signature invalid");
    }
    if (!capsSubset([requestedCap], passport.caps)) {
      throw new DeniedError(
        "CAP_NOT_GRANTED",
        `requested '${requestedCap}' not in passport caps`
      );
    }
    // 2 · meter
    this.steps.push("meter");
    const rem = await this._remainingFor(passport);
    const spend = costHint.spend ?? 0;
    const calls = 1;
    if (rem.max_tool_calls !== undefined && rem.max_tool_calls < calls) {
      throw new DeniedError("BUDGET_CALLS", "tool-call budget exhausted");
    }
    if (rem.max_spend !== undefined && rem.max_spend < spend) {
      throw new DeniedError("BUDGET_SPEND", "spend budget exhausted");
    }
    if (rem.ttl_seconds !== undefined && rem.ttl_seconds <= 0) {
      throw new DeniedError("BUDGET_TTL", "lifetime expired");
    }
    if (rem.max_tool_calls !== undefined) rem.max_tool_calls -= calls;
    if (rem.max_spend !== undefined) rem.max_spend -= spend;

    // 4 · log (audience-scoped token exchange would happen here in production)
    this.steps.push("log");
    this.ledger.push({
      t: Date.now(),
      chain: passport.act.join(" -> "),
      sub: passport.sub,
      cap: requestedCap,
      spend,
      remaining: { ...rem },
    });
    return { ok: true, remaining: { ...rem } };
  }

  // Step 3: delegate — mint a narrowed child. Enforces spawn budget too.
  async delegate(parent, { addActor, caps, budget }) {
    this.steps = ["verify"];
    if (!(await verifySignature(parent))) {
      throw new DeniedError("SIG_INVALID", "parent signature invalid");
    }
    const rem = await this._remainingFor(parent);
    if (rem.max_spawns !== undefined) {
      if (rem.max_spawns < 1) throw new DeniedError("BUDGET_SPAWNS", "spawn budget exhausted");
      rem.max_spawns -= 1;
    }
    this.steps.push("attenuate");
    // attenuate() itself throws CAPS_WIDENED / BUDGET_WIDENED if illegal
    const child = await attenuate(parent, { addActor, caps, budget });
    this.steps.push("log");
    this.ledger.push({
      t: Date.now(),
      event: "delegate",
      chain: child.act.join(" -> "),
      caps: child.caps,
    });
    return child;
  }
}
