# Fusion-Decoupling Follow-Up Audit — Findings & Fix Plan

**Date:** 2026-07-11
**Scope:** verify the shipped Fusion-decoupling work (Phase A complete record, Phase B no-Fusion tools / promote / detach / Fusion-off toggle / drift surfacing) against `FUSION_DECOUPLING_AUDIT.md` and `PHASE_A_TOOL_RECORD_SCHEMA.md`, and hunt for bugs the docs' green-test baseline doesn't cover.
**How to use this doc:** each finding has a severity, exact file/function references, and a step-by-step fix plan written so a smaller model can implement it. Do the 🔴 items first; each is independently shippable. Add the listed regression test with each fix.

**Note on verification depth:** G1–G4 were traced end-to-end in code. G5–G8 and the suggestions are code-read findings; confirm each against the running app before/while fixing.

---

## Summary table

| # | Severity | Finding | Files |
|---|---|---|---|
| G1 | 🔴 Data loss — ✅ **FIXED** | `normalizeLibrary` → `saveFullLibrary(cleanTools)` wiped metadata records not in the passed set — **no-Fusion tools' metadata is their ONLY store**, so they were permanently deleted | `libraryOps.js` |
| G2 | 🔴 Consistency — ✅ **FIXED** | `deleteTool` ignored the shop-wide `integrations.fusion.enabled === false` mode — it round-tripped APS (and deleted Fusion entries) while "Fusion sync is off" | `toolActions.js` |
| G3 | 🟠 Data loss (silent) — ✅ **FIXED** | `saveFullLibrary` with Google Drive not connected silently dropped every no-Fusion tool's data (metadata write skipped, but the tool re-materialized in memory and looked saved) | `libraryOps.js` |
| G4 | 🟠 Data loss (silent) — ✅ **FIXED** | `assignToolIds` / `renumberAllToolIds` / `renumberLibrary` counted no-Fusion tools as assigned even when Drive is disconnected — their new IDs/numbers existed only in memory and vanished on reload | `libraryOps.js` |
| G5 | 🟡 Staleness — ✅ **FIXED** | O1 violation: the flat speed/feed mirror was not recomputed from preset 0 on the no-Fusion write path (self-healed on reload, stale in memory until then) | `toolActions.js`, `logicalTools.js` |
| G6 | 🟠 Data loss (confirmed) — ✅ **FIXED** | `normalizeLibrary`'s "conflict tools' raw entries left untouched" claim was FALSE — `saveFullLibrary`'s full-replace **deleted** conflict tools' Fusion entries during migration whenever their library also held a clean tool | `libraryOps.js` |
| G7 | 🟡 Edge — ✅ **FIXED** | `detachToolFromFusion` two-step ordering (a metadata-write failure after Fusion removal could turn the tool into an invisible dormant orphan) + no-library guard + Fusion-off guard | `toolActions.js` |
| G8 | ⚪ Doc drift — ✅ **FIXED** | CLAUDE.md "Orphaned metadata is never pruned" was false; updated in the G1 commit to state bulk saves merge-by-id and never prune | CLAUDE.md |

---

## G1 — `normalizeLibrary` permanently deletes no-Fusion tools' metadata 🔴 ✅ FIXED

