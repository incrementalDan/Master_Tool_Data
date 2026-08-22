# FUSION_SYNC_AUDIT_PLAN.md — Round-Trip Audit Findings & Fix Plan

> **STATUS: IMPLEMENTED ✅** — all root causes below (RC1–RC8) are fixed in
> `src/schema/toolSchema.js`; the harness now reports **0 unexpected diffs across all 232
> reference tools / 23 types** (only the documented expected diffs remain). The resolution
> record lives in `SCHEMA_AUDIT.md` §RT; CLAUDE.md's Geometry-minimalism and Preset-expressions
> sections were rewritten to match. This document is kept as the diagnosis record. Still open:
> the coverage gaps (no counter bore / counter sink / center drill / boring head reference
> exports) and one real-Fusion confirmation save per previously-affected type.

**How this was produced:** a new harness (`scripts/roundtrip-audit.mjs`) runs every tool in
`FUSION TOOL Library REF/` (`Full_Type_List Examples.json` + `Special Cases.json`, 232 tools)
through `fusionToolToInternal()` → `internalToFusionTool()` and deep-diffs the output against the
original Fusion export, field by field.

```
node scripts/roundtrip-audit.mjs              # summary per tool type
node scripts/roundtrip-audit.mjs --verbose    # every diff with example tools
node scripts/roundtrip-audit.mjs --type drill # one Fusion type only
```

It exits non-zero when any unexpected diff remains, so once the fixes below land it becomes a
**regression test**: run it after any change to `toolSchema.js` and it should stay clean.

**Result: 232/232 tools currently round-trip with unexpected diffs — 2,383 total.**
They reduce to **8 root causes** (RC1–RC8 below), all in `internalToFusionTool` /
`fusionToolToInternal` / `normalizePreset` (`src/schema/toolSchema.js`). The per-type breakdown
(what the task asked for) follows in the second half; most types share the same causes, so each
cause is written up once and the per-type sections reference them.

**Diffs classified as expected** (allowlisted in the harness, each with a reason):
- `last_modified` regenerated on every write — by design (232×)
- Numeric expression reformatting where value + unit are identical, e.g. `".57000000000 in"` → `"0.57 in"` (632×)
- `"<NEW TOOL GUID>"` placeholder stripped from `reference_guid` — documented fix (6×)

---

## Part 1 — Root causes (ranked by severity)

### RC1 🔴 Default-formula expressions injected into presets that already have real values

- **What's wrong:** for any preset that has a numeric feed value but no matching expression string,
  `internalToFusionTool` (toolSchema.js:1017–1055) injects Fusion's *default formula* as the
  expression — `tool_feedPlunge` (the `(tool_type=='drill'…)?(40inpm):(tool_feedCutting/3)` ternary),
  `tool_feedRamp: 'tool_feedPlunge'`, `tool_feedTransition: 'tool_feedCutting'`,
  `tool_feedRetract: 'tool_feedPlunge'`, `tool_feedPerRevolution`, `tool_feedRetractPerRevolution`,
  the `tool_surfaceSpeed` companion formula, and the `tool_feedPerTooth` companion formula.
- **Why it's a bug:** Fusion re-derives every numeric from its expression on load (the documented
  invariant). Ground truth shows most native presets store **numerics with no expression at all**
  (35 tools have zero preset expressions; `tool_feedTransition` exists on only 18/280 native presets,
  `tool_feedPlunge` on 183/280). Injecting a formula makes Fusion **replace the stored, proven value**
  on the next load — e.g. a drill with proven plunge feed 12 in/min and no `tool_feedPlunge`
  expression comes back as **40 in/min**. This is the same mechanism as the old "use stepdown became
  true" bug, applied to feeds. It is almost certainly a main source of values silently changing
  after sync.
- **Scale:** ~400 injections across every type — e.g. `tool_feedTransition` added 72× (flat end mills),
  `tool_feedPlunge` 29× (drills), `tool_feedRetract` 41× (drills), `tool_feedRetractPerRevolution`
  47× (drills) + 11× (spot drills), `tool_surfaceSpeed` ~90×, `tool_feedPerTooth` ~70×.
- **Proposed fix:** the intent of the code (per its comment) was to seed defaults for **new blank
  presets only**. Gate every one of these injections on `isBlankPreset` (already computed at
  toolSchema.js:973). For presets with real values: either write the **literal** from the numeric
  (`` `${np.v_f_transition} ${feedUnit}` ``) or — better, matching native Fusion output — write **no
  expression at all** when the original had none.
