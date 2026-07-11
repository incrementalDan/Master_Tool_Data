# Workflow Recommendations — Making ToolDex Development Better & Safer

Written for someone newer to coding who builds with Claude ("vibe coding").
Each item says **what** to do, **why**, and **how much it matters**. Jargon is
explained inline, and there's a glossary at the bottom.

---

## Part 1 — What you're already doing right (keep these)

You'd be surprised how many experienced teams don't have these. Don't let any
of them decay:

- **`CLAUDE.md` is your superpower.** It's the project's memory. Every Claude
  session reads it first, which is why sessions "know" about the stepdown bug,
  the vendor-field convention, etc. Most vibe-coding pain comes from the AI
  forgetting decisions — you've solved that. Keep making Claude update it when
  something important changes.
- **Tests + CI.** Every push runs lint + 250+ tests + the Fusion round-trip
  audit automatically (the "Tests" workflow). This is the machine that catches
  a bad change *before* it reaches the live site.
- **Demo mode** (`?demo=true`). A sandbox where nothing can be broken. It's
  also how Claude can visually verify changes with screenshots without
  touching your real library.
- **Secrets hygiene.** `.env` is git-ignored, real keys live in GitHub Actions
  Secrets, tokens stay in memory. This is genuinely above-average.
- **Working on branches + merging via pull requests.** Your git history shows
  PR merges — good. Part 2 makes this safer still.

---

## Part 2 — Highest-value changes (do these first)

### 1. Turn on branch protection for `main` ⭐ most important

**The risk today:** anything pushed to `main` deploys to the live site
automatically. There is currently nothing *forcing* the tests to pass first —
CI runs, but a merge doesn't have to wait for it.

**The fix (one-time, ~3 minutes):** GitHub → your repo → **Settings →
Branches → Add branch ruleset** (or "Add rule") for `main`:

- ✅ **Require a pull request before merging** — no direct pushes to `main`,
  even accidental ones.
- ✅ **Require status checks to pass** — select the **Tests** workflow. Now a
  red ❌ physically blocks the merge button.

Think of it as the machine guard on a press brake: you *probably* wouldn't put
your hand in anyway, but the guard makes it impossible.

### 2. Read the PR before merging — and ask for it in plain English

The pull request page shows every changed line ("the diff"). You don't need to
understand all the code — but before merging, ask Claude:

> "Summarize this PR for me in plain English. What could break? What should I
> test by hand?"

You're the shop owner signing off on a job. You don't re-run the CAM yourself,
but you look at the setup sheet. Never merge something where you can't say in
one sentence what it does.

### 3. Fix the dependency vulnerabilities (and check quarterly)

Right now `npm audit` reports **2 moderate vulnerabilities** in the libraries
the app is built from. Libraries are like purchased tooling — recalls happen,
and you want to hear about them.

- Ask Claude: *"Run `npm audit`, fix what's safe to fix, and run the full test
  suite after."* (Don't run `npm audit fix` blindly yourself — it can bump
  versions in breaking ways; let Claude verify with tests.)
- One-time: GitHub → **Settings → Security** (Advanced Security / Code security):
  enable **Dependabot alerts** and **Secret scanning**. GitHub will then email
  you when a library you use has a known flaw, or if a key ever lands in the
  repo by mistake.

### 4. Use Plan Mode for anything big

In Claude Code, **plan mode** (Shift+Tab to cycle modes in the CLI, or the
mode picker in the web/app) makes Claude research and present a written plan
*before* touching any file. You approve or redirect, then it builds.

Your CLAUDE.md already tells Claude to "flag big asks" — plan mode is the
stronger version of that. Use it whenever a request touches the data model,
multiple workflows, or sync logic (the stuff where a wrong assumption costs a
week). For small UI tweaks, skip it.

### 5. Run the built-in review skills before merging bigger changes

Skills are pre-packaged expert routines Claude can run. You already have these
available — they're free to use and you just type them:

- **`/code-review`** — hunts for actual bugs in the current changes (not
  style nitpicks). Worth running on any PR that touches sync/merge/write logic.
- **`/security-review`** — checks the branch's changes for security problems.
  Run it whenever a change touches login, tokens, Drive/APS calls, or anything
  that reads external data.
- **`/simplify`** — cleans up code that works but got convoluted. Nice
  occasionally; keeps the codebase easy for future sessions to work in.

A good habit: for any PR beyond a small UI tweak, end the session with
*"run /code-review, fix anything real it finds, then push."*

---

## Part 3 — Habits that make Claude sessions go better

- **One feature per session/branch.** Small, focused asks produce better code
  and reviewable PRs. "Fix the preset panel machine filter" beats "fix these
  9 things" — batches make mistakes harder to spot and harder to undo.
- **Ask for verification, not just code.** End feature requests with *"verify
  it in demo mode and show me a screenshot."* Claude can launch the app in the
  cloud session and photograph the result (that's how the machine-pill work
  was checked). Seeing it beats trusting it.
- **Ask for a test with every bug fix.** The phrase to use: *"and lock it with
  a test so it can't regress."* A regression test is a jig — once built, that
  exact mistake can never happen again silently. Your stepdown/stepover bug is
  locked this way; every bug you find deserves the same.
- **When something feels off, say so plainly.** "This feels overcomplicated
  for what I asked" or "explain why this needs 6 files" are great prompts.
  You understand manufacturing systems deeply — trust that instinct; it
  transfers.
