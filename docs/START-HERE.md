# START HERE — Setup Wizard (for Claude Code)

> **You are Claude Code. This file is your script.** Run it as an **interactive wizard**: work through the phases in order, and at each 🟡 **ASK** step, stop and ask the user, wait for their answer, then act. Do not run a whole phase silently. Echo what you're about to do before doing it, and after each command show the result in one line. If a step fails, stop and show the error before continuing.
>
> *Note on paths: links here are written for reading on GitHub (relative to `docs/`). When you execute this wizard, run commands from the repository root.*

This sets up **telekey-mcp** (a reference MCP gateway) on the user's VPS and, optionally, pushes it to GitHub.

---

## Phase 0 — Greeting & preflight

Say hello and give a one-line summary of what you'll do: *"I'll set up telekey-mcp on this machine, run the tests, optionally start the server, and optionally push it to GitHub. I'll ask before each big step."*

Then check the environment and **report a small table** of what you found:

```bash
node --version 2>/dev/null || echo "node: MISSING"
npm --version 2>/dev/null || echo "npm: MISSING"
git --version 2>/dev/null || echo "git: MISSING"
gh --version 2>/dev/null | head -1 || echo "gh: not installed (optional)"
pwd
```

🟡 **ASK 0a** — If `node` is missing or below v20:
> "Node 20+ is required and I don't see it. Want me to install it (I'll use the NodeSource setup for your OS), or will you install it yourself?"
- If they say install: detect the OS (`cat /etc/os-release`) and use the appropriate method (e.g. NodeSource for Debian/Ubuntu). Show the commands first.
- If unsure, stop and let them install, then resume.

🟡 **ASK 0b** —
> "Where should the project live? Default is `~/telekey-mcp`. Press enter to accept or give me a path."
Store their answer as `$TARGET`.

---

## Phase 1 — Place the project

You have two cases. **Ask which applies:**

🟡 **ASK 1** —
> "Do you already have the project files here (the tarball `telekey-mcp.tar.gz` or an unzipped folder), or should I create everything from scratch?"

**Case A — they have the archive:**
```bash
# adjust the source path to wherever they downloaded it
mkdir -p "$TARGET" && tar -xzf telekey-mcp.tar.gz -C "$(dirname "$TARGET")"
cd "$TARGET"
ls -la
```

**Case B — from scratch:** see Phase 6 for where to get the authoritative source. This wizard does not embed it — recreating `src/` by hand risks drift from the tested version, so treat a missing tarball as a blocker, not a challenge.

Confirm the layout looks right (`src/`, `test/`, `assets/`, `package.json`, `README.md`) before moving on.

---

## Phase 2 — Install & test

Echo the plan, then:

```bash
cd "$TARGET"
npm install
npm test
```

**Report the result clearly.** You want to see `# pass 29 / # fail 0`. If any test fails, stop and show which one — do not proceed to GitHub with failing tests.

🟡 **ASK 2** — Once green:
> "All 29 tests pass. Want me to (a) boot the MCP server and run the demo driver, (b) skip to GitHub setup, or (c) stop here?"

If (a):
```bash
node drive.js
```
Explain the output: a valid `delete_file` call is allowed and budget ticks down; a simulated injected `send_email` is **denied** because that capability was never in the narrowed passport.

---

## Phase 3 — GitHub setup (optional, interactive)

Only enter this phase if the user wants it.

🟡 **ASK 3a** —
> "Ready to put this on GitHub? I'll need to know: (1) public or private repo, (2) the repo name (default `telekey-mcp`), and (3) whether you have the GitHub CLI `gh` authenticated, or you'd rather I set up the remote by URL."

Branch on whether `gh` is available and authenticated (`gh auth status`).

**Path A — `gh` is authenticated (easiest):**
```bash
cd "$TARGET"
git init -b main
git add .
git commit -m "Initial commit: telekey-mcp reference implementation"
# fills OWNER/REPO in the README badges before first push
gh repo create <REPONAME> --<public|private> --source=. --remote=origin --push
```

