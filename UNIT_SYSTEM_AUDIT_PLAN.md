# UNIT_SYSTEM_AUDIT_PLAN.md — Inch Shop / mm Shop: audit + feature plan

The working checklist for making ToolDex fully unit-aware: a shop sets itself up as an
**inch shop** or a **mm shop**, flips one toggle in Settings, and everything just works —
while individual tools keep whatever unit they actually have in Fusion, with the mismatch
clearly shown instead of hidden.

Status legend: ☐ open · ☑ done · ◐ partially done.

---

## 0. What was asked for (the requirements)

1. **Shop unit toggle** (Settings) switches the whole app between inch and mm — defaults,
   labels, display — and "everything just works."
2. **Per-tool unit respected + surfaced**: a Fusion tool can be a different unit than the
   shop. An inch tool in a mm shop still displays as an inch tool, but the UI *says so*
   (and vice versa).
3. **Wrong-unit data reality**: a physically-metric tool may have been *entered into Fusion
   as an inch tool* (and vice versa). The app displays what's stored (it can't know the
   physical truth), but must make comparison easy — which is requirement 4.
4. **Secondary unit display (display-only)** on selected fields: show the mm equivalent
   next to an inch value (and vice versa) so manufacturer-catalog values (often metric)
   can be compared without doing math.
5. **Perfect conversion math** everywhere, with **configurable default decimals per unit**
   for display.
6. **Presets + speeds & feeds are unit-aware** (they already follow the tool's unit — SFM
   vs m/min etc. — no independent unit selection needed), **plus a small converter
   toggle** in the preset editor and Speeds & Feeds Reference: type the manufacturer's
   value in the *other* unit, the app converts it, and the converted (app-unit) value is
   what's saved. Small, opt-in, never takes over the UI.
7. **Far future (explicitly deferrable)**: Fusion-style inline unit entry — typing `6mm`
   into an inch field auto-converts on commit.

---

## 1. Architecture ground rules (decide once, apply everywhere)

These follow from the existing canonical model (CLAUDE.md → Units) and from how Fusion
itself works. Every phase below assumes them.

- **R1 — Storage never converts.** Every length stays stored in its record's own unit
  (`tool.unit`, `holder.unit`). The shop toggle changes **defaults and display
  preferences only** — it must never rewrite stored values or Fusion JSON. "Convert the
  app over" = convert the *experience*, not the data. (Converting data would corrupt the
  Fusion round-trip: Fusion re-derives numerics from unit-suffixed expressions.)
- **R2 — Three distinct concepts, never conflated:**
  | Concept | Where it lives | What it drives |
  |---|---|---|
  | **Record unit** | `tool.unit` / `holder.unit` (Fusion-native) | What the stored numbers *mean*; Fusion expression suffixes; preset feed/speed units |
  | **Shop unit** | `shop_settings.default_units` (+ localStorage mirror) | Unit for **new** records; fallback display unit; which unit is "primary" vs "secondary" in dual display |
  | **Display precision** | new `shop_settings.unit_display` (Phase 2) | Decimals per unit, secondary-display on/off |
- **R3 — One conversion primitive.** All length conversion goes through
  `convertLength` (`src/utils/units.js`). No new inline `× 25.4`. Speed/feed conversions
  get their own primitives in `units.js` (see §5) — same rule.
- **R4 — Convert at display/entry boundaries only.** Secondary display and the converter
  toggle convert *at the edge* (render / keystroke); the value that lands in state and
  storage is always in the record's unit.
- **R5 — Round only at display.** Stored values keep full precision; `toFixed` happens in
  the formatter, never before save. (Existing rule: display rounds to 4dp via `round4`;
  this generalizes it to per-unit precision.)
- **R6 — Mismatch is information, not an error.** Tool unit ≠ shop unit gets a visible
  badge, never a warning/block. (Same "informed, not blocked" philosophy as conflicts.)

---

## 2. Current-state audit — what already exists

### 2a. The unit seam (`src/utils/units.js`) — solid foundation ☑

