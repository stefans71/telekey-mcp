// The governance engine — the local trusted computing base every tool call
// routes through. Mirrors the four numbered steps in the technical diagram:
//   1 verify · 2 meter · 3 attenuate (on delegation) · 4 exchange+log
//
// It holds live budget state per passport chain and refuses when a counter
// hits zero. It never lets an action run that isn't covered by caps.

import { verifySignature, capsSubset, attenuate, hashOf } from "./passport.js";

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
  }

  _remainingFor(p) {
    const h = hashOf(p);
    if (!this.remaining.has(h)) {
      this.remaining.set(h, { ...p.budget });
    }
    return this.remaining.get(h);
  }

  // Step 1 + 2 + 4: authorize and meter a tool call under a passport.
  authorizeCall(passport, requestedCap, costHint = {}) {
    // 1 · verify
    if (!verifySignature(passport)) {
      throw new DeniedError("SIG_INVALID", "passport signature invalid");
    }
    if (!capsSubset([requestedCap], passport.caps)) {
      throw new DeniedError(
        "CAP_NOT_GRANTED",
        `requested '${requestedCap}' not in passport caps`
      );
    }
    // 2 · meter
    const rem = this._remainingFor(passport);
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
  delegate(parent, { addActor, caps, budget }) {
    if (!verifySignature(parent)) {
      throw new DeniedError("SIG_INVALID", "parent signature invalid");
    }
    const rem = this._remainingFor(parent);
    if (rem.max_spawns !== undefined) {
      if (rem.max_spawns < 1) throw new DeniedError("BUDGET_SPAWNS", "spawn budget exhausted");
      rem.max_spawns -= 1;
    }
    // attenuate() itself throws CAPS_WIDENED / BUDGET_WIDENED if illegal
    const child = attenuate(parent, { addActor, caps, budget });
    this.ledger.push({
      t: Date.now(),
      event: "delegate",
      chain: child.act.join(" -> "),
      caps: child.caps,
    });
    return child;
  }
}
