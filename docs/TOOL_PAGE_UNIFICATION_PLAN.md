# TOOL_PAGE_UNIFICATION_PLAN.md — one tool page, one draft, two save destinations

> **STATUS: Phases 1-2 and 4 shipped ✅; Phases 3 and 5 planned.** Supersedes and absorbs
> `UI_CONSISTENCY_AUDIT.md` §12 ("View/edit unification, part 2"), whose owner
> decisions A/B/C still stand except where noted below — **decision B is
> retired**, see "What this changes about §12".

The tool page is three screens showing one tool:

| Screen | File | Lines | Own draft? |
|---|---|---|---|
| View | `ToolDetail.jsx` | ~1323 | no (renders `tool`) |
| Edit | `ToolForm.jsx` | ~1059 | yes (`data`) |
| Drawing | `ToolProfileModal.jsx` | ~695 | yes (`draft`) |

**Three drafts of one record is the actual problem.** The fields were already
unified (`ToolFields.jsx`, one `toolFieldLayout.js`, `UI_CONSISTENCY_AUDIT` item
11); what was never unified is the page around them and *when an edit becomes
real*.

The goal: **one page**, one draft, the drawing as the geometry layout rather
than a separate editor.

---

## 1. The save model

Decided with the shop owner. Two destinations, and **the user is never asked
which one a field lives in**.

| Destination | When | What |
|---|---|---|
| **Metadata (Drive)** | **autosaves** while typing | app-only data — notes, tags, purchasing, links, speed/feed refs, location |
| **Metadata + Fusion** | **an explicit Save button** | everything Fusion also holds — geometry, identity, presets, assemblies |

### ⚠️ The invariant this protects, and why it decides everything

Today metadata and Fusion are always written **together** (`writeLogicalTool`),
so when they disagree it means exactly one thing:

> **metadata ≠ Fusion means FUSION moved.**

`detectFusionDrift` (`metadataModel.js:75`) is built on that reading, and
`DriftBanner` acts on it — "Fusion has X, the app has Y, keep which?".

Split the two stores for a **Fusion-shared** field and that sentence stops being
true: metadata ≠ Fusion would *also* mean "you just typed something and haven't
pushed it". Same signal, opposite meaning — and **"Keep Fusion" would silently
throw away the edit the user just made.**

That is the holder `ref-only` bug in a new place (see Holder identity in
CLAUDE.md), and holders had to grow a `last_pushed` snapshot to tell the two
apart. **This plan does not need one**, because a Fusion-shared field's metadata
copy is only ever written at the same instant as its Fusion copy. The invariant
holds untouched, `detectFusionDrift` keeps its meaning, and **no new stored field
is introduced** — so nothing to migrate and nothing to re-enter.

### The rule that makes it safe

> **An autosave writes metadata-only keys onto the last SAVED tool — never onto
> the draft.**

Reverse it and uncommitted geometry reaches metadata, Fusion looks stale, and the
user gets a drift banner they cannot clear, about an edit they made themselves.

⚠️ **Enforce it structurally, not by discipline.** `saveToolMetadata` filters
every patch through the registry's `metadataOnly` flag plus an explicit
allowlist for the non-scalar keys, and **drops anything else**. A Fusion-shared
field then *cannot* travel down the autosave path even if a future caller passes
one. Test-locked in the shape of `relationalIntegrity.test.js`: build a patch
containing every registry field, assert only the metadata-only ones survive —
**including a field that does not exist yet**, so a newly added Fusion-shared
field fails the suite until it is classified.

### Save behaviour is decided per SECTION, not per field

Owner's call, and it is what keeps this invisible: *"the user should not know or
care about any of this."*

Several geometry fields are metadata-only (`min_ooh`, `reach`, `has_undercut`,
`undercut_diameter`, `lower_radius`, `upper_radius`, `profile_radius`,
`axial_distance`) while the boxes beside them on the same drawing are
Fusion-native. Marking them differently would put two save behaviours on one
drawing and make the user carry a distinction that is ours, not theirs.

> **A section is buffered if it contains ANY Fusion-shared field. Otherwise it
> autosaves.**

