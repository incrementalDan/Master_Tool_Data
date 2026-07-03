# ToolDex — Cutting-Knowledge Capture Review

*Reviewed 2026-07-02. An expert-lens assessment (CNC/CAM machinist + software engineer) of where the app stands against its real mission, and a tiered roadmap. Reference doc — revisit before planning new feature work.*

---

## 1. What this app is (my read)

ToolDex is a **shop knowledge base disguised as a tool library manager**. The tool
specs, holders, assemblies, and ProShop plumbing are the *substrate* — the actual
asset being built is **proven cutting knowledge**: "this tool, in this holder, at this
stick-out, at these speeds/feeds, in this material, on this machine, works."

The stated future (ERP, MachineMetrics, tool-life data, a Fusion add-in) all points
the same direction: ToolDex becomes the **system of record for how this shop cuts
metal**, with Fusion/ProShop as integrations rather than the center.

That framing matters because it changes what "done" means. A perfect tool library
that doesn't accumulate cut knowledge is a filing cabinet. The review below is scored
against the knowledge-capture mission, not the library-management one.

---

## 2. Where it stands today — what's genuinely strong

- **The multi-instance / assembly model is the right foundation.** Encoding
  holder + OOH into real Fusion instances, with preset names carrying material +
  assembly + operation, means proven-setup context survives *inside Fusion itself*,
  not just in app metadata. Most shops never get this right.
- **The material taxonomy (ISO group → CAM preset → alloy, with ISO 513 /
  Kennametal / VDI 3323 cross-reference codes) is a sleeping asset.** It's exactly
  the structure needed to map *any* manufacturer's speeds/feeds chart onto the
  shop's own material list. Almost nothing uses it yet.
- **The Fusion round-trip discipline** (expression/numeric sync, sync-never-inject,
  re-download-before-write, round-trip audit script) is real engineering. The hardest
  and least-visible part of talking to Fusion's JSON is already solved.
- **Data model is SQLite-ready** — stable UUIDs, normalized shapes, FK-style
  references throughout. The eventual database migration is a port, not a rewrite.
- **Phase 2 Sync Job exists and works** — batch queue, matching, diff, revision
  notes, merge history. The capture loop is *built*; the problem is what it captures
  and how much friction it has (see below).

---

## 3. The core gap: a tool library is not a cut record

**The unit of knowledge the shop actually wants to reuse is the *cut*, and the app
has no entity for it.**

A preset today stores: RPM, surface speed, feeds (cutting/plunge/ramp/lead), chip
load, coolant, optional stepdown/stepover, a material query, a machine link, an
operation type. That's a good **starting-point card**. What it does *not* store —
and what actually determines whether parameters transfer to the next job:

| Missing dimension | Why it matters |
|---|---|
| **Engagement** — actual WOC/DOC used, % of diameter | The same tool runs 3× the chip load at 10% stepover (chip thinning) vs. slotting. A feed number without engagement is ambiguous — the single biggest reason "proven" numbers fail on the next part. |
| **Strategy** — adaptive / contour / face / slot / drill cycle | Adaptive at 0.002 f_z and contour at 0.002 f_z are different physics. |
| **Job/part context** — job #, part, feature, workholding rigidity | `last_used_job` is one free-text string on the whole tool. Merge history has notes but no structured cut data. |
| **Outcome** — tool life achieved, finish, chatter, "would run faster next time" | Without outcomes there is no optimization loop, only accumulation. |
| **Cycle-time / MRR** | The app never shows MRR anywhere, so there's no way to see which proven recipe is actually the *productive* one. |

The Fusion clipboard TSV can never carry this — it's a *tool* export, not an
*operations* export. This is exactly why the planned **Fusion add-in reading the
active CAM document** is the single highest-leverage future item: the CAM API can
enumerate every operation — strategy, tool, the preset values *actually used*,
per-op stepover/stepdown, estimated cycle time — which is precisely the missing
record. (See §6 for the proposed `cut_records` schema and §7 for sequencing.)

---

## 4. Specific shortfalls found (against current intent)

### 4.1 The "blocked" preset bucket silently discards proven improvements ⚠ — **FIXED 2026-07-03**