- **Confidence:** high. **Complexity:** small (one block, well-isolated; harness verifies).

### RC2 🔴 `geometry.tip-diameter` is zeroed on every write

- **What's wrong:** `fusionToolToInternal` never reads `geometry['tip-diameter']` (toolSchema.js:596–668
  has no read), so `tool.tip_diameter` is null. On write, the condition at toolSchema.js:1125 sees the
  *original* had a non-zero value and writes `'tip-diameter': tool.tip_diameter || 0` → **0**.
- **Why:** the field registry (`fieldRegistry.js:337`) declares `fusionPath: 'geometry.tip-diameter'`,
  but only the write half was ever implemented. Metadata can mask it (`mergeFusionAndMetadata`
  toolSchema.js:1194 prefers `meta.tip_diameter`), but any tool whose tip diameter lives only in
  Fusion is corrupted on first save.
- **Scale:** 35 tools — chamfer mill **10/10**, spot drill 9/10, thread mill 3, bull nose 3, flat 7,
  slot mill 2, form mill 1. Real examples: `.375 90DEG CHAMFER` 0.07 → 0, `1/2 100DEG Spot Drill`
  0.045 → 0, `.488 11-32 THREAD MILL` 0.488 → 0.
- **Proposed fix:** add `tip_diameter: geo['tip-diameter'] || null` to `fusionToolToInternal`, and
  make the merge Fusion-authoritative with metadata fallback (the exact pattern already used for
  `tip_angle` per SCHEMA_AUDIT). One line + one merge-order change.
- **Confidence:** high. **Complexity:** small.

### RC3 🔴 `geometry.shoulder-diameter` is overwritten with the shank diameter

- **What's wrong:** there is no internal `shoulder_diameter` field; the write at toolSchema.js:1111
  forces `'shoulder-diameter': tool.shank_diameter || tool.diameter`. Real Fusion data stores the
  actual shoulder diameter, which differs on reduced-shank/necked tools and thread mills.
- **Examples:** `.062 BULL .01R` shoulder 0.062 → **0.125** (the shank — a shoulder *twice the cutting
  diameter*); `3/8Ø Bull reduced shank` 0.375 → 0.3125; `.098Ø #6 Threadmill` 0.0439 → 0.1875.
  Wrong geometry like this is a strong candidate for Fusion's per-type validation flags, and it
  corrupts the tool silhouette Fusion draws.
- **Also:** the same line **adds** `shoulder-diameter` to types that never carry it natively —
  drills (48/48), taps (21/21), reamers (8/8), form mills (13/13), boring bar, turning (see RC4).
- **Proposed fix (two options, pick one):**
  1. *Minimal:* stop writing it; preserve from `...existing` like `NT`/`tip-length`/`tip-offset`
     (the "never written explicitly" set, toolSchema.js:1126). New tools created in the app get it
     from the type defaults instead.
  2. *Complete:* add a real internal `shoulder_diameter` field (read + registry + form field), write
     it only for the mill types that natively carry it (§1d matrix).
  Option 1 is recommended first — it's safe and reversible; option 2 can follow if you want the
  field editable in the app.
- **Confidence:** high. **Complexity:** small (option 1) / medium (option 2).

### RC4 🟠 Core geometry + expressions force-written onto types that never carry them

- **What's wrong:** `internalToFusionTool` writes a fixed core set unconditionally —
  geometry `CSP/DC/HAND/LCF/NOF/OAL/SFDM/shoulder-diameter/shoulder-length` (toolSchema.js:1100–1112)
  and expressions `tool_description/diameter/fluteLength/overallLength/material/productId/
  productLink/shaftDiameter/shoulderLength/vendor` (toolSchema.js:1083–1099). Ground truth says these
  are **type-dependent**: turning general carries *none* of the mill geometry (it has insert fields
  EPSR/INSD/LH/RA/S/SC/SCTY/TC…), circle-segment lens/oval/taper have no `SFDM`, form mills mostly
  lack `SFDM`/`shoulder-length` (11/13), taps omit `HAND` (12/21 here). Empty-valued expressions are
  also added where Fusion omits the key entirely — `tool_productLink: "''"` (~140 tools),
  `tool_vendor: "''"`, `tool_material`, `"0 in"` lengths on types without that dimension.
