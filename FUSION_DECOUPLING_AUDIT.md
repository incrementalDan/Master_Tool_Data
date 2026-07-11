# Audit: Insert-Tool Pairings, Program/Job Links & the Fusion-Decoupling Plan

**Date:** 2026-07-06
**Scope:** (1) audit the insert holder/insert component feature, (2) audit the program/job ↔ tool/preset link feature, (3) a concrete plan for letting tools exist *without* a Fusion entry (the "zero Fusion instances" TODO).
**Status:** findings + plan. **F1–F6 are FIXED** (F1/F2 with regression tests); **F7 is a deliberate won't-fix** (see below). The Part-3 decoupling plan is **largely built** — Phase A (complete record) and Phase B (no-Fusion tools, promote/detach, Fusion-off toggle, drift review incl. write-time conflict surfacing, ID-system membership) are all implemented; only B4b-2 (never-connect-Autodesk onboarding gate) and the SQLite storage swap remain deferred. See the implementation-status block in `PHASE_A_TOOL_RECORD_SCHEMA.md`.
**Baseline:** all unit tests pass (234); the round-trip audit runs clean (232 tools, 0 unexpected diffs).
**Follow-up (2026-07-11):** a later audit of the *shipped* Phase A/B work found and fixed 8 additional issues (G1–G8) — two migration-path data-loss bugs among them — plus implemented the repository seam (`toolStore`) and several UX/visibility improvements. See **`DECOUPLING_FOLLOWUP_FINDINGS.md`** (now at 245 tests, audit 0 diffs). Deferred items from that pass: multi-device block-on-conflict (#4), the `no_fusion_link → is_linked` rename (at SQLite time), and the Universal Change Log feature.

---

## Part 1 — Insert-Style Tools (holder body + insert) Audit

### What checks out

- **Components never leak into Fusion.** The `pairing` object and component records are metadata-only; `internalToFusionTool` writes `product-id` verbatim so combined IDs round-trip untouched (locked by `fusionConvert.test.js` and the round-trip audit).
- **ProShop component rows never mint placeholder tools.** `matchProShopToTools` intercepts rows whose Tool # matches one side of a combined ID *before* the tool-match/placeholder path, exactly as documented.
- **Unpair is correctly hidden** for tools whose Fusion product-id is a combined ID (unpairing would just re-derive on next load), and unpairing keeps component records (only the link is removed).
- **Asm-number stamping correctly skips turning (non-tier-3) families** — their `{holder}/{insert}` number is derived at render, never stored.
- Debounced `tool_components.json` writes are flushed on tab close (`flushSharedWrites` on `pagehide`), so a component edit in the last 600 ms isn't lost.

### Findings (ordered by severity)

#### 🔴 F1 — Stored pairings never re-link to their components ("re-linked on next load" is broken) — ✅ FIXED

**What happens:** `derivePairings` (`src/schema/insertFamilies.js`) skips any tool that already has a stored pairing (`if (t.pairing) return t` — "stored pairing wins"). But the pairing gets *stored with null component links* before the components exist:

1. Load: a tool with combined product-id (e.g. `TF-194/TO-195`) gets an **in-memory** pairing with `holder_component_id: null, insert_component_id: null` (no component records yet).
2. ProShop import: the component rows correctly create component records, **and** `saveFullLibrary` persists every tool's metadata — *including the in-memory pairing, nulls and all* (`buildMetadataTool` writes `tool.pairing` as-is).
3. Next load: the components exist, but `derivePairings` skips the tool because its pairing is now *stored* — **the links stay null forever**.

The same thing happens with any ordinary save (`writeLogicalTool` → `upsertMetadata`) of an auto-detected tool before its components exist. The demo doesn't catch this because demo saves are read-only, so the pairing is never persisted there.

**Impact:** no data loss — the component records exist and are manually linkable via `ComponentPicker` — but the documented auto-link workflow silently doesn't work, and after a full ProShop import the operator has to hand-link two components on every insert tool.

**Fix applied:** `derivePairings` (`src/schema/insertFamilies.js`) now, for tools **with** a stored pairing, fills (never overwrites) null `holder_component_id`/`insert_component_id` by re-resolving `pairingFromCombinedId(tool.tool_id)` against the component maps. Fill-only keeps user-made manual links authoritative; a fully-linked or non-combined-id pairing is returned by the same reference (untouched). Covered by 3 new tests in `insertFamilies.test.js`.

#### 🟠 F2 — Assembly numbers can permanently bake the raw combined ID (with the slash) — ✅ FIXED

**What happens:** for a tier-3 (milling/indexable/generic) paired tool whose components aren't linked yet, `pairedAsmIdPart` returns `''`, and both `writeLogicalTool` (`src/context/toolActions.js`) and `backfillAsmNumbers` (`src/utils/assemblyIdSystem.js`) fall back to `tool.tool_id` — the combined string like `I-167/G-168`. The composed asm number (e.g. `SK13-I-167/G-168-2.125`) is **stamped once and never overwritten**, and Auto values are by design never retired — so after the components link, the asm number stays in the wrong form forever (it should be `…I-167+G-168…`).

**Fix applied:** both call sites (`writeLogicalTool` in `src/context/toolActions.js` and `backfillAsmNumbers` in `src/utils/assemblyIdSystem.js`) now **skip stamping** when `tool.pairing` is set and `pairedAsmIdPart` returns `''` (leaving `asm_number` unset), so the correct `{holder}+{insert}` token composes once the components link. Covered by 2 new tests in `assemblyIdSystem.test.js`.

#### 🟠 F3 — Component-row routing misses components whose parent tool has no combined ID — ✅ FIXED

`insertComponentIndex` only indexes tools whose `tool_id` contains a `/`. A component record that exists but belongs to a pairing without a combined ID (any `generic_insert`, or a shop that never clicked "Apply as Tool ID") is invisible to the import intercept — its ProShop row falls through to tool matching and can **mint a Fusion placeholder tool** for a component number (the exact thing the intercept exists to prevent).

**Fix applied:** `matchProShopToTools` (`src/components/ImportFlow.jsx`) now derives `compMeta` from an existing component record (via `existingCompByNum`, using its own `role`/`family`) when `insertComponentIndex` misses — so any row whose Tool # matches an existing component routes to that component regardless of the parent tool's ID shape, and can never mint a Fusion placeholder.

#### 🟡 F4 — No duplicate-`tool_id` guard on component records — ✅ FIXED (create path)

`ComponentPicker` inline-create and the ProShop import don't check whether another component already carries the same Tool #. `derivePairings`/`insertComponentIndex` key by normalized number in a `Map`, so on a collision **last-write-wins silently** — two pairings could resolve to the wrong physical drawer. Low likelihood (ProShop numbers are its primary key), but a cheap warn-on-create check would close it. Related edge: the same number registered as a *holder* in one tool and an *insert* in another also collides.

**Fix applied:** `ComponentPicker.handleCreate` (`src/components/ComponentPicker.jsx`) now blocks inline-creating a component whose Tool ID (normalized) already belongs to another component **of any role**, with a message pointing the user to select the existing record instead. (The ProShop-import side already upserts by number via `existingCompByNum`, so it updates rather than duplicates; a genuinely conflicting *cross-role* number in a ProShop export remains an inherent source-data issue, not something this app can invent an answer for.)

#### Notes (working as designed, keep on the radar)

- Component records have **no delete/cleanup path** (documented as deferred) — orphaned records accumulate harmlessly but permanently, same tolerance as orphaned tool metadata.
- `tool_components.json` is whole-file last-writer-wins across devices, like every shared Drive file. Fine at this scale; the SQLite move fixes it properly.
- ProShop **export** of pairings (two rows back out) is still deferred — a full-library ProShop export today emits the *combined* tool row only, so a round-trip through ProShop would not carry the per-component location/purchasing. Worth confirming this is acceptable until export lands.

---

## Part 2 — Program/Job ↔ Tool/Preset Links Audit

### What checks out

- **`job_ids` never reach Fusion.** They're pulled out of the preset in `normalizePreset`'s destructure (`operation_type, machine_id, job_ids, …`) — verified in code and locked by the round-trip audit.
- **Rename-safe provenance.** Job links are keyed by preset **guid** (`preset_meta[guid].job_ids`), so renaming a preset keeps its proven-job history. The DiffStep guid-collision guard mints fresh guids *before* anything captures them, so merge-flow links stay consistent.
- **Dedupe works.** `findOrCreateJob` keys on the case-insensitive `(program #, part #)` pair — the same job linked from five tools stays one record. `mergeTool` unions rather than duplicates ids, and falls back to a tool-level link when a commit touches no presets.
- **Program numbers can't drift.** `nextProgramNumber` is computed (`max + 1`), never stored; deletion is inherently safe (test-locked).
- Dangling references (deleted job/program/part/alloy) degrade gracefully everywhere I traced (`collectToolJobs`, `alloyLabel`, picker rows).

### Findings

#### 🟠 F5 — Copying a preset copies its proven-job history — ✅ FIXED

`PresetPanel`'s "copy from preset" builds the new preset as `{ ...src, guid: generateId(), name: … }` — which **carries `job_ids`**. A brand-new, unproven preset then claims "proven on job O1042," which is false provenance and pollutes the tool's *Jobs / Where Used* panel. (Keeping `machine_id` on copy is documented and intentional; keeping `job_ids` is not.)

**Fix applied:** the "copy from preset" branch in `PresetPanel.jsx` now sets `job_ids: []` on the copy (`machine_id` is still carried, as before — that's intentional).

#### 🟡 F6 — Small dangling-reference window between metadata and `jobs.json` — ✅ FIXED

`findOrCreateJob` returned the job immediately and scheduled the `jobs.json` write on the 600 ms debounce, while `mergeTool`/`saveTool` write the referencing `job_id` into `tool_metadata.json` right away. A crash, forced tab kill, or failed Drive write in that window leaves a `job_id` in metadata with no job record — and `collectToolJobs` hides dangling ids *silently*, so the link just vanishes without a trace.

**Fix applied:** `findOrCreateJob` (`src/context/AppContext.jsx`) now persists a **created or enriched** job via a new `persistJobsNow` helper that writes `jobs.json` to Drive **immediately** (cancelling any pending debounced jobs write, and writing the *explicit* next-file object rather than the render-lagged `jobsRef` so the new job isn't dropped) — so the job record is durable before its id is referenced. An unchanged existing job needs no write; demo/no-Drive stays in-memory. This is a strict narrowing of the window, not a transaction — the complete guarantee still comes with the planned SQLite backend.

#### 🟡 F7 — Cancelling a preset edit can orphan a freshly-created job record — ⚪ WON'T FIX (by design)

In the preset editor's Jobs block, picking a program calls `findOrCreateJob` immediately (creating the `jobs[]` record), then adds the id to the *draft*. Cancelling the edit abandons the reference but the registry record stays.

**Decision (after implementing F3/F4/F6): not worth a code change.** A job (program # + part #) is a legitimate shop-level entity that stands on its own — a job record with zero current tool/preset references is valid data, not corruption, and the future Programs page manages the registry directly. The only real "fix" is to defer job creation until the preset is *saved*, which means threading pending, id-less selections through the preset editor's draft + save path (a non-trivial refactor of a ~1,300-line component) for zero data-integrity benefit — nothing breaks, nothing resolves wrong, and `collectToolJobs` already tolerates any dangling id. Left as-is deliberately; revisit only if orphan-job accumulation ever becomes a real UX problem on the Programs page (at which point a "prune unreferenced jobs" action there is the cleaner answer than editor-side deferral).

#### ⚪ Trivia

- `JobProgramPicker.pick`: an exact program-number hit whose `part_id` dangles produces `part_number: ''`, so the job dedupe key becomes `(program, '')` — a later pick of the repaired program creates a *second* job for the same program. Only reachable via a deleted part; noting for completeness.
- `searchPrograms` sort has a dead expression (`a.program_number ?? a.program.program_number` — the first operand is always undefined). Harmless; cosmetic cleanup.

---

## Part 3 — Decoupling Tools from Fusion (the "zero Fusion instances" plan)

### The honest answer to "is this mostly just conditional workflows?"

**Partly — but the real cost is hiding in the data model, not the conditionals.** Adding `if (fusionEnabled)` branches to the write paths is the easy half. The hard half is this:

> **Today, a tool *is* its Fusion entries.** `loadTools` builds the entire in-memory library *from* the downloaded Fusion lists; `tool_metadata.json` is only an overlay of extra fields. The metadata record has **no** `tool_type`, `description`, `diameter`, `unit`, geometry, or **presets** — it cannot reconstruct a tool on its own.

So if you naively made `writeLogicalTool` skip the Fusion write for a "no-Fusion" tool, the save would appear to succeed — and the tool would **vanish on the next load**, because loading is Fusion-driven. That's why this is a real architectural change, not a settings flag: the app's own record must become a *complete* tool record, and the load path must build tools from **metadata ∪ Fusion** instead of Fusion alone.

### The hard couplings, precisely (what has to change)

| # | Coupling | Where |
|---|---|---|
| 1 | Tool existence derives from Fusion; zero libraries → hard error | `loadTools` (`AppContext.jsx`, throws "No tool library linked") |
| 2 | Metadata is an overlay, not a record — no identity/geometry/presets/unit | `buildMetadataTool` / `mergeFusionAndMetadata` (`metadataModel.js`) |
| 3 | Presets live **only** in Fusion JSON (`start-values.presets`) | `fusionConvert.js`, `buildLogicalTool` |
| 4 | Every tool must have ≥1 assembly = 1 real Fusion instance | `splitToFusionInstances`, `writeLogicalTool`, `deleteAssembly` guard |
| 5 | Every write is download-library → drop → append → upload | `writeLogicalTool`, `saveFullLibrary`, `renumberLibrary`, `assignToolIds`, `renumberAllToolIds`, `normalizeLibrary` |
| 6 | App onboarding gates on a Fusion library existing | `App.jsx` AppShell gate order (`!libraryLocation → LibrarySetup`) |
| 7 | Reconcile-on-open / Sync Job / local mode all assume a live Fusion library | `reconcile.js`, `MergeFlow` |

### Recommended architecture: app store = system of record, Fusion = a sync adapter

This is the standard ERP pattern and it's where this app is already heading (the CLAUDE.md vision statement says it: *"Fusion becomes one integration among several rather than the center of the design"*). Concretely:

- **The app's own tool record** (today `tool_metadata.json`, soon SQLite) becomes the authoritative, *complete* record: identity, type, description, unit, geometry, presets, plus everything it already owns.
- **Fusion linkage becomes per-tool state**, not an app-wide assumption: a tool is either *linked* (has N Fusion instances — behaves **exactly** as today, same code path, byte-for-byte) or *unlinked* (zero instances — metadata-only, like component records already are).
- **A shop-level setting** `shop_settings.integrations.fusion.enabled` (set in onboarding, changeable later) controls whether the Fusion sync layer is active at all. Turning it off doesn't delete anything — it just stops the sync adapter, so tools keep their stored Fusion linkage and pick it back up when re-enabled. This gives you the "start with Fusion, turn it off/on later" requirement for free.

### Design decisions (resolved with the shop owner, 2026-07-06)

These pin down the two questions that shape Phase A. Both should be treated as settled inputs to the schema design.

**D1 — The app record is complete in ALL modes (not just no-Fusion mode).**
The workflow is **identical** with or without Fusion: you always create/edit/manage tools *in the app*, and the app's own record holds everything (identity, geometry, unit, presets, …). Fusion — or any other CAM — is a **push/sync target**, not the store the app reads its identity from. Concretely, this means **Fusion-native data is duplicated into the app record even in Fusion mode** (today it lives "only in Fusion" with metadata as sticky-notes on top; after Phase A the app record is the real binder and Fusion is a printout of it). "Working with another CAM" = push to that CAM instead of Fusion; "no CAM" = the app stands alone with nothing to push.

- **Caveat that keeps Fusion special:** Fusion is *co-edited* today — programmers edit tools directly in Fusion 360, and the Sync Job / reconcile-on-open machinery exists to pull those edits back. So **Fusion mode is two-way** (push out **+** keep today's pull-back/reconcile); a brand-new CAM starts **push-only** until a pull-back importer is built for it; **no CAM** is app-only.

**D2 — Who wins on conflict is a user-selectable, guarded setting.**
When the app record and Fusion disagree (someone edited a tool directly in Fusion 360), the winner is chosen by a shop setting — call it `integrations.fusion.authority: 'fusion' | 'app'` — **switchable at any time**, so the shop can start Fusion-authoritative (safe during migration) and flip to app-authoritative once it fully lives in the app as the front door.

- **Mechanism is cheap and contained:** it's one setting + one branch at the load/merge seam (`mergeFusionAndMetadata`). It does **not** touch the editing workflow or the write path (writes always go to both stores). It's essentially **free once D1 lands**, because it only needs the app record to already hold the Fusion-native fields.
- **Scope:** the setting governs only the fields **both stores hold** (the currently Fusion-native ones). Metadata-owned fields (`tool_id`, `machine_tool_number`, notes, tags, jobs, locations, …) stay app-owned in every mode — they never conflict.
- **Not a free toggle — flip is a guarded migration action.** Each flip decides who gets *overwritten*: flipping to app-wins discards any un-reconciled Fusion-side edit on the next push (and the reverse flip has the mirror risk). So expose it as **"Make ToolDex the source of truth" / "Hand authority back to Fusion"** actions that **reconcile/pull from Fusion first** (nothing lost), then flip — not a raw checkbox that silently changes behavior.

**D3 — Drift is always surfaced on the tool page; nothing is silently overwritten (either direction, either mode).**
Whenever a linked tool's app record and its live Fusion entry differ on any field, **opening that tool shows a banner + per-field diff** (app value vs Fusion value) to confirm — the app never quietly clobbers a change someone made in Fusion (nor silently discards a deliberate app edit). The D2 `authority` setting becomes the **pre-selected/default** choice in that diff (one click to accept if you agree), *not* a silent auto-resolve.

- **Enabled by D1, not extra scaffolding:** field-level diffing is only possible once the app record holds its own copy of every field. Today the app can't diff geometry/presets — it has no independent value — so this is a *payoff* of the complete record.
- **Reuses existing machinery:** the reconcile-on-open + Sync Job `DiffStep` UI, extended from structural strays to **field-level** drift, with today's significance tolerances (`PRESET_SIGNIFICANCE` / `valuesEqual`) so Fusion float noise isn't flagged.
- **Cost model:** detected on tool open (same per-tool live-fetch as today's reconcile-on-open); until reviewed, the app doesn't push over the differing Fusion fields. Bulk full-library rewrites keep their existing Review step. Full spec in `PHASE_A_TOOL_RECORD_SCHEMA.md` §10.
- **Write-time surface too (implemented):** the save-time 3-way merge nets a Fusion edit made after load. Only-Fusion-changed → adopt (no wipe). Both-edited-the-same-thing → keep the app's active edit **but never silently** — a warning toast summarizes what Fusion also changed and the scalar-field conflicts re-appear in the `DriftBanner` for one-click restore. So D3 holds on both the load and write paths.

### Phasing (each phase ships independently, current behavior preserved throughout)

**Phase A — make the record complete (do this together with the SQLite schema design).**
Extend the app's tool record to carry identity + geometry + unit + presets (i.e., everything `fusionToolToInternal` currently supplies) — see D1. On read, **Fusion still wins by default** for Fusion-native fields on linked tools (unchanged behavior); this is exactly the `authority: 'fusion'` branch of D2, so the winner setting drops out of Phase A for free rather than being extra work. The record is simply no longer amnesiac. This step is ~zero behavioral risk and is *literally the same work* as designing the SQLite `tools`/`presets` tables — do it once, not twice.

**Phase B — support zero-instance tools.**
- `loadTools`: build tools from Fusion groups as today, **then** append metadata records with no live Fusion instances as unlinked tools. Delete the "no library linked" hard error when Fusion is disabled.
- `writeLogicalTool`: one early branch — unlinked tool (or Fusion disabled) → metadata write only, no APS round-trip. Linked tool → the exact current path, untouched.
- `deleteTool`, bulk ops (`saveFullLibrary`, renumber, assign IDs): partition unlinked tools out of the Fusion writes; they still participate in numbering/ID assignment (they're real tools).
- `App.jsx` gates + `LibrarySetup`: branch on the integration setting ("Use Fusion 360? yes/no" in onboarding).
- Reconcile / Sync Job: no-op for unlinked tools (nothing to reconcile against).
- **Drift diff (D3):** extend reconcile-on-open to field-level — on opening a linked tool, diff the app record vs the live Fusion entry and surface any differences as a confirm-banner (authority setting pre-selects the default winner). No silent overwrite in either direction.
- UI: a "Not in Fusion" badge (the inverse of today's "In library: …" note), plus two explicit actions — **"Create Fusion entry"** (promote: split instances, write, store guids) and optionally **"Detach from Fusion"** (demote: remove instances, keep the record). Promote/demote are just the two halves of `writeLogicalTool` you already have.

**Phase C — collect the payoffs.**
- ProShop import: unmatched rows become **unlinked tools** instead of Fusion placeholders — the `no_fusion_link` flag and the Review-step placeholder warning retire.
- Insert components: the F3 intercept stops being load-bearing (a component row that slips through creates an unlinked record, not a Fusion placeholder). You could even later model components as unlinked tools if you want one entity type — but keeping them as component records is also fine; nothing forces that unification.
- Local mode phase 2 (edit + re-export) becomes much cheaper, since the write path no longer assumes APS.

### Sync behavior guarantees (your "99% unchanged" requirement)

- A linked tool with Fusion enabled takes the **identical code path** as today — same download-before-write, same instance splitting, same expression rules. The round-trip audit (232 tools, 0 unexpected diffs) + the unit suite (234 tests) are the regression net, and they cover that path.
- Insert/holder assemblies change only in the ways you predicted: component rows can't create placeholders anymore, and a pairing's components no longer need a Fusion entity to hang off.
- The one *deliberate* behavior change: with Fusion disabled, Sync Job / reconcile / holder-library features are hidden (they're Fusion features). Presets, assemblies, jobs, ProShop, locations, IDs all keep working from the app record.

### Do it before or after SQLite? → **Do Phase A *as* the SQLite prep, then B. Don't do them as two separate projects.**

Reasoning, as the ERP/database call:

1. **The record-shape work is shared.** Phase A (complete tool record) *is* the SQLite table design. Doing decoupling first on JSON and SQLite later means migrating the record shape twice.
2. **You have a free migration window.** You said current metadata is disposable. That means Phase A needs zero migration shims (consistent with the repo's no-backwards-compat rule). Once the shop switches over for real, this gets 10× more delicate — this is the cheapest this change will ever be.
3. **The seam already exists.** Every write already funnels through `writeLogicalTool` / `saveSharedFile` / `driveService` — the repository interface SQLite needs is the same one the Fusion-adapter split needs. One refactor, two payoffs.
4. **Doing SQLite *first* without decoupling would encode the wrong invariant** ("a tool row must have ≥1 Fusion instance") into your schema on day one, and you'd be untangling it later — the exact thing the SQLite design guidance in CLAUDE.md warns against.

### Size & risk estimate (candid)

- **Not a rewrite, but genuinely medium-large:** ~12–18 files meaningfully touched. Core: `metadataModel.js`, `logicalTools.js`, `AppContext.jsx` (loadTools), `toolActions.js`, `libraryOps.js`, `App.jsx`, `Settings.jsx`/`LibrarySetup.jsx`/onboarding, `ImportFlow.jsx`, plus UI badges/actions and validation.
- **Highest-risk area:** the loadTools union and the promote/demote transitions (a tool must never exist twice — once from Fusion, once from metadata — after a promote). Mitigation: tracking ID is the join key in both stores already.
- **Lowest-risk area:** everything Fusion-linked, because the rule is "linked tools take the untouched current path."
- Realistically **2–4 focused implementation sessions** (A, then B, then C + polish), each independently shippable and testable. It will not spiral *if* the "linked tools = current code path, byte-for-byte" rule is enforced ruthlessly and Phase A lands first.

### Suggested order of operations

1. ~~**Fix F1, F2, F5**~~ ✅ done — plus F3, F4, F6 (F7 = deliberate won't-fix). All the audit's tactical findings are cleared; the branch is green.
2. ~~**Design the full tool record + SQLite schema together** (Phase A)~~ ✅ done — `PHASE_A_TOOL_RECORD_SCHEMA.md` lists every field, its owner, and its SQLite table; incorporates D1, D2, D3.
3. ~~**Implement Phase A on JSON**, keeping behavior identical (`authority: 'fusion'` default)~~ ✅ done — the app record now carries the complete scalar set + presets; linked-tool reads unchanged.
4. ~~**Implement Phase B** behind `integrations.fusion.enabled` + per-tool linkage, guarded authority flip (D2)~~ ✅ done — no-Fusion tools (build/write/delete), promote/detach, the Fusion-off toggle, ID-system membership, and the D3 drift review (load-time banner + write-time conflict surfacing). Because drift is always surfaced, the authority flip needed no guarded-migration machinery — it only sets the default pre-selection.
5. **Phase C cleanups** (retire `no_fusion_link` as merely a flag, placeholder warnings, tighten the insert-component intercept) — **partly done**: `saveFullLibrary` no longer mints placeholders for no-Fusion tools, so the general placeholder path is retired; the ImportFlow/insert-intercept polish is the remaining tail.
6. **B4b-2 (deferred):** the never-connect-Autodesk onboarding gate (`App.jsx` AppShell library-requirement relaxation) — the one high-blast-radius auth/gate piece, left as its own step.
7. **SQLite storage swap** when ready — at that point it's "replace the file layer," not "redesign the data."

---

## What I did & why

- **Traced both new features end-to-end through the actual write/read paths** (import → save → reload) rather than just reading each file in isolation — that's how F1 surfaced: every individual piece is correct, but the *sequence* (persist pairing before components exist, then skip stored pairings) breaks the documented re-link.
- **Ran the full test suite + round-trip audit first** so every finding is on top of a verified-green baseline — the issues listed are workflow/sequence gaps the tests don't cover, not regressions.
- **Recommended folding the Fusion decoupling into the SQLite prep** instead of treating them as separate projects, because the expensive part of both is the same thing: making the app's own record a complete tool record. Doing it while your metadata is still disposable is the cheapest it will ever be.
