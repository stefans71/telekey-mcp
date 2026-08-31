# Roadmap & Go-to-Market

*How this goes from a reference implementation to something people adopt — honestly positioned against a field that is already moving.*

---

## First, the honest competitive picture

You are **not** first to this idea, and the plan has to own that rather than pretend otherwise. As of 2026 the space is active:

- **Macaroons** (Google, 2014) already established holder-side attenuation as a primitive; `libmacaroons` and ports exist.
- **Google DeepMind's Delegation Capability Tokens** (2026) apply macaroons directly to agent-to-agent delegation.
- Research protocols — **AIP** (Agent Identity Protocol) and **Invocation-Bound Capability Tokens (IBCTs)** — are explicitly trying to fuse identity + attenuation + provenance for MCP/A2A.
- Commercial entrants (e.g. macaroon-token auth for agents) are marketing capability-based agent auth now.

**So what is actually defensible here?** Not the primitive. Three things:

1. **The MCP-native framing.** Most of the above are protocol-agnostic or A2A-first. Being the clean, boring, *drop-in-for-MCP* reference — matching the exact spec revisions and the RFC 8693 flow MCP already mandates — is an open lane.
2. **The narrowing invariant as the whole product.** Competitors bundle attenuation into larger identity systems. A tiny, auditable "one rule + test suite" is easier to trust, adopt, and standardize than a platform.
3. **The story.** The Telescript lineage is a genuinely memorable narrative hook nobody else has. It gets you talks, posts, and attention that a spec draft alone never would.

If none of those three hold up on contact with users, that's the signal to fold into an existing effort (macaroons/DCT) rather than compete. Building that off-ramp into the plan is the honest move.

---

## Product roadmap

Framed in phases, not dates — a solo/small effort should gate on validation, not calendar.

### Phase 0 — Reference (done)
The current repo: passport core, engine, real MCP server, 29 tests (25 failure-mode fixtures plus build guards), diagrams, CI. This exists to make the idea *concrete and testable*, not to be run in production.