| Section | Behaviour | Why |
|---|---|---|
| Geometry / the drawing | **buffered** | diameter, LOC, OAL … are Fusion-native |
| Identity | **buffered** | description + `tool_id` are Fusion-native; status rewrites the description via `withRetiredMarker` |
| Presets | **buffered** | owner: no autosave |
| Assemblies | **buffered** | holder + OOH drive the Fusion instance split |
| Notes & Tags | autosave | metadata-only |
| Purchasing | autosave | metadata-only |
| Speeds & Feeds refs | autosave | metadata-only |
| Linked Tools | autosave | metadata-only (already is) |
| Location | autosave | structured `tool_location` is metadata-only — see the leak below |
| Photo, Files | **immediate** | a Drive upload is not a draft; the bytes are already gone |

**A buffered section needs no new write path** — it uses the existing
`saveTool` → `writeLogicalTool`, unchanged. The only new plumbing is the
metadata-only autosave. That is what makes Phase 1 small.

### The one place metadata and Fusion still diverge

**Location.** `tool_location` (structured) is metadata-only, but the composed
`location` string is Fusion-native — Fusion's repurposed "Vendor" field. So
assigning a location autosaves the structure and leaves Fusion's string stale.

This is **not new**: `normalizeLocationSystem` and `importLocationsFromProShop`
already do exactly this, and `pushFieldToFusion` + the **Fusion sync** block in
`LocationIssuesPanel` already exist to settle it. The tool page must **say so**
rather than leave it to be discovered — same standing rule as those two actions.

### "If Fusion has a place for it, Fusion must have it"

Deferring the Fusion write is only acceptable because the deferral is **visible**:
the Save button is the sign, enabled exactly when something is pending, and the
page never goes quiet with Fusion holding values the app knows are wrong. The
user does not need to know *which* fields are pending — only that something is.

---

## 2. One page, and every field in exactly one place

Owner's direction: *"What fields are part of the tool profile are just in the
tool profile... Only display the field in one spot. Others can either go below or
to the side, grouped by things that go together. I want just one view that shows
the profile and all the fields."*

**The rule to build, and to test:**

> Every field applicable to the tool type appears **exactly once** — either as a
> dimension box on the drawing, or in a group around it. Union, no overlap.

- `profileDimensions(toolType)` (`toolProfile.js:163`) already says which fields
  the drawing owns.
- The **remainder** renders in groups beside/below it.
- The standalone Geometry grid **goes away** for anything the drawing carries.

⚠️ A test asserting `union(drawing dims, surrounding groups) === fieldsForType(t)`
with no duplicates, over **every** tool type, is what stops a field silently
appearing twice or vanishing when someone edits either list. It is the same
guard `toolFieldLayout.js` was created to provide, extended to the drawing.

**Two types cannot be drawn** — `boring head` and `turning general`
(`canDrawProfile`, `toolProfile.js:31`). They fall back to the plain grid.
**Deferred by the owner** ("will fix later") — the fallback just has to exist,
not be designed.

### What the merge has to carry over

`ToolProfileModal` is not just a drawing; several of its rules were learned the
hard way and must survive being lifted out of a modal:

- **A blank cell is mid-edit, not a zero** — the cell being typed into holds raw
  text; the stored number moves only when it parses.
- **`shaftRows` vs `shaftSegments`** — the editor reads every stored row; the
  drawing reads only the drawable ones. Editing off the filtered list deleted a
  segment on every retype.
- **The table is top-down, the array is tip-first** — every edit maps through the
  reversed index.
- **No literal `step`** — `stepFor(field, unit)`, or a metric tool nudges by a
  micron.
- **Value boxes are placed by their EDGE, not their centre** — locked by
  `toolProfileUi.test.jsx`, which also asserts no `NaN` reaches an SVG path
  across the whole real library. That suite must keep passing against the new
  layout.

Sizing changes: the modal is a fixed-width canvas with a capped side column. As
the page it becomes responsive, and the drawing has to collapse gracefully on a
narrow screen.

---

## 3. What this changes about `UI_CONSISTENCY_AUDIT.md` §12