- **Keep decisions in CLAUDE.md, not in chat history.** Chat sessions end;
  CLAUDE.md persists. If you make a call ("we always do X, never Y"), ask
  Claude to record it there. You already do this well — just keep it up.
- **Let Claude babysit PRs.** After a PR is opened, you can say *"watch this
  PR and fix CI failures / respond to review comments."* The session
  subscribes to the PR and reacts on its own.

---

## Part 4 — Security specifics for *this* app

ToolDex is a client-side app with OAuth to Autodesk and Google — the main
assets to protect are **your API credentials** and **your shop's data files**.

1. **Never paste real keys/tokens into a chat message**, even to "show" an
   error. If a key ever leaks (committed, pasted, screenshotted), rotate it:
   generate a new one at APS/Google, update GitHub Secrets and your local
   `.env`, and revoke the old one. Assume anything leaked is compromised.
2. **Guard the token rules in CLAUDE.md.** "APS token in memory only, never
   localStorage" exists because localStorage is readable by any script that
   ever runs on the page. If a future feature request would need to persist a
   token, treat that as a big-deal decision, not a convenience tweak.
3. **Back up before bulk operations.** Before running Normalize, Re-number,
   or a big import against the *live* library: download copies of
   `fusion_tool_library.json` and `tool_metadata.json` (Drive and ACC both
   make this easy). The app is careful, but a 30-second manual backup turns
   "disaster" into "annoyance." Google Drive also keeps ~30 days of version
   history on files (right-click → Version history) — know that it's there.
4. **Your Google account is now shop infrastructure.** The metadata, settings,
   and jobs files live under it. Make sure it has 2-factor authentication and
   that the Drive folder is shared/owned in a way that survives one person's
   account having a bad day.
5. **`npm run deploy` stays forbidden from cloud sessions** (already in
   CLAUDE.md) — it would publish a build with no credentials and break the
   live site. The Actions pipeline is always the path.

---

## Part 5 — Worth learning next (in order)

You don't need to become a programmer. These five concepts give the most
leverage for supervising one:

1. **Reading a diff.** Green lines added, red lines removed. Skim every PR;
   you'll absorb more than you expect, and you'll start catching things
   ("why did the export file change? I asked for a UI tweak").
2. **The git safety model.** Branch = a parallel copy of the shop's job folder;
   commit = a saved snapshot you can always return to; merge = folding the
   copy back in. Nothing on a branch can hurt `main`. Internalizing this
   removes most fear of letting Claude work.
3. **What CI is.** "Continuous Integration" = robots that run your checks on
   every push. Yours runs lint + tests + the round-trip audit. When a check is
   red, the answer is always "paste the failure to Claude," never "merge anyway."
4. **Project skills** (`.claude/skills/` folder). A skill is a written recipe
   Claude follows exactly — like a setup sheet for a repeated job. Good first
   candidate for this repo: a **verify-in-demo** skill that documents how to
   launch the dev server with placeholder env vars and screenshot demo mode
   (this trick had to be rediscovered mid-session once; a skill makes it
   instant every time). Ask Claude: *"create a project skill for verifying
   changes in demo mode."*
5. **MCP connectors** — how Claude talks to outside services (you already use
   GitHub and Notion ones). Relevant later if you want sessions to read
   ProShop exports from Drive directly, file issues automatically, etc.

---

## Part 6 — Things you *don't* need right now

So the list above stays honest — commonly recommended, not worth it yet:

- **TypeScript migration** — big rewrite, modest payoff while tests + the
  audit are strong and Claude writes most code. Revisit if the app grows a lot.
- **A stricter linter / formatter gate** — your minimal ESLint is a deliberate
  choice that catches the blank-screen bug class; style gates mostly add noise
  to AI-generated PRs.
- **A backend server** — the client-only + SQLite-someday plan in CLAUDE.md is
  right for the shop's scale. Don't let anything talk you into infrastructure
  you'd then have to secure and maintain.
- **More MCP servers / plugins for their own sake** — add a connector when a
  task needs it, not preemptively. Each one is another thing with access.

---

## Glossary

| Term | Plain English |
|---|---|
| **PR (pull request)** | A proposed batch of changes with a review page — the setup sheet you sign before the job runs |
| **Diff** | The line-by-line before/after view of a change |
| **CI** | Robots that automatically run your tests/checks on every push |
| **Branch protection** | GitHub setting that physically blocks merging until checks pass |
| **Lint** | Automatic scan for known-bad code patterns (yours catches missing imports → blank page) |
| **Regression test** | A test that pins down a fixed bug so it can't quietly return |
| **Skill** | A written recipe Claude follows exactly (`/code-review`, `/security-review`, or your own in `.claude/skills/`) |
| **Plan mode** | Claude researches and proposes a plan for approval before editing anything |
| **Hook** | A script that runs automatically at certain moments (you have one that runs `npm install` at session start) |
| **MCP connector** | A bridge letting Claude use an outside service (GitHub, Notion, …) |
| **Dependabot** | GitHub robot that warns when a library you use has a known vulnerability |
| **`npm audit`** | Command that checks your libraries against the known-vulnerability database |

---

*Suggested cadence: do Part 2 items 1 & 3 this week (both are one-time,
~10 minutes total). Adopt one habit from Part 3 per week. Revisit this file
in a few months and delete what's become second nature.*