> **Status: fixed.** Same-setup presets with significantly different values now get a
> per-preset "Update master with job values" / "Keep master values" choice in DiffStep.
> Updates patch only the significant changed fields onto the master preset (guid kept,
> so assembly links survive), require a revision note, and are recorded in
> `merge_history[].presets_changed`. Alongside this, machining-relevant significance
> thresholds were added so trivial differences no longer surface at all — see §8.

`matchPresets` (`src/components/MergeFlow/DiffStep.jsx`): an incoming preset with
the **same name, different values, same assembly context** is classified `blocked` —
rendered grayed out as "Same setup — master values kept" with **no user action
available**. But *same setup + better values* is the app's founding use case: a
programmer proved improved feeds on the exact master assembly. Today that
improvement is dropped on the floor, which is the pre-ToolDex failure mode the
README opens with. The conservative instinct (the change might be feature-specific)
is fair — but the answer is an explicit user choice ("Update master preset" with
revision note + `previous_values` in merge history), not silence. **This is the #1
functional bug against intent.**

### 4.2 Presets have no provenance

`preset_meta` stores `operation_type` and `machine_id` — nothing about *where a
preset's numbers came from*. A preset seeded from a guess and a preset proven
across 40 parts on the M300 look identical. Reuse confidence requires at minimum:
`source` (manufacturer / calculated / proven), `proven_job`, `proven_at`,
`proven_by`, and a free-text `result_note`. All metadata-only — cheap to add.

### 4.3 Speeds & Feeds Reference is per-tool, so new tools start from nothing

`speed_feed_refs[]` lives on each individual tool. The knowledge "316L roughs at
350 SFM / 0.002 chip load with a 1/2" 4-flute carbide EM" is a **shop-level** fact
that currently must be re-typed onto every tool it applies to. Consequence: the
"new tool" workflow the user cares about most has no data to draw from unless
someone manually seeds it. Same for "new material" — nothing suggests parameters
from adjacent alloys in the same ISO group / CAM preset.

### 4.4 Engagement math is absent despite the inputs being present

- **Chip thinning**: no radial-engagement compensation anywhere, yet stepover is a
  preset field. For adaptive/HSM (the modern default), uncompensated chip load
  either burns tools (too hot, rubbing) or leaves 2–3× MRR on the table.
- **L:D / stick-out derating**: the app *uniquely* knows OOH per assembly — the
  data most S&F calculators can't have — and does nothing with it. A 4×D stick-out
  vs. 1.5×D on the same tool should visibly derate DOC/feed suggestions.
- **Machine guardrails**: `machines[]` carries `max_rpm` and `horsepower`; neither
  is checked. A preset can quietly specify 18k RPM for a 16k-RPM Speedio, and
  nothing estimates cutting HP (MRR × unit power for the ISO group) against the
  spindle.

These are the "process reliability first, then MRR and tool life" levers, and all
three are pure client-side math over data already in memory.

### 4.5 Capture friction works against the mission

- Sync Job requires: open ToolDex → re-login (token is memory-only; every page
  refresh = full OAuth round-trip) → copy from Fusion → paste → step through the
  queue. Every point of friction is knowledge that doesn't get captured. The
  **Phase A backend plan (docs/PHASE_A_PLAN.md)** directly fixes the login half and
  is correctly scoped — it should be prioritized as *capture infrastructure*, not
  just security polish.
- Capture is **opt-in per job**. Nothing nudges: no "this tool was in job 1042's
  paste but its improvements weren't committed," no periodic reconcile of job files.

### 4.6 Client-side-only architecture is now the integration ceiling

MachineMetrics data, the external tool-life tracker, and a Fusion add-in all need
**somewhere to send data**. A static GitHub Pages app can't receive a webhook or an
add-in POST. The Phase A Cloudflare Worker is the seam: once it exists for auth, the
same worker grows `/api/ingest/*` endpoints. Until then, every external data source
is limited to manual CSV/JSON import.

### 4.7 Schema drift — legacy flat fields overlap newer structures