- **Decision A stands** — a new tool starts unlocked. Under this model it is
  created as a metadata record and reaches Fusion on the first Save (or via the
  existing `promoteToolToFusion`).
- **Decision B is RETIRED.** It blocked instant-save panels while the page was
  dirty, to stop a panel writing the pre-edit record over a live draft. The
  section-level split removes the situation instead of policing it: an autosave
  section holds no Fusion-shared field, and a buffered section has no instant
  save. **Do not re-implement the dirty-blocking.**
- **Decision C stands** — a hand-edit is never discarded. The layered replay for
  the scan proposals (accepted rows from the frozen base, hand-edits on top) is
  still the answer, and the `purchRows.length === 0` guard in `ToolForm` is still
  the interim stand-in.
- The §12 "panel may only appear in a buffered form in controlled mode" rule
  **still holds** for anything inside a buffered section.

---

## 4. Phases

Each ships on its own. None requires the next.

### Phase 1 — split the save path ✅ SHIPPED
- **`src/schema/metadataScope.js`** — the classification and the filter.
  `metadataOnlyPatch(saved, updated)` **diffs** rather than trusting a patch, so
  a caller handing over a buffered draft has its geometry dropped and reported.
  `NOT_AUTOSAVABLE` carries a reason per field; seven metadata-only fields are on
  it because their content still reaches Fusion (`assemblies`,
  `selected_holder_guid`, `tool_status`, `tsc_capable`, `pitch`,
  `tap_thread_unit`, `preset_name`) — the registry flag alone is **not** enough.
- **`saveToolMetadata`** in `toolActions.js` — write first then memory; its own
  demo/local read-only guard (those modes are enforced inside the Fusion IO
  functions, which this path deliberately never calls); returns the same
  reference when nothing changed.
- **`metadataScope.test.js`** (12) + **`toolActions.test.js`** (+7): no
  `DRIFT_FIELDS` entry and no Fusion-backed field may pass, and every
  metadata-only field must be classified — a new field fails the suite until it
  is.
- **Repointed**: Purchasing and Speeds & Feeds refs on the tool page. Those saves
  no longer download and re-upload the whole Fusion library.
- **Not repointed, deliberately**: **Location**. `assignToolLocation` is a full
  `writeLogicalTool` today, and moving it metadata-only leaves Fusion's vendor
  string stale — which needs the page to *say so*. That belongs with Phase 3,
  where there is somewhere to say it.
- Additive, no stored-shape change — **backwards-compatible**.
- Notes & Tags is still view-only on the tool page; making it inline-editable is
  Phase 3's first step (§12's "smallest rehearsal").

### Phase 2 — decompose ✅ SHIPPED
`ToolDetail` **1330 → 735**, `ToolForm` **1059 → 701**. Pure moves: no behaviour
change, no test rewritten. Everything lives in **`src/components/tool/`**.

| File | From | Note |
|---|---|---|
| `ToolSection.jsx` | both | ⚠️ **was defined twice** — `defaultOpen` in the view, `forceOpen` + `mb-16` in the form. Now one superset; the form passes `className="mb-16"` so its 16px spacing survives (`.panel` is 8px). |
| `ToolStickyHeader.jsx` | both | ⚠️ **also duplicated** — the identity rail (location + T/H/D) was verbatim in both. `mode` picks the body; shell, status wash and rail are shared. |
| `ToolBanners.jsx` | ToolDetail | the whole "informed, not blocked" stack |
| `ToolActionSidebar.jsx` + `SidebarBtn.jsx` | ToolDetail | every button is a prop — the decisions stay on the page |
| `AssembliesSection.jsx`, `AssemblyExportPicker.jsx`, `DetailField.jsx` | ToolDetail | |
| `ToolIdentitySection.jsx` | ToolForm | becomes a panel on the unified page in Phase 3 |
| `SpecScanPanels.jsx`, `FieldInput.jsx` | ToolForm | |

