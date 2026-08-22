# Storage Migration Plan — getting off whole-file JSON

**Date:** 2026-08-22 · **Status:** plan, not started
**Companion to:** `DATA_LOSS_AUDIT.md` · **Detail for Phase C of:** `docs/PHASE_A_PLAN.md`

> ⚠️ **This is not a competing plan.** `docs/PHASE_A_PLAN.md` already lays out a
> three-phase Cloudflare roadmap — A: private hosting + server-side login, B:
> blobs to R2, C: the JSON into a database. **This document is Phase C in
> detail.** Read that one first for the shape; this one for what actually moves
> and why. Where they differ, the reconciliation is in §0.

-----

## 0. Reconciling with `docs/PHASE_A_PLAN.md`

Three things the older plan settles or changes:

**Phase A answers the auth question, and answers it better than §5 does.**
This document proposed the cheapest possible auth — the Worker verifies the
caller's APS token. Phase A instead moves the whole OAuth dance server-side:
the Worker holds the refresh token, the browser gets an httpOnly cookie it
cannot read. That is strictly better (no token in the browser at all, and login
survives refresh, new tabs, and the whole day), and it means **the Worker and its
session already exist before Phase C starts.** Phase C then adds a database
endpoint to a backend that is already there and already authenticated, rather
than standing one up. **Do Phase A first** — it removes most of what §8 lists as
the real cost of D1.

**Phase A has value independent of data safety**, which the audit did not weigh:
it makes the repo private (GitHub Pages forces it public today) and fixes
mid-session token expiry. Those are worth having regardless of storage.

**⚠️ Phase B (blobs → R2) is NOT required, and should not be treated as a
prerequisite for C.** Measured: every blob call site is upload / download / copy
/ rename — write-once, read-many, **no read-modify-write cycle**, so blobs have
none of the corruption problem this whole effort is about. Moving them fixes no
data-loss issue and is the riskiest bulk move available. Do it if and when
consolidating off Drive is wanted for its own sake; **B does not block C**, and
C is the one that matters. See §2 Track B.

**Revised order:** A → C → (B, optional, whenever).

-----

The audit found a class of bug, not a list of bugs. This is the plan to remove
the class instead of patching instances of it.

-----

## 1. The one sentence

> Every save today is **"read a whole JSON file, change it in memory, write the
> whole file back."** Every hole in `DATA_LOSS_AUDIT.md` is a variant of *the
> whole file got replaced with the wrong contents*.

A database write touches one row and either commits or doesn't. That deletes the
class. Backups are a **secondary** benefit — worth being clear about, because
"we're migrating for backups" leads to the wrong design.

-----

## 2. ⚠️ What actually has to move — it is much less than "move to Cloudflare"

Measured across the codebase, storage use splits into three tracks that have
nothing to do with each other:

| Track | What | Read-modify-write? | Moves? |
|---|---|---|---|
| **A. Records** | `tool_metadata.json` + the 7 shared JSON files | **YES** — this is the whole problem | **Moves to the DB** |
| **B. Blobs** | tool photos, attachments, raw posted CSVs in `ProgramFiles/` | **No** — upload / download / copy / rename only | **Stays on Drive** |
| **C. Fusion** | `fusion_tool_library.json`, holder library in ACC | Whole-file, but ACC versions every write | **Never moves** |

⚠️ **Track B does not need to move, and moving it is the riskiest part of a
migration for zero benefit.** The blob call sites are `uploadToolFile`,
`fetchFileBlob`, `copyDriveFile`, `renameDriveFile`, `listFolderChildren` — all
write-once/read-many. There is no cycle to corrupt. Photos in Drive are fine
today and will be fine after. Leave them. (R2 later is an optimisation, not a
fix.)

⚠️ **Track C never moves.** Fusion has to read that file from ACC. It already has
full version history, which is the best protection of anything in the system.

**So the migration is: the 8 JSON files. That's it.**

-----

## 3. How well insulated the code already is

| Surface | Call sites | Insulated? |
|---|---|---|
| `tool_metadata.json` | 37 (toolActions 15, libraryOps 19, AppContext 3) | ✅ **All through `toolStore.js` — 47 lines.** Swap its body, nothing else changes. |
| The 7 shared files | 18, direct from AppContext | ❌ **No seam yet.** Needs the same treatment. |
| Blobs | ~25 | n/a — not moving |
| Onboarding UI (`MetadataConnect`, `ShopConnect`, `DriveFolderPicker`) | ~5 | Largely **deleted**, not ported — there is no folder to pick |