- **Why it matters:** CLAUDE.md's own rule — Fusion validates strictly and flags tools with fields it
  doesn't expect; the holder_vendor fix established "**absent, not empty**". Since Fusion re-derives
  numerics from expressions, writing `tool_diameter: "0 in"` onto a turning tool isn't cosmetic — it
  tells Fusion the tool has zero diameter. SCHEMA_AUDIT previously recorded the unconditional core
  set as a deliberate trade-off; the reference data now shows it diverges from native output on
  **every** non-mill type, and it is the most plausible source of the per-type validation errors
  this audit was commissioned for.
- **Proposed fix (staged):**
  1. Gate the obviously-wrong cases first: skip the mill core set + mill expressions for
     `turning general`; don't add `SFDM`/`shoulder-length` where the original lacked them
     (circle segments, form mills); don't write `HAND` for taps (Fusion derives handedness from the
     `tap left/right hand` type — the app already reads it from the type string, toolSchema.js:655).
  2. Write string expressions (`tool_productLink`, `tool_vendor`, `tool_comment`, `tool_productId`)
     only when the value is non-empty, deleting the key otherwise — the existing holder_vendor pattern.
  3. Full per-type gating driven by the §1d matrix in FUSION_SCHEMA.md (add a `geometryFields`
     per-type table to `fieldRegistry.js`) — the complete fix, larger and best done after 1–2 prove out.
- **Confidence:** high that it diverges from native output; medium that it's the validation-error
  trigger (needs one confirmation save in Fusion). **Complexity:** small (stage 1–2) → large (stage 3).

### RC5 🟠 Hole-making preset shapes strip real stored feed fields

- **What's wrong:** `normalizePreset` deletes fields by tool category: taps lose
  `v_f/f_z/v_f_plunge/v_f_retract/v_f_leadIn/leadOut/ramp/transition/use-feed-per-revolution`;
  drills/reamers lose `v_f/f_z/v_f_leadIn/leadOut/ramp/transition`. Ground truth: **9/21 native tap
  tools and 16/48 drills (4/8 reamers) carry exactly those fields with real values** — Fusion writes
  the full set whenever values were entered.
- **Why:** the per-category preset shapes were modeled on minimal examples; Fusion's actual export
  is a superset. Deleting them probably doesn't error (absent = default), but it **discards proven
  data** and changes the entry's shape vs. native.
- **Proposed fix:** for fields the category "doesn't use", **preserve what the original preset had**
  instead of deleting (only delete when the app itself authored the preset). Concretely: in
  `normalizePreset`, drop the delete-list for incoming Fusion presets and keep the category shape
  only for app-created (blank) presets. Note this interacts with the documented per-category preset
  rules in CLAUDE.md — those should be re-scoped as "fields the app *edits*" rather than "fields the
  file *contains*".
- **Confidence:** high on the data loss; medium on the right remedy boundary. **Complexity:** medium.

### RC6 🟠 Cabinet location lost when only the root `vendor` field is set

- **What's wrong:** `location` is read only from `expressions.tool_vendor` (toolSchema.js:622). 7
  reference tools store the location only in the root `vendor` field (e.g. `"LC-11"` with no
  expression) → location reads empty, and the write then blanks the root field
  (`fusionObj.vendor = tool.location || ''`, toolSchema.js:1171). The cabinet location is erased.
- **Proposed fix:** read with fallback: `location: stripQuotes(expr.tool_vendor) || fTool.vendor || ''`.
- **Confidence:** high. **Complexity:** small (one line).

### RC7 🟡 Default values injected into presets (fields native presets don't carry)

- `f_n: 0` added to **50/50 drill presets + 8/8 reamer presets** (only 1 native drill preset has `f_n`).
- `n_ramp: 0` added to the turning preset (boring bar).
- `description: ''` added to ~60 presets that omit it.
- An `expressions: {…}` object added to the 35 tools whose presets had none (consequence of RC1).
- `use-stepdown/use-stepover: false` added to milling presets that omit them (native Fusion omits
  flag + value + expression together when off on some tools).
- **Why it matters:** mostly cosmetic bloat, but `f_n` on a drill preset is a field that type's
  presets never natively carry — the same "unexpected field per type" class as RC4.
- **Proposed fix:** emit these keys only when present in the source preset (or for app-authored
  presets). **Confidence:** high. **Complexity:** small.