### Phase 1 — Credibility
The goal is "a serious person could evaluate this in an afternoon."
- Swap HMAC for **real signed JWTs** (RFC 9068, asymmetric keys). This is the single biggest credibility gap today.
- Add the **RFC 8693 token-exchange** leg for real (currently logged/simulated), against a throwaway auth server, so the upstream-scoped-token story is demonstrable end to end.
- **Issuer-held budget state (authoritative mode).** The plugin meters locally, in a signed, TTL-bounded state file. That bounds the delete-reset vector — a deleted file reseeds to the passport's signed ceiling, never above it, and only until the TTL would have reset it anyway — but it cannot close it. Moving remaining-budget accounting to the issuer, as monotonic durable state, is the only complete fix, and that is a proven requirement rather than a design preference.[^caplease] This is the natural companion to the token-exchange leg above: the same auth server that issues scoped tokens is the thing that should be counting them.
- **HTTP transport** for the MCP server (it's stdio today). Nothing real integrates over stdio.
- Turn the fixtures into a **runnable eval you can point at any MCP gateway**, and publish the OWASP-MCP-Top-10 mapping as the headline artifact.

### Phase 2 — Usefulness
The goal is "someone can put this in front of their own agent."
- Ship as an **MCP gateway middleware** — a thing that sits in front of existing MCP servers and enforces passports, rather than a bespoke server people must adopt wholesale.
- **Reference SDK** (TS first, Python second) for minting/attenuating/verifying passports, so integration is a few lines.
- **Interop test** against a real second implementation (macaroons or DCT) to prove the model isn't idiosyncratic.

### Phase 3 — Standardization (the actual endgame)
The goal is "this stops being *your* project and becomes *a* standard."
- Publish the passport claims + the ⊆ verification rule as an **Internet-Draft** / a proposed **MCP authorization extension (SEP)**, with the fixtures as its conformance vectors.
- Engage the MCP Auth Working Group and the macaroon/DCT authors directly — ideally **converge**, not compete. The win condition is the *narrowing invariant* landing in a standard, under whatever name, not this repo winning.

> The strategic point: for a governance primitive, **adoption of the idea beats ownership of the code.** Optimize the roadmap for the rule getting standardized, even if that means the repo becomes a footnote.

### Repo operations — revisit when this stops being solo

`main` is protected: CI (`test (20)` **and** `test (22)`) must pass before a merge, `strict` requires a branch to be current with `main` first, and force-pushes and branch deletion are off.

But **`enforce_admins` is deliberately `false`**, and that is the part worth remembering. It means none of the above binds repo admins. As the sole admin you can still push straight to `main` and bypass the required checks entirely — and you can force-push or delete the branch, since those toggles don't bind admins either. What the protection actually buys today is that *someone else* can't merge a red build.

That's the right trade for a one-person repo: turning it on would make every one of your own changes take a PR, and requiring review on top would deadlock outright, since you can't approve your own pull request.

**Trigger to revisit:** the first time anyone else gets write access. Flip it then, and the rules start binding everyone, you included:

```bash
gh api -X POST repos/stefans71/telekey-mcp/branches/main/protection/enforce_admins
```

### Deferred — the overview diagram

The plain-language overview diagram is **not currently in the README**: the demo
recording (`assets/demo.gif`, from `demo.js`) took the hero slot, on the grounds
that showing the attack fail beats explaining that it would.

The render source is kept at [`assets/overview.html`](../assets/overview.html) —
a self-contained page, no build step, open it in a browser. The rendered
`assets/overview.png` was deleted once nothing referenced it; recover it from git
history rather than re-rendering if the exact original is wanted.

If the diagram is ever reinstated, two things are worth knowing, both learned the
hard way:

- **Style the raster, not the tag.** GitHub's Markdown sanitizer strips `style`
  attributes from inline HTML in READMEs, so rounded corners and padding have to
  be baked into the image. The deleted PNG had a 24px radius and an `#e6e9ef`
  hairline composited in for exactly this reason.
- **A solid background is deliberate.** It guarantees the diagram's text stays
  legible on a dark canvas, which a transparent SVG does not. The proper fix is a
  dark-palette variant served through `<picture>` + `prefers-color-scheme`, which
  GitHub does honor:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/overview-dark.png">
  <img src="assets/overview.png" alt="…" width="88%">
</picture>
```

---

## Go-to-market

This is developer-tools / open-source infrastructure, so GTM = attention + trust + being in the right rooms, not ads.

### Positioning (one line)
> *Authority that can only narrow. A capability-passport layer for MCP agents — reviving a 1994 idea the modern stack is scrambling to reinvent.*

### The three audiences, in order
1. **MCP / agent-infra developers** — the adopters. Reach them where they already are: the MCP GitHub discussions, the Auth WG, Show HN, agent-dev Discords, and the `modelcontextprotocol` topic. The hook is the **OWASP-MCP-Top-10 eval** ("does your gateway pass these fixtures?") — a tool that makes their problem legible.
2. **AI-security researchers & writers** — the amplifiers. The Telescript-lineage essay is genuinely publishable. It travels because it's a *story* (past-futures-of-computing) attached to a *live 2026 problem*. This is your cheapest, highest-leverage channel.
3. **Standards people** — the deciders. Smaller, slower, but the only audience that matters for Phase 3. Reached by *doing the work in the open* — an ID, clean test vectors, and showing up in the WG.

### Content plan (highest ROI first)
- **The essay:** "A 1994 language already solved the agent-permission problem we're reinventing." Lead with the Telescript→MCP mapping table; end at the narrowing invariant and the repo. This is the thing most likely to travel.
- **The eval as a product:** "Run the OWASP MCP Top 10 against your MCP gateway" — a repo + a one-command runner. Utility gets stars and issues; issues get contributors.
- **The demo GIF/video:** the injected `send_email` getting denied in the Inspector. One 20-second clip that shows the whole thesis.
- **A short technical post** on the JWT/RFC-8693 implementation once Phase 1 lands, for credibility with the auth crowd.

### What NOT to do
- Don't lead with "better than macaroons/DCT" — you'll lose a feature fight against Google. Lead with **MCP-native + tiny + auditable + the story.**
- Don't build a platform or a SaaS before Phase 2 validates that anyone wants the middleware. The eval tool is the wedge; resist scope creep.
- Don't over-badge the README or over-promise production-readiness — the caveats *are* the credibility for a security project.

### Signals that this is working (or isn't)
- **Working:** the eval gets used against gateways that aren't yours; a WG member engages; the essay gets cited; someone files a "we implemented the invariant" issue.
- **Not working (fold-in triggers):** six months of crickets on the eval; the macaroon/DCT camp ships an MCP-native version first; no WG interest. Any of these → contribute the fixtures + invariant upstream and move on. That's a *good* outcome for the idea, just not for the repo.

---

## The one-paragraph version

Build the smallest trustworthy thing (real JWTs + RFC 8693 + an HTTP gateway + the eval), tell the Telescript story loudly to researchers, put the OWASP-MCP eval in front of gateway builders as a utility, and aim the whole effort at getting the narrowing invariant into an MCP authorization extension — converging with the macaroon/DCT work rather than fighting it. Win the *idea*, not the repo.

[^caplease]: Xu, Fan, Wang, Li & Liu, *[Beyond Single-Use Tokens: Durable Authorization State for Replay-Resistant LLM Agent Actions](https://arxiv.org/abs/2608.01710)*, arXiv:2608.01710 (2026). Shows that identifier-local token consumption cannot prevent fresh reissuance unless the issuer retains monotonic durable state over the authorized action, the confirmation event, and the remaining execution budget.