**`toolStore.js` is the single best piece of preparation in this repo.** Half the
migration is already done and was done for exactly this reason. The remaining
prep is to give the shared files the same seam — see §7.

-----

## 4. ⚠️ The schema decision that turns weeks into days

**Do NOT design a fully normalized relational schema as step one.** That is a
multi-week project, it blocks the fix, and it invites a rewrite of every read
path at the same moment as the storage swap — two risky changes at once.

**Land the documents as rows first:**

```sql
CREATE TABLE tools (
  id          TEXT PRIMARY KEY,          -- tracking_id (FTL-XXXXXX)
  data        TEXT NOT NULL,             -- the existing metadata record, verbatim JSON
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE shared_files (
  name        TEXT PRIMARY KEY,          -- 'materials' | 'shop_settings' | ...
  data        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);
```

On the day that ships you already have:

- **Atomic per-record writes.** `upsertMany` becomes one transaction over N rows.
  A bulk save can no longer replace the file with a subset — structurally, not by
  a guard someone has to remember.
- **No blank-overwrite class.** There is no "whole file" to overwrite. A failed
  read cannot become a write, because reads and writes address different rows.
- **Real concurrency.** `version` + `WHERE version = ?` is optimistic locking:
  the second writer's UPDATE affects 0 rows and you know to reload. This is the
  two-people-editing problem, solved properly rather than detected.
- **30-day point-in-time restore** (D1 Time Travel), automatic.

Then normalize **incrementally and only where it buys something** — pull
`tool_id`, `tool_type`, `diameter`, `location_bin` out into real columns when you
want to query them; leave the rest in `data`. The FK inventory in `CLAUDE.md` →
**Relational integrity** is the map for that, and it is already correct. Nothing
about landing documents-as-rows first makes the eventual normalization harder.

⚠️ **This is the step most likely to be over-engineered.** The value is
transactions and PITR. Both arrive with the two tables above.

-----

## 5. Platform — the honest comparison

The requirement is *"a real database with transactions and backups."* Cloudflare
satisfies it; so do others. What actually differs:

| | Cloudflare D1 + Worker | Supabase |
|---|---|---|
| Engine | SQLite | Postgres |
| Backend needed? | **Yes** — D1 has no browser client, so a Worker sits in front | **No** — browser client + Row Level Security preserves today's no-server architecture |
| Point-in-time restore | **Time Travel, 30 days, free, automatic** | Daily backups free (7d); true PITR is a paid tier |
| Auth | You build it (verify the APS token in the Worker, or Cloudflare Access) | Built in |
| Already in use here? | **Yes** — `worker/extractor-worker.js` exists | No |

**Recommendation: Cloudflare D1 + a Worker.** Reasons, in order:

1. **Time Travel is the best recovery story available at this scale**, and
   recovery is why this started.
2. **SQLite is what the data model was designed for** (`CLAUDE.md` says so
   repeatedly; the UUID and FK discipline was for this).
3. **A Worker is an asset, not a cost, for an ERP.** It is the one place business
   rules cannot be bypassed by a client — the write tripwire, and later the
   append-only audit log (`DECOUPLING_FOLLOWUP_FINDINGS.md`) which *must* be
   server-side to be trustworthy.
4. Cloudflare is already in the stack.

⚠️ The real cost of D1 is **you now run a backend**: an auth story, a deploy, and
a second thing that can be down. Accept that deliberately. Supabase is the
credible alternative specifically because it avoids it — worth ten minutes of
thought, not a week.

**Auth: already solved, if Phase A runs first.** `docs/PHASE_A_PLAN.md` moves the
Autodesk and Google OAuth flows into the Worker, which holds the refresh token
server-side and hands the browser an httpOnly cookie. Phase C then rides that
existing session — no new auth work at all.

Only if Phase C somehow runs first: the Worker verifies the caller's **APS access
token** against Autodesk's `userinfo` endpoint and checks the account belongs to
the shop's hub — ~30 lines, keeps today's model ("access to the Autodesk hub is
access to the app"). Strictly worse than the Phase A cookie (the token still
lives in the browser), so treat it as the fallback, not the plan.

-----

## 6. Cutover — big-bang is acceptable here, *because* it is two people

Enterprise practice is dual-write / shadow-read / flip. That ceremony exists for
systems that cannot stop. This one can: two people, one room.

**The safe sequence, one evening:**

1. **Freeze.** Both people out of the app.
2. **Export** all 8 files (the Export Everything button from §7 — this is what it
   is for). Keep the zip off Drive.
