# Holder workflow — the state table

**What this is.** The one place that says which states a holder can be in and
what each action does in each of them. `CLAUDE.md` explains *why* each rule is
what it is; this says *what happens*, so the whole workflow can be checked
against intent in one sitting instead of a cell at a time.

Every row is asserted by `src/schema/holderLifecycle.test.js`, which walks the
whole workflow end to end against the real reference library. If this document
and the code disagree, that test fails.

-----

## The premise, in three lines

Three copies of a holder's geometry exist, and they do not update each other:

| Copy | Written by | Updates itself? |
|---|---|---|
| **The app record** (`holder_library.json`) | this app | — it is the source of truth |
| **The Fusion holder entry** | Fusion, and this app's **Push** | no |
| **A frozen snapshot inside every tool** | Fusion, at the moment a tool is made | **never** — only a tool write replaces it |

Fusion's holder **GUID is not an identity** — it churns. So identity is
constructed: **`holder_ref`** (our ID, stamped into Fusion's `product-id`)
**AND** a **segment match** within `0.001"`. Both must agree.

-----

## Invariants

Numbered so the test can name what it is protecting.

- **I1 — Both signals, or flag.** Nothing is written to a Fusion entry unless
  the ref and the shape agree on one record, or one of the two named bootstrap
  cases below applies. Everything else is reported, never guessed.
- **I2 — One record, one Fusion entry.** A record is written to at most one
  entry per push.
- **I3 — The GUID is never an identity.** No decision about *which holder this
  is* reads a GUID. It survives as a last-resort hint when there is no geometry.
- **I4 — Settling.** A push run twice has nothing to do the second time.
- **I5 — One question, one rule.** "Are these the same holder?" is
  `segmentsMatch` everywhere — identity, staleness, `last_pushed`, duplicates.
- **I6 — Archived is invisible.** No matcher, resolver or picker may return an
  archived record.
- **I7 — Nothing is destroyed.** Retiring or merging archives the record; only
  Fusion's copy is deleted, and only when identified with the certainty of I1.
- **I8 — Every flag is clearable.** The action that fixes a flag makes the
  detector stop firing, with no reload.

-----

## Where this sits in first-time setup

The holder work is a **setup step of its own** — `holdersLinked`, *"Set up the
holder library"* — placed in `SETUP_STEPS` immediately after **Normalize the
library** and before **Merge ProShop data**.

That position is deliberate: connecting the library, normalizing it, and getting
the holders under control are all one job — **getting the Fusion data right**.
ProShop is a different system and can come before or after; the holder step
cannot come *before* the tool library is normalized, because linking matches
against tools that must already exist and carry tracking IDs.

Step 1 (**Connect Fusion library**) links the holder library *file*. This step is
the work: import → normalize names → merge duplicates → link tools → push.
Settings lists those five in order underneath it, with a button to the Holders
page; the same order, plus the "edit here, not in Fusion" rule, is on the
Holders page itself in `HolderWorkflowBanner`.

**It checks itself off from the data, not from a click** — a live holder record
exists AND at least one assembly carries a `holder_id`. A shop that did the
holder work before this step existed checks off on load. Correspondingly it is
**not** part of the established-shop seed: a library set up before the holder
feature genuinely still has this to do, and saying otherwise would hide it.

-----

## Holder states

What the app can conclude about one Fusion entry, and what put it there.
Produced by `matchFusionHolder` (`src/schema/holderIdentity.js`), plus two
states the push plan adds from context.

| State | Ref | Shape | What put you here |
|---|---|---|---|
| **`none`** | — | — | A Fusion holder the app has never imported |
| **`exact`** | ✓ | ✓ | Settled. The normal state |
| **`geometry-only`** | — | ✓ | Never pushed yet, or the `product-id` was cleared in Fusion |
| **`ref-only`** | ✓ | ✗ | Either **you redrew it here**, or someone edited it in Fusion. `last_pushed` decides which |
| **`conflict`** | → A | → B | The ID says one record, the shape says another |
| **`ambiguous`** | — | → 2+ | Two app records share one shape — merge them first |
| **`duplicate-entry`** | ✓ | ✓ | A *second* Fusion entry resolving to a record already written this push |
| **`fusion-copy`** | ✓ | ✗ | `ref-only`, **and** another entry already matches that record exactly — so this is a copy made in Fusion |

Record-side states that are not entry statuses:

| State | Means |
|---|---|
| **never pushed** | `last_pushed == null` — Fusion has no copy yet |
| **unmatched** | No Fusion entry resolves to it → the push **creates** one |
| **archived** | Merged away or retired. Invisible to every matcher (**I6**) |

-----

## What each action does, per state

### Import from Fusion
`AppContext.importHoldersFromFusion`

| State | Action |
|---|---|
| `none` | **Import** as a new record, minting a `holder_ref` |
| retired (see below) | **Skip**, counted and reported — it is going to be deleted, not adopted |
| `exact` | **Skip** — already known |
| everything else | **Flag**, not imported. A half-match is a person's call |

Immediately afterwards the **first push runs itself**, scoped to *only* the
records just created — so it can only ADOPT, never create or delete.

### Push to Fusion
`holderPushPlan` → `applyHolderPushPlan`. Order matters and is the order below.

| State | Action | Why |
|---|---|---|
| entry belongs to a **retired** record | **DELETE** the Fusion entry | Checked first: a retired ref still resolves to the survivor, so leaving it later would file it as an update |
| `duplicate-entry` | **Flag**, write nothing | **I2** |
| `exact` | **Update** — but only if a diff exists (`stale`) | A settled holder is untouched, not "refreshed" |
| `ref-only` **and** Fusion still holds `last_pushed` | **Update** | Fusion didn't move → the change is ours to write |
| `ref-only` **and** Fusion differs from `last_pushed` | **Flag** | Fusion moved. This is the real "edited in Fusion" |
| `fusion-copy` | **Flag** with an accurate reason | Detection only — resolution is an open TODO |
| `geometry-only`, exactly 1 record, **blank** `product-id` | **ADOPT** — stamp our ID | The bootstrap that lets a first push land. Nothing is overwritten |
| `geometry-only` otherwise / `conflict` / `ambiguous` | **Flag** | **I1** |
| `none`, but exactly one **archived** record has that shape | **DELETE** | A holder retired before it was ever pushed |
| `none` | **Skip** | Not ours |
| record with no entry, **active** | **CREATE**, named in the dialog | |
| record with no entry, **archived** | **Skip** | Retired, not missing |

Deletions are named and **tick-gated** — the one irreversible thing a push does.
After a successful write each record's `last_pushed` and `fusion_guid` are
stamped **from the entry that was written**, read back by `holder_ref` (never by
index — deletes shift indices).

### Link tools to holders
`backfillHolderIds` (silent, at load) then `buildHolderLinkPlan` (the worklist).

Resolution order for one assembly — **shape before GUID** (**I3**):

1. its stored **`holder_id`**, if it still resolves to a live record
2. the baked **segments**, when exactly one record has that shape
3. the baked **GUID**, last — only for a holder with no usable geometry, or to
   break a tie when two records share a shape

| Tier | Meaning | Offered |
|---|---|---|
| **exact** | Segments match one record | Already linked silently; appears only if a stored `holder_id` points at a deleted record |
| **near** | ONE dimension out, < 5mm, **and the descriptions agree** | Pre-ticked, still confirmed |
| **confirm** | Auto-linked on **one** signal only — see below | Pre-filled with the guess, changeable |
| **candidate / none** | Plausible by name or gauge, or nothing to match on | Manual pick |
| **skipped** | A **turning tool** — carries no holder in Fusion at all | Out of scope; named in the dialog. See the TODO in `CLAUDE.md` |

**Auto-match always, silent only when certain** (`matchBakedHolder`). A tool's
baked holder carries the same two signals the Fusion library does — our
`holder_ref` in its `product-id`, and the segments:

| Signals | Result |
|---|---|
| **ref + shape agree** | Certain → linked silently |
| **shape only, no ref baked in** | Certain → linked silently. ⚠️ Every tool copied *before* the first push is in this state, so treating it as uncertain would put the whole library on a confirmation list. Measured on the real export: **212 of 221 linked, 3 asked about** |
| **ref and shape disagree** | Linked to the **shape** (what the tool actually carries) → **confirm** |
| **ref only** / **guid only** | Linked → **confirm** |
| nothing resolves | Not linked → **candidate / none** |

A guessed link is marked `_linkGuess` at load — runtime only, never persisted —
so once the user confirms it, the stored `holder_id` arrives clean on the next
load and the row stops appearing. ⚠️ Confirming counts as a **real change even
when the holder doesn't move** (**I8**): the guess was never persisted, so a
"same id → nothing to do" shortcut made accepting it a no-op that re-flagged on
every load. As holder refs get baked into new tools, the
check strengthens by itself.

⚠️ The description check is not optional: a length family (`-60/-90/-120/-150`)
puts every sibling one dimension from the others, and a different stickout of
the same parts looks numerically identical to a drawing difference.

**Committing does two things**: stores the FK **and rewrites to Fusion every
tool whose baked copy disagrees with the record it was just linked to.** An
assembly pointing at an **archived** record is deliberately *not* skipped — that
holder is retired, so the tool needs a new one.

### Re-stamp
`restampHolderTools` → `writeToolsToFusion`.

| State | Action |
|---|---|
| tools carrying older geometry | Preview each tool's **old → new assembly gauge**, then write |
| a tool whose link is an **unconfirmed guess** | Listed, but **starts unticked** — re-stamping would bake the guess into Fusion permanently. Confirm it in *Link tools*, or tick that one tool by hand |
| all tools current | A quiet line, **no call to action** |
| holder is **archived** | **Not offered.** The banner names the tools still pointing there and sends them to *Link tools* |

The write refreshes each tool's `_instancesRaw` to what it just wrote, so the
stale flag clears without a reload (**I8**).

### Merge duplicates
`compareHolders` → `applyHolderMerge`.

Two records are **never** offered as a merge when they disagree on **taper,
type, collet family, collet size, or extension collet** — those say what the
holder physically *is*, and a different collet is a different bore. What stays
"possible" is a label discrepancy on what could still be one object.

On merge: the survivor absorbs the loser's Fusion GUIDs and its `holder_ref`
into `legacy_ids`; the loser is **archived**, not dropped (**I7**); tools are
repointed in memory immediately; the loser's Fusion entry is deleted on the next
push.

### Retire / Restore
`deleteHolderRecord` archives (the action is **Retire**, not Delete).
Its Fusion entry is deleted on the next push — identified by its retired ref,
or by shape if it was retired before it was ever pushed.

**Retiring a holder that is IN USE asks where its tools go** (`RetireHolderModal`).
A retired record is invisible to `resolveHolderForWrite`, so any tool left on one
silently reverts to Fusion's geometry on its next ordinary save — one tool at a
time, with nothing on screen. So:

| Situation | What the modal does |
|---|---|
| Library **not normalized** | **Blocked.** "Which tools use this" is read off assemblies, which don't exist yet — the count reads 0 and would say "nothing uses this" about a holder half the shop runs |
| **0 tools** use it | Straight confirm |
| **N tools** use it | **Requires a replacement.** Pick the better-drawn record; every tool moves onto it and gets its geometry corrected in Fusion, then the old one retires — one commit, tools moved **first** so a failed re-link can never leave them stranded |

The replacement needs **no relation** to the record being retired — different
segments, a gauge several mm apart, unrelated Fusion GUIDs. Nothing in this
flow reads a GUID. Each tool's **assembly gauge before → after** is previewed
(the same `gaugeChecks` backstop re-stamp uses), because swapping to a holder
drawn 8mm differently moves every one of those tools by 8mm — and a change over
10mm is called out as implausible.

**Move ≠ Merge, and both are offered.** *Move* = these tools now run a
**different** holder; the retired record keeps its own identity, so a future
Fusion entry carrying its old ref does **not** resolve to the replacement.
*Merge* = the two records were the **same** holder all along; the survivor
absorbs the ref and GUIDs and **no tool is rewritten**. The modal links to
Duplicates rather than duplicating that flow.

**Restore is a COPY**: new `id`, new `holder_ref`, no Fusion link, no push
history. Reviving the old identity would re-attach every tool still carrying its
GUID to the geometry the archive was retiring.

-----

## A tool arrives carrying OLDER holder data

The everyday case: a holder is corrected here, then a tool built in Fusion — or
synced back from a job — arrives with the **old** frozen copy. Four routes in,
one answer. Asserted by `src/schema/arrivingHolder.test.js`.

| Route | What happens |
|---|---|
| **Built in Fusion, dumped into the library** | Load-time `backfillHolderIds` links it — its **shape no longer matches**, so the baked **GUID** carries it. `staleHolderTools` flags it. Fixed by Re-stamp or any ordinary save |
| **Sync Job** (one tool or a whole job) | The assembly `DiffStep` creates has `holder_guid` and **no** `holder_id`, and the commit runs before any backfill — so `resolveHolderForWrite` resolves on the guid and **writes the corrected geometry at commit time**. It arrives already fixed |
| **New assembly added in the app** | Picked from the holder library, so it carries the record from the start |
| **Reconcile on open** | An adopted stray is registered, then follows the first row |

Two ways it can fail to resolve, neither silent and neither destructive:

| | |
|---|---|
| The GUID **also churned** | Nothing resolves → it appears in **Link tools to holders** for a person to pick |
| The holder was **retired** first | Archived is invisible (**I6**) → link worklist, and the write **falls back to the Fusion entry** so the tool keeps the holder it has rather than being written with none |

-----

## Tool link states

Independent of the holder's state.

| State | Detected by | Fixed by |
|---|---|---|
| **unlinked** | no `holder_id` | Link tools to holders |
| **linked, current** | baked segments match the record | — |
| **linked, stale** | `staleHolderTools` | Re-stamp, or any ordinary save of that tool |
| **pointing at an archived record** | `holder_id` resolves to nothing live | Link tools to holders |

⚠️ Staleness asks **one** question — is the *geometry* out of date — with the
same `segmentsMatch` rule identity uses (**I5**). A changed baked GUID is **not**
staleness; Fusion re-issues those constantly.

-----

## Deliberately not decided

- **A holder duplicated inside Fusion.** Detection is built (`fusion-copy`);
  the resolution is not, because it depends on what Fusion actually does to
  `product-id` and `guid` on duplicate. See the TODO in `CLAUDE.md`.
- **Holder locations** are free text, not the structured Location System.
- **`holder_ref` is internal plumbing**, not a fourth configurable ID system.