⚠️ **`toolComponents.test.js` asserts each module's export SHAPE**, and it earned
its place immediately: `SpecSummary` came out as a *named* export while ToolForm
imported it as the *default*, leaving `undefined` at the call site. Lint cannot
see it (the symbol is defined) and nothing renders these — several only appear
behind a condition (a scan in progress, a stray found on open) — so it would
have shipped and surfaced as a blank page the first time someone scanned a spec
sheet. `npm run lint` caught two other slips (a handler and a prop whose meaning
changed on the way out), which is the whole reason that config exists.

### Phase 3 — one page, view and edit unified
- Lift `editing` into the page; `ToolFields` already switches on it.
- Autosave sections edit in place, always — no mode.
- Buffered sections switch to inputs and raise one **Save** bar.
- Fold the form-only fields (description + Suggest, `tool_id`, tool type, unit,
  insert toggle) into Identity as controlled inputs.
- Retire the `ToolForm` route. `AddToolFlow` is the last caller — decide then
  whether it keeps using it or renders the unified page in new-tool mode.

### Phase 4 — the drawing becomes the geometry layout ✅ SHIPPED
The drawing itself moved out of the modal into **`ToolProfileFields.jsx`**, a
controlled `({ draft, setDraft })` component. `ToolProfileModal` is now a thin
wrapper that owns the draft, the dirty check and the modal chrome and renders
it; **`tool/GeometrySection.jsx`** renders the same component on the page, above
a `ToolFields` told (via a new `hideFields` prop) to skip everything the drawing
already owns. One component, so the page and the modal can never draw the tool
two different ways — which is what the earlier mockup attempts kept doing.

Two things had to change for it to fit the page rather than a modal:
- **`.tp-body` wraps and `.tp-side` flexes** — it was sized for a modal, so it
  clipped inside the Geometry panel.
- **⚠️ The length dimensions went ORDINATE.** The nested arrowed stack spent a
  94px lane per dimension, and every length shares one origin anyway (the tip),
  so it drew four spans of the same datum. One horizontal leader per length at
  its own height took the canvas from **634px to 446px**, which is what lets the
  Cutter and Shaft Segments panels sit beside the drawing instead of below it
  (446 + a 20px gap + 291 = the 757px the panel has). A lane is now spent only
  on a genuine collision — a flute length that IS the shoulder length is
  ordinary, not an edge case. ⚠️ The MIN OOH datum then had to size the canvas
  too: it reaches further left than lane 0 and steps out again when it collides,
  and with no wide lane stack incidentally covering it, sizing from the lane
  count alone put its label off the left edge.

Fallback: `boring head` and `turning general` are undrawable, so
`GeometrySection` renders the full `ToolFields` grid for them — verified.

### Phase 5 — UI refinement pass
Owner-led. Grouping, spacing, and the long-tail inline-style cleanup
`UI_CONSISTENCY_AUDIT` still tracks.

---

## 5. Risks worth naming before starting

1. **The drift/pending ambiguity** (§1). The whole design rests on Fusion-shared
   fields never being written to metadata alone. The registry filter is the
   enforcement; the test is the proof.
2. **Autosave + an invalid record.** `validateTool` currently blocks a save.
   Autosave sections carry no required field today, so this does not bite in
   Phase 1 — but it must be answered before any required field moves into an
   autosave section. Proposed rule: **metadata is a working record, Fusion is
   the published one** — autosave anything, block the Fusion save on invalid.
3. **`toolProfileUi.test.jsx` and `shaftSeen.test.jsx`** exercise the modal.
   Phase 4 kept them green against the page rather than rewriting them to match
   it — the modal still renders, it just delegates the drawing. The ordinate
   change touched exactly the two assertions that named the old extension lines,
   and added lane-sharing, width and on-canvas-bounds tests beside them.
4. **Autosave cadence.** Copy `HolderDetail` exactly — 900ms debounce,
   `Unsaved… → Saving… → Saved` in the header, undo stack, leave guard
   (`HolderDetail.jsx:397`). One pattern in the app, not two.
5. **The section-level rule needs a home.** If a future field is added to an
   autosave section and it turns out to be Fusion-shared, the filter silently
   drops it and the edit is lost. The allowlist test catches the classification;
   the section table above is where the *placement* rule lives.
