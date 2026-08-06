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
| **candidate / none** | Plausible by name or gauge, or nothing to match on | Manual pick |

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

**Restore is a COPY**: new `id`, new `holder_ref`, no Fusion link, no push
history. Reviving the old identity would re-attach every tool still carrying its
GUID to the geometry the archive was retiring.

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