3. **Import** into D1 via a script that reads that same zip. Same input, so the
   export is provably what landed.
4. **Verify by count and by spot-check**, not by eyeball: tools, assemblies,
   presets, holders, parts, programs. The script prints the table; it should
   match the manifest.
5. **Flip** `VITE_STORAGE_BACKEND=d1` and deploy.
6. **Leave the Drive files exactly where they are, untouched, forever.** They
   are the rollback. Do not delete them "once it's working" — that is the month
   you find the one field that didn't map.
7. Run for two weeks. Only then stop thinking about them.

⚠️ **The rollback is "flip the env var back."** That only stays true while the
Drive files are frozen and the app can still read them, which is why the storage
seam (§7) must keep both implementations for a release or two. Deleting the Drive
adapter the same week as the cutover is what turns a bad afternoon into a bad
month.

-----

## 7. ⚠️ What to build BEFORE migrating — and what NOT to

The test for each item: **does this survive the migration, or is it Drive
plumbing that gets thrown away?**

### Build now — durable, and most of it makes the migration easier

| Item | Why it survives |
|---|---|
| ✅ **Failed-load write block** *(done)* | "Never write state you failed to load" is backend-agnostic. |
| ✅ **Dev write lock** *(done)* | Lives in the service layer. **More** valuable after: one shared DB, no per-device localStorage to accidentally differ. |
| **`sharedStore.js` — the shared-file seam** | The single highest-value prep. ~50 lines mirroring `toolStore.js`. Insulates the 18 direct calls, **and is the swap point the migration needs anyway.** Pays for itself twice. |
| **Write tripwire** (refuse a save that drops the record count sharply) | A business rule, not storage. Belongs in the seams; moves into the Worker later, unchanged in spirit. |
| **Export Everything** (one zip of all 8 files) | Backend-agnostic. It is the interim backup, **and step 2 of the cutover.** |

### Do NOT build — throwaway

| Item | Why |
|---|---|
| ❌ **Daily snapshot folder in Drive** | Folder machinery, retention policy, restore UI, manifest format — **all of it deleted by D1 Time Travel.** This was item 4 in the audit; it is the one genuinely wasted effort on the list. The manual export covers the gap. |
| ❌ **`keepRevisionForever`** | Already withdrawn: Drive caps pinned revisions ~200/file, so pinning every write risks turning a safety feature into a write failure. |
| ❌ **Drive `modifiedTime` conflict guard** | The *design* (a version column) carries over; the Drive implementation does not. Do it once, in the DB, as `version`. |

**Net:** three small durable items, two of which are migration prep. Everything
else waits.

-----

## 8. Risks, named

| Risk | Mitigation |
|---|---|
| **The Worker is a new single point of failure** | It is also the only place to enforce rules. Accept deliberately; keep the Drive adapter for a release or two. |
| **Auth is the real work, not the schema** | Verify the APS token server-side — reuses the existing model, adds no accounts. |
| **Losing "open the JSON in Drive and read it"** | Genuinely useful today. Replace with an admin read-only JSON endpoint + the Export button. Do not skip this; debuggability was load-bearing. |
| **Half-migrating** | The three tracks in §2 are independent. Move Track A only. Track B staying on Drive is the plan, not an unfinished state. |
| **Over-normalizing on day one** | §4. Documents as rows first. |
| **Deleting the Drive files too early** | §6 step 6. They cost nothing to keep. |

-----

## 9. Rough shape of the work

Not estimates — sequence. Each step is independently shippable and leaves the app
working.

1. `sharedStore.js` seam + write tripwire + Export Everything *(pre-migration,
   durable — see §7)*
2. **Phase A** (`docs/PHASE_A_PLAN.md`) — private hosting + the Worker +
   server-side login. Standalone value; also removes most of Phase C's cost.
3. D1 with the two tables from §4, behind the Worker Phase A already built
3. A `storageBackend` switch behind `toolStore` / `sharedStore`; D1 adapter
   alongside the Drive one
4. Import script that reads the export zip; verification by counts
5. Cutover per §6
6. *(Later, unhurried)* normalize hot columns; move the audit log server-side;
   consider R2 for blobs

-----

## 10. The decision this rests on

> **Migrate before the app is load-bearing, not after.**

It "isn't running the business yet but will be soon." Migrating an ERP under
production load is a materially harder and more dangerous project than migrating
one that two people can step out of for an evening. The window that makes §6's
simple cutover acceptable is open now and closes on its own.