`DiffStep`'s `EXCLUDED` set is a fossil record: `spindle_speed`, `cutting_feedrate`,
`feed_per_tooth`, `depth_of_cut`, `width_of_cut` (flat tool-level fields, superseded
by presets), plus `material_suitability`, `preferred_machine`, `last_used_job`
overlapping the materials library, `machine_id` preset links, and (future) cut
records. Harmless individually; collectively they blur which field is authoritative.
Worth a deliberate one-off deprecation pass (the project's own "no
backwards-compatibility code" rule makes this easy).

### 4.8 Code health: two god files — **FIXED 2026-07-03**

> **Status: fixed.** Both files were split with zero import churn for callers:
> - `toolSchema.js` (2,055 → 54 lines) is now a thin barrel re-exporting nine
>   focused modules: `identity`, `extractorConvert`, `combine`, `holderGauge`,
>   `fusionConvert` (the round-trip seam), `threads`, `metadataModel`,
>   `logicalTools`, `toolFactory`.
> - `AppContext.jsx` (2,338 → ~700 lines) keeps only provider wiring (auth, IO,
>   shared-file plumbing, loadTools); the actions moved to `appState.js` (pure
>   reducer/state), `toolActions.js`, `libraryOps.js`, `attachmentActions.js` —
>   factories injected with dispatch/notify/IO + render-synced refs, memoized so
>   action identities stay stable.
> Code moved verbatim; verified with lint, full test suite, round-trip audit
> (0 unexpected diffs), 61-component render smoke, and a production build.
> Cut-record and ingestion code now has clear homes to land in.

### 4.9 Configurability outran the core loop (acknowledged)

The three-ID systems, multi-library routing, multi-shop onboarding are well built —
and are also the classic "platform before product" pattern. The user has flagged this
themselves. Recommendation: **feature-freeze the generalization tracks** until the
capture loop (§3) closes end-to-end for *this* shop.

---

## 5. Recommendations, tiered

### 🟢 Low effort — easy wins (days, mostly UI + metadata fields)

1. ~~**Unblock the blocked bucket** (§4.1).~~ ✅ **Done 2026-07-03** — see §4.1 status
   note and §8.
2. **Preset provenance** (§4.2). Add `source`, `proven_job`, `proven_at`,
   `proven_by`, `result_note` to `preset_meta`; stamp them automatically in
   CommitStep (job # is already being typed into the revision note — make it a
   field). Show a small ✓ "proven" badge on preset cards.
3. **Chip-thinning + L:D readouts in the preset editor.** Given stepover% (or a
   quick engagement input) show *effective* chip load next to programmed f_z; given
   the linked assembly's OOH show L:D with a color-banded derating hint. Pure math
   in `speedsAndFeedsCalc.js` + display in `PresetPanel`.
4. **Machine guardrails.** Warn (non-blocking, ToolDex style) when preset RPM >
   linked machine's `max_rpm`, and estimated cutting HP (MRR × per-ISO-group unit
   power constant seeded into `materials.json` groups) approaches spindle HP.
5. **Show MRR and a "recipe strength" line** on preset cards (MRR from
   feed × WOC × DOC when engagement present; else feed-only). Makes the
   MRR/tool-life tradeoff *visible*, which is the prerequisite to optimizing it.
