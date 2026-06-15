# SCHEMA_AUDIT.md — App Code vs. FUSION_SCHEMA.md

Audit of `src/schema/toolSchema.js`, `src/schema/fieldRegistry.js`,
`src/utils/fusionExport.js`, and `src/utils/proShopExport.js` against
`FUSION_SCHEMA.md` (ground truth from `FUSION TOOL Library REF/`).

Severity: **🔴 high** (produces JSON/CSV Fusion misreads or reverts),
**🟠 medium** (latent / unit-specific / data-loss), **🟡 low** (cosmetic / extra fields).

Status legend: ☐ open · ☑ resolved.

---

## 🔴 fusionExport.js — `toFusionFormat` (assembly gauge length key + value) ☑

- **Schema says:** the assembly gauge length is **`geometry.assemblyGaugeLength`** (camelCase, nested in `geometry`), and its value = `holder.gaugeLength` (converted to the tool's unit) **+** `geometry.LB` (OOH). There is **no** root-level `assembly-gauge-length` key in any of the 226 reference tools.
- **App does:** line 20 writes a **root-level** `f['assembly-gauge-length'] = ooh` — wrong key name, wrong nesting level, and the value is OOH alone (holder gauge length omitted). `internalToFusionTool` never sets `geometry.assemblyGaugeLength` either (only preserved via `...existing`), so single-tool / full-library JSON exports emit the wrong field with the wrong value.
- **Impact:** exported JSON carries an unexpected root field Fusion ignores (or flags) and lacks the gauge length Fusion expects in `geometry`; the assembly's stick-out positioning is wrong by the holder gauge length.
- **Fix:** drop the root `assembly-gauge-length`; compute `geometry.assemblyGaugeLength = holderGaugeLength(in tool unit) + ooh` (mirroring `splitToFusionInstances` lines 1032–1038). Keep writing `geometry.LB = ooh`.

---

## 🔴 toolSchema.js — `internalToFusionTool` (geometry expression unit hardcoded `in`) ☑

- **Schema says:** `expressions.tool_diameter/tool_fluteLength/tool_overallLength/tool_shaftDiameter/tool_shoulderLength/tool_cornerRadius` carry a unit suffix that **matches the tool's unit** (`" in"` for inch tools, `" mm"` for mm tools). Fusion re-derives the numeric geometry field from this expression on every load.
- **App does:** lines 728–738 hardcode `" in"` for all of these regardless of `tool.unit` (the feed/speed expressions correctly use `feedUnit`/`speedUnit`, but the geometry block does not).
- **Impact:** for a millimeters tool, writing e.g. `tool_diameter: "5 mm-value in"` makes Fusion parse it as inches (5 in = 127 mm) and silently corrupt every geometry value on the next load. Latent today (all current tools are inches) but breaks the moment a mm tool is written, contradicting the units mandate in CLAUDE.md.
- **Fix:** compute a linear-unit string (`isInch ? 'in' : 'mm'`) and use it for all geometry expression suffixes.

---

## 🟠 toolSchema.js — `buildHolderObject` / holder gauge length not expression-derived ☑

- **Schema says:** holder gauge length = sum of the segment heights **named in `expressions.tool_holderGaugeLength`** (Fusion segment numbers → JSON indices via `S - fusionNum`); segments absent from the expression are above the gauge line and excluded. Use `computeGaugeLength()`.
- **App does:** `buildHolderObject` trusts the stored `holderEntry.gaugeLength` and only clamps it **down** to the **total** height of all segments (lines 372–375). The total includes any above-gauge-line segment, so the clamp ceiling is too high to catch a stale value that wrongly includes an above-gauge segment, and the function never parses the expression.
- **Impact:** a holder-library entry with a wrong/stale `gaugeLength` (or an above-gauge segment) is not corrected; assembly gauge length derived from it is wrong. No expression-parsing path exists as required by the task.
- **Fix:** add `computeGaugeLength(holder)` and `buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount=1)` per FUSION_SCHEMA §1b; have `buildHolderObject` recompute gauge length from the expression+segments when an expression is present, falling back to the clamped stored value. Never hardcode the above-gauge-line count.

---

## 🟠 fusionExport.js — `toolToTsvRows` thread-pitch field names wrong ☑

- **Schema says:** CSV cols 106/107 (`tool_maximumThreadPitch`/`tool_minimumThreadPitch`) come from the thread-pitch fields. The app's internal fields are `max_thread_pitch` / `min_thread_pitch` (per `fieldRegistry.js` and `newTool`).
- **App does:** lines 252–253 read `tool.thread_pitch_max` / `tool.thread_pitch_min` — fields that **do not exist** on the internal model, so cols 106/107 are never populated for thread mills.
- **Impact:** thread-mill max/min pitch is silently dropped from the TSV/clipboard export.
- **Fix:** read `tool.max_thread_pitch` / `tool.min_thread_pitch`.

---

## 🟠 fusionExport.js / toolSchema.js — invalid coolant `flood and through tool` ☑

- **Schema says:** the only valid Fusion coolant values are `flood`, `tool`, `disabled`, `air`, `flood tool`. `"flood and through tool"` is **not** valid.
- **App does:** `toolToTsvRows` default preset (line 181) and the col-42 fallback (line 224) emit `tool.tsc_capable ? 'flood and through tool' : 'flood'`. `toolToExtractor` (toolSchema.js line 161) also produces `'flood and through tool'`. (`normalizePreset` already remaps stored values, but these synthesis/fallback paths bypass it.)
- **Impact:** a TSC tool exported without an explicit preset coolant gets an invalid value Fusion rejects/normalizes unpredictably.
- **Fix:** use `'flood tool'` for the TSC case in all three spots.

---

## 🟠 fieldRegistry.js / toolSchema.js — drill point angle (`SIG`) not mapped to Fusion ☑ resolved

- **Schema says:** drills/spot drills store the point (included) angle in `geometry.SIG` (e.g. 118/135/140); it is a real Fusion geometry field (71 tools).
- **App does:** `fieldRegistry.js` marks `tip_angle` as `fusionPath: null, metadataOnly: true`; `fusionToolToInternal` never reads `geometry.SIG`, and `internalToFusionTool` never writes it. The drill point angle is read from / written to ProShop + metadata only.
- **Impact:** a drill's point angle present in the Fusion library is ignored on read and never written back — Fusion-side point angle is lost for app-managed drills. The CSV/TSV path *does* write col 155 (`tool_tipAngle`→SIG) from `tool.tip_angle`, so the JSON and CSV paths disagree.
- **Fix:** ☑ done (user-approved). `tip_angle` is now Fusion-native: `fusionToolToInternal` reads `geometry.SIG`; `internalToFusionTool` writes `geometry.SIG` for the point-angle types (`TIP_ANGLE_TYPES` = drill/center drill/spot drill/counter sink/chamfer mill, matching the TSV `tipAngleTypes`), with clearing support. `fieldRegistry.js` now sets `fusionPath: 'geometry.SIG'`, `metadataOnly: false`. `mergeFusionAndMetadata` now prefers `fusionInternal.tip_angle` (Fusion authoritative) with metadata as a transition-only fallback; the value is still cached in metadata (parallel to `shoulder_length`). JSON and TSV paths now agree. CLAUDE.md mapping table documents the field.

---

## 🟠 fieldRegistry.js — no unit-conversion flag; `ooh`/`min_ooh` not distinguished from native lengths ☑

- **Schema says (§1e):** every `unit: 'length'` field is stored in the tool's **native** unit EXCEPT `ooh`/`min_ooh`, which are **inches-canonical** and must convert at any boundary with native lengths. The registry should flag which fields need a conversion multiplier.
- **App does:** all length fields share `unit: 'length'` with no flag separating inches-canonical (`ooh`, `min_ooh`) from native lengths; there is no `canonicalUnit`/`needsConversion` metadata.
- **Impact:** the registry can't be used to drive conversions; conversion logic is hand-coded in scattered spots, the seam the future global-unit work needs is missing.
- **Fix:** add a `canonicalUnit` annotation (`'inches'` for `ooh`/`min_ooh`, `'native'` for other lengths) and document it in the registry header. Non-breaking metadata addition.

---

## 🟡 toolSchema.js — `internalToFusionTool` writes geometry fields some types omit ☑(documented)

- **Schema says (§1d):** `shoulder-diameter` is present only on mills (absent on drills, taps, reamers, circle-segment oval, turning); `SFDM` is absent on circle-segment lens/oval/taper and turning; `HAND` is absent on most taps. Geometry should be minimal per type.
- **App does:** `internalToFusionTool` writes `CSP`, `HAND:true`, `SFDM`, `shoulder-diameter`, `shoulder-length` **unconditionally** for every type (lines 745–753). For a drill this adds a `shoulder-diameter` Fusion never emits; for a tap it forces `HAND`.
- **Impact:** extra geometry keys that differ from native Fusion output for those types; bloats diffs. Not corrupting (Fusion tolerates the extra geometry keys), and matches the long-standing CLAUDE.md "write the core set unconditionally" rule.
- **Fix:** ~~documented as a deliberate trade-off~~ **reopened and resolved by the round-trip audit (see §RT below)** — the reference exports showed this diverged from native output on every non-mill type and was the likely source of per-type validation flags. `internalToFusionTool` now gates the core set per type (turning skipped entirely; SFDM/shoulder-length presence-conditional; shoulder-diameter preserve-only; HAND synced-only for taps).

---

## 🟡 toolSchema.js — `internalToFusionTool` always writes `GRADE` ☑(documented)

- **Schema says:** `GRADE` is present on only 166/226 tools — Fusion omits it on 60 and lets the UI default.
- **App does:** line 717 writes `GRADE: existing.GRADE || 'Mill Generic'` always.
- **Impact:** adds `GRADE` to tools that never had it; cosmetic diff only.
- **Fix:** preserve `GRADE` only when the original entry had one (write `...(existing.GRADE ? { GRADE: existing.GRADE } : {})`). Low priority; documented.

---

## 🟡 fusionExport.js — TSV omits a few always-populated columns ☑(documented)

- **Schema says (§1c):** `tool_surfaceSpeed`(146), `tool_diameterOffset`(56), `tool_compensationOffset`(41), `tool_lengthOffset`(97) are populated on every reference row; `tool_useFeedPerRevolution`(164) is set for drills/taps/turning.
- **App does:** writes 146 only `if (preset.v_c)`; writes 41/56/97 only when a tool number exists; never writes 164/163.
- **Impact:** rows for tools with no surface speed or no machine number omit cells Fusion always emits; drill/tap feed-per-rev mode flag is absent. Fusion fills defaults, so import still works — cosmetic / round-trip-fidelity only.
- **Fix:** documented. The TSV is paste-compatible as-is (verified column positions all correct); these are fidelity nits, not correctness bugs. Left for a follow-up unless round-trip diffs require it.

---

## 📌 CLAUDE.md — documents a root-level `assembly-gauge-length` (contradicts ground truth) ☑ resolved

- **Schema says:** there is **no** root-level `assembly-gauge-length` field in any of the 226 reference tools; the value lives at `geometry.assemblyGaugeLength` = holder gauge + OOH.
- **CLAUDE.md says:** lines 263, 373, and 762 describe `assembly-gauge-length` as "a Fusion-native root-level field for OOH, safe to write" and "what we WRITE on export". This is factually wrong per the reference exports and now contradicts the corrected code.
- **Impact:** future work guided by CLAUDE.md could reintroduce the root-level field that this audit removed. (Also note line 616 says `incoming_ooh` is read from `assembly-gauge-length`, but the code actually — and correctly — reads it from `tool_bodyLength`/`geometry.LB`.)
- **Fix:** ☑ done — updated CLAUDE.md lines 66, 263, 372–373, 616, 677, and 762 to describe the field as `geometry.assemblyGaugeLength` (nested, = holder gauge + OOH) and to source `incoming_ooh` from `geometry.LB`/`tool_bodyLength`. No remaining references describe a root-level `assembly-gauge-length` as what we write.

## ☑ services/mergeQueue.js — Phase 2 JSON import does not capture `incoming_ooh` (resolved)

- **Schema/observation:** the primary Fusion clipboard path is CSV/TSV; `parseFusionCsv` correctly derives `incoming_ooh` from `tool_bodyLength` (geometry.LB). The secondary JSON-paste path (`parseIncoming` → `fusionToolToInternal`) does not set `incoming_ooh` at all.
- **Impact:** a tool imported via pasted **JSON** carries no incoming OOH, so CommitStep's assembly detection won't fire for that path. Minor — JSON paste is the fallback, not the documented clipboard format.
- **Fix:** ☑ done — the JSON branch of `parseIncoming` now attaches the same transient fields as `parseFusionCsv`: `incoming_ooh = readOohFromFusion(ft)` (reads `geometry.LB`, ÷25.4 for mm), plus `incoming_holder_guid` and `_incomingHolderDesc` from the raw tool. CommitStep assembly detection now fires for JSON-pasted tools too.

## Verified correct (no action)

- **TSV column positions** — every `S(pos,…)` in `toolToTsvRows` matches the reference 173-column header exactly (assemblyGaugeLength=15, bodyLength=33, holderGaugeLength=82, feedCutting=59, feedPerRevolution=66, feedPerTooth=67, spindleSpeed=141, surfaceSpeed=146, shaftDiameter=134, shoulderDiameter=137, shoulderLength=138, taperAngle=147, tipAngle=155, tipDiameter=156, lowerRadius=99, upperRadius=162, vendor/location=165, stepdown=144, stepover=145, use_stepdown=168, use_stepover=169, shaft_segments=170, holder_segments=171, version=172).
- **`splitToFusionInstances`** — writes `geometry.assemblyGaugeLength` (camelCase, nested) = holder gauge + OOH, and keeps `geometry.LB` + `expressions.tool_bodyLength` in sync. (Corrected — see full-stack pass §A1: it previously emitted the gauge length in inches while `geometry.LB` was native, wrong for mm tools; now both are in the tool's unit.)
- **Holder/shaft segment TSV format** — `H<h> U<upper> L<lower>; …` in tool unit, JSON array order; matches the reference.
- **Stepdown/stepover three-way sync** — `normalizePreset` correctly drops numeric+expression when the flag is off.
- **Preset formula expressions** — `internalToFusionTool` correctly preserves `tool_feedPlunge/Ramp/Transition` and only regenerates the active speed/feed mode keys with correct units.
- **Holder gauge unit conversion in TSV** — `unitFactor(holder.unit, tool.unit)` correctly handles mm-holder-on-inch-tool.

---

# Full-stack sync pass (4-axis audit)

A second audit across four axes — flat field-mapping, CLAUDE.md-vs-code, units, and metadata coherence. Items resolved below; the `pitch`/`geometry.TP` item is left **open pending a decision** (see end).

## ☑ A1 🔴 `splitToFusionInstances` wrote `assemblyGaugeLength` in inches for metric tools
- The live save path summed holder-gauge-in-inches + inches OOH while the sibling `geometry.LB` was written in the tool's native unit — two geometry fields in different units for a mm tool. **Fixed:** both now converted to the tool's native unit before summing (mirrors `fusionExport.js`). Reopened the stale "verified correct" note above.

## ☑ A2 🔴 Sync Job could never commit TSC capability
- `DiffStep.jsx` diffed a non-existent flat field `'coolant'`; the real field is `tsc_capable`. **Fixed:** Setup diff now lists `tsc_capable` (boolean, rendered Yes/No, label from `FIELD_LABELS`).

## ☑ A3 🟠 `linked_preset_guids` dropped on every save (data loss)
- Producers (`DiffStep` create/link, `ToolDetail`) wrote it, but `buildMetadataTool` omitted it and `buildLogicalTool` never read it back → stripped on the next write. **Fixed (user chose persist):** `buildMetadataTool` now persists `linked_preset_guids`, `buildLogicalTool` reads it back. CLAUDE.md in-memory shape + metadata example reconciled.

## ☑ A4 🟠 `cutting_direction` / `geometry.HAND` — left-hand tools lost their hand
- `internalToFusionTool` hardcoded `HAND: true` and never read it. **Fixed (user chose map):** `fusionToolToInternal` reads `geometry.HAND` → `cutting_direction` (`true`=Right Hand); `internalToFusionTool` writes `HAND` from `cutting_direction`; `mergeFusionAndMetadata` now Fusion-authoritative; `fieldRegistry` `cutting_direction` → `fusionPath: 'geometry.HAND'`, `metadataOnly: false`. CLAUDE.md mapping-table row added.

## ☑ A5 🟡 CLAUDE.md doc drift
- **Fixed:** metadata schema lead-in (keyed by `tracking_id`, `buildMetadataTool` authoritative, `proshot_id` Fusion-owned) + assembly example (`instance_guid` added, `source` includes `fusion`); Description Rename marked implemented (`DescRenameModal.jsx`); Source Layout updated (added `NormalizeModal`, `DescRenameModal`, `PresetPanel`, `LibrarySetup`, `LoginScreen`, `Settings`, `ToolExtractorTab`, `utils/presetNaming.js`, `holderNaming.js`, `speedsAndFeedsCalc.js`); `tap cut`/`tap form` round-trip caveat documented.

## ☑ B1 🟠 `pitch` / `geometry.TP` — resolved
- Internal `pitch` is a free-form thread **designation string** (e.g. `"5/16-24"`); `geometry.TP` is a numeric pitch. The JSON path neither read nor wrote `TP`, so thread pitch was dropped on JSON round-trip while the extractor-CSV wrote it — paths disagreed.
- **Fixed (user chose "add a numeric field"):** added a dedicated Fusion-native numeric field `thread_pitch` ↔ `geometry.TP`, kept alongside the `pitch` designation string. `fusionToolToInternal` reads `geo.TP`; `internalToFusionTool` writes `geometry.TP` + the synced `expressions.tool_threadPitch` (unit-correct via `lenUnit`) for `THREAD_PITCH_TYPES` (thread mill / tap form / tap cut); `fieldRegistry` `thread_pitch` → `fusionPath: 'geometry.TP'`, `canonicalUnit: 'native'`. TSV path now reads (`parseFusionCsv` col 150) and writes (`toolToTsvRows` col 150) it. `pitch` stays the metadata-only human designation; no lossy read-back. (Also: `parseFusionCsv` now reads `tool_hand` → `cutting_direction`, matching the A4 JSON change.)

## ☑ B2 🟡 Dead `?? fusionInternal.X` fallbacks in `mergeFusionAndMetadata` — resolved
- Several merge chains read `meta.X || fusionInternal.X || default` for fields where `fusionToolToInternal` only ever produces an empty placeholder (Fusion has no source for them), so the middle term could never contribute.
- **Fixed:** trimmed the dead middle operand for the metadata-only fields `vendor`, `product_id`, `coating`, `center_cutting`, `material_suitability` (now `meta.X ?? default`). Genuinely-live Fusion-wins chains (`cutting_direction`, `tip_angle`, `created_at`/`updated_at`, `machine_tool_number`) are unchanged. Pure no-op; aligns with the "no dual-read shims" rule. (Note: `vendor`/`product_id` here are the manufacturer name / EDP # — metadata-only — **not** the `location` and `proshot_id` Fusion mappings, which are separate and untouched.)

## ☑ B3 🟡 `tool_number` / `machine_tool_number` registry overlap — resolved
- Two internal fields mapped to the same Fusion slot `post-process.number` with different types (legacy string `tool_number` vs. number `machine_tool_number`), with write precedence hand-coded in `internalToFusionTool`.
- **Fixed (user: "there should be only one variable"):** removed the legacy internal `tool_number` entirely; `machine_tool_number` is now the single field owning `post-process.number` (assigned by the renumber function). Updated the extractor map (`toolNumber ↔ machine_tool_number`), `extractorToTool`/`toolToExtractor`, `fusionToolToInternal` (dropped the duplicate string read), `internalToFusionTool` (dropped both legacy fallback branches), `newTool`, `FIELD_LABELS`, and the field registry. The Fusion-native `expressions.tool_number` write (inside `applyMachineNumberToFusion`) is unrelated and kept.

## ☑ B4 🟡 `proshot_id` mirror not noted in the registry — resolved
- `internalToFusionTool` writes `proshot_id` to both `product-id` and `expressions.tool_productId`, but the registry only listed the primary path.
- **Fixed:** added a `fusionMirror: 'expressions.tool_productId'` annotation (plus a comment) to the `proshot_id` registry entry, so the mirror is documented at the source of truth.

## ☑ B5 🟡 Hardcoded `(in)` linear-unit suffixes in labels — resolved
- The linear-unit suffix was hardcoded as `(in)` / `(in/min)` across three places (`FIELD_REGISTRY` labels, `FIELD_LABELS`, `FacetFilters`), contradicting the "display off the active unit" goal.
- **Fixed:** added a single `fieldLabel(field, unit)` helper in the registry — the one source of the linear suffix (native lengths → `(in)`/`(mm)`, feeds → `(in)`/`(mm)`, feedrates → `(in/min)`/`(mm/min)`); a `DEFAULT_LINEAR_UNIT` constant makes the future global toggle a one-line change. Stripped the 20 hardcoded suffixes from the registry labels; `FIELD_LABELS` is now generated from the registry (eliminating the duplicate map); `FacetFilters` drops the entries that duplicated `FIELD_LABELS`; and `ToolForm` now calls `fieldLabel(field, data.unit)` so a metric tool's edit form shows `(mm)`. `AssemblyForm`'s OOH/MIN OOH labels are left as inches — those values are **canonical inches by design**, so the suffix is correct, not a bug.

## ☑ C1 🟢 Full units pass — OOH/min_ooh native + app-wide inch/mm support
- Per the user, the "OOH/min_ooh always inches" rule was a stopgap from before there was a global default unit. Reworked the whole app onto a single canonical model: **every length is stored in its record's own unit** (tool lengths in the tool's unit, holder gauge in the holder's unit), OOH/min_ooh included — no hidden inches canonical. Done now (rather than later) because no data is migrated yet, so changing the canonical model is free.
- **Foundation:** new `src/utils/units.js` — `convertLength`/`toInches`/`fromInches` (the one conversion primitive, `MM_PER_IN`), `getDefaultUnit`/`setDefaultUnit` (localStorage `app_default_unit`), `unitAbbr`, `formatLength`, `lengthEps` (unit-aware tolerance).
- **Model flip:** `readOohFromFusion` and `splitToFusionInstances` read/write `geometry.LB` raw (no ÷/×25.4); `assemblyGaugeLength` converts only the holder gauge (holder unit → tool unit) before adding OOH. Removed `inchesToNative` and all its call sites (`validateGeometry`, `normalizeLibrary`/AppContext now compare/assign same-unit directly). `incoming_ooh` (merge import) taken raw. Registry: `ooh`/`min_ooh` `canonicalUnit: 'native'`; `newTool()` defaults to `getDefaultUnit()`.
- **Matching:** OOH/preset tolerances are unit-aware via `lengthEps(unit)` — `presetMatchesAssembly(preset, assembly, unit)` and DiffStep `checkDifferentAssembly`/`matchPresets` thread the tool's unit through.
- **Display:** all length displays + labels read the record's unit (`ToolForm`, `ToolDetail`, `ToolCard`, `AssemblyForm`, `AssemblyCard`, `PresetPanel`, `HolderPicker`, `MatchStep`/`DiffStep`/`CommitStep`/`NewToolStep`). The holder picker shows each holder in its own unit.
- **Settings:** new **Default Unit** toggle (inches/mm). **ProShop import:** new **ProShop file unit** selector — `min_ooh` converted from the file unit into the matched tool's unit; new tools from ProShop rows adopt the file unit.
- **Docs:** CLAUDE.md Units section + OOH/MIN OOH/assembly-export/Key-Constraints rewritten to the native-everywhere model.
- **Per-record unit picker:** `ToolForm` now shows a unit selector when **creating** a tool (defaults to the global default; geometry labels update live) — the chosen unit is written to Fusion (`internalToFusionTool` writes `tool.unit`, fixing a bug where new tools always wrote `inches`). When **editing** an existing tool the unit is shown read-only (pulled from Fusion). The extractor create path carries a unit through too (`extractorToTool`).
- `computeGaugeLength` (returns inches) is now unused but kept as a utility.

---

# RT — Round-trip audit fixes (June 2026)

`scripts/roundtrip-audit.mjs` runs every tool in `FUSION TOOL Library REF/` through
`fusionToolToInternal` → `internalToFusionTool` and diffs against the original export.
Baseline: **232/232 tools diverged (2,383 unexpected diffs)**; after the fixes below: **0**.
Findings and per-type breakdown: `FUSION_SYNC_AUDIT_PLAN.md`. The harness exits non-zero on
any unexpected diff — run it after touching the converters.

## ☑ RT1 🔴 Default-formula expressions injected into presets with real values
- Injecting Fusion's default formulas (`tool_feedPlunge` ternary → 40 inpm, `tool_feedRamp`,
  `tool_feedTransition`, `tool_feedRetract`, `tool_feedPerRevolution`, surface-speed/fpt
  companions) into presets that had numerics but no expression made Fusion replace stored,
  proven feeds on the next load. **Fixed:** defaults are seeded only for blank app-created
  presets; existing presets get sync-only treatment (preserve byte-for-byte when unchanged,
  literal rewrite when the value changed, never add keys, "both absent" preserved).
## ☑ RT2 🔴 `geometry.tip-diameter` zeroed on every write
- The read half was never implemented (registry declared the path). **Fixed:**
  `fusionToolToInternal` reads it; `mergeFusionAndMetadata` is Fusion-first (metadata fallback).
## ☑ RT3 🔴 `geometry.shoulder-diameter` overwritten with the shank diameter
- Real data on reduced-shank tools/thread mills. **Fixed:** preserve-only for existing tools;
  seeded from the shank only for new tools of `SHOULDER_DIAMETER_TYPES`.
## ☑ RT4 🟠 Per-type geometry/expression gating
- Turning general no longer receives the mill core set; SFDM/shoulder-length only when the
  tool has them; HAND synced-only for taps; tool-level expressions are sync-never-inject
  (no more `"''"` / `"0 in"` adds); offset keys only touched when the entry uses them.
## ☑ RT5 🟠 Hole-making preset stripping
- `normalizePreset` no longer deletes real incoming feed fields from tap/drill presets
  (native exports carry the full set when values were entered); only step flags, ramp
  fields, and tap/spot `f_n` are stripped. Category branches seed presence-conditionally
  (no more injected `f_n: 0` on 50 drill presets).
## ☑ RT6 🟠 Cabinet location lost when only root `vendor` set
- `fusionToolToInternal` now falls back to the root `vendor` field.
## ☑ RT7/RT8 🟡 Injected preset defaults / formula-literal overwrites
- `description: ''`, turning `n_ramp: 0`, empty `expressions` objects no longer injected;
  unchanged expression strings (formulas like `"(.8/25.4) in"`, mixed-unit literals,
  trailing-zero formats) preserved byte-for-byte via the value-changed sync.

Remaining **expected** diffs (allowlisted in the harness, all intentional): `last_modified`,
`<NEW TOOL GUID>` strip, root-vendor re-derivation, whitespace-only string normalization,
offsets-follow-tool-number policy.

---

# FR — Field-registry centralization audit (June 2026)

Goal (future "later thing"): **no field definition hardcoded anywhere outside
`fieldRegistry.js`.** This section maps the current state — what is genuinely
registry-driven vs. what the registry only *documents* while the real definition
lives (and can silently drift) in the conversion/export/extractor code. No code
was changed for this audit; it is a map for a later, deliberately-scoped refactor.

## ✅ Already centralized (registry is the source AND is consumed)
- **Labels** — `FIELD_LABELS` (`toolSchema.js`) is generated via `Object.fromEntries(... fieldLabel(name))` from `FIELD_REGISTRY`. Consumed by `FacetFilters.jsx`, `NewToolStep.jsx`, `ToolFields.jsx`. Linear-unit suffix derived centrally by `fieldLabel(field, unit)`.
- **Type / unit / precision** — `FIELD_REGISTRY[field]` read directly by `ToolFields.jsx`, `toolFieldLayout.js`, `FacetFilters.jsx` (e.g. `.type === 'number'`).
- **Form applicability** — `fieldsForType()` consumed by `toolFieldLayout.js`.
- **Metadata-only write guard** — `isMetadataOnly()` consumed by `internalToFusionTool` (`toolSchema.js:1303`) to strip non-Fusion keys before write. This is the one place a registry flag actually gates the Fusion JSON.

## ☐ FR1 🟠 Fusion JSON paths — registry `fusionPath` is documentation only
- `fusionNativeFields()` has **zero callers**; the registry's `fusionPath` values are never read programmatically.
- Real read/write paths are **hardcoded literals**: `toolSchema.js` `fusionToolToInternal` / `internalToFusionTool` (~17 distinct `geometry.*` / `expressions.*` / `BMC` paths), `fusionExport.js`, `reconcile.js` (signature keys), `mergeQueue.js` (CSV parse).
- Drift risk: a path can disagree between the registry and the converter with no error or audit failure (the round-trip audit checks converter↔Fusion, not converter↔registry).

## ☐ FR2 🟠 ProShop columns — registry `proShopColumn` is documentation only
- `proShopFields()` has **zero callers**; `proShopColumn` values are never read programmatically.
- Real definitions: `tool-extractor.tsx` `PS_MAIN_COLS` (header + extractor fn pairs — the actual export source), `proShopExport.js`, and `ImportFlow.jsx` (reads PS header **strings** directly, e.g. `row['Tip to 1st Full Thread']`).

## ☐ FR3 🟠 Per-type applicability duplicated from the extractor
- Registry `appliesToTypes` is **manually duplicated** from `FIELD_VISIBILITY` in `tool-extractor.tsx` (the registry comment says "derived from tool-extractor.tsx FIELD_VISIBILITY").
- `FIELD_VISIBILITY` is the real source for `getRequiredFields()` (`toolSchema.js`) and the extractor UI. Two places that can drift on every new field / type-visibility change.

## ☐ FR4 🟡 Tool-type list duplicated
- Registry `ALL_TYPES` is "duplicated to avoid circular dep" from `TT` in `tool-extractor.tsx`. Two hand-maintained lists of the 25 types.

## ☐ FR5 🟡 Field-label maps outside the registry (mostly different concerns — verify, don't assume)
- `PRESET_FIELD_LABELS` (`DiffStep.jsx`) — preset sub-field labels (`v_f`, `f_z`…), not tool fields; out of registry scope today.
- `MATERIAL_LABELS` (`presetNaming.js`), `TYPE_LABELS` (`FilesSection.jsx`, attachment types), `STEP_LABELS` / `FACET_LABEL` overrides — non-tool-field label maps. Catalog them when scoping, but they are not the `FIELD_REGISTRY` field set.

## Suggested refactor staging (when the "later thing" starts — confirm scope first)
1. **FR1 paths** behind the round-trip audit: drive `fusionToolToInternal` / `internalToFusionTool` off `registry.fusionPath`, proving byte-identical output at each step.
2. **FR2 ProShop**: generate `PS_MAIN_COLS` / import lookups from `registry.proShopColumn`.
3. **FR3/FR4**: make the registry the single source for applicability + the type list (generate `FIELD_VISIBILITY` / `TT` from it, or vice-versa), removing the duplicate.

This is a **big, cross-cutting change** to the most audit-critical code (the converter). Scope and stage deliberately; do not start as a tidy-up.
