# FUSION_SCHEMA.md — Fusion 360 Tool & Holder Library Schema

**Ground truth** derived from the unmodified Fusion exports in `FUSION TOOL Library REF/`:

| File | Type | Count | Notes |
|---|---|---|---|
| `Full_Type_List Examples.json` | Tool library JSON | 226 tools, 280 presets | `{ "data": [...], "version": 36 }` |
| `Full_Type_List Examples.csv` | Tool library CSV | 280 rows (one per preset) | 173 columns |
| `Master-Holder.json` | Holder library JSON | 20 holders | `{ "data": [...], "version": 36 }` |
| `Master-Holder.csv` | Holder library CSV | 20 rows | same 173-column header as the tool CSV |

All 226 example tools are `unit: "inches"`; **72 of their embedded holders are `unit: "millimeters"`** — proving Fusion mixes units (inch tool + mm holder) within a single tool object. See [§1e Unit Handling](#1e-unit-handling).

This document is the source of truth for what correct Fusion output looks like. `SCHEMA_AUDIT.md` compares the app code against it.

---

## 1a. Tool JSON Structure

The library file is `{ "data": [ <tool>, ... ], "version": 36 }`. Each `<tool>` is an object.

### Top-level fields (count out of 226)

| Field | Count | Type | Meaning |
|---|---|---|---|
| `guid` | 226 | string | Permanent UUID — the tool's identity, links Fusion ↔ metadata. |
| `type` | 226 | string | Fusion tool type (see [§1d](#1d-tool-type-field-matrix)). |
| `unit` | 226 | string | `"inches"` or `"millimeters"` — the tool's native unit. |
| `description` | 226 | string | Tool description (plain, unquoted). |
| `BMC` | 226 | string | Body material: `"carbide"` (147), `"hss"` (68), `"unspecified"` (11). |
| `geometry` | 226 | object | Dimensions — see [§1a geometry](#the-geometry-object). |
| `expressions` | 226 | object | Parametric expression strings — see [§1a expressions](#the-expressions-object-tool-level). |
| `post-process` | 226 | object | Machine/post fields — see [§1a post-process](#the-post-process-object). |
| `start-values` | 226 | object | `{ "presets": [ ... ] }` — see [§1a presets](#the-start-valuespresets-array). |
| `product-id` | 226 | string | **= our `proshot_id`** (ProShop ID; shown as "Vendor Number" in Fusion UI). |
| `product-link` | 226 | string | Product URL. |
| `vendor` | 226 | string | Fusion's "Vendor" field — **repurposed as cabinet location** (e.g. `"LC-52"`). |
| `last_modified` | 224 | number | Epoch ms. Omitted on 2 tools. |
| `reference_guid` | 224 | string | Source/template guid. Omitted on 2. |
| `holder` | 222 | object | Embedded holder — see [§1a holder](#the-embedded-holder-object). 4 tools have none. |
| `GRADE` | 166 | string | Grade label (e.g. `"Mill Generic"`). **Absent on 60 tools** — do not force it. |
| `shaft` | 26 | object | `{ "segments": [ {height, lower-diameter, upper-diameter} ], "type": "shaft" }`. |
| `setup` | 1 | object | Rare. |
| `tapered-type` | 1 | string | Rare (tapered mill variant). |

### The `geometry` object

Keys are Fusion's terse abbreviations. **Only fields the tool type actually uses are present** — see the per-type matrix in [§1d](#1d-tool-type-field-matrix). Lengths are in the **tool's native unit**.

| Key | Count | Unit | Meaning |
|---|---|---|---|
| `OAL` | 226 | length | Overall length. |
| `DC` | 225 | length | Cutting diameter. |
| `LCF` | 225 | length | Length of cutting flutes (flute length). |
| `LB` | 225 | length | **Body length = OOH / "Length below Holder" (stick-out).** Per-instance. |
| `NOF` | 225 | int | Number of flutes. |
| `assemblyGaugeLength` | 225 | length | **Holder gauge length + LB(OOH).** camelCase, **inside `geometry`** (see warning below). |
| `CSP` | 225 | bool | Center sharp/point flag — `false` on all examples. |
| `HAND` | 214 | bool | Right-hand flag — `true` on all that have it. Absent on most taps. |
| `shoulder-length` | 214 | length | Unbroken shoulder length. |
| `SFDM` | 211 | length | Shaft/shank diameter. |
| `shoulder-diameter` | 125 | length | Shoulder diameter. **Absent on drills, taps, reamers, circle-segments.** |
| `RE` | 124 | length | Corner radius (radius of edge). |
| `tip-diameter` | 106 | length | Tip diameter (chamfer/drill/thread/etc.). |
| `TP` | 103 | length | Thread pitch (taps, thread mills). |
| `tip-offset` | 103 | length | Tip offset. |
| `tip-length` | 94 | length | Tip length. |
| `NT` | 93 | int | Number of teeth (per flute) — `1` on all examples. |
| `thread-profile-angle` | 93 | angle | Thread profile angle (e.g. `60`). |
| `TA` | 73 | angle | Taper angle. |
| `SIG` | 71 | angle | **Drill point (included) angle** — e.g. `118`, `135`, `140`. Drills/spot drills/reamers. |
| `profile` | 13 | array | 2-D contour point list (`{end:[x,y]}` / `{arc,ccw,center,end}`) for form mills & circle-segment custom profiles. |
| `TPN` / `TPX` | 6 / 6 | length | Thread pitch min / max (thread mills). |
| `thread-tip-type` | 6 | string | e.g. `"point"`. |
| `upper-radius` / `lower-radius` | 5 / 4 | length | Circle-segment / face-mill radii. |
| `profile-radius` | 3 | length | Circle-segment profile radius. |
| `DCX` | 3 | length | Max cutting diameter (form/circle). |
| `axial-distance` | 1 | length | Circle segment barrel. |
| (turning only) `EPSR`,`INSD`,`LH`,`RA`,`S`,`SC`,`SCTY`,`SIZE_SPECIFICATION_MODE`,`TC`,`tool_grooveWidth`,`tool_insertWidth`,`tool_internalThread` | 1 each | — | Turning-insert geometry (different field set entirely). |

> ⚠️ **`assemblyGaugeLength` placement & spelling.** In every reference tool the assembly gauge length is **`geometry.assemblyGaugeLength`** (camelCase, nested in `geometry`). There is **no** root-level `assembly-gauge-length` key anywhere in the 226 tools. Its value = `holder.gaugeLength` (converted to the tool's unit) **+** `geometry.LB` (OOH). Example (flat end mill): `3.346417 + 0.61 = 3.956417`. With a mm holder on an inch tool: `114.999/25.4 + 1.1 = 5.627520`.

### The `expressions` object (tool level)

Parametric strings Fusion re-derives numeric fields from on every load. **A stale expression silently overrides the numeric field.** String values are wrapped in single quotes (`'…'`); numeric values carry a unit suffix matching the tool's unit (`" in"` for inch tools, `" mm"` for mm tools).

Keys observed (count): `tool_description`(219), `holder_description`(216), `tool_productId`(211), `tool_bodyLength`(209), `tool_fluteLength`(186), `tool_shoulderLength`(179), `tool_diameter`(177), `tool_number`(148), `tool_overallLength`(133), `tool_material`(132), `tool_vendor`(127, = cabinet location), `tool_numberOfFlutes`(100), `tool_shaftDiameter`(91), `tool_productLink`(84), `tool_lengthOffset`(61, value `"tool_number"`), `tool_tipAngle`(47), `holder_vendor`(40), `tool_cornerRadius`(38), `tool_threadPitch`(21), `tool_tipDiameter`(19), `tool_comment`(9), `holder_productId`(9), `tool_diameterOffset`(7), `tool_maximumThreadPitch`(4), `tool_minimumThreadPitch`(4), `tool_taperAngle`(3), `tool_numberOfTeeth`(2), `tool_unit`(2), plus rare turning keys.

Example (inch flat end mill): `"tool_diameter": ".1875 in"`, `"tool_fluteLength": ".57000000000 in"`, `"tool_description": "'3/16 EM 7FL .57LOC FINISH'"`, `"tool_lengthOffset": "tool_number"`, `"tool_vendor": "'LC-52'"`.

### The `post-process` object

| Key | Count | Type | Meaning |
|---|---|---|---|
| `number` | 226 | int | Machine tool number. |
| `break-control` | 226 | bool | |
| `comment` | 226 | string | Free comment. **App uses this for the `FTL-XXXXXX` tracking ID.** |
| `manual-tool-change` | 226 | bool | |
| `turret` | 226 | int | `0` for milling. |
| `diameter-offset` | 225 | int | = `number`. |
| `length-offset` | 225 | int | = `number`. |
| `live` | 225 | bool | `true` for milling. |
| `compensation-offset` | 1 | int | Rare. |

### The `start-values.presets[]` array

One or more presets per tool (188 tools have 1, 24 have 2, 13 have 3, 1 has 5). Each preset:

| Key | Count/280 | Type | Meaning |
|---|---|---|---|
| `guid` | 280 | string | Preset UUID. |
| `name` | 280 | string | Preset name (the app encodes assembly+operation here). |
| `description` | 220 | string | |
| `material` | 280 | object | `{ category, query, "use-hardness" }`; category ∈ `all`/`metal`/`plastic`. |
| `n` | 280 | number | Spindle speed (RPM). |
| `n_ramp` | 189 | number | Ramp spindle speed. |
| `v_c` | 280 | number | Surface/cutting speed (SFM or m/min). |
| `v_f` | 230 | number | Cutting feedrate. |
| `v_f_plunge` | 267 | number | Plunge feedrate. |
| `v_f_ramp` | 230 | number | Ramp feedrate. |
| `v_f_leadIn` / `v_f_leadOut` | 230 / 230 | number | Lead-in / lead-out feed. |
| `v_f_transition` | 230 | number | Transition feed. |
| `v_f_retract` | 78 | number | Retract feed. |
| `f_z` | 230 | number | Feed per tooth. |
| `f_n` | 192 | number | Feed per revolution. |
| `ramp-angle` | 189 | number | Typically `2`. |
| `tool-coolant` | 280 | string | See [valid coolant values](#valid-coolant-values). |
| `use-stepdown` / `use-stepover` | 189 / 189 | bool | Step flags. |
| `stepdown` / `stepover` | 17 / 23 | number | **Present only when the matching flag is true.** |
| `use-feed-per-revolution` | 80 | bool | Feed-per-rev mode (drills/taps/turning). |
| `expressions` | 247 | object | Preset-level expressions — see below. |
| `use-constant-surface-speed`, `use-depth-of-cut`, `f_n_leadIn`, `f_n_leadOut`, `f_n_retract` | rare | | |

**Three-way stepdown/stepover invariant:** the `use-*` boolean, the numeric `stepdown`/`stepover`, and the `expressions.tool_stepdown`/`tool_stepover` string must agree. When the flag is `false`, Fusion omits **both** the numeric key and the expression. (Confirmed: disabled presets carry neither.)

#### Preset `expressions` keys (count/280)

Fusion uses **one speed mode** (RPM `tool_spindleSpeed` *or* surface speed `tool_surfaceSpeed`) and **one feed mode** (`tool_feedCutting` *or* `tool_feedPerTooth` *or* `tool_feedPerRevolution`) per preset — not all at once:

`tool_feedPlunge`(183), `tool_surfaceSpeed`(148), `tool_feedRamp`(146), `tool_feedPerTooth`(96), `tool_spindleSpeed`(95), `tool_feedCutting`(81), `tool_feedPerRevolution`(36), `tool_coolant`(31), `tool_stepover`(22), `tool_feedTransition`(18), `tool_rampAngle`(18), `tool_feedRetract`(16), `tool_stepdown`(14), `tool_rampSpindleSpeed`(10), `tool_presetMaterialCategory`(10), `tool_feedEntry`(9), `tool_feedExit`(7), `tool_presetMaterialQuery`(5), `tool_feedCuttingRel`(1), `tool_feedRetractPerRevolution`(1), `tool_useFeedPerRevolution`(1), `use_tool_stepover`(1).

Units in preset expressions: feed → `inpm`/`mmpm`, surface speed → `fpm`/`m/min`, RPM → `rpm`, feed-per-tooth → linear unit `in`/`mm` (**not** `in/tooth`), step → linear unit `in`/`mm`.

**Formula expressions (do not overwrite with literals):** `tool_feedPlunge`, `tool_feedRamp`, `tool_feedTransition` are frequently formulas referencing other fields (e.g. `"tool_feedCutting/3"`, `"tool_feedCutting"`). Overwriting these with numeric literals breaks the dynamic links.

#### Valid coolant values

Observed: `"flood"`(247), `"flood tool"`(20), `"disabled"`(9), `"tool"`(4). Fusion also accepts `"air"`. **`"flood tool"` is the combined flood+TSC value — never `"flood and through tool"` or `"through tool"`.**

### The embedded `holder` object

Same shape as a holder-library entry (see [§1b](#1b-holder-library-json-structure)): `{ description, expressions, gaugeLength, guid, product-id, product-link, segments[], type:"holder", unit, vendor }`. **`unit` is independent of the tool's unit** (72/222 embedded holders are mm inside inch tools).

### `assembly-gauge-length`

**Does not exist as a root-level field.** The assembly gauge length lives at **`geometry.assemblyGaugeLength`** (see the warning in [§1a geometry](#the-geometry-object)). In the CSV it is the column `Tool Assembly Gauge Length (tool_assemblyGaugeLength)`.

### Fields Fusion omits (UI uses defaults)

- `GRADE` — absent on 60 tools (UI defaults). Do not force-write.
- `last_modified`, `reference_guid` — absent on 2 each.
- Per-type geometry fields (`SIG`, `TP`, `RE`, `tip-*`, `shoulder-diameter`, etc.) are **omitted when the type doesn't use them**. Injecting them as zero defaults bloats the diff — only write what a type uses (see [§1d](#1d-tool-type-field-matrix)).
- Preset `stepdown`/`stepover` and their expressions — omitted when the flag is off.
- Preset speed/feed expression keys — only the **active** mode's key is present.

---

## 1b. Holder Library JSON Structure

File: `{ "data": [ <holder> ], "version": 36 }`. 20 holders in the reference.

| Field | Type | Meaning |
|---|---|---|
| `guid` | string | Permanent holder UUID (Fusion links tools to holders by this). |
| `description` | string | Holder description (e.g. `"NBT30-SK20C-90 w/ER16 EXT 2.2OOH "`). |
| `unit` | string | `"inches"` or `"millimeters"` — the holder's own unit. |
| `gaugeLength` | number | Gauge length **in the holder's unit** — sum of the included segment heights (see algorithm). |
| `vendor` | string | Holder manufacturer (e.g. `"Nikken "`). |
| `product-id` | string | Usually `""`. |
| `product-link` | string | Usually `""`. |
| `type` | string | `"holder"`. |
| `segments` | array | Profile segments, **bottom-to-top order** (see below). |
| `expressions` | object | `{ tool_description, tool_holderGaugeLength, tool_vendor, [holder_*] }`. |

### `segments[]`

Each: `{ "height": number, "lower-diameter": number, "upper-diameter": number }` — all in the holder's unit.

**Segment order is reversed vs. the Fusion UI.** The JSON array runs **bottom (collet face / tool exit) → top (spindle end)**. Fusion UI numbers them top→bottom starting at 1:

```
fusionSegmentNumber = S - jsonArrayIndex      (S = segments.length)
jsonArrayIndex      = S - fusionSegmentNumber
```

So **Fusion `segment_1` = the last entry in the JSON array**; `segment_S` = the first JSON entry.

### `tool_holderGaugeLength` & the "above gauge line" concept

`expressions.tool_holderGaugeLength` is a sum of the **included** segment heights, naming them by **Fusion** segment number:

```json
"tool_holderGaugeLength": "segment_2_height + segment_3_height + ... + segment_11_height"
```

Segments **absent** from this expression are **above the gauge line** (inside the spindle) and excluded from the gauge length. They are always the **lowest** Fusion numbers (typically just `segment_1`), i.e. the **last** entries in the JSON array. There is usually 1, but **always parse the expression — never hardcode 1.**

### Gauge length algorithm (verified)

```javascript
function computeGaugeLength(holder) {
  const expr = holder.expressions?.tool_holderGaugeLength ?? '';
  const included = [...expr.matchAll(/segment_(\d+)_height/g)].map(m => parseInt(m[1]));
  const S = holder.segments.length;
  let gaugeLength = 0;
  for (const fusionNum of included) {
    const jsonIdx = S - fusionNum;          // Fusion number → JSON index
    if (jsonIdx >= 0 && jsonIdx < S) gaugeLength += holder.segments[jsonIdx].height;
  }
  return holder.unit === 'millimeters' ? gaugeLength / 25.4 : gaugeLength; // → inches
}
```

**Worked example** (`Master-Holder.json` holder 0, 11 segments, mm): expression includes `segment_2..segment_11` → excludes `segment_1` (= JSON index 10, height `2.0`). Sum of indices 0–9 = `141.879 − 2.0 = 139.879` → matches the stored `gaugeLength: 139.879`. ✓

### Building the expression when writing a holder

```javascript
function buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount = 1) {
  const firstIncluded = aboveGaugeLineCount + 1;       // almost always 2
  const terms = [];
  for (let n = firstIncluded; n <= totalSegments; n++) terms.push(`segment_${n}_height`);
  return terms.join(' + ');
}
```

---

## 1c. CSV Structure

Both the tool CSV and holder CSV share the **same 173-column header** (last column literally `"CSV_TOOLS_VERSION_1"` and is always blank). Every cell is double-quoted on export. **One row per preset** — a multi-preset tool spans consecutive rows that share `tool_index` (e.g. index 4 "face mill" appears twice for presets `AL A-13` and `Steel A-28`). Holder rows have `tool_type = "holder"`.

### Column → JSON / internal-field map (populated columns only)

| # | CSV column (`id`) | JSON source | Internal field | Notes |
|---|---|---|---|---|
| 1 | `tool_index` | row sequence | — | 1-based; repeats across a tool's presets. |
| 2 | `preset_name` | `presets[].name` | preset name | |
| 3 | `tool_type` | `type` | `tool_type` (mapped) | `"holder"` for holder rows. |
| 4 | `tool_description` | `description` | `description` | |
| 5 | `tool_diameter` | `geometry.DC` | `diameter` | |
| 6 | `tool_number` | `post-process.number` | `machine_tool_number` | |
| 7 | `tool_unit` | `unit` | `unit` | |
| 8 | `holder_description` | `holder.description` | (assembly holder) | blank on holder rows (desc is col 4). |
| 9–11 | `holder_productId`, `holder_productLink`, `holder_vendor` | `holder.*` | holder fields | |
| 15 | `tool_assemblyGaugeLength` | `geometry.assemblyGaugeLength` | — | = holder gauge + OOH, tool unit. |
| 17 | `tool_axialDistance` | `geometry.axial-distance` | `axial_distance` | rare. |
| 33 | `tool_bodyLength` | `geometry.LB` | per-assembly `ooh` | OOH/stick-out, tool unit. |
| 34 | `tool_breakControl` | `post-process.break-control` | — | |
| 38 | `tool_clockwise` | (preset) | — | `true` for mills; blank/absent for taps. |
| 39 | `tool_comment` | `post-process.comment` | `tracking_id` | |
| 41 | `tool_compensationOffset` | `post-process` | = tool number | |
| 42 | `tool_coolant` | `presets[].tool-coolant` | — | |
| 43 | `tool_coolantSupport` | — | — | `"no"` typical. |
| 44 | `tool_cornerRadius` | `geometry.RE` | `corner_radius` | |
| 56 | `tool_diameterOffset` | `post-process.diameter-offset` | = tool number | |
| 59 | `tool_feedCutting` | `presets[].v_f` | `cutting_feedrate` | |
| 62 | `tool_feedEntry` | `presets[].v_f_leadIn` | `lead_in_feedrate` | |
| 64 | `tool_feedExit` | `presets[].v_f_leadOut` | `lead_out_feedrate` | |
| 66 | `tool_feedPerRevolution` | `presets[].f_n` | `feed_per_rev` | |
| 67 | `tool_feedPerTooth` | `presets[].f_z` | `feed_per_tooth` | |
| 68 | `tool_feedPlunge` | `presets[].v_f_plunge` | `plunge_feedrate` | |
| 71 | `tool_feedRamp` | `presets[].v_f_ramp` | `ramp_feedrate` | |
| 72 | `tool_feedRetract` | `presets[].v_f_retract` | — | |
| 74 | `tool_feedTransition` | `presets[].v_f_transition` | — | |
| 76 | `tool_fluteLength` | `geometry.LCF` | `flute_length` | |
| 82 | `tool_holderGaugeLength` | `holder.gaugeLength` | — | tool unit. |
| 97 | `tool_lengthOffset` | `post-process.length-offset` | = tool number | |
| 98 | `tool_live` | `post-process.live` | — | |
| 99 | `tool_lowerRadius` | `geometry.lower-radius` | `lower_radius` | |
| 102 | `tool_manualToolChange` | `post-process.manual-tool-change` | — | |
| 103 | `tool_material` | `BMC` | `material` | |
| 105 | `tool_maximumCuttingDiameter` | `geometry.DCX` | — | |
| 106 | `tool_maximumThreadPitch` | `geometry.TPX` | `max_thread_pitch` | |
| 107 | `tool_minimumThreadPitch` | `geometry.TPN` | `min_thread_pitch` | |
| 109 | `tool_numberOfTeeth` | `geometry.NT` | — | |
| 110 | `tool_numberOfFlutes` | `geometry.NOF` | `number_of_flutes` | |
| 114 | `tool_overallLength` | `geometry.OAL` | `overall_length` | |
| 119 | `tool_presetMaterialCategory` | `presets[].material.category` | — | |
| 122 | `tool_presetMaterialQuery` | `presets[].material.query` | — | |
| 123 | `tool_presetMaterialUseHardness` | `presets[].material.use-hardness` | — | |
| 126 | `tool_productId` | `product-id` | `proshot_id` | |
| 127 | `tool_productLink` | `product-link` | `product_link` | |
| 128 | `tool_profileRadius` | `geometry.profile-radius` | `profile_radius` | |
| 129 | `tool_rampAngle` | `presets[].ramp-angle` | — | |
| 130 | `tool_rampSpindleSpeed` | `presets[].n_ramp` | — | |
| 134 | `tool_shaftDiameter` | `geometry.SFDM` | `shank_diameter` | |
| 137 | `tool_shoulderDiameter` | `geometry.shoulder-diameter` | — | |
| 138 | `tool_shoulderLength` | `geometry.shoulder-length` | `shoulder_length` | |
| 141 | `tool_spindleSpeed` | `presets[].n` | `spindle_speed` | |
| 144 | `tool_stepdown` | `presets[].stepdown` | — | only when flag on. |
| 145 | `tool_stepover` | `presets[].stepover` | — | only when flag on. |
| 146 | `tool_surfaceSpeed` | `presets[].v_c` | `cutting_speed` | |
| 147 | `tool_taperAngle` | `geometry.TA` | `taper_angle` | |
| 148 | `tool_taperedType` | `tapered-type` | — | rare. |
| 150 | `tool_threadPitch` | `geometry.TP` | `pitch` | |
| 151 | `tool_threadProfileAngle` | `geometry.thread-profile-angle` | — | |
| 153 | `tool_threadTipType` | `geometry.thread-tip-type` | — | |
| 155 | `tool_tipAngle` | `geometry.SIG` | `tip_angle` | drill point angle. |
| 156 | `tool_tipDiameter` | `geometry.tip-diameter` | `tip_diameter` | |
| 157 | `tool_tipLength` | `geometry.tip-length` | — | |
| 158 | `tool_tipOffset` | `geometry.tip-offset` | — | |
| 161 | `tool_turret` | `post-process.turret` | — | `0`. |
| 162 | `tool_upperRadius` | `geometry.upper-radius` | `upper_radius` | |
| 163 | `tool_useConstantSurfaceSpeed` | `presets[].use-constant-surface-speed` | — | rare. |
| 164 | `tool_useFeedPerRevolution` | `presets[].use-feed-per-revolution` | — | drills/taps/turning. |
| 165 | `tool_vendor` | `vendor` / `expressions.tool_vendor` | `location` (cabinet) | holder rows: holder vendor. |
| 168 | `use_tool_stepdown` | `presets[].use-stepdown` | — | |
| 169 | `use_tool_stepover` | `presets[].use-stepover` | — | |
| 170 | `shaft_segments` | `shaft.segments` | — | segment format (below). |
| 171 | `holder_segments` | `holder.segments` | — | segment format (below). |
| 172 | `tool_library_version` | `version` | — | `36`. |

### `holder_segments` / `shaft_segments` format

Semicolon-separated list, **same order as the JSON `segments` array** (bottom→top), each segment:

```
H<height> U<upper-diameter> L<lower-diameter>
```

Values in the **tool's (row's) unit**, formatted to 6 decimals. Example (mm holder row):
`H17.780000 U22.225000 L22.225000; H38.100000 U19.050000 L19.050000; … ; H2.000000 U31.750000 L31.750000`. The list includes **all** segments (above-gauge-line segment included as the last entry).

### Columns never populated (always blank)

73 columns are blank across all 280 rows — additive-manufacturing, laser/plasma, waterjet, tool-block, probe, turning-insert-specific and other fields the shop's tools never use, plus the trailing `CSV_TOOLS_VERSION_1`. Examples: `tool_abrasiveFlowRate`, `tool_adaptiveItemSize`, `tool_assistGas`, `tool_beadWidth`, all `tool_block_*`, `tool_chamferAngle`/`Width`, `tool_cutHeight`/`Power`, all `tool_depositing*`, `tool_depthOfCut`, `tool_endAngle`/`endCutting`, `tool_feedDepositing`, `tool_feedProbeLink`/`Measure`, `tool_feedWire`, `tool_grooveCompOppositeEdge`, `tool_headClearance`/`headLength`, `tool_insertAngle`, `tool_internalThread`, `tool_isHalfIndex`, `tool_kerfWidth`, `tool_layerThickness`, `tool_leadingAngle`, `tool_lengthNonCuttingEdge`, `tool_machineQualityControl`, `tool_machineSideConnectionType`, `tool_maximumRotationalSpeed`, `tool_nozzleDiameter`, `tool_numberOfAttachmentPoints`/`numberOfTools`, `tool_orientationType`, `tool_pierce*`, `tool_powderFlowRate`, `tool_presetMaterialMaximum/MinimumHardness`, `tool_presetProgram`/`use_tool_presetProgram`, `tool_pressure`, `tool_sideAngle`/`sideCutting`, `tool_standoffDistance`, `tool_stationNumber`, `tool_threadTipRadius`/`Width`, `tool_trailingAngle`, `use_tool_depthOfCut`.

### Sometimes-blank vs. always-populated

Always populated (every row): `tool_index`, `preset_name`, `tool_type`, `tool_description`, `tool_diameter`, `tool_number`, `tool_unit`, `tool_breakControl`, `tool_compensationOffset`, `tool_coolant`, `tool_diameterOffset`, `tool_lengthOffset`, `tool_live`, `tool_manualToolChange`, `tool_material`, `tool_overallLength`, `tool_presetMaterialCategory`, `tool_presetMaterialUseHardness`, `tool_surfaceSpeed`, `tool_turret`, `use_tool_stepdown`, `use_tool_stepover`, `tool_library_version`. Everything else is type-/preset-dependent.

---

## 1d. Tool Type Field Matrix

Geometry-field presence per Fusion type (`Y` = present on all tools of that type, `.` = absent on all, `n` = present on n of the type's tools). `(count)` = number of example tools.

| Type (n) | DC | LCF | OAL | LB | NOF | SFDM | HAND | RE | TA | TP | NT | SIG | sh-dia | sh-len | tip-dia | tip-len | tip-off | thr-prof | SIG/aGL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flat end mill (46) | Y | Y | Y | Y | Y | Y | Y | 30 | 30 | 30 | 30 | . | Y | Y | 30 | 30 | 30 | 30 | aGL Y |
| ball end mill (10) | Y | Y | Y | Y | Y | Y | Y | 1 | 1 | 1 | 1 | . | Y | Y | 1 | 1 | 1 | 1 | aGL Y |
| bull nose end mill (30) | Y | Y | Y | Y | Y | Y | Y | Y | 12 | 12 | 12 | . | Y | Y | 12 | 12 | 12 | 12 | aGL Y |
| chamfer mill (10) | Y | Y | Y | Y | Y | Y | Y | 3 | Y | 3 | 3 | . | Y | Y | Y | 3 | 3 | 3 | aGL Y |
| radius mill (2) | Y | Y | Y | Y | Y | Y | Y | Y | . | . | . | . | Y | Y | . | Y | . | . | aGL Y |
| tapered mill (1) | Y | Y | Y | Y | Y | Y | Y | Y | Y | . | . | . | Y | Y | . | . | . | . | aGL Y |
| dovetail mill (2) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | . | Y | Y | Y | Y | Y | Y | aGL Y |
| lollipop mill (3) | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | . | Y | Y | Y | Y | Y | Y | aGL Y |
| slot mill (9) | Y | Y | Y | Y | Y | Y | Y | Y | 3 | 3 | 3 | . | Y | Y | 3 | 3 | 3 | 3 | aGL Y |
| form mill (13) | Y | Y | Y | Y | Y | 2 | Y | 2 | 2 | 2 | 2 | . | . | 2 | 2 | 2 | 2 | Y | aGL Y; +`profile` |
| thread mill (6) | Y | Y | Y | Y | Y | Y | Y | 5 | 5 | 5 | Y | . | Y | Y | 5 | 5 | 5 | Y | +TPN/TPX/thread-tip-type |
| face mill (3) | Y | Y | Y | Y | Y | Y | Y | Y | Y | . | . | . | Y | Y | . | . | . | . | aGL Y |
| drill (47) | Y | Y | Y | Y | Y | Y | Y | 13 | . | 13 | 13 | **Y** | . | Y | 13 | 13 | 13 | 13 | **SIG=point angle** |
| spot drill (10) | Y | Y | Y | Y | Y | Y | Y | 4 | . | 4 | 4 | **Y** | . | Y | Y | 4 | 4 | 4 | SIG |
| reamer (8) | Y | Y | Y | Y | Y | Y | Y | 4 | . | 4 | 4 | **4** | . | Y | 4 | 4 | 4 | 4 | SIG (some) |
| tap right hand (20) | Y | Y | Y | Y | Y | Y | 9 | 9 | . | **Y** | 9 | . | . | Y | 9 | 9 | 9 | 9 | **TP=pitch**; HAND/sh-dia often absent |
| circle segment barrel (1) | Y | Y | Y | Y | Y | Y | Y | . | . | . | . | . | Y | Y | . | . | . | . | +profile-radius, axial-distance |
| circle segment lens (1) | Y | Y | Y | Y | Y | . | Y | Y | . | . | . | . | Y | Y | . | . | . | . | SFDM absent |
| circle segment oval (1) | Y | Y | Y | Y | Y | . | Y | . | . | . | . | . | . | Y | . | . | . | . | SFDM/sh-dia absent |
| circle segment taper (1) | Y | Y | Y | Y | Y | . | Y | . | Y | . | . | . | Y | Y | Y | . | . | . | +upper/lower/profile-radius |
| boring bar (1) | Y | Y | Y | Y | Y | Y | Y | Y | . | Y | Y | . | . | Y | Y | Y | Y | Y | |
| turning general (1) | . | . | Y | . | . | . | . | Y | . | . | . | . | . | . | . | . | . | . | **insert geometry: EPSR/INSD/LH/RA/S/SC/SCTY/TC/…** |

`aGL` = `geometry.assemblyGaugeLength`, present on all but the 1 holderless turning tool. **Takeaways for the app:** drills/spot drills need **`SIG`** (point angle); taps need **`TP`** (thread pitch) and frequently omit `HAND`/`shoulder-diameter`; circle-segment/turning types omit `SFDM`/`shoulder-diameter`; only mills reliably carry `shoulder-diameter`.

---

## 1e. Unit Handling

| Field(s) | Inch tool stores | mm tool stores | Conversion needed? |
|---|---|---|---|
| `geometry.DC/LCF/OAL/SFDM/RE/shoulder-*/tip-*/TP/TPN/TPX/axial-distance/*-radius` | inches | mm | **Native to the tool's unit.** App reads/writes raw — no conversion. |
| `geometry.LB` (OOH) | inches | mm | **App stores OOH canonically in inches** → ÷25.4 on read, ×25.4 on write for mm tools. |
| `geometry.assemblyGaugeLength` | inches | mm | = holder gauge (converted to tool unit) + LB; tool's unit. |
| `geometry.SIG/TA/thread-profile-angle` | degrees | degrees | Angles — never converted. |
| `geometry.NOF/NT` | count | count | Never converted. |
| `expressions.tool_*` length strings | `"X in"` | `"X mm"` | **Unit suffix must match the tool's unit.** |
| preset `v_f/v_f_*` (feed) | `inpm` | `mmpm` | feed-rate unit string follows tool unit. |
| preset `v_c` (surface speed) | `fpm` | `m/min` | speed unit string follows tool unit. |
| preset `f_z` / `stepdown` / `stepover` expr | `"X in"` | `"X mm"` | linear unit follows tool unit. |
| `holder.gaugeLength` + `holder.segments` heights/diameters | holder's own unit | holder's own unit | **Holder unit is independent of the tool unit** — convert to the tool's unit when combining (e.g. computing `assemblyGaugeLength` or CSV `holder_segments`). |

**Mixing within one tool:** confirmed — 72/222 embedded holders are `millimeters` inside `inches` tools. Therefore any code that combines holder dimensions with tool dimensions (assembly gauge length, holder segment CSV) **must convert via the holder's unit, not the tool's**.

**Fields flagged for a unit-conversion multiplier in the field registry:** every `unit: 'length'` field is native EXCEPT `ooh`/`min_ooh`, which are inches-canonical and must convert to native at any boundary with native lengths. Feed (`unit: 'feed'`) and speed (`unit: 'speed'`) carry unit-dependent suffix strings in expressions. (The registry currently has no explicit "needs conversion" flag — see `SCHEMA_AUDIT.md`.)

---

## 1f. ProShop Field Mapping

The ProShop CSV is a **separate** format from the Fusion CSV (built by `tool-extractor.tsx` / `proShopExport.js`, driven by `fieldRegistry.js` `proShopColumn`). The mappings below come from `fieldRegistry.js` and `proShopExport.js`.

| Internal field | ProShop column | Universal vs. PS-specific | Notes |
|---|---|---|---|
| `diameter` | `cutDiameter` | universal | |
| `flute_length` | `lengthOfCut` | universal | |
| `overall_length` | `overallLength` | universal | |
| `number_of_flutes` | `no. of flutes` | universal | |
| `shank_diameter` | `shankDiameter` | universal | |
| `corner_radius` | `cornerRadius` | universal | |
| `ooh` | `lengthBelowShankDiameter` | universal | **MIN OOH source** (imported as `min_ooh`, inches). |
| `material` | `toolMaterial` | universal | |
| `coating` | `coating` | universal | |
| `tip_angle` | `tipAngle` | universal | drill point angle. |
| `taper_angle` | `taperAngle` | universal | |
| `material_suitability` | `recommendedWorkpieceMaterial` | universal | |
| `tsc_capable` | `throughCoolant` | universal | |
| `helix_angle` | `helixAngle` | universal | |
| `center_cutting` | `centerCutting` | universal | |
| `flute_type` | `fluteType` | universal | |
| `cutting_direction` | `cuttingDirection` | universal | |
| `pitch` | `pitch` | universal | |
| `tap_class` | `tapClass` | universal | |
| `min_thread_pitch` / `max_thread_pitch` | `minThreadPitch` / `maxThreadPitch` | universal | |
| `point_type` | `pointType` | universal | |
| `stub_jobber` | `stubJobber` | universal | |
| `full_profile` | `fullProfile` | universal | |
| `backside_capable` | `backsideCapable` | universal | |
| `double_ended` | `doubleEnded` | universal | |
| `vendor` (manufacturer) | `approvedBrand` | universal | brand-section column; **never** to Fusion. |
| `product_id` (mfr EDP) | `EDP#` | universal | brand-section column. |
| `cost` | `cost` | universal | brand-section column. |
| `distributor` | `vendor` | ⚠️ **ProShop-named** | PS confusingly calls the distributor column "vendor". |
| `grouping` | `toolGroupLetter` | ⚠️ **ProShop-specific** | ProShop tool-group letter. |

**Flagged for future ERP-agnostic renaming (do NOT rename now):**
- `proShopColumn: 'vendor'` for `distributor` — generic "distributor" concept under a ProShop-specific column name.
- `proShopColumn: 'toolGroupLetter'` for `grouping` — ProShop grouping convention.
- Internal `proshot_id` / `proShop` naming throughout — represents the generic "external system ID" concept (currently ProShop's).
- `lengthBelowShankDiameter` → MIN OOH — generic minimum stick-out under a ProShop column name.