6. **Stepdown/stepover as %-of-diameter** display + capture (already a scoped TODO
   in CLAUDE.md — do it as part of #3, they share the same editor real estate).
7. **"Copy S&F refs from similar tool"** button on the Speeds & Feeds panel — a
   stopgap for §4.3 until the shop-wide table exists (find same type + ISO group,
   nearest diameter; scale chip load, keep SFM).

### 🟡 Medium effort — the "new tool / new material" workflow (1–3 weeks each)

1. **Shop-wide Speeds & Feeds knowledge table.** Move the reference data from
   per-tool `speed_feed_refs` to a shop-level table keyed by
   `(cam_preset_id, tool_family, coating, diameter_band, operation_type)` in a Drive
   file (later a DB table), with per-tool overrides kept. Then:
   - **New tool flow**: on create, auto-populate its starting points from the table.
   - **New material flow**: pick the CAM preset (or create the alloy under a group)
     → inherit the group/preset's table rows as the starting point → adjust →
     first proven job promotes the row from `calculated` to `proven`.
   This single change is most of the "straightforward workflow to a good starting
   point" the user asked for, and the materials taxonomy was clearly built for it.
2. **Similar-cut suggestions.** When opening a tool with no preset for material M:
   surface the nearest proven presets (same type + ISO group, diameter within a
   band, similar L:D), diameter-scaled (hold SFM, scale f_z). Ranked list with
   provenance shown — reliability-first by construction.
3. **`cut_records[]` — the cut log entity** (schema in §6). Start feeding it from
   what exists today: CommitStep already knows tool, preset values, OOH, holder,
   machine, revision note — add job #, strategy, engagement, and an outcome rating
   at commit time. The Fusion add-in later *automates* filling it; the entity
   shouldn't wait for the add-in.
4. **Phase A backend** (already planned in `docs/PHASE_A_PLAN.md`). Reframe it as
   capture infrastructure: all-day login kills the biggest capture friction, and the
   Worker becomes the ingestion endpoint for everything in §7.
5. **Manufacturer chart ingestion via the existing AI extractor.** The extractor
   already reads photos/PDFs of tool specs; extend it to speeds/feeds charts,
   mapping the manufacturer's material rows through the ISO 513 / Kennametal /
   VDI 3323 codes already on every CAM preset (`material_code_system` per
   manufacturer is already in the vendor registry — this is the feature that data
   was added for). Output: table rows for #1 tagged `source: 'manufacturer'`.
6. **Tool-life import (interim).** CSV import from the existing tool-life app keyed
   on `tool_id`; show life stats on ToolDetail and next to each proven preset.
   Correlation-grade data later via the backend; visibility now.

### 🔴 Higher effort — the future-of-manufacturing tier

1. **Fusion helper add-in (the big unlock).** A Python add-in in Fusion reading the
   *active CAM document* via the CAM API: per operation → strategy, tool (matched by
   tracking ID / product-id), actual cutting values, stepover/stepdown, estimated
   cycle time, setup/WCS, machine from the post. One button: "Push job to ToolDex"
   → Worker endpoint → `cut_records`. Interim zero-backend version: add-in writes a
   JSON the user drags into ToolDex's import — worth shipping first, it derisks the
   CAM-API half independently of the backend half.
2. **Database migration (Phase C / D1-SQLite).** Cut records + telemetry are
   append-heavy relational data; JSON-file-on-Drive is the wrong home for them
   specifically (concurrent writers, growth, querying). Migrate the *new* entities
   to the DB first — the tool library JSON can lag behind; don't block on a
   big-bang migration.
3. **MachineMetrics correlation.** Join cut records ↔ machine cycles (spindle load,
   overrides, alarms, actual vs. estimated cycle time). Override percentage is
   ground truth for "were the programmed feeds actually run"; load curves validate
   the HP model in Low-#4. This turns the cut log from a diary into a scored
   dataset.
4. **Recommendation engine.** With provenance, engagement, outcomes, and telemetry
   in place: given (material, tool, machine, engagement, L:D) → starting parameters
   from physics (unit power, chip thinning, deflection limit) *blended with* the
   shop's proven-cut history, confidence-labeled ("proven on 6 jobs" vs.
   "calculated"). Reliability-first, MRR/tool-life as the tunable frontier. This is
   the defensible thing no generic calculator or manufacturer app has: **your**
   machines, **your** holders, **your** outcomes.
5. **ERP growth** — purchasing/inventory absorbing ProShop's role. Correctly parked
   as future; the UUID discipline means it stays a straight extension.

---

## 6. Proposed `cut_records` schema (design now, even if filled manually at first)

Metadata-side (later a DB table). One record = one operation (or one tool-in-job at
minimum granularity):