### RC8 🟡 Formula/unit-variant expressions replaced with literals

- Native data contains *formula* expressions beyond the protected feed trio:
  `tool_shaftDiameter: "((tool_type == 'reamer') ? (tool_diameter * 0.9) : …)"`,
  `tool_shoulderLength: "(7/16) in"`, `tool_threadPitch: "(.8/25.4) in"` — and mixed-unit literals
  (`"4mm"` on an inch tool). The app overwrites all of these with plain literals. Values are equal
  today, but the dynamic links are broken (same class the code already protects for
  `tool_feedPlunge/Ramp/Transition`).
- Cosmetic siblings found: `"650 fpm"` → `"650.0000208 fpm"` (float noise from the stored numeric —
  worth rounding before formatting), `"100 in/min"` → `"100 inpm"` (both unit spellings appear in
  native exports; harmless), trailing-space trims of `tool_description`.
- **Proposed fix:** when regenerating a geometry expression, keep the original string if it parses
  to the same value (re-use the harness's tolerance comparison); round literals to a sane precision.
- **Confidence:** medium (Fusion accepts the literals; this is fidelity, not breakage). **Complexity:** small.

### Intentional behaviors confirmed (no action, but be aware)

- `expressions.tool_lengthOffset: "16"` → `"tool_number"` and `post-process.diameter-offset` forced
  equal to the tool number (e.g. `D26/T16` tool became `D16`). This is the app's "offsets follow T#"
  policy. **If you ever run separate diameter offsets (wear comp slots), this silently rewrites
  them** — flagging for your decision, not proposing a change.
- `holder`, `shaft`, `profile` (form mills), `GRADE`, `NT`, `tip-length`, `tip-offset`,
  `thread-profile-angle`, `setup`, `tapered-type` all round-trip cleanly via `...existing` — verified.
- Stepdown/stepover three-way sync — no violations found in 232 tools. The documented invariant holds.

---

## Part 2 — Per-type breakdown

All 22 Fusion types in the reference exports have unexpected diffs. Columns = root causes above.

| Fusion type (tools) | RC1 formulas | RC2 tip-dia zeroed | RC3 shoulder-dia | RC4 forced fields | RC5 preset strip | RC6 location | RC7 injected defaults |
|---|---|---|---|---|---|---|---|
| flat end mill (48) | ✔ heavy (72× transition) | ✔ 7 | ✔ changed 3 | ✔ exprs | — | ✔ 1 | ✔ |
| bull nose end mill (31) | ✔ heavy | ✔ 3 | ✔ changed 4 | ✔ exprs | — | ✔ 6 | ✔ |
| drill (48) | ✔ retract/plunge/per-rev | — | ✔ added 48 | ✔ exprs | ✔ 16 tools | — | ✔ f_n×50 |
| tap right hand (21) | ✔ | — | ✔ added 21 | ✔ +HAND×12 | ✔ 9 tools | — | ✔ |
| spot drill (10) | ✔ retract-per-rev ×11 | ✔ **9/10** | ✔ added 10 | ✔ exprs | — | — | ✔ |
| reamer (8) | ✔ | — | ✔ added 8 | ✔ exprs | ✔ 4 tools | ✔ 1 | ✔ f_n×8 |
| chamfer mill (10) | ✔ | ✔ **10/10** | — | ✔ +`tool_inclusiveAngle` added 10× (see docs section) | — | — | ✔ |
| thread mill (6) | ✔ | ✔ 3 | ✔ changed 6 (minor-dia formula lost) | ✔ exprs | — | — | ✔ |
| ball end mill (10) | ✔ | — | ✔ changed 2 | ✔ exprs | — | — | ✔ |
| form mill (13) | ✔ | ✔ 1 | ✔ added 13 | ✔ **+SFDM×11, +shoulder-length×11** | — | — | ✔ |
| slot mill (9) | ✔ | ✔ 2 | — | ✔ exprs | — | — | ✔ |
| face mill (3) | ✔ | — | ✔ changed 1 | ✔ +SFDM×1; mm-expr rewrites | — | — | ✔ |
| radius mill (2) | ✔ all 6 feed exprs | — | ✔ changed 2 | ✔ exprs | — | — | ✔ |
| dovetail mill (2) | ✔ | — | ✔ changed 2 | ✔ exprs | — | — | ✔ |
| lollipop mill (3) | ✔ | — | — | ✔ exprs | — | — | ✔ |
| tapered mill (1) | — | — | — | ✔ exprs (12 added keys) | — | — | ✔ |
| circle segment lens/oval/taper/barrel (4) | — | — | ✔ changed/added | ✔ **+SFDM on 3** + `"0 in"`/`"''"` exprs | — | — | ✔ |
| turning general (1) | — | — | — | 🔴 **gains the entire mill field set it must not have** (DC/LCF/NOF/CSP/HAND/SFDM/shoulder-* + `"0 in"` exprs) | — | — | ✔ |
| boring bar (1) | ✔ plunge | — | ✔ added 1 | ✔ exprs | — | — | ✔ n_ramp |

**Reading the table:** the *changed-value* corruptions (RC2/RC3/RC6) and the formula injections (RC1)
are the live data bugs; RC4 concentration on turning general / circle segments / form mills / taps
matches "Fusion throws small validation errors on certain tool types."

**Coverage gaps — types with no ground truth:** the reference exports contain no
`counter bore`, `counter sink`, `center drill`, `boring head`, or left-hand-tap examples
(one `tap left hand` exists in Special Cases and round-trips its type correctly). The harness can't
validate those types until an export containing them is added to `FUSION TOOL Library REF/` —
worth doing next time you're in Fusion.

---

## Part 3 — Where the docs are wrong or incomplete

1. **CLAUDE.md — tap types stale:** describes internal types `tap form` / `tap cut` mapping to
   Fusion. The code has a single internal `tap` (+ `tap_sub_type` metadata field, `is_sti` flag).
   Several CLAUDE.md references (Tool Types list, `THREAD_PITCH_TYPES` description) need updating.
2. **CLAUDE.md — chamfer `tool_inclusiveAngle`:** documented as "confirmed from a real Fusion
   export," but **none of the 10 reference chamfer mills carry it** — the app adds it to all 10.
   Either the confirming export came from a newer Fusion build, or it's optional. Action: confirm
   one chamfer mill saves cleanly in Fusion with the key present; if yes, allowlist the add in the
   harness; if not, make it preserve-only.
3. **FUSION_SCHEMA.md §1e units table:** still documents the abandoned "OOH stored canonically in
   inches (÷25.4 on read)" model — superseded by the native-units rework (SCHEMA_AUDIT item C1).
   Should be rewritten to match.
4. **FUSION_SCHEMA.md §1d matrix:** missing rows for counter bore / counter sink / center drill /
   boring head / tap left hand (no examples — same coverage gap as above). Also worth adding a
   "preset keys per type" matrix: the audit showed preset *shape* is as type-specific as geometry,
   and that's what RC5 tripped over.
5. **FUSION_SCHEMA.md §1c:** native exports use both `"100 in/min"` and `"100 inpm"` feed-expression
   spellings; the doc only mentions `inpm`.
6. **SCHEMA_AUDIT.md 🟡 "writes geometry fields some types omit … left as-is":** the ground-truth
   diff shows this trade-off is the likely validation-error source (RC4) — should be reopened rather
   than documented-closed.
7. **fieldRegistry.js — `tip_diameter`:** declares `fusionPath: 'geometry.tip-diameter'` but the
   read half doesn't exist (RC2). Registry and code must agree.

---

## Suggested fix order (when you green-light implementation)

| Step | Fixes | Risk | Verify with |
|---|---|---|---|
| 1 | RC2 (tip-diameter read), RC6 (location fallback) — two one-liners | minimal | harness count drops; spot-check a chamfer mill + an LC-tagged tool |
| 2 | RC1 (gate formula injections on `isBlankPreset`) | low | harness; then one real Fusion load to confirm feeds hold |
| 3 | RC3 option 1 (preserve shoulder-diameter) + RC7 (stop injecting `f_n`/`n_ramp`/empty keys) | low | harness |
| 4 | RC4 stages 1–2 (turning/circle-segment/tap gating; absent-not-empty strings) | medium | harness + save one tool of each affected type in Fusion |
| 5 | RC5 (preserve native preset fields) — needs a decision on app-authored vs. native presets | medium | harness + Phase 2 sync smoke test |
| 6 | RC8 + doc updates + add missing-type exports to the REF folder | minimal | harness goes fully green → becomes CI-able regression test |

After step 6 the harness should report **0 unexpected diffs**, and any future regression in the
converters shows up as a non-zero exit.
