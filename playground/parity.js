// GENERATED FILE — do not edit by hand.
// Produced by playground/tools/generate-parity.mjs from the real Node core
// in src/passport.js + src/engine.js. Verified in CI by test/parity.test.js.
export const PARITY = {
  "root": {
    "sub": "user:alice",
    "caps": [
      "listRepo:repoX",
      "deleteFile:repoX",
      "sendEmail:you"
    ],
    "budget": {
      "ttl_seconds": 120,
      "max_spend": 0.5,
      "max_tool_calls": 40,
      "max_spawns": 2
    }
  },
  "child": {
    "addActor": "agent:cleanup",
    "caps": [
      "listRepo:repoX",
      "deleteFile:repoX"
    ],
    "budget": {
      "max_tool_calls": 5,
      "max_spend": 0.2
    }
  },
  "vectors": [
    {
      "id": "sig.root",
      "note": "HMAC over the root passport body",
      "ok": true,
      "value": "8f99a48bc05441669879495faa0576713f6a364a95a4d339f0dbc58c84afea61"
    },
    {
      "id": "sig.child",
      "note": "HMAC over the delegated child body",
      "ok": true,
      "value": "1d75afc600acba65f97ed7fc764fc33c2b29046eccaeb9c1ef3a96feac52fa98"
    },
    {
      "id": "hash.root",
      "note": "hashOf(p0) — the provenance link",
      "ok": true,
      "value": "f79caf550bce3b1c"
    },
    {
      "id": "sig.fixed",
      "note": "HMAC over a fixed nested body (canonicalization)",
      "ok": true,
      "value": "5e248d51354c1b9ce1609835aa5d7b3d90cc25f7d320011277227b7c1dea9e11"
    },
    {
      "id": "verify.root",
      "note": "an untampered root verifies",
      "ok": true,
      "value": true
    },
    {
      "id": "verify.capsTampered",
      "note": "caps tampering breaks the signature",
      "ok": true,
      "value": false
    },
    {
      "id": "verify.budgetTampered",
      "note": "budget tampering breaks the signature (v0.2.0 fix)",
      "ok": true,
      "value": false
    },
    {
      "id": "call.delete",
      "note": "cleanup deletes a file — inside its key",
      "ok": true,
      "value": {
        "max_tool_calls": 4,
        "max_spend": 0.18000000000000002
      }
    },
    {
      "id": "call.injectedEmail",
      "note": "injected sendEmail:attacker — never in the key",
      "ok": false,
      "code": "CAP_NOT_GRANTED",
      "name": "DeniedError"
    },
    {
      "id": "mint.widerKey",
      "note": "injection tries to mint itself a wider key",
      "ok": false,
      "code": "CAPS_WIDENED",
      "name": "PassportError"
    },
    {
      "id": "mint.widerBudget",
      "note": "child budget above parent remaining",
      "ok": false,
      "code": "BUDGET_WIDENED",
      "name": "PassportError"
    },
    {
      "id": "mint.wildcard",
      "note": "scoped cap promoted to wildcard",
      "ok": false,
      "code": "CAPS_WIDENED",
      "name": "PassportError"
    }
  ]
};