```json
{
  "id": "uuid",
  "tracking_id": "FTL-XXXXXX",
  "assembly_id": "uuid",
  "preset_guid": "guid | null",
  "job": "1042",
  "part": "optional part/rev",
  "machine_id": "uuid",
  "cam_preset_id": "pre_M_aus_316",
  "alloy_id": "uuid | null",
  "strategy": "adaptive | contour | face | slot | drill | tap | bore | other",
  "params": { "n": 8000, "v_f": 50, "f_z": 0.002, "doc": 0.75, "woc": 0.05,
               "doc_pct_dia": 150, "woc_pct_dia": 10, "coolant": "tool" },
  "est_cycle_min": 4.2,
  "source": "manual | sync_job | fusion_addin",
  "outcome": { "rating": "good | acceptable | problem | null",
                "tool_life_parts": null, "notes": "" },
  "created_at": "ISO", "created_by": "user"
}
```

Rules: append-only (corrections are new records), every FK a UUID/stable ID,
lengths in the tool's own unit per the app-wide convention. `sync_job` records can
be created today from CommitStep; `fusion_addin` is the end state.

---

## 7. Suggested sequencing (opinionated)

1. **Now (this month):** Low-#1 blocked-bucket fix → Low-#2 provenance →
   Low-#3/5/6 engagement + MRR readouts. Small, compounding, all in the existing UI.
2. **Next:** Medium-#3 cut-record entity (manual/CommitStep-fed) + Medium-#1
   shop-wide S&F table. This closes the "new tool/material starting point" loop.
3. **Then:** Phase A backend → interim Fusion add-in (JSON export) → add-in POST →
   tool-life + MachineMetrics ingestion.
4. **Throughout:** hold the line on generalization/multi-shop features; split the
   two god files before the cut-record code lands in them.

The thesis: the app has already won the hard plumbing battles (Fusion round-trip,
identity, materials taxonomy). What's left to build is comparatively simple *data
and workflow* — but it has to be pointed at the cut, not the tool.

---

## 8. Merge/Sync workflow analysis (added 2026-07-03)

A close read of the Sync Job flow (`MergeFlow/` — ImportStep → MatchStep → DiffStep
→ CommitStep → SummaryStep), prompted by real use: *"I get kind of confused as to
what I'm looking at and what it's asking me to do. It seems like it might be
flagging super small differences."*

### 8.1 Where the confusion was coming from

The flow's **structure** is sound (paste → auto-match → per-tool diff → commit with
a note → summary). The confusion concentrated in **DiffStep**, for three
compounding reasons:

1. **Float-noise diff rows.** Tool-level fields compared with *exact* numeric
   equality, but Fusion's JSON round-trip produces float noise (0.5 stored as
   0.4999999…). The diff then showed rows like **"0.5 → 0.5"** — a "change" where
   both sides display identically. Nothing erodes trust in a diff screen faster.
2. **One-size-fits-all preset tolerances.** The old `presetTolerance` was tiered by
   magnitude only (values <1 → 0.0001; <10 → 0.5; <1000 → 10; ≥1000 → 25) — blind
   to *what the number is*. It could flag a meaningless 12 in/min → 11 in/min
   lead-in tweak while a genuinely meaningful 0.0001" chip-load change sat exactly
   at the flag boundary. Machining significance is per-field, not per-magnitude.
