# Naming — candidates, availability, and a recommendation

> **RESOLVED:** the project is named **TeleKey** (repo `telekey-mcp`). A coined name — *Tele-* keeps the Telescript lineage, *Key* names what it issues — that's free on GitHub/npm and collision-free in search. The analysis below is the decision record that led there.


## The core naming tension

Your instinct (`Telescript-MCP-Passport`) points at the two strongest ideas — the **Telescript lineage** and the **passport metaphor** — but the second one has a problem I found while checking availability, so the recommendation splits them.

## What the checks turned up

**"Passport" is the most crowded word you could pick in this exact space.** `Passport.js` is *the* Node.js authentication middleware — 480+ auth strategies, and `passport-oauth2` alone pulls ~2M downloads/week. A project called `passport-mcp` or `telescript-mcp-passport` reads, to any Node developer, as "a Passport.js strategy for MCP." That's active brand confusion in the one audience you most want. **Recommendation: keep "passport" as an in-repo *metaphor* (the shrinking keycard / passport story in the README), but not in the repo name.**

**"Macaroon" / "attenuate" are the academic terms of art — accurate but occupied.** The whole niche already speaks this language: `libmacaroons`, `Macaroons.Net`, a 2026 macaroon-vs-API-keys-for-agents literature, and commercial entrants (SatGate). Using these names makes you findable but instantly comparable to incumbents, and you'd be the newest, smallest one. Good for keywords in the description; risky as the identity.

**"Telescript" is wide open in the modern context.** Every search hit is historical — Wikipedia and Semantic Scholar's archive of the 1990s General Magic language. **No active MCP/agent-auth project is using it.** That makes it the distinctive, ownable, story-rich angle — and it's *literally your differentiation*: you're the project reviving a 1994 idea the current stack is scrambling to reinvent.

> Note on the checks: GitHub's API rate-limited my direct namespace probes (HTTP 403), so availability here is inferred from web/search presence, which is the more decision-relevant signal anyway (a free repo slug is worthless if the *name* is confusable). Confirm the exact slug on GitHub and npm yourself before you commit — 30 seconds each.

## Candidates, ranked

### Tier 1 — distinctive, on-thesis, low collision

| Name | Why it works | Watch-outs |
|---|---|---|
| **telescript** *(if the bare org/repo is free)* | Maximum lineage payoff; clean; memorable. | Bare word may be claimed as a user/org — check. Doesn't say "MCP" on the tin. |
| **telescript-passport** | Lineage + the keycard metaphor, without "mcp-passport" reading as a Passport.js plugin. | Slightly long. |
| **narrows** / **narrowing** | Names the actual invariant (caps can only narrow). Verb-y, distinctive, no collision found. | Abstract until you read the tagline. |
| **attenuator** | One word, precise, less crowded than "macaroon" itself. | Still in the macaroon family's shadow. |

### Tier 2 — descriptive, findable, more generic

| Name | Why it works | Watch-outs |
|---|---|---|
| **mcp-capability-passport** | Says exactly what it is; SEO-friendly. | Long; "passport" collision softened but present. |
| **capgate** / **capward** | "capability gate/ward" — short, brandable. | Coined words need a tagline to land. |
| **shrinkcap** | Literal (shrinking capability); memorable. | Reads slightly toy-like for a security project. |

### Tier 3 — your original

| Name | Verdict |
|---|---|
| **telescript-mcp-passport** | Works, and it's clear — but it's long and the `-passport` tail invites the Passport.js mix-up. If you love it, **telescript-passport** keeps the spirit and drops the ambiguity. |

## The recommendation

**Repo name: `telescript-passport`** (or bare **`telescript`** if the slug is free and you want to plant a bigger flag).
**Tagline / description:** *"Capability-passport delegation for MCP agents — authority that can only narrow. A revival of General Magic's 1994 Telescript permit model."*
**In the description field, include the crowded keywords on purpose** — `mcp`, `capability`, `attenuation`, `delegation`, `oauth`, `rfc8693` — so the macaroon/agent-auth crowd still finds you via search, while your *name* stays distinctive.

This way: the **name** owns a story nobody else is telling, and the **metadata** competes on the keywords everyone searches. Best of both.

## Before you commit (quick checklist)
- [ ] `gh repo view <you>/telescript-passport` → confirm the slug is free
- [ ] `npm view telescript-passport` → confirm the npm name is free (if you'll publish)
- [ ] Web-search the final name once more for any brand you'd collide with
- [ ] Grab the matching npm/GitHub name even if you won't publish yet, to reserve it