> **Fixed 2026-07-11.** `saveFullLibrary` (`libraryOps.js`) now loads the existing `tool_metadata.json`, overlays this save's records by `id`, and writes the merged set — so records not in the passed set (no-Fusion tools, conflict tools, dormant orphans) survive. In-memory re-materialization (`materializeUnlinkedTools`) now runs against the full merged set, so no-Fusion tools also survive a normalize on screen. Covered by a new `libraryOps.test.js` case; CLAUDE.md's "orphaned metadata" bullet updated (closes G8). Always-merge is safe because no caller relies on replace-to-delete (deletion is `deleteTool`'s job), and a first-run import file is empty (merge == replace), so no `replaceAllMetadata` option was needed. Full suite 235 green, round-trip audit 0 diffs.

**The chain (all verified in code):**

1. `driveService.saveAllMetadata(metaList)` **replaces the entire `tool_metadata.json`** with exactly the list passed (`driveService.js:165–167`).
2. `saveFullLibrary(tools)` (`libraryOps.js:28`) builds `allMeta` from **only the tools passed in** and calls `saveAllMetadata(allMeta)` (`libraryOps.js:79`). The doc rule "callers must pass the complete in-memory set" is what protects this.
3. `normalizeLibrary` (`libraryOps.js:485`) builds its tool list **from the downloaded Fusion libraries only** (`downloadAllLibraries()` → `groupByTrackingId` → per-library loop) and then calls `saveFullLibrary(cleanTools)` (`libraryOps.js:606`).

No-Fusion tools (`no_fusion_link: true`, zero Fusion instances) are never in `perLib`, are never added to `cleanTools`, and are therefore **absent from `allMeta`** → the whole-file replace deletes their metadata records. Since metadata is a no-Fusion tool's *only* store (per `PHASE_A_TOOL_RECORD_SCHEMA.md` §5), the tools are gone permanently. `conflictTools` (excluded at `libraryOps.js:602`) lose their metadata records the same way (notes/tags/assemblies/purchasing), and dormant orphan metadata is pruned too (see G8).

**Also exposed:** the ImportFlow initial-import path (`ImportFlow.jsx:202`, `saveFullLibrary(numbered)`) passes only the imported `fusionTools`. For a *first* import that's by design ("Replace the entire metadata file — used by the import flow"), but a **re-run** of the importer after no-Fusion tools exist has the same wipe behavior.

### Fix plan (choose the structural fix, not per-caller patching)

Make `saveFullLibrary` **merge-by-id instead of blind replace**:

1. In `saveFullLibrary`, when `googleRef.current`, first `const existing = await driveService.loadMetadata()`.
2. Build `const metaById = new Map(existing.map(m => [m.id, m]))`, then `for (const m of allMeta) metaById.set(m.id, m)`.
3. `await driveService.saveAllMetadata([...metaById.values()])`.
4. This preserves: no-Fusion tools not in the passed set, conflict tools' records, dormant orphan metadata (matching the CLAUDE.md contract). Records for tools deliberately deleted still get removed by `deleteTool`'s own `deleteMetadata` path, so nothing regresses.
5. **ImportFlow caveat:** the initial import deliberately wants a clean file. Give `saveFullLibrary` an options arg `{ replaceAllMetadata = false }` and pass `true` only from `ImportFlow.handleSaveToDrive` — and even there, prefer merging when `state.tools` already contains `no_fusion_link` tools not present in the import (safest: always merge; a first-run file is empty anyway, so merge == replace).
6. Additionally, in `normalizeLibrary`, re-materialize no-Fusion tools into the final `SET_TOOLS` dispatch — today `saveFullLibrary` handles the dispatch and only re-materializes from `allMeta` (which lacked them). Once step 1–3 land, pass the merged list to `materializeUnlinkedTools` inside `saveFullLibrary` (i.e. materialize from `[...metaById.values()]`, not from `allMeta`) so no-Fusion tools also survive **in memory** across a normalize.

**Regression test (add to `libraryOps.test.js`):** mock Drive with a metadata file containing one linked record + one `no_fusion_link: true` record; call `saveFullLibrary` with only the linked tool; assert the saved metadata still contains the no-Fusion record, and that the returned/dispatched tool set still includes the materialized no-Fusion tool.

---

## G2 — `deleteTool` doesn't honor the Fusion-off mode 🔴 ✅ FIXED

> **Fixed 2026-07-11.** `deleteTool` now takes the metadata-only branch when `integrations.fusion.enabled === false` as well as for `no_fusion_link` tools — no APS round-trip while sync is off. **Chosen semantics:** metadata-only delete (consistent with the whole disabled-mode contract, where every write is metadata-only). A formerly-linked tool's Fusion entry is left untouched and resurfaces if Fusion is re-enabled — that re-enable is the reconcile point, rather than mutating the Fusion library while sync is off. *(This was going to be a user question — block vs. metadata-only — but the prompt was interrupted; metadata-only is the consistent default and is a one-line change to "block" if the owner prefers.)* Same `fusionDisabled` guard added to `promoteToolToFusion` / `detachToolFromFusion` (they were UI-gated only). New regression test in `toolActions.test.js`.

**Where:** `toolActions.js` `deleteTool` (~line 567). The early metadata-only branch checks only `tool?.no_fusion_link === true`. `writeLogicalTool` (line 43–44) treats `fusionDisabled = shopSettings.integrations.fusion.enabled === false` as equivalent to unlinked — `deleteTool` does not.

**Consequence:** with Fusion sync toggled off (B4b-1), every tool is built by `buildUnlinkedTool` with `no_fusion_link: false` preserved for formerly-linked tools. Deleting one of those tools takes the Fusion path: `downloadFusionList` + `uploadFusionList` — an APS round-trip **and a real Fusion-library mutation while the user believes sync is off**. This contradicts the B4b-1 contract ("`writeLogicalTool` routes ALL writes metadata-only when disabled") and can throw confusing errors if APS auth is stale in a Fusion-off session.

### Fix plan

1. At the top of `deleteTool`, compute `const fusionDisabled = shopSettingsRef.current?.integrations?.fusion?.enabled === false;`.
2. Extend the early branch to `if (tool?.no_fusion_link === true || fusionDisabled)`.
3. **Decide the re-enable semantics and document them in the code comment** (recommendation): with Fusion off, delete metadata only and leave the Fusion entries untouched — on re-enable the entries resurface as a tool (Fusion is co-edited; the app shouldn't mutate it while sync is off). If the owner would rather have delete mean delete-everywhere, instead **block** the delete with a toast: "Fusion sync is off — re-enable it to delete this tool from Fusion, or detach it first." Blocking is the safer default; silent divergence between stores is the thing this whole project exists to avoid.
4. Mirror the same check in `promoteToolToFusion` / `detachToolFromFusion` (they're already UI-gated on `fusionEnabled`, but the action itself should also guard — UI gating is not a contract).

**Regression test:** mocked-Drive test (same harness as the existing 6 no-Fusion write tests): with `integrations.fusion.enabled: false` and a formerly-linked tool, `deleteTool` must not call `downloadFusionList`/`uploadFusionList`.

---

## G3 — `saveFullLibrary` silently loses no-Fusion tools when Drive is disconnected 🟠 ✅ FIXED

> **Fixed 2026-07-11.** `saveFullLibrary` now throws before any Fusion write when the passed set contains a `no_fusion_link` tool and Drive is not connected ("Connect Google Drive to save — N of these tools exist only in metadata"). The `catch` surfaces it as a toast; no partial write happens. Regression test in `libraryOps.test.js`.

**Where:** `libraryOps.js:79` — `if (googleRef.current) await driveService.saveAllMetadata(allMeta);` then line 98 re-materializes the no-Fusion tools into in-memory state regardless.

**Consequence:** with Google disconnected (or token expired → `googleRef` cleared), a bulk save that includes no-Fusion tools writes their Fusion siblings, skips the metadata write, then puts the no-Fusion tools back on screen — the user sees "Saved N tools" and everything looks fine until the next reload, when the no-Fusion tools vanish. `writeLogicalTool`'s single-tool unlinked branch already throws "Connect Google Drive to save…" — the bulk path needs the same posture.

### Fix plan

1. In `saveFullLibrary`, before writing anything: `const noFusion = combinedTools.filter(t => t.no_fusion_link === true);`
2. `if (noFusion.length && !googleRef.current) throw new Error('Connect Google Drive to save — N of these tools exist only in metadata');` (the catch already surfaces it as a toast).
3. Same guard in the three bulk ID ops for their no-Fusion loops (see G4 — one shared guard is fine).

**Regression test:** `saveFullLibrary` with `googleRef.current = null` and one `no_fusion_link` tool → rejects, and `uploadFusionList` was never called (fail before partial writes).

---

## G4 — Bulk ID/number ops "assign" to no-Fusion tools without persisting 🟠 ✅ FIXED

> **Fixed 2026-07-11.** Chose option (a): `renumberLibrary`, `assignToolIds`, and `renumberAllToolIds` each throw at the top of their non-demo path when a candidate (non-excluded) no-Fusion tool exists and Drive is off — before any Fusion upload — so nothing is reported assigned that can't persist. `assignToolIds` additionally scopes the check to no-Fusion tools that still lack an ID (avoids a false block when all already have one). Regression test in `libraryOps.test.js`.

**Where:** `libraryOps.js` — `renumberLibrary` (no-Fusion loop at ~157), `assignToolIds` (~266), `renumberAllToolIds` (~430). Each updates `metaByTracking` for no-Fusion tools and increments `assigned`, but the only persistence is `if (googleRef.current) await driveService.saveAllMetadata(...)`. With Drive disconnected the success toast reports them assigned; the values exist only in the in-memory rebuild.

*(In practice no-Fusion tools can only have been loaded when Drive was connected, but the token can expire mid-session — `googleRef` then reads null while the tools are still in `toolsRef`.)*

### Fix plan

Pick one consistently (recommend a):

- **(a)** At the top of each op: if any candidate no-Fusion tool exists and `!googleRef.current`, throw before any Fusion upload ("Connect Google Drive — no-Fusion tools can't be renumbered without it").
- (b) Or skip no-Fusion tools when `!googleRef.current` and say so in the toast ("skipped N no-Fusion tools — Drive not connected").

**Regression test:** `assignToolIds` with a no-Fusion tool in `toolsRef` and `googleRef.current = null` → throws (or reports skip), and no Fusion upload happened before the throw.

---

## G5 — O1 (flat mirror = derived cache of preset 0) not enforced on the no-Fusion write path 🟡 ✅ FIXED

> **Fixed 2026-07-11.** Extracted the 9-field mirror recompute into a shared pure helper `presetZeroMirror(presets)` (`logicalTools.js`, re-exported via the schema barrel). It returns `{}` when there are no presets, so it never nulls flat values on a preset-less tool (e.g. one whose speeds/feeds came straight from a ProShop row). `buildUnlinkedTool` now uses it (load path), and the no-Fusion branch of `writeLogicalTool` spreads it into the written tool (save path). The linked path and `mergeTool`'s existing ad-hoc mirror block were left untouched (their `?? updated.x` keep-semantics differ intentionally; not worth changing the byte-for-byte linked path). Regression test in `toolActions.test.js`.

**Where:** `toolActions.js` `writeLogicalTool` unlinked branch (~line 123–143). It writes `{ ...tool }` metadata without recomputing `spindle_speed`/`cutting_feedrate`/… from `presets[0]`. `PHASE_A_TOOL_RECORD_SCHEMA.md` §4d says the mirror is "always recomputed from preset 0 on write, never independently editable."

**Consequence:** edit a no-Fusion tool's primary preset → save → cards/search facets/ProShop export read the stale flat values until the next full reload (`buildUnlinkedTool` recomputes at load, so it self-heals — no durable corruption, since `buildMetadataTool` doesn't persist the mirror at all). Inconsistent UX, and any code that trusts the in-memory mirror after save is wrong.

### Fix plan

1. Extract the 9-field mirror recompute that already exists in `buildUnlinkedTool` (`logicalTools.js:281–289`) into a small pure helper, e.g. `export function presetZeroMirror(presets)` in `logicalTools.js` returning the 9 fields (or `{}` when no presets).
2. Use it in `buildUnlinkedTool` and spread it into `toWrite` in `writeLogicalTool`'s unlinked branch: `...presetZeroMirror(tool.presets)`.
3. (Optional consistency) also spread it in the linked path's `toWrite` — `mergeTool` already does an ad-hoc version of this (`toolActions.js:522–533`); once the helper exists, replace that block with it too.

**Regression test:** unlinked save with `presets[0].n = 12000` and stale `spindle_speed: 8000` → returned tool has `spindle_speed 12000`.

---

## G6 — Conflict tools' Fusion entries deleted by `normalizeLibrary` 🟠 ✅ FIXED (upgraded from 🟡)

> **Confirmed a real data-loss bug, then fixed (2026-07-11).** A regression test proved it: with a clean tracked tool + a conflict pair (two tracked entries sharing a `product-id`, differing on a scalar) in one library, `normalizeLibrary` uploaded a library missing the conflict pair's entries — because `saveFullLibrary` full-replaces each represented library and conflict tools are held back from the passed set. **Fix:** `saveFullLibrary` gained an `extraRawByLibrary` option (Map libraryId → raw entries) that appends those entries **verbatim** (not re-split) to each library's upload and includes them in the in-memory rebuild; `normalizeLibrary` passes the conflict tools' `_instancesRaw` through it. The conflict pair now survives in Fusion and is re-flagged for reconcile on the next load. Other `saveFullLibrary` callers pass nothing → no behavior change. Test verified to fail without the fix. *(The metadata half of this loss was already covered by G1's merge-by-id.)*

**Original investigation note (kept for context):**

**Where:** `libraryOps.js:597–606`. The comment says conflict tools' "raw entries [are left] untouched in the library so nothing is destroyed" — but `saveFullLibrary` **full-replaces each represented library** with the instances of the tools passed, and `conflictTools` are excluded from that set. If a conflict tool's raw entries live in a library that IS represented by `cleanTools` (the normal case — same file), the full-replace upload would drop them.

**Action:** trace `combineToolsByToolId` / `_combineConflicts` (`src/schema/combine.js`) and write a unit test: one library containing a clean tool and a conflicted duplicate pair → run `normalizeLibrary` → assert the conflicted raws are still present in the uploaded list. If they're dropped, the fix is: in `normalizeLibrary`, append the conflict tools' `_instancesRaw` entries verbatim to the upload for their library (pass-through, no rewrite), or include `conflictTools` in the save with a "preserve raw" flag. **Note:** if the G1 fix lands first, the metadata half of this loss is already covered; this item is about the Fusion entries.

---

## G7 — Promote/detach edge hardening 🟡 ✅ FIXED

> **Fixed 2026-07-11.** (1) **Reordered detach to metadata-first:** `detachToolFromFusion` now writes the no-Fusion metadata mark *before* removing the Fusion entries. On analysis this is strictly safer than the original order — if the second step fails, the tool is already marked no-Fusion, so a reload shows it (as no-Fusion, or linked again from the still-present entries); it never becomes an invisible dormant orphan (no Fusion entries + unmarked metadata), which the original order risked on a metadata-write failure. In-memory state updates only after both steps succeed, so a failure leaves the tool linked and detach is safely re-runnable. (2) **No-library guard (G7.2):** the Fusion-removal step is skipped when there is no library to target. (3) **Fusion-off guard (G7.3):** added in the G2 commit. Two regression tests (the existing detach test still passes under the new order; a new no-library test). The original text below stands as the analysis record.

**Where:** `toolActions.js` `promoteToolToFusion` / `detachToolFromFusion` (~758–819).

1. **Detach is two non-atomic writes:** Fusion entries are removed first, then the metadata-only write runs. If the metadata write fails (Drive token expiry — the exact failure `writeLogicalTool` throws on), the Fusion entries are already gone but the in-memory/metadata record still says linked with dead `instance_guid`s. **Fix:** reorder — write the metadata (with `no_fusion_link: true`, guids nulled) *first*, then remove the Fusion entries; a failure after the metadata write leaves harmless orphan Fusion entries that the next reconcile-on-open… will NOT see (reconcile is skipped for no-Fusion tools) — so instead surface a retryable toast: "Detached, but the Fusion entries could not be removed — run Detach again to clean them up," and make detach idempotent (safe to re-run when already `no_fusion_link` but stale entries match by tracking id).
2. **`detachToolFromFusion` with no library:** `tool.library_id || defaultToolLibraryId(...)` can be null (e.g. Fusion previously disabled); `downloadFusionList(null)` behavior is undefined. Guard: if no library id, skip the Fusion-removal step and go straight to the metadata write.
3. Add the `fusionDisabled` guard from G2 to both actions.

---

## G8 — Doc drift + design decision: metadata pruning ⚪

CLAUDE.md ("Key Constraints → Orphaned metadata is harmless but permanent — no prune/cleanup pass exists **anywhere**") is stale: `saveFullLibrary`'s whole-file replace *is* a prune, and after G1's merge fix it stops being one. Also the orphan-ghost guard (`isUnlinkedMeta`) depends on dormant orphan metadata *persisting* — pruning it via bulk saves was silently changing that contract.

**Action:** after G1, update CLAUDE.md's bullet to say bulk saves merge-by-id and never prune; if the shop ever wants cleanup, build it as an explicit Settings action ("Prune metadata records with no matching tool") with a preview list — never as a side effect.

---

## Doc-vs-code checklist (what I verified as matching the docs)

- ✅ Phase A complete record: `buildMetadataTool` persists all §4a/4b scalars + full `presets[]`; `mergeFusionAndMetadata` reads them back Fusion-wins (`?? meta` fallbacks) — matches Increment 1/2 exactly.
- ✅ B1/B2: `buildUnlinkedTool` / `isUnlinkedMeta` orphan-ghost guard / `materializeUnlinkedTools` triple guard — as documented.
- ✅ B3: `writeLogicalTool` early metadata-only branch, Drive required, `library_id` nulled; `saveFullLibrary` partitions no-Fusion tools out of the Fusion writes (placeholder-minting retired). *(But see G1/G3 for the metadata half of that partition.)*
- ✅ B4a: promote/detach exist and mint/clear instance guids as documented *(see G7 edges)*.
- ✅ B4b-1: `writeLogicalTool` honors `fusionDisabled`; `buildUnlinkedTool` preserves `no_fusion_link: false` so re-enable doesn't spuriously detach. *(But `deleteTool` was missed — G2.)*
- ✅ B5a/B5b + write-time net (D3): `detectFusionDrift` scans every instance; the three 3-way merges (`mergePresetsWithFusion`, `mergeSharedFieldsWithFusion`, `mergeInstanceFieldsWithFusion`) adopt Fusion-only changes and accumulate both-edited conflicts; `writeLogicalTool` toasts + re-attaches scalar conflicts to `_drift`; a clean save clears `_drift`. Matches the doc's description.
- ✅ ID-system membership: bulk ops process no-Fusion tools and skip only excluded ones *(see G4 for the Drive-disconnected hole)*.
- ✅ F1–F6 fixes from the audit are present in code (`derivePairings` fill-only re-link, asm-stamp skip, component-row intercept via `existingCompByNum`, ComponentPicker duplicate guard, preset-copy clears `job_ids`, `persistJobsNow`).
- ⏳ B4b-2 (never-connect-Autodesk gate) confirmed still deferred — `App.jsx` gates unchanged. This remains the biggest UX gap for a truly Fusion-optional shop.

---

## Suggestions (workflow / data structure / user clarity) — not bugs, prioritized

**Status (2026-07-11):** #1, #2, #5, #7 implemented this session; #8 was already present in `DriftBanner`. #3, #4, #6 are the remaining architectural/infra items — see the note after the list for why they're sequenced separately.

1. ✅ **DONE** — **Make "Fusion off / no-Fusion" state visible at the library level.** Today the "Not in Fusion" pill is per-card and the Fusion-off note is per-tool. Add one persistent topbar chip when `integrations.fusion.enabled === false` ("Fusion sync off") — the G2 class of confusion ("why did/didn't this touch Fusion?") is much cheaper to prevent with an always-visible mode indicator. Cheap: a small badge in `TopBar` reading `fusionEnabled` from context.
2. ✅ **DONE** — **Drift for presets in the DriftBanner.** `_drift` now carries `{kind}` info rows (preset/OOH/holder), rendered non-actionable so both-edited conflicts survive past the toast.
3. ✅ **DONE** — **Formalize the repository seam before SQLite.** `src/services/toolStore.js` (`loadAll` / `upsertMany` / `upsertOne` / `deleteById`) now fronts every metadata read/write across `libraryOps`, `toolActions`, `attachmentActions`, and `AppContext`. `upsertMany` merges by id (the G1 invariant now lives in the seam, not each caller). Dedicated `toolStore.test.js`; 245 tests + audit + build green; existing tests unchanged (they mock `driveService`, which the seam delegates to). One swap point for SQLite.
4. ⏳ **PENDING (decided: BLOCK on conflict + notify why).** **`modifiedTime` conflict stamp for multi-device.** Store the metadata file's Drive `modifiedTime` at load; on save, if it changed, **block the write** and notify the user why ("Someone else saved metadata since you loaded — reload to get their changes, then retry"). Owner chose block-not-warn. Touches `driveService` (thread `modifiedTime` through `driveGet`/`loadMetadata` and return it from the write), `toolStore`/`AppContext` (hold the stamp; compare in `upsertMany`/`upsertOne`), and surface a clear toast. Note: `upsertOne`/`deleteById` already re-read before writing and `upsertMany` merges by id, so this is the *last-mile* guard against a same-record concurrent clobber, not the whole safety net.
5. ✅ **DONE** — **Promote flow: pick the target library.** `promoteToolToFusion(toolId, targetLibraryId)` + a picker modal for multi-library shops.
6. ⏳ **DEFERRED to the SQLite migration.** **Retire `no_fusion_link` → `is_linked`.** Pure rename of a *persisted* field across ~15 sites for zero functional benefit and nonzero regression risk. The schema doc says flip it "in one pass" at the SQLite swap; doing it in isolation now is cost without payoff. (Owner: "your call" → deferred.)
7. ✅ **DONE** — **"IDs out of date" nudge** in location ID mode (Settings Tool ID card).
8. ✅ **DONE (already present)** — **DriftBanner bulk actions** ("Keep all Fusion" / "Keep all app").

### Why #3, #4, #6 are sequenced separately

They're infrastructure/cleanup, not user-facing features: #3 is a persistence-layer refactor (its value is *preventing* future bugs and easing the SQLite swap — worth doing, but as a focused change with its own test pass), #4 needs a product decision (block vs. warn on concurrent edit) and touches the save hot path, and #6 is a risky persisted-field rename with no functional benefit that the schema doc explicitly slots into the SQLite migration. Recommendation: do #3 next as its own change, decide #4's UX then implement, and fold #6 into the SQLite work.

---

## Suggested fix order (for the implementing model)

1. **G1** (metadata merge-by-id in `saveFullLibrary`) + its test — highest data-loss risk, small diff.
2. **G3 + G4** (Drive-required guards on bulk ops) — same files, same test harness, do together.
3. **G2** (deleteTool fusionDisabled) + **G7.3** (same guard on promote/detach).
4. **G5** (`presetZeroMirror` helper) — small, pure, easy tests.
5. **G7.1/7.2** (detach ordering + null-library guard).
6. **G6** (write the verification test; fix only if it fails).
7. **G8** (doc update) + suggestions as owner-approved follow-ups.

After each: `npm run lint && npm test` and `node scripts/roundtrip-audit.mjs` must stay green; none of these fixes may touch the linked-tool write path's byte-for-byte behavior (the "linked tools = current code path" rule from the decoupling audit).

---

## Future feature — Universal Change Log / Audit Trail (owner idea, 2026-07-11)

**Goal (owner's words, lightly structured):** capture *every* change and event so the shop can see what happened, when, and who did it — across the whole app, not just tools. Two views of the same log:

1. **Scoped, in-context history** — per-tool history in the tool view (this partly exists via `merge_history`), shop settings changes on the Settings page, vendor changes on the Vendors page, materials on the Materials page, programs on the Programs page, and so on for every page.
2. **A "mega" change log in Settings** — one global feed of everything, filterable by **category** (Tools / Settings / Vendors / Materials / Programs / Jobs / Locations / …).

**What each entry should capture:** the **fields that changed** (old → new), **things added**, **things deleted**, plus **who** and **when**. For a change **pushed in from Fusion** (detected via drift / reconcile / the write-time 3-way merge), the actor is simply **"Fusion"** — we can't know the real person who edited it in Fusion 360.

**Status:** partially implemented today and **not fully working** — `merge_history[]` on tools (Sync Job commits) and the drift/conflict surfaces are the closest existing pieces, but there is no unified event log, no coverage of settings/vendors/materials/programs edits, and no global feed. **Held for later** per the owner; capturing here so it isn't lost.

### Engineering notes for when this is picked up (this IS a big feature — flag scope before building)

- **It's a genuinely large, cross-cutting feature** (touches every write path and every editor page + a new data store + new UI) — treat it as its own project with an explicit scope sign-off, not a quick add. The current `merge_history` is tool-only and merge-only; generalizing it is the bulk of the work.
- **Sequence it *with or after* the SQLite migration, not before.** An append-only `audit_log` table `(id, at, actor, category, entity_type, entity_id, action ['create'|'update'|'delete'], field, old_value, new_value, source ['app'|'fusion'|'proshop'|'import'])` is the natural shape — one row per changed field. Building this on the current whole-file-JSON Drive storage would mean rewriting a growing log file on every edit (slow, and last-writer-wins would *lose* concurrent log entries — the exact multi-device problem #4 flags). **The repository seam (#3, now built) is the right capture point**: every metadata write already funnels through `toolStore`, and the shared-file writes through `saveSharedFile` — those two seams are where change events can be emitted once, centrally, instead of hand-instrumenting every action.
- **Actor identity:** app edits already carry `updated_by` (Google account); wire that through as the log actor. Fusion-sourced changes (from `detectFusionDrift` / the write-time `conflicts` accumulator / reconcile) log actor `"Fusion"`. ProShop import logs `"ProShop import"`.
- **Diffing:** the field-level diff machinery already exists for tools (`detectFusionDrift` / `DRIFT_FIELDS`, the combine `_combineConflicts`) — reuse the same shape (`{field, old, new}`) so the log format is consistent across sources.
- **Open questions to refine with the owner later:** (a) retention — keep forever, or cap/rotate? (b) do settings/vendor/material edits need per-field granularity or is "X edited the vendor registry" enough? (c) should the global feed be searchable by entity (e.g. "everything that touched tool A-3")? (d) is the actor always the signed-in Google user, or should there be a shop-user concept?

## Future UX — Surface the non-obvious "what just happened" moments (owner ask, 2026-07-11)

The owner's related point: we've worked hard on the *correctness* of sync/conflict handling; the complement is making sure the user can *see* what the app is doing. We already toast most actions, but several behaviors are currently **silent or non-obvious** and worth an explicit surface (small, do opportunistically):

- **Load-time auto-combine** (`combineToolsByToolId`) silently folds same-`tool_id` duplicates into one tool on every load — the user never sees that two entries became one. A one-line "Combined N duplicate entries on load" notice (like normalize already shows) would make it visible.
- **Load-time backfills** run invisibly: `backfillAsmNumbers` (assembly numbers), `derivePairings` (insert-tool auto-detection from a combined product-id), and `materializeUnlinkedTools` (no-Fusion tools). None announce themselves.
- **Metadata-only vs. Fusion writes:** with the new "Fusion sync off" badge (#1) this is better, but even in normal mode a no-Fusion tool's save doesn't make clear "this did NOT go to Fusion." The per-tool "Not in Fusion" note covers the tool page; a save toast could say "Saved (app only — not in Fusion)".
- **Lazy re-sync after normalize:** location normalization writes metadata only and re-syncs to Fusion's vendor field on each tool's *next individual save* — the user isn't told the Fusion side is briefly behind.
- **Write-time drift adoption:** when a save silently adopts a Fusion-only change (the "only Fusion changed it" branch of the 3-way merge), there's no toast — only the both-edited conflict toasts. Adopting a Fusion edit is arguably worth a quiet "Also pulled in N change(s) made in Fusion" note.

These overlap heavily with the change-log feature above — the audit trail is the durable version, and these toasts are the in-the-moment version. Recommend doing the toasts opportunistically (cheap) and the log as the larger project.