3. **The three preset buckets were opaque** — "conflicts" got orange warning
   styling and radio buttons; "blocked" appeared as a grayed-out one-line list with
   no explanation of why nothing could be done; the summary counts ("N matched, N
   conflicts") didn't map to what the eye saw.

### 8.2 What was changed (shipped with this analysis)

- **Machining-relevant significance thresholds** (`PRESET_SIGNIFICANCE`,
  DiffStep.jsx). A value counts as changed only when
  |job − master| > max(rel × magnitude, abs floor):

  | Field | rel | abs floor | Rationale |
  |---|---|---|---|
  | RPM (`n`, `n_ramp`) | 1% | 15 | 10 RPM changes nothing |
  | Surface speed | 1% | 1 | |
  | Cutting / plunge / ramp feed | 2% | 0.1 | |
  | Lead-in/out/transition | 5% | 0.1 | followers of `v_f` — low signal |
  | Chip load (`f_z`, `f_n`) | 2% | 0.00005 | **0.0001" of chip load is real** — flags |
  | Ramp angle | — | 0.25° | |
  | Stepdown (DOC) | **10%** | 0.005 | reference value in Fusion — coarse (see 8.3) |
  | Stepover (WOC) | **2%** | 0.0005 | engagement — small diffs matter |

  Floors are inch-unit and scale ×25.4 for metric tools. Sub-threshold diffs are
  treated as identical and reported as *"N of these had only insignificant
  differences (ignored)"* so the user knows they were seen, not missed.
- **Float-noise kill on tool fields**: numbers within 5e-5 are equal — anything
  closer renders identically at the 4-decimal display rounding, so a diff row can
  never again show two identical-looking values.
- **The blocked bucket is now actionable** (the §4.1 fix): same-setup presets with
  significant differences render like conflicts — field-by-field master → job rows —
  with "Update master with job values" / "Keep master values" (default keep).
  Updates keep the master preset's guid, patch only the significant fields, require
  a revision note, and land in `merge_history[].presets_changed`.
- **Clearer language throughout**: section summary is now "N new, N changed, N
  matched"; InfoTips explain the same-setup vs. different-setup logic and that
  trivial diffs are auto-ignored; CommitStep shows updated presets with old → new
  values alongside added presets.

### 8.3 The stepdown/stepover problem (DOC/WOC are references, not the cut)

The user's observation is exactly right and worth recording as a design principle:
**Fusion's preset stepdown/stepover are *recipe reference values*, not a record of
the actual cut.** A preset can say stepdown 1.00" while the pocket it was proven in
was 0.65" deep — Fusion applies the same preset regardless of part depth, so the
captured number is "what the recipe requests," not "what the metal saw." Two
consequences:

1. **Don't over-trust captured DOC; trust WOC more.** Radial engagement (stepover)
   *is* generally honored by the toolpath strategy (adaptive optimal load, contour
   stepover), while axial depth is truncated by whatever the part offers. Hence the
   asymmetric thresholds above (10% vs 2%) — and any future recommendation logic
   should weight WOC as a hard input and DOC as a soft one.
2. **Reframe preset stepdown as a proven *envelope*, not an actual.** The useful
   reading of "stepdown 1.00, proven in a 0.65 pocket" is: *proven safe at up to
   0.65 engaged, recipe requests 1.00*. Practical convention until better data
   exists: treat master's stepdown as **max proven DOC** — a job showing a
   *smaller* stepdown with all else equal is usually just a shallower part (noise;
   the 10% threshold + user choice covers it), while a *larger* one is real new
   knowledge (proven deeper — worth committing).

**How to actually capture the real cut** (in order of increasing fidelity, no
machinist data entry in any of them):

- **Now (done):** loose DOC / tight WOC thresholds + user judgment in the diff.
- **Fusion add-in v1:** read each operation's *parameters* — adaptive "optimal
  load", roughing stepdown, axial DOC per pass — which are already closer to the
  cut than the preset, because they're per-operation.
- **Fusion add-in v2 (the user's "analyze the part" idea — feasible):** the CAM API
  exposes each operation's toolpath and its Z-extents; `(op z-top − z-bottom)`
  gives the **actual engaged depth**, and passes = depth ÷ stepdown gives actual
  per-pass DOC. Similarly, machining time and stock-remaining queries can
  approximate true average engagement. This is the right long-term answer: derive
  actual engagement from the toolpath, never ask a human to type it.
- **MachineMetrics cross-check (later):** spindle-load profiles validate derived
  engagement — a "1.00 DOC proven" claim with a 15% load trace is self-evidently a
  shallow cut.

### 8.4 Remaining friction worth knowing about (not yet addressed)

- **Preset matching is by name.** A preset renamed in the job file shows up as one
  `newPresets` entry plus one master-only "matched" entry instead of a change. Fine
  once the naming convention is universal; surprising during transition.
- **"Skip" at DiffStep skips the whole tool** — there's no "commit nothing but mark
  reviewed" distinction. Cosmetic, but worth a label tweak someday.
- **No provenance stamping yet** (§5 Low-#2): the update path now exists, but
  proven-where/when/by still lives only in the free-text revision note.
- The **assembly prompt** appears only when new presets are being added with OOH
  data. An *update* to a same-setup preset never re-touches assembly records — the
  right behavior, but the asymmetry is worth remembering.