`normalizeUnit`, `convertLength` (+ `toInches`/`fromInches`), `MM_PER_IN = 25.4`,
`getDefaultUnit`/`setDefaultUnit` (localStorage `app_default_unit`, mirrored from
`shop_settings.default_units` in AppContext), `unitAbbr`, `unitPrecision`, `lengthEps`
(unit-aware ≈0.0005" tolerance), `formatLength`. Tested in `units.test.js`.

### 2b. Per-record own-unit storage ☑

- Tools: unit read from Fusion (`fusionToolToInternal`), selectable at creation
  (`ToolForm` unit toggle, defaults to `getDefaultUnit()`), read-only afterward. All
  geometry incl. OOH/min_ooh stored raw in the tool's unit.
- Holders: own `unit`; gauge length in the holder's unit.
- Cross-unit boundaries already converted via `convertLength`: holder gauge → tool unit
  for `assemblyGaugeLength`; ProShop file-unit selector in `ImportFlow` (min_ooh,
  tip_to_first_thread, new-tool adoption); holder gauge display in tool context.

### 2c. Fusion expression suffixes ☑ (locked by tests + SCHEMA_AUDIT)

`internalToFusionTool` derives `lenUnit = isInch ? 'in' : 'mm'` for all geometry
expressions, and per-preset `feedUnit` (`inpm`/`mmpm`), `speedUnit` (`fpm`/`m/min`),
`fzUnit` (`in`/`mm`) — `src/schema/fusionConvert.js:361-365`. Never hardcode `" in"`.

### 2d. Unit-aware comparison/merge ☑

`PRESET_SIGNIFICANCE` abs floors scale ×25.4 for mm tools (`DiffStep.jsx`,
`presetMerge.js`); `lengthEps` used for OOH/preset matching.

### 2e. What the shop toggle does **today** (Settings → Shop → Default Unit) ◐

Only: (a) sets the default unit for `newTool()` / new-tool `ToolForm`, (b) fallback for
`fieldLabel()` suffixes when no record unit is passed. It does **not** drive any display
preference, precision, or primary/secondary choice — that's the gap Phases 2–3 fill.

### 2f. Unit-bearing field inventory (the checklist)

**Length fields** (`unit: 'length'` in `fieldRegistry.js` — stored in the record's own
unit, labeled `(in)`/`(mm)` via `fieldLabel`):

| Field | Fusion path | Notes |
|---|---|---|
| `diameter` | `geometry.DC` | shown as "Tip Diameter" for tapered mill |
| `flute_length` | `geometry.LCF` | |
| `overall_length` | `geometry.OAL` | |
| `shank_diameter` | `geometry.SFDM` | |
| `corner_radius` | `geometry.RE` | |
| `shoulder_length` | `geometry['shoulder-length']` | |
| `tip_diameter` | `geometry['tip-diameter']` | |
| `lower_radius` / `upper_radius` / `profile_radius` / `axial_distance` | circle-segment geometry | |
| `ooh` (per assembly) | `geometry.LB` | + `expressions.tool_bodyLength` |
| `min_ooh` | metadata only | ProShop file-unit converted on import |
| `thread_pitch` | `geometry.TP` | numeric pitch in tool's unit |
| `tip_to_first_thread` | metadata only | ProShop file-unit converted on import |
| `depth_of_cut` / `width_of_cut` | preset `stepdown`/`stepover` | + expression strings |

**Speed/feed fields** (per preset; unit follows the tool's unit):

| Field | Inch unit | mm unit | Conversion |
|---|---|---|---|
| `n`, `n_ramp` (spindle/ramp RPM) | rev/min | rev/min | **invariant** |
| `v_c` (surface speed) | SFM (ft/min) | m/min | × **0.3048** (exact) |
| `v_f`, `v_f_plunge`, `v_f_ramp`, `v_f_retract`, `v_f_leadIn`, `v_f_leadOut`, `v_f_transition` | in/min | mm/min | × 25.4 |
| `f_z` (feed/tooth) | in/tooth | mm/tooth | × 25.4 |
| `f_n` (feed/rev) | in/rev | mm/rev | × 25.4 |
| `stepdown` / `stepover` | in | mm | × 25.4 |
| `ramp-angle` | degrees | degrees | **invariant** |

**Speeds & Feeds Reference** (`speed_feed_refs[]`, metadata): `sfm` (SFM or SMM per the
tool's unit — `SpeedFeedSection` labels it correctly) and `chip_load` (in/tooth or
mm/tooth). Stored in the tool's unit implicitly — **not flagged in data** (see F10).

**Angles** (`tip_angle`, `taper_angle`, thread profile angle): unit-invariant.
**Holder**: `gaugeLength` + segment heights in the holder's own unit.

---

## 3. Findings — gaps & bugs (fix list)

Severity: 🔴 wrong numbers today · 🟠 wrong the moment a mm tool/shop exists · 🟡 polish.

### 🔴 F1 — Surface-speed math is inch-only in the preset editor ☐
- `src/utils/speedsAndFeedsCalc.js` `rpmToSFM`/`sfmToRPM` hardcode the ×12 (feet) factor.
- `PresetPanel.jsx` uses them for the `v_c↔n` formula link (lines ~654, ~828) while
  *labeling* the field `m/min` for a metric tool (line 123) — so a mm tool's surface
  speed is computed as SFM but displayed as m/min. Wrong by ~3.28×.
- Meanwhile `SpeedFeedSection.deriveRPM` already does it right (factor 1000 vs 12) —
  two implementations, one wrong.
- **Fix:** make the calc helpers unit-aware (`rpmToSurfaceSpeed(rpm, dia, unit)` with
  factor `unit==='millimeters' ? 1000 : 12`), use them from both call sites, delete the
  duplicate in `SpeedFeedSection`.

### 🟠 F2 — Hardcoded inch suffixes in display ☐
- `ReconcileModal.jsx:23` — OOH formatted with a literal `in`.
- `DiffStep.jsx:272` — OOH with a literal `"` inch mark (line 237/372 nearby do it right
  with `unitAbbr`).
- `PresetPanel.jsx:460` — seed-tooltip says "SFM" regardless of tool unit.
- **Fix:** route through `unitAbbr(tool.unit)` / the Phase-2 formatter.

### 🟠 F3 — Inline `25.4` conversions outside the seam ☐
- `ToolForm.jsx:29,37` (thread-pitch designation ↔ numeric pitch) — hand-rolled `/25.4`,
  `*25.4`; should call `convertLength`.
- `holderGauge.js:34` — hand-rolled `/25.4`; should call `convertLength` (math is
  correct, seam rule violation only).

### 🟠 F4 — `toolIdSystem.padDiameter` assumes inches ☐
- `dia × 1000 → 4 digits` only makes sense for inch diameters (documented known
  assumption). A mm shop using `size_first` mode gets nonsense IDs (6mm → `6000`).
- **Fix (design needed):** mm branch, e.g. dia in mm ×100 (`6mm → 0600`) or ×10 — pick
  with the user when a mm shop is real. Note in Settings preview meanwhile.

### 🟠 F5 — `buildDesc` (auto descriptions) is inch-centric ☐
- Letter/number drills, fraction names (`1/8 (.125)…`), 3-decimal display all assume
  inch. A mm tool gets an inch-styled description.
- **Fix (scoped small):** for mm tools, emit metric style (`6MM 4FL EM …`), skip
  letter/fraction lookup. `toolNaming.js` already has metric-detection helpers
  (`isMetricSize`, lines 58-73).

### 🟡 F6 — Display precision is hardcoded all over ☐
- `.toFixed(3)` / `.toFixed(4)` at ~20 sites (`AssemblyCard`, `AssemblyForm`,
  `PresetPanel`, `ToolDetail`, `ToolCard.formatDim`, `DiffStep`, `CommitStep`,
  `HolderPicker`, `PairingSections`, `presetNaming.js:284` OOH-in-name…).
- `units.js` itself disagrees with itself: `unitPrecision` → 3 (mm) / 4 (in) but
  `formatLength`'s internal default → 2 (mm) / 3 (in).
- **Fix:** Phase 2 formatter + settings; one default table; sweep the call sites.
  (Preset **names** keep `.toFixed(3)` — the name is a durable identifier, not display;
  changing it would orphan `presetMatchesAssembly` matching. Explicitly out of scope.)

### 🟡 F7 — No unit badge anywhere ☐
- Nothing in `ToolCard` / `ToolDetail` says "this is a mm tool" beyond the small
  `unitAbbr` next to the diameter. No indicator when tool unit ≠ shop unit. → Phase 1.

### 🟡 F8 — No secondary-unit display ☐ → Phase 3 (requirement 4).

### 🟡 F9 — No converter entry mode in preset / speed-feed editors ☐ → Phase 4
(requirement 6).

### 🟡 F10 — `speed_feed_refs[]` rows don't record their unit ☐
- `sfm`/`chip_load` are implicitly in the tool's unit. Harmless while the tool's unit
  never changes (it can't), but note it: the row's meaning is anchored to `tool.unit`.
  **Decision: leave as-is** (no schema change) — document in `metadataModel.js` comment.

### 🟡 F11 — `lengthEps` mm tolerance is scaled, not metric-native ☐
- 0.0127mm tolerance is fine in practice; a metric shop might expect a rounder 0.01mm.
  **Decision: leave as-is** unless matching problems surface.

---

## 4. Feature plan — phases

Each phase is independently shippable; order matters (correctness → visibility →
comparison → entry helpers → smart parsing).

### Phase 0 — Correctness fixes (small, do first) ☐
- F1 unit-aware surface-speed math (+ tests for both units).
- F2 hardcoded suffixes; F3 seam violations.
- Acceptance: create a mm tool in demo mode, open a preset — surface speed labeled
  m/min computes RPM correctly (e.g. Ø6mm @ 200 m/min → ~10,610 RPM).

### Phase 1 — Unit visibility (badges) ☐
- **`.unit-badge` data-field token** (new row in the token table): tiny mono chip `in` /
  `mm` shown on `ToolCard` and the `ToolDetail` sticky header **only when
  `tool.unit ≠ shop unit`** (always-on adds noise for the 95% case). Muted styling —
  informational, not a warning.
- `ToolForm` (edit mode) keeps showing the unit read-only; add an `InfoTip` explaining
  "the tool's unit comes from Fusion and can't be changed here; the shop unit only
  changes defaults + display."
- Optional: facet/filter by unit on the landing page if mixed libraries get common.

### Phase 2 — Display precision + one formatter ☐
- New `shop_settings.unit_display` (additive, defaults cleanly — **backwards
  compatible**):
  ```json
  "unit_display": {
    "inch_decimals": 4,
    "mm_decimals": 3,
    "feed_decimals_inch": 2, "feed_decimals_mm": 1,
    "chipload_decimals_inch": 5, "chipload_decimals_mm": 4,
    "secondary_display": true
  }
  ```
- `units.js` gains `formatLength(value, unit, precisionOverride?)` reading the settings
  (via a `setUnitDisplayConfig()` hook AppContext calls after shop_settings loads — same
  active-registry pattern as `vendorRegistry`). Reconcile `unitPrecision` vs
  `formatLength` defaults into the one table above.
- Sweep the ~20 hardcoded `toFixed` display sites onto the formatter (F6). Trailing-zero
  trimming preserved where it exists today (`ToolCard.formatDim`).
- Settings UI: two number steppers in the Shop card next to Default Unit.
- **Storage unchanged** — R5: full precision saved, rounding at render only.

### Phase 3 — Secondary unit display (requirement 4) ☐
- Display-only muted equivalent after the primary value:
  `0.2362 in (6.000 mm)` / `6 mm (0.2362 in)`.
- **Where:** `ToolDetail` Geometry + Assemblies (OOH), `ToolForm` (static text under
  length `NumField`s), `HolderPicker` gauge. Not in cards/badges (too dense).
- **Which fields:** all `unit: 'length'` registry fields — gate by
  `FIELD_REGISTRY[f].unit === 'length'`, no per-field hardcoding (registry rule).
- Toggle: `unit_display.secondary_display` (default **on**); the secondary unit is
  always "the other one" relative to the value's record unit.
- Speeds/feeds secondary display (SFM ↔ m/min) is **not** included by default — the
  converter entry mode (Phase 4) covers the manufacturer-comparison need there. Can be
  added later behind the same toggle if wanted.

### Phase 4 — Converter entry mode in preset + speed-feed editors (requirement 6) ☐
- A small `in ⇄ mm` toggle button (mono, `.icon-btn`-sized) in `PresetPanel`'s `EditCard`
  header and `SpeedFeedSection`'s edit row — **off by default, per-editing-session,
  never persisted.**
- While on: the *entry* fields accept values in the other unit; on each commit
  (blur/change) the value is converted to the tool's unit before it hits the draft —
  what's stored is always tool-unit (R4). A muted live hint shows the conversion
  (`350 m/min → 1148.3 SFM`).
- Field-class conversions (see §5): surface speed ×0.3048, feeds/chiploads/steps ×25.4,
  RPM/angles pass through untouched.
- Formula links (`fx` state) operate **after** conversion — the cascade math never sees
  foreign-unit numbers, so the existing `initialFx` traps are unaffected.
- Same widget component reused in both places (`UnitEntryToggle` or similar).

### Phase 5 (far future, explicitly deferred) — inline unit tokens in inputs ☐
- Fusion-style: typing `6mm` in an inch field converts on commit; `1/4` fraction entry
  could ride along.
- Design sketch (for later): extend `NumField` with a `parseSmart` — regex
  `^\s*([\d./]+)\s*(mm|in|")?\s*$`; when a unit token is present and differs from the
  field's unit, `convertLength` on commit; show a transient hint of what it became.
- Cheap to add *after* Phase 2/3 centralize formatting; skip for now per the ask.

---

## 5. Conversion math reference (the "perfect math" contract)

All factors are **exact by definition** (international yard & pound agreement):

| Quantity | Factor | Direction |
|---|---|---|
| Length / feed / chip load / step | **25.4** mm per in (exact) | in→mm ×25.4 · mm→in ÷25.4 |
| Surface speed | **0.3048** m per ft (exact) | SFM→m/min ×0.3048 · m/min→SFM ÷0.3048 |
| RPM, flute count, angles, percentages | 1 | invariant |

Rules:
- Divide by the exact factor rather than multiplying by a truncated reciprocal
  (`v / 25.4`, never `v * 0.03937`).
- Convert once per boundary crossing — never chain in→mm→in (float drift).
- Round only at display (R5); comparisons use `lengthEps`, never `===` on converted
  floats.
- New primitives to add in `units.js` (Phase 0/4): `convertSurfaceSpeed(v, from, to)`,
  and reuse `convertLength` for feed/chipload/step classes. Unit tests must cover
  round-trip identity to 1e-9 and the known anchors (1 in = 25.4 mm; 100 SFM =
  30.48 m/min; 1000 m/min ≈ 3280.84 SFM).

---

## 6. Test plan

- **Unit tests** (`units.test.js` + new `speedsAndFeedsCalc.test.js`): factor anchors,
  round-trip identity, null/empty pass-through, precision-table defaults.
- **Round-trip audit** (`scripts/roundtrip-audit.mjs`): confirm none of the display
  phases change a single byte of Fusion output (R1 — display-only guarantee).
- **`fusionConvert.test.js`**: unchanged — expression suffixes already locked.
- **Manual demo-mode script**: create one mm tool in an inch shop → badge appears,
  geometry shows secondary inch values, preset surface speed labeled m/min computes
  correct RPM, converter toggle converts an SFM entry to m/min before save; flip shop
  to mm → badges swap to the inch tools, new-tool default becomes mm, nothing stored
  changed (verify via Copy JSON before/after).

---

## 7. Open questions (need the user)

1. **F4 mm Tool-ID diameter padding** — preferred mm encoding for `size_first` mode?
   (`0600` = 6.00mm suggested.)
2. **Secondary display default-on?** Plan says on; easy to flip.
3. Should the **converter toggle remember** its last state per session, or always start
   off? (Plan: always off — "by case situation".)
4. Phase 1 badge: mismatch-only (planned) or always show the unit chip on cards?

---

*No stored-data changes anywhere in this plan; the only schema addition is the optional
`shop_settings.unit_display` block, which defaults cleanly → backwards compatible, no
migration needed.*
