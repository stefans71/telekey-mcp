# TeleKey — Claude Code plugin

> **Just want it installed?** Hand [`INSTALL-PLUGIN.md`](../docs/INSTALL-PLUGIN.md) to Claude Code and it'll walk you through it interactively (Claude Code, Codex, or DeepSeek). This README is the reference.

Enforces the capability passport on **every tool call**, inside the harness, via a
`PreToolUse` hook. A call that exceeds the agent's passport is **blocked before it
runs** — not flagged afterward.

## Install (local)

```
/plugin marketplace add <this-repo-or-path>
/plugin install telekey@telekey-marketplace
```

Or point Claude Code at the local dir during development. The manifest is at
`.claude-plugin/plugin.json`; the enforcement point is `hooks/pretooluse.js`.

## How it works

On each tool call, Claude Code runs the hook with the call event on stdin. The hook
maps the call to a capability (e.g. `delete_file` on `repoX` → `deleteFile:repoX`),
checks it against the active passport using the same engine as the MCP server, and
returns `allow` / `deny`. No passport, or a tampered one → **deny (fail-closed)**.

The passport travels either as a `passport` field on the tool input (agents attach it)
or as an operator-provisioned `session-passport.json`. Delegation still narrows: a
sub-agent's passport is `⊆` its parent's, so an injected call to a capability the
agent never held is unrepresentable, not merely refused.

## Why this is the same file for Codex and DeepSeek

The three major harnesses converged on one hook model:

| Harness | Hook event | Status |
|---|---|---|
| Claude Code | `PreToolUse` (can block) | this plugin |
| Codex | `PreToolUse` (10 events incl. `PermissionRequest`) | same contract; `.codex-plugin/plugin.json` |
| DeepSeek `dsh` | `tools/pre-execute` (can block) + **runs Claude Code / Codex hooks via bridge** | compatibility path |

DeepSeek's harness ships bridges that run existing Claude Code and Codex `hooks.json`,
so this hook is the basis for all three. Codex is mid-migration on its plugin framework
and DeepSeek is a developer preview — **pin versions and re-verify before shipping.**

## Settings — `passport-policy.json`

Adjustable per capability: `allow` (silent), `ask` (confirm each call), `deny` (block). Also sets default budgets. A hard ceiling in `src/policy.js` caps everything and cannot be exceeded by any setting.

**Publisher awareness (identity, not trust).** If a server is identity-verified in the official MCP registry, it gets *lighter prompts* and a *fuller default budget* — never a lifted ceiling and never a silent grant of a dangerous capability. This mirrors the registry's own stance: verification proves *who published it*, not *that it's safe*. There is deliberately **no** "trusted publisher → wide open" mode. Pin known-verified names in `plugin/hooks/verified-publishers.json`.

## Caveat

This enforces **your side** of the boundary — what the agent may attempt. It bounds a
compromised or prompt-injected agent's blast radius. It does not make an unmodified
upstream MCP server honor the passport end-to-end (see `docs/ROADMAP.md`). Enforcement, not
cognition.