**Path B — no `gh`, use a URL:**
🟡 **ASK 3b** — "Create an empty repo on github.com (no README/license), then paste me the URL."
```bash
cd "$TARGET"
git init -b main
git add .
git commit -m "Initial commit: telekey-mcp reference implementation"
git remote add origin <PASTED_URL>
git push -u origin main
```

### Fix the badge placeholders (do this BEFORE the first push if possible)

The README has `OWNER/REPO` placeholders in the badge URLs so the CI badge points at the right repo. Replace them:

```bash
# after you know the owner + repo name:
sed -i "s|OWNER/REPO|<owner>/<reponame>|g" README.md
```

Also personalize the license:
```bash
sed -i "s|YOUR_NAME|<their name or handle>|" LICENSE
```

If you already pushed, commit the fix:
```bash
git add README.md LICENSE && git commit -m "Set repo owner in badges + license" && git push
```

🟡 **ASK 3c** — After push:
> "Pushed. The CI workflow (`.github/workflows/ci.yml`) runs the tests on every push — the green CI badge will light up within a minute. Want me to open the Actions page URL for you, or verify the run with `gh run watch`?"

---

## Phase 4 — Verify & hand off

Run a final check and print a short summary:

```bash
cd "$TARGET"
echo "Location:  $TARGET"
echo "Tests:";    npm test 2>&1 | grep -E "# (pass|fail)"
git remote -v 2>/dev/null | head -1 || echo "no git remote (local only)"
```

Then tell the user, in plain terms:
- where the project is,
- that `npm test` is the way to re-run the fixtures,
- that `npx @modelcontextprotocol/inspector node src/server.js` opens it in the official MCP Inspector,
- and the one caveat: **this is Side-B enforcement only — it bounds what a compromised agent can do, it doesn't stop the agent from being fooled.**

---

## Phase 5 — Optional extras (offer, don't assume)

🟡 **ASK 5** — "Want any of these? (1) run it as a systemd service so it stays up, (2) a Dockerfile, (3) branch protection requiring CI to pass before merge."

- **systemd:** create `/etc/systemd/system/telekey-mcp.service` pointing at `node $TARGET/src/server.js`, then `systemctl enable --now`. Note it's an stdio server, so this only makes sense if they front it with an HTTP transport — mention that rather than blindly daemonizing an stdio process.
- **Docker:** a minimal `node:22-slim` image, `npm ci`, `CMD ["node","src/server.js"]`.
- **Branch protection:** `gh api` call to require the `test` check on `main`.

Do each only if asked.

---

## Phase 6 — Appendix: where the source actually lives

If Phase 1 Case B applies, do **not** work from a file list written into this
document. A hardcoded manifest goes stale the moment a file is added — this one
did, and silently omitted `src/policy.js`, `src/publisher.js`,
`test/policy.test.js`, and the whole `plugin/` tree. Read the tree from the
source instead, which is always current:

```bash
# from the tarball, without extracting it:
tar -tzf telekey-mcp.tar.gz

# or straight from the repo:
git clone https://github.com/stefans71/telekey-mcp && git -C telekey-mcp ls-files
```

Either way, prefer the archive or the repo over re-deriving anything by hand.
The signing, attenuation, and policy logic in `src/` is precisely what the 16
fixtures assert against, so a hand-written approximation can pass a reading and
still fail the suite. If you have this wizard and nothing else, say so and stop:
ask the user for the tarball or the repo URL rather than improvising an
implementation.

---

### Wizard etiquette (reminder to you, Claude Code)
- One question at a time at 🟡 steps; wait for the reply.
- Never push with failing tests.
- Show commands before running; summarize results after.
- If the user seems unsure, pick the safe default and say what you chose.
- Keep secrets out of the repo — if you ever see a token, don't commit it.
