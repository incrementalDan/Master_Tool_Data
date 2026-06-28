# Tool Management System (TMS)

## Working Style

- Keep responses short. Bullets over prose. Bold key terms.
- Don't repeat back what was just said before answering.
- When referencing code, explain what it does in plain English first, then mention the file/function name.
- I know manufacturing deeply but communicate it conversationally — ask one clarifying question at a time, not a list.
- Don't assume all details have been stated. Manufacturing has many implicit constraints that may not be mentioned until they matter.

I'm not an experienced developer. When you do something non-trivial:

### After completing a task, add a short "What I did & why" section

- 1–3 bullet points max
- Plain English, no jargon (or explain the jargon inline)
- Focus on the *why*, not just the *what*
- Keep it separate from the work output so it's easy to skip if I just want the result

### Proactively suggest better approaches

- If there's a built-in tool, library, or Claude feature that would do this better or more simply, mention it
- Flag if what I asked for is a workaround when a cleaner solution exists
- But don't overwhelm — one suggestion at a time

### Keep explanations digestible

- Short sentences
- Analogies to physical/real-world things when possible
- Don't assume I know what acronyms mean

### Flag big asks before building them

- If a feature request is actually a big deal — it touches a lot of files, the data model, several workflows, or implies a large rewrite — and I haven't acknowledged that scope, **stop before implementing**
- Give a quick summary of *why* it's a big deal (what it would touch and what could break), then ask me to confirm before proceeding
- Goal: make sure we both understand the size of the thing before time gets sunk into it — not to gatekeep, just to avoid a false-triggered rewrite neither of us meant to start
- If I say "doesn't need to be a big deal, keep it simple" (as with the setup guide), take that as permission to scope it down rather than building the full version

-----

## Project Overview

A **Tool Management System (TMS)** — the single source of truth for the shop's CNC cutting tool library. It owns tool specifications (geometry, speeds/feeds, holders, assemblies, presets, notes, tags) and replaces a fragmented, manual workflow where tools were pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The TMS integrates with the shop's other systems rather than being tied to any one of them:
- **Fusion 360 / Autodesk cloud** — the CAM tool library. The Fusion tool library JSON lives in Autodesk cloud (BIM 360 / ACC) and is read/written via the Autodesk Platform Services (APS) Data Management API. Tools are pulled from Fusion and synced back, with a compare/merge workflow for committing proven job values to master.
- **ProShop** — inventory and purchasing. ProShop import/export must always be maintained.
- **Google Drive** — tool metadata Fusion doesn't support (notes, tags, ProShop ID, preferred machine, assemblies, etc.) is stored in a separate `tool_metadata.json`. The TMS is the single source of truth across these files.

This is also the foundation of a future in-house **ERP system**: ProShop continues to handle inventory and purchasing in the interim, so the ProShop integration stays first-class. As the TMS grows, Fusion becomes one integration among several rather than the center of the design.

-----

## Logical Tools & Instances (multi-instance model)

A **logical tool** maps to **N Fusion library entries ("instances")** — one instance per **assembly** (holder + OOH). Every instance is a real Fusion tool entry; all instances of a logical tool are identical **except** their holder and OOH (`geometry.LB`). This keeps proven setup knowledge (which holder/stick-out a preset was proven on) living natively in the Fusion library, not just in app metadata.

- **Family key**: an app-generated **tracking ID** (`FTL-XXXXXX`) written into Fusion's native comment (`post-process.comment`, mirrored in `expressions.tool_comment`). All instances of one logical tool share it. The library is grouped strictly by tracking ID on load (`groupByTrackingId`). `familySignature` (tool_id + tool_type + diameter ±0.0001) is used only to validate a group and to match incoming job tools — never to merge two different guids.
- **Shared vs per-instance**: editing any shared field (description, geometry except LB, vendor, tool_id, presets, tags, notes, machine number, …) propagates to **all** instances. Only **holder** and **OOH** are per-instance.
- **Machine tool number** is shared across all instances of a logical tool. When a programmer copies a tool into a Fusion job file, they will typically reassign the T# to a job-specific value (e.g. ≤ 100 for the Haas, ≤ 200 for the M300) — this is intentional and should never sync back to master. `machine_tool_number` is deliberately excluded from `DIFF_SECTIONS` in `DiffStep.jsx` so job-modified T# values are silently ignored during Phase 2 job sync. Do not add it to those fields.
- **Presets** are a single shared set replicated identically onto every instance. Each preset's name encodes its assembly + operation (see below), so opening any instance in Fusion shows the full proven-preset set.
- **In-memory shape**: `id` (= `tracking_id`), `tracking_id`, `assemblies[]` (`{ assembly_id, instance_guid, holder_guid, holder_description, ooh, linked_preset_guids, notes, source }`), shared `presets[]` (each with `operation_type`), `machine_tool_number`, and `_instancesRaw[]` (raw Fusion entries).
- **Write path**: `AppContext.writeLogicalTool()` reconciles in one library write — re-download, drop every entry whose tracking ID matches, append the freshly split instance set (`splitToFusionInstances`). It backs `saveTool`/`addTool`/`mergeTool`, the assembly CRUD (`addAssembly`/`updateAssembly`/`deleteAssembly` = create/edit/remove an instance), and `applyReconcile` (adopt/drop strays found on open — see Sync & Merge Workflows). `deleteTool` removes all instances; a tool must keep ≥1 assembly. `renumberLibrary` assigns one number per logical tool.
- **Transition**: `normalizeLibrary()` (one-time, surfaced via the `needsNormalize` banner) assigns tracking IDs to pre-migration tools, fans each out into instances per its existing metadata assemblies, and renames presets to the convention. Back up library + metadata first.

### Preset naming convention

`<MaterialCode> <OOH> <HolderShort> - <Operation>` — e.g. `SS 2.125 30-SK13-60 - Rough`. The name is the **durable source of truth** for the preset's assembly + operation. Helpers in `src/utils/presetNaming.js`: `composePresetName`, `parsePresetName`, `presetMatchesAssembly` (links a preset to an assembly by parsed holder short name + OOH within 0.0005"), `OP_TYPES`/`opTypeWord`/`matchOpType`. Holder short names (strip `NBT`, drop the `C` after `SK<n>`, + override map) come from `src/utils/holderNaming.js`. `operation_type` is stored on the in-memory preset and cached in metadata (`preset_meta`), but is **never written into the Fusion JSON** (Fusion validates strictly) — it lives in the name. On import, operation_type is parsed from the name; the name wins on conflict.

**Auto-name builds incrementally**: `composePresetName` tolerates missing pieces — `materialQuery`, `ooh`, `holderShort`, and `opType` can each be `null`/absent, and the name is composed from whatever is filled in (blank pieces are filtered before joining; `materialToCode` falls back to `'GEN'`). `EditCard.composeName` (`PresetPanel.jsx`) no longer early-returns when there's no linked assembly or no operation type selected — the live preview updates as soon as *any* relevant field is set, instead of waiting until everything (incl. a holder) is filled in.

**Legacy bare-word preset names — whole-name fallback**: many pre-migration presets don't follow the convention at all; the entire name is just the operation word/abbreviation (e.g. `"Rough"`, `"R"`, `"Finsh"`, `"SM Bore"`). `parsePresetName` first tries `matchOpType` on the tail after `" - "` (the normal convention); if that yields nothing (no separator, or the tail doesn't match), it retries `matchOpType` against the **whole trimmed name**. This lets `normalizeLibrary` auto-assign `operation_type` for these bare names instead of prompting the user in `NormalizeModal`. `OP_TYPES`'s `finish` aliases include `'FINSH'` (a common misspelling) alongside `FINISH`/`FIN`/`F`. Covered aliases: Rough ← `R`/`Rough`/`Roughing`; Finish ← `FIN`/`F`/`Finish`/`Finsh`/`Finishing`; Small Bore ← `SM BORE`/`SM HOLE`/`Small Bore`/`Small Hole`. Add new aliases to `OP_TYPES` (`src/utils/presetNaming.js`) rather than special-casing strings elsewhere.

**Embedded-token op-type scan**: real Fusion preset names carry the operation as one token among others — `"AL FIN"`, `"BRZ ROUGH"`, `"AL SM BORE"`, `"GF Nylon Fine Finish"`, `"AL-150-FIN"`. The whole-name/`" - "` matches above miss these, so `parsePresetName` has a final fallback to `scanOpTypeInName` (`src/utils/presetNaming.js`): split the name on spaces **and** dashes, match op aliases as standalone tokens (single-letter `R`/`F` never match inside a word like `BRZ`), **longest alias first** so `Fine Finish` beats `Finish` and `SM HOLE` (small bore) beats a trailing `FIN`.

**Material comes from the Materials library** (`materials.json` — see Shared Drive Files): it is the **single source of material in the app**, a **3-tier taxonomy** — ISO **groups** (P/M/K/N/S/H) → **CAM presets** (the speed/feed preset name pushed to Fusion, carrying each standard's code: ISO 513 / Kennametal / Haas-VDI 3323) → **materials** (individual alloys, each with `aliases[]` for "look it up by the name we know it by" and a `preset_id` linking up to a CAM preset). The preset material picker in `PresetPanel` (`EditCard`) is a single **Material field** that opens the **`CamPresetPicker`** modal — a compact, read-only "mini Materials page" (search + color-coded group pills + the same rich CAM-preset rectangles, sourced from `state.materials`). Search matches a CAM preset's own fields **and its alloy names/aliases**, so typing `6061`/`1018`/`316L` surfaces the right CAM preset; or browse the group pills. Selecting a card stores its name; the field's `×` clears it. The selection is stored in the preset's Fusion-native `material.query` as the **CAM preset name** (if picked) else a **group label** (legacy) (e.g. `"SS Austenitic 316"` / `"Stainless Steel"`); Fusion accepts any string. ("Filter by type" — metal/plastic/all — is a separate Fusion-native field next to it.) The old hardcoded `MATERIALS` / `MATERIAL_QUERY_MAP` list in `PresetPanel` was removed.

Three resolver helpers (`src/utils/presetNaming.js`) read a stored `material.query` back against the library — `findMaterialInLibrary(query, materials)` (→ `{group, preset, alloy}`, matching most-specific first: alloy label/alias → CAM preset name → group label/id, with each level filling in the levels above it), `materialNameCode(query, materials)` (the **preset-name token**: alloy `code` → CAM preset `code` → group `code` → group id, falling back to the legacy keyword code for non-library strings), and `presetMaterialColor(query, materials)` (group color, library first). The codes (edited in the Materials editor) are what appear in the convention name, e.g. `SS 2.125 30-SK13-60 - Rough` (seeded CAM presets leave `code` blank → group code applies). All three name-composition call sites resolve the code this way: `PresetPanel.composeName`, `normalizeLibrary` (via `materialsRef`), and `DiffStep` conflict naming.

**Legacy keyword matcher kept only as a fallback**: `matchMaterial(str)` (maps `"AL FIN"`/`"SS316"`/etc. → a canonical code via keyword/token rules) is **no longer used by the picker**. It survives solely so (a) `mergeFusionAndMetadata` can still infer `material.query` from a preset **name** on import when Fusion left it blank (the shop encodes material only in names like `"AL FIN"`), and (b) `materialNameCode`/`presetMaterialColor` can resolve pre-library/imported material strings not yet in `materials.json`. `MATERIAL_CODE_TO_ISO_GROUP` + `materialIsoGroup` back that color fallback. **`"BZN"` is intentionally NOT mapped** (ambiguous). Grade detail collapses to the broad code in the legacy path; the library path preserves whatever alloy/CAM preset the user defined.

### Stepdown / stepover three-way sync (Fusion gotcha)

Each Fusion preset stores stepdown and stepover in **three** places that must agree: the `use-stepdown`/`use-stepover` **boolean**, the **numeric** `stepdown`/`stepover`, and an **expression string** (`expressions.tool_stepdown` / `tool_stepover`, e.g. `".018 in"`). **Fusion re-derives the checkbox from the expression on load** — so if we write the boolean `false` but leave a leftover expression, Fusion flips the flag back to `true` on the next pull (the recurring "use stepdown/stepover became true" bug). `normalizePreset` (`src/schema/toolSchema.js`) is the single point that keeps all three consistent: the **boolean is the source of truth**, the numeric value is sourced from the field *or* parsed from the expression (the value sometimes lives only in the expression), and the step expression is **stripped whenever the flag is disabled**. Any new code that writes presets to Fusion must preserve this invariant — never set a step boolean without syncing its number and expression.

### Fusion expression-numeric sync — general rule

**Fusion re-derives every numeric field from its paired expression string on library load.** If you write a numeric field (e.g. `geometry.LB = 0.751`) but leave the expression stale (`expressions.tool_bodyLength = "3.1 in"`), Fusion evaluates the expression and silently reverts your write. This applies to all geometry and preset fields that have a corresponding `expressions.*` entry.

**The expression unit suffix must match the tool's unit.** Every length expression carries a linear-unit suffix (`tool_diameter`, `tool_fluteLength`, `tool_overallLength`, `tool_shaftDiameter`, `tool_shoulderLength`, `tool_cornerRadius`, `tool_bodyLength`, …). Fusion parses the number *through* that suffix — so writing `"5 in"` for a millimeters tool makes Fusion read 5 in = 127 mm and silently corrupt the geometry on the next load. `internalToFusionTool` computes one `lenUnit = isInch ? 'in' : 'mm'` (from `tool.unit`) and uses it for **all** geometry expression suffixes; the feed/speed expressions use their own `feedUnit`/`speedUnit`/`fzUnit`. **Never hardcode `" in"`** — always derive the suffix from the tool's unit. (This is the seam that makes the app correct for an mm-default shop.)

**The OOH / body-length case** (the most common place to get this wrong): `splitToFusionInstances` writes per-instance OOH to `geometry.LB` **and** `expressions.tool_bodyLength` together in one step. Never update one without the other:

```js
base.geometry   = { ...(base.geometry || {}), LB: lb };
base.expressions = { ...(base.expressions || {}), tool_bodyLength: `${lb} ${isMetric ? 'mm' : 'in'}` };
```

**The holder expression fields case** — two tool-level expression strings (NOT inside `holder.expressions`) that Fusion re-derives the displayed holder name and vendor from: `expressions.holder_description` mirrors `holder.description` and `expressions.holder_vendor` mirrors `holder.vendor`. The same "write native + expression together" rule applies. Both must be regenerated every time a holder is set or changed, not carried forward from `...existing`:

```js
// after base.holder is set:
base.expressions = { ...(base.expressions || {}) };
if (base.holder?.description) base.expressions.holder_description = `'${base.holder.description}'`;
else delete base.expressions.holder_description;
if (base.holder?.vendor)      base.expressions.holder_vendor      = `'${base.holder.vendor}'`;
else delete base.expressions.holder_vendor;
```

- **Absent, not empty**: Fusion omits `holder_vendor` entirely when the holder has no vendor (common) — write the key only when the value is non-empty, and delete any stale key otherwise. Never write `"''"` for a missing vendor; that itself becomes a mismatch.
- Synced in: `splitToFusionInstances` (`toolSchema.js`) and `syncHolderExpressions` / `toFusionFormat` (`fusionExport.js`).

**The `reference_guid` placeholder** — Fusion writes the literal string `"<NEW TOOL GUID>"` into `reference_guid` on freshly created/duplicated tools that haven't been committed to the library yet. This is a sentinel telling Fusion to mint a brand-new GUID for the entry on its next save, discarding whatever GUID is supplied. The `...existing` spread in `internalToFusionTool` would carry this stale placeholder forward on every subsequent write — causing Fusion to generate a new GUID each sync and breaking the `instance_guid` join between metadata and the saved Fusion entry (the tool then surfaces as a stray on the next reconcile). `internalToFusionTool` strips this placeholder explicitly when `fusionObj.reference_guid === '<NEW TOOL GUID>'`. Real (non-placeholder) `reference_guid` values are left untouched.

### Preset expressions — sync, never inject (round-trip audit rule)

Fusion presets store expressions as **formulas** (e.g. `"tool_feedCutting/3"`) or **literals** (`"100 inpm"`), and many native presets store **numerics with no expression at all** — the numeric stands alone. Fusion re-derives every numeric from its expression on load, so an *injected* expression overrides a real stored value exactly like a stale one does (a drill with proven plunge feed 12 in/min + an injected default ternary comes back as 40 in/min).

**Rule** (`internalToFusionTool`): for **existing** presets, never ADD an expression key; for keys that are present, keep the original string **byte-for-byte when the paired numeric is unchanged** (preserves formulas and native formats — `approxEqual` absorbs Fusion's float noise) and rewrite a literal only when the value actually changed (compared against `existingPresetByGuid`). "Both absent" (no numeric, no change) also preserves — some native presets carry only the expression (e.g. drill `tool_feedPerRevolution`) and Fusion derives the numeric from it. Fusion's default formula set (`tool_spindleSpeed` ternary, `tool_surfaceSpeed` companion, `tool_feedPlunge` ternary, ramp/transition/retract links) is seeded **only for blank app-created presets** (`isBlankPreset`).

### Valid Fusion coolant values

The only values Fusion accepts for `tool-coolant` are: `"flood"`, `"tool"` (TSC / through-spindle), `"disabled"`, `"air"`, `"flood tool"` (flood + TSC combined). **Not** `"through tool"`, **not** `"flood and through tool"`.

- Default for TSC-capable tools (`tsc_capable: true`): `"tool"`
- Default for non-TSC tools: `"flood"`
- `normalizePreset` remaps any stored `"flood and through tool"` → `"flood tool"` on every write

### Geometry field minimalism

Only write geometry fields that the tool actually uses — Fusion flags fields a type doesn't expect, and the round-trip audit (`scripts/roundtrip-audit.mjs`) verifies against real exports. `internalToFusionTool`:

- Writes the core set (`CSP`, `DC`, `LCF`, `NOF`, `OAL`) for all **non-turning** types. `turning general` uses an entirely different insert geometry (EPSR/INSD/LH/RA/…) preserved via `...existing` — never force mill fields onto it.
- `HAND`: written from `cutting_direction` for non-tap types. **Taps**: handedness lives in the type string (`tap left/right hand`); most native tap entries omit `HAND`, so it's only synced when the entry already has it.
- `SFDM` / `shoulder-length`: written only when the tool actually has them (`!= null`, or a new tool) — circle segments and most form mills natively omit them.
- `shoulder-diameter`: **real data, never overwritten** — reduced-shank tools and thread mills store a shoulder diameter that differs from the shank. Preserved from `...existing`; seeded from the shank only for NEW tools of `SHOULDER_DIAMETER_TYPES` (the mill types that natively carry it per FUSION_SCHEMA §1d).
- `RE`, `TA`, `tip-diameter` **only when non-zero** (or when the original entry had a non-zero value — to support clearing). `tip_diameter` is Fusion-native both ways: read from `geometry['tip-diameter']`, Fusion wins over metadata (the missing read used to zero real tip diameters on every write).
- `SIG` (point angle) for `TIP_ANGLE_TYPES` (`'drill', 'center drill', 'spot drill', 'counter sink'` — **not** `chamfer mill`, see Included/Inclusive Tip Angle below) and `TP` (thread pitch) for `THREAD_PITCH_TYPES` — each only when non-zero or the original entry had it.
- `NT`, `thread-profile-angle`, `tip-length`, `tip-offset`: never written explicitly — preserved from `...existing`.

**Tool-level expressions follow the same sync-never-inject rule as preset expressions**: for existing tools, keys that are present are synced (original string kept byte-for-byte when the value is unchanged); a key is **added only when its value actually changed** in the app (so the native+expression pair is written together); empty-valued keys are never injected (`"''"` / `"0 in"` adds were the source of per-type validation flags). New tools (no existing entry) get the standard set. The root `vendor` ↔ `expressions.tool_vendor` pair: `fusionToolToInternal` falls back to the root `vendor` when the expression is absent, so a location stored only in the root field survives.

### Included/Inclusive Tip Angle (chamfer mill / tapered mill)

`INCLUSIVE_ANGLE_TYPES` (`src/schema/fieldRegistry.js`) = `Set(['chamfer mill', 'tapered mill'])`. For these two types, `ToolForm` and `ToolDetail` show `taper_angle` as **"Included/Inclusive Tip Angle (°)"** = **2 × the stored `geometry.TA`**, edited bidirectionally (÷2 on input). `geometry.TA` itself is unchanged — still the half-angle Fusion expects. `NumField` (`ToolForm.jsx`) gained optional `label`/`transformOut`/`transformIn` props for this; `ToolDetail` branches the same way on `INCLUSIVE_ANGLE_TYPES.has(tool.tool_type)`.

For **chamfer mill** only, `internalToFusionTool` additionally writes a chamfer-mill-only Fusion-native expression: `expressions.tool_inclusiveAngle = "${TA * 2} degrees"` — confirmed from a real Fusion export (chamfer mill `geometry.TA: 45` → `expressions.tool_inclusiveAngle: "90 degrees"`). **Note**: none of the 10 reference-library chamfer mills carry the key, so it is written only when the entry already has it, the included angle is new/changed, or the tool is new — never injected onto an unchanged tool. Deleted (not left empty) for every other type — same "write native + expression together, delete when not applicable" pattern as the holder expression fields. **Tapered mill has no such expression** (confirmed absent from a real tapered-mill export even with `TA: 10`) — its ×2/÷2 is UI-only.

Chamfer mill was removed from `tip_angle`'s `appliesToTypes`, `TIP_ANGLE_TYPES`, the TSV `tipAngleTypes` (`fusionExport.js`), and `tool-extractor.tsx`'s `tipTypes` / `FIELD_VISIBILITY.tipAngle` — confirmed via a real Fusion chamfer-mill CSV export, which has `Taper Angle (tool_taperAngle) = '45'` and an **empty** `Tip Angle (tool_tipAngle)`. Fusion itself never writes `tool_tipAngle`/`geometry.SIG` for chamfer mills; the included angle lives entirely in `TA`/`tool_inclusiveAngle`.

**Chamfer mill naming**: `buildDesc` (`src/utils/toolNaming.js`) names chamfer mills from the Included/Inclusive Tip Angle (2 × `taper_angle`), not `tip_angle` (which chamfer mills don't have) — e.g. a 1/8" chamfer with a 90° included angle becomes `1/8 (.125) 90DEG CHAMFER`.

**The `label` prop is a general per-type display-rename hook, not just for Included Tip Angle**: `ToolForm`'s diameter `NumField` and `ToolDetail`'s Diameter `Field` pass `label={fieldLabel('tip_diameter', unit)}` for **tapered mill**, showing "Tip Diameter" instead of "Diameter" — the underlying data is still `tool.diameter` / `geometry.DC`, unchanged. Same pattern (display label override only, no data/schema change) as the Included Tip Angle case above; reuse it for future per-type label tweaks rather than branching the field name itself.

### Holder gaugeLength — always from the library

`buildHolderObject(holderEntry)` in `splitToFusionInstances` is always called with the live holder library entry — **never preserve `gaugeLength` from the existing Fusion tool's `raw.holder`**. Preserving from a previous write perpetuates stale values from older bad writes.

**Gauge length is expression-derived, not just trusted.** Fusion's `expressions.tool_holderGaugeLength` sums the heights of the segments **below the gauge line**; segments absent from it are "above the gauge line" (inside the spindle) and excluded. `sumGaugeSegments` parses that expression and sums the named segment heights — mapping each Fusion segment number to its JSON array index via `jsonIndex = S − fusionNumber` (the `segments` array is stored bottom-first, the opposite of Fusion's top-down numbering). `buildHolderObject` **prefers this computed sum** (in the holder's native unit) over the stored `gaugeLength`, which corrects stale/wrong stored values left by older writes; it **falls back** to the stored value only when there's no usable expression (e.g. embedded holders that lack one). `computeGaugeLength(holder)` returns the same value in inches; `buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount = 1)` builds the expression — **never hardcode an above-gauge-line count other than 1** without parsing the existing expression. As a final guard, `buildHolderObject` clamps the result down to the exact section sum to avoid a "Gauge length exceeds total section height" floating-point error.

`geometry.assemblyGaugeLength` (a Fusion-native field **nested in `geometry`**, not root-level; = holder gauge length + OOH, in the tool's unit) is always **explicitly recomputed** in `splitToFusionInstances` from the freshly-built holder's `gaugeLength` + the assembly's `ooh` — never carried forward from `...existing`.

-----

## Tool ID System

A shop-wide, **configurable** scheme for how a tool's human-readable ID is generated and displayed, set in `shop_settings.tool_id_system`. The design rule that makes it simple:

- **Metadata-owned, mirrored to Fusion, mode-driven display.** `tool_id` (formerly `proshot_id`, renamed because the ID is no longer ProShop-specific) is **metadata-owned** — the TMS manages it, so it lives in `tool_metadata.json` and is the source of truth, **mirrored** to Fusion's native `product-id` on every write (an unmanaged free-text box that the TMS keeps in sync). **On read, metadata wins** (`mergeFusionAndMetadata`: `meta.tool_id || fusionInternal.tool_id`), falling back to Fusion `product-id` only for tools imported before the TMS assigned an ID. If someone edits the Fusion library directly and `product-id` drifts, metadata wins on the next save — same as any metadata-owned field (this is the same pattern as `machine_tool_number`, `metadataOnly: false` + "metadata wins"). The active **mode** only controls how the value is *generated*, how it's *labelled*, and whether the *ProShop URL* is shown — never *which* of the two stores wins. There is **no** second ID field. (Ownership mirrors `machine_tool_number`; display mirrors how `location` reuses Fusion's repurposed "Vendor" field.)
- **Legacy IDs.** Switching ID schemes and running **Settings → "Re-number all tools (new scheme)"** (`AppContext.renumberAllToolIds`) overwrites every tool's `tool_id` and retires each old value into a **metadata-only `legacy_ids[]`** array. Legacy IDs are matched on ProShop import (`matchProShopToTools`) and Phase-2 sync (`duplicateDetector.matchTool`, `method: 'legacy-id'`), are searchable (`searchEngine` — `matchedLegacyId` surfaces which one matched), and a new ID skips only an **exact** collision with a retired ID (partial digit overlap with a different prefix is allowed). Both "Assign IDs to unassigned tools" (`assignToolIds`, fills blanks only) and re-number write the value to **both** stores (metadata + Fusion `product-id`). **Duplicate clusters:** re-number works per Fusion **tracking-ID group**, but the library view folds entries that share a `tool_id` across different tracking IDs (`combineToolsByToolId` — usually a human-error duplicate in legacy/Fusion data). `duplicateIdClusters` (`toolSchema.js`) surfaces these in the re-number preview as an amber warning with a per-cluster **Merge** (one shared new ID across all the cluster's groups → stays one tool, dedupe-able) vs **Split** (each group gets its own new ID → becomes separate tools) choice, plus Merge-all/Split-all. The chosen `consolidateIds` (tool_ids to merge) are passed to `renumberAllToolIds`; default is Merge. **Display:** ToolDetail shows a muted "Formerly:" line below the photo when `legacy_ids` is non-empty; a search result card shows "formerly X" **only** when the query matched that legacy ID; nowhere else.
- **ProShop mode = unchanged legacy behavior** — the value comes from ProShop, the ProShop tool-page URL link is shown/active, and it remains the Phase 2 / import match key. In **every other mode** the same field holds a generated shop ID, shown as "Tool ID" with **no** URL link. ProShop import/export is **not** changed — `matchProShopToTools` already falls back to description+diameter matching when `Tool #` doesn't match, so import still works regardless of mode.

### Modes (`shop_settings.tool_id_system.mode`)

| Mode | Format | Example |
|---|---|---|
| `proshop` | value from ProShop (legacy) | `A-3` |
| `location` | composed location string from the Location System | `LC-1405` |
| `sequential` | zero-padded number | `1042` |
| `type_prefix` | `{typecode}{sep}{number}` | `EM-1042` |
| `size_first` | `{dia}{sep}{typecode}{sep}{number}` | `0500-EM-1042` |
| `machine_linked` | `T{machine_tool_number}` (start/skip from **Machine Numbers**) | `T42` |
| `other_erp` | reserved for a future in-house ERP — **disabled** placeholder | — |

Config also carries `separator` (`-` `.` `/` `_` or none), `start` + `skip` (counter floor + reserved numbers), and `digits` (zero-pad width). There are **no** per-mode cabinet/drawer settings — in `location` mode the Location System (see below) owns the segment/identifier format.

### Pure helpers — `src/utils/toolIdSystem.js`

All ID-composition logic is here (no React): `TYPE_CODES` (per-`tool_type` short code — the one complete type→code map; `buildDesc` only hardcodes "EM" inline), `composeToolId(config, tool, seqNumber)`, `padNumber` / `padDiameter` (dia × 1000 → 4-digit, **inch assumption**), `nextSequential(start, skip, used)` (mirrors `getNextMachineNumber`), `isCounterMode` (`location` is **not** a counter mode — its number is the bin, owned by the Location System), `toolIdLabel(mode)`, `showsProShopUrl(mode)`, `previewToolId(config)`. Reuse these rather than re-deriving an ID anywhere.

### Generation never auto-runs

Existing tools are **never** auto-assigned an ID (no migration shims — the displayed value just falls back to Fusion `product-id`). New IDs are written **only** by two explicit Settings actions: **"Assign IDs to unassigned tools"** → `AppContext.assignToolIds()` (fills blanks only) and **"Re-number all tools (new scheme)"** → `AppContext.renumberAllToolIds()` (overwrites all, retires old IDs). Both model on `renumberLibrary` (download → write the value to **both** metadata `tool_id` and Fusion `product-id` via `applyToolIdToFusion` → upload → save metadata → rebuild in memory), and are a no-op in `proshop`/`other_erp` modes. Because `tool_id` is metadata-owned, both actions **write metadata** (when Drive is connected) in addition to mirroring to Fusion.

### Location mode + the Location System

In `location` mode each tool's ID **is** its composed physical-location string from the Location System (see below). `composeToolId`'s `location` branch simply returns `tool.location` — the composed string that AppContext pre-resolves from the tool's structured `tool_location` + `location_config` at load/write time (the same pattern as the derived `location` display string). No counter, no cabinet/drawer config. A tool with no resolved location yields `''` (no ID). The Location System section in Settings shows a banner when this mode is active.

**Location ≠ ID — strict separation (Generation never auto-runs).** Assigning or normalizing a tool's location (the Location System's job) updates the derived **display** values only — the composed `location` string and `proshop_location` — it **never writes `tool_id`**. ID generation stays exclusively the Tool ID System's two explicit actions (`assignToolIds` / `renumberAllToolIds`), which in `location` mode derive the value from the tool's structured `tool_location` (authoritative — not the possibly-stale Fusion vendor string). So in a location-mode shop the flow is: configure the Location System → assign/normalize locations → run **Assign IDs / Re-number** to bake those into Tool IDs. `writeLogicalTool`, `assignToolLocation`, and `normalizeLocationSystem` deliberately do not touch `tool_id`.

### Settings UI + machine-linked interplay

The **Tool ID System** card (`Settings.jsx`, near Machine Numbers) holds the mode selector, separator/start/skip/digits, a live `previewToolId` preview, and the **Assign IDs** preview→confirm flow. When `mode === 'machine_linked'`, the **Machine Numbers** card shows a note that its start/skip now also drive the IDs (and `saveIdSystem` mirrors them into `machine_number`). In `location` mode the card shows a note pointing at the **Location System** section (rendered immediately below it) which owns the format. Display gating (label + ProShop URL) lives in `ToolCard.jsx` and `ToolDetail.jsx` via `showsProShopUrl` / `toolIdLabel`.

### Trying it in demo mode

In `?demo=true`, the ID system is **fully editable in-memory** (throwaway, reset on refresh): `saveSharedFile` and `assignToolIds` have demo branches that update state without any APS/Drive write, and demo **Assign IDs reassigns *all* tools** (not just unassigned) so you can flip schemes and re-run repeatedly. A live (non-demo) session is unaffected — both branches are guarded by `demoModeRef`.

-----

## Location System

A configurable, **database-ready** model for how tools are physically stored, in `shop_settings.json` under `location_config`. A shop defines **multiple independent systems**, each a **Zone → Station → Drawer → Bin** pattern where every upper level is optional and the Bin is always present (auto-incrementing or fixed). UI lives in **Settings → Location System** (`LocationSystemSettings.jsx`, rendered adjacent to the Tool ID System card) and the **Assign Location** picker in **ToolDetail** (`LocationPicker.jsx`). The approved UI prototype is `docs/LocationSystemUI.tsx` — follow it for layout/copy/interaction; the app design system wins on visuals.

### Data model (`shop_settings.location_config`)

```json
"location_config": {
  "systems": [{
    "id": "uuid", "name": "LC Cabinet",
    "normalized": false, "allowDuplicates": false,
    "proShopExport": "number_only",   // number_only | full | fixed
    "fixedExport": "",
    "delimiters": { "zs": "-", "sd": "-", "db": "-" },
    "levels": {
      "zone":    { "on": false, "levelType": "Building", "customTypeName": "", "identFormat": "number", "customIdent": "", "options": [] },
      "station": { "on": false, "levelType": "Cabinet",  "customTypeName": "", "identFormat": "number", "customIdent": "", "options": [] },
      "drawer":  { "on": true,  "levelType": "Drawer",   "customTypeName": "", "identFormat": "custom", "customIdent": "LC", "options": [] },
      "bin":     { "fixed": false, "start": 1000, "fixedVal": "", "skip": [] }
    }
  }],
  "bin_sizes": [{ "id": "standard", "label": "Standard", "slots": 1, "isDefault": true }]
}
```

Level `options[]` are stable-UUID entries `{ id, label, order }` (number/letter identifiers). A `custom` `identFormat` is a fixed prefix (e.g. `LC`) with no per-tool choice. `delimiters` are the three adjacent junctions (`zs`/`sd`/`db`); a non-adjacent junction (a middle level off) falls back to `-`. `bin_sizes` is a shared lookup — capacity-aware suggestion is a **future** feature (not built). A reserved `presetter: { serial_format, serial_start }` placeholder also lives in `shop_settings.json`.

### Tool metadata additions (`buildMetadataTool` / `mergeFusionAndMetadata`)

Metadata stores **only IDs**, never the display string:

```json
"location": { "system_id": "uuid", "zone_id": null, "station_id": null, "drawer_id": null, "bin": 1405 },
"bin_size_id": "standard",
"legacy_locations": []
```

The metadata key `location` (object) maps to the internal field **`tool_location`** (to avoid clashing with the internal `location` **string**). `legacy_locations[]` holds prior free-text strings retired by normalization.

### `tool.location` (string) — derived, not stored

The internal `tool.location` string (written to Fusion's "Vendor" field, `expressions.tool_vendor`) is **composed on read/write** from `tool_location` + the system config — never stored on the tool:

1. **Load time** (`loadTools`): for each tool with a `tool_location`, `resolveLocationString(tool_location, systems)` sets `location`; a `proShopLocationValue(system, composed)` is also stashed as **`proshop_location`** (per-system export rule). Tools with no structured location keep their legacy Fusion-vendor free text.
2. **Write time** (`writeLogicalTool`): the composed string overrides `location` before `splitToFusionInstances`, so a structured location is the single source of truth for the Fusion vendor field.

`toolToExtractor` emits `proshop_location ?? location` as the ProShop **Location** column.

### Pure helpers — `src/utils/locationSystem.js`

Framework-free. Key exports: `newLocationSystem(name)` / `newLevelOption(label, order)` (factories with UUIDs), `findSystem` / `levelOptions` / `findOption` / `levelTypeName`, `composeLocationString(loc, system)` and `buildPreview(system)` (the live-preview composer — order zone→station→drawer→bin, per-junction delimiters), `resolveLocationString(loc, systems)`, `proShopLocationValue(system, composed)` (number_only strips non-digits / full / fixed), `nextBin(system, usedBins)` + `usedBinsForSystem`, `parseLocationString(str, system)` (lenient regex parse for normalization), `analyzeSystem(tools, system)` (matched/unmatched/noLocation/nextBin), `libraryLocationStatus(tools, systems)` (library-wide assigned vs unassigned), `emptyLocation(systemId)`, `LEVEL_KEYS`.

### Normalization (migration action, not a toggle)

Per system: **Analyze** (read-only `analyzeSystem` parse pass — no writes) → **preview** (matched count + next bin) → **commit** (`AppContext.normalizeLocationSystem(systemId)`). Commit assigns the parsed `tool_location` (LOCATION data **only** — never `tool_id`; see "Location ≠ ID" under Tool ID System) to every matched tool, marks `system.normalized = true`, and does a **metadata-only batch write** (`saveAllMetadata` once — a full Fusion round-trip per tool would re-upload the whole library hundreds of times; the composed string re-syncs to the Fusion vendor field the next time each tool is individually saved) plus an optimistic in-memory update. The Location System is intentionally **find-and-assign-location only**; renumbering/ID generation is the Tool ID System's job (a location-system bin-renumber action is future work). The **Library Location Status** panel (below all system cards, only once ≥1 system is normalized) shows the union of unassigned tools across all systems with an expandable table.

### ProShop import/export

- **Export**: composed string → ProShop `Location` column, transformed by the tool's system `proShopExport` rule (`number_only` strips to just the bin digits / `full` / `fixed`).
- **Import** (`ImportFlow.matchProShopToTools`): the ProShop location free text fills `location` **only** when the tool has no structured `tool_location` yet. Once a tool is normalized/assigned, this app owns its location and the ProShop import value is ignored.

### Context actions (AppContext)

`saveLocationConfig(locationConfig)` (persists the `location_config` sub-object), `assignToolLocation(tool, toolLocation, binSizeId)` (single-tool assign/clear via `writeLogicalTool` — composes into Fusion vendor + metadata), `normalizeLocationSystem(systemId)` (the commit above). All exposed in the context value.

-----

## The Problem Being Solved

Current workflow:

1. Open master tool library in Fusion 360 (stored in Autodesk cloud)
1. Copy a tool into a job file
1. Edit speeds, feeds, and other details for that job
1. Forget (or avoid) syncing changes back to master
1. Result: outdated master, lost edits, duplicates everywhere

This app fixes that by being the authoritative place to manage tools, with a proper compare/merge workflow (Phase 2) for committing proven job values back to master.

-----

## Security Model

The app is hosted on GitHub Pages (static, client-side only). Access requires signing in with an Autodesk account that has access to the team's hub/project. Unauthorized visitors get a login screen — nothing else. No API keys or tokens are ever persisted to localStorage or cookies. Google OAuth is optional (metadata only) and does not gate library access.

-----

## Architecture

```
Autodesk cloud (BIM 360 / ACC)
├── fusion_tool_library.json     ← Fusion 360 reads this; app reads/writes via APS Data Management API
└── holder_library.json          ← Read-only holder/toolholder library; app reads via APS

Google Drive (shared team folder)
├── tool_metadata.json           ← Extra fields Fusion doesn't support (optional, can be skipped)
├── materials.json               ← Material taxonomy: groups → CAM presets → alloys + colors (shared)
├── vendor_registry.json         ← Unified manufacturer/vendor entity list (shared)
└── shop_settings.json           ← Shop-wide settings (shared)

Web App (GitHub Pages, client-side only)
├── APS PKCE OAuth login (required — gates all library access)
├── Google OAuth login (optional — only needed for metadata)
├── Loads all files into memory on login
├── All search/filter runs in memory — no API calls during search
├── Writes changes back to their respective services on save
└── Phase 2: Queue-based compare/merge for syncing job edits to master ✅
```

The full tool list (~250 tools) is loaded once on login. All search and filtering is client-side and instant.

-----

## Multi-Library Support (tool & holder libraries)

The app links **multiple** Fusion tool libraries and **multiple** holder libraries, shows everything merged into one list, and reads/writes each tool back to the library it came from (no moving tools between libraries).

- **Registry** lives in `shop_settings.json` (shop-wide on Drive) under `tool_libraries[]` / `holder_libraries[]` / `default_tool_library_id`. Each entry is an APS location `{ id, hubId, projectId, folderId, itemId, fileName, order }` where **`id === itemId`** is the canonical **library_id**. It is **also mirrored to localStorage** (`aps_library_registry`) so an APS-only session (Drive optional) still knows which libraries to load — Drive wins when present, the mirror is the fallback/seed. `seedShopSettingsRegistry` (`AppContext.jsx`) seeds the registry from the mirror, then the legacy single-location keys (`aps_library_location` / `aps_holder_library_location`), so an established single-library shop upgrades with no data migration.
- **Provenance is runtime-derived, never persisted.** Each logical tool is tagged with `library_id` / `library_name` in `loadTools` (a tool came from file X → its library is X). Holders are tagged `_libraryId` / `_libraryName`. These are **never** written to Fusion JSON or `tool_metadata.json` (metadata stays one global file keyed by tracking_id).
- **Per-library IO** (`AppContext.jsx`): `downloadFusionList(libraryId)` / `uploadFusionList(libraryId, list)` resolve the location via `toolLibById` and cache each library's wrapper in `libraryWrappersRef` (a `Map(itemId → wrapper)`, replacing the old single `libraryWrapperRef`). `fetchRawLibrary(libraryId)` live-fetches one library. `downloadAllLibraries()` returns `[{ libraryId, library, list }]` for the shop-global bulk ops.
- **Write routing**: `writeLogicalTool` routes by `tool.library_id || default`. `saveFullLibrary` **partitions** tools by library and full-replaces each represented library (so callers must pass the complete in-memory set — they do). `renumberLibrary` / `assignToolIds` / `renumberAllToolIds` download **all** libraries, operate across the union, then write each back partitioned. `normalizeLibrary` runs per-library and tags. `combineToolsByToolId` runs **within each library only** (cross-library same-`tool_id` folding is avoided so writes stay routable).
- **Convenience pointers**: `state.libraryLocation` / `state.holderLibraryLocation` are kept synced to the primary (default) tool library + first holder library via the `SET_LIBRARIES` reducer action, so `App.jsx` routing (which gates on `libraryLocation`) is unchanged.
- **Registry actions** (`AppContext.jsx`): `addToolLibrary` / `removeToolLibrary` / `setDefaultToolLibrary` / `addHolderLibrary` / `removeHolderLibrary` (each updates state + mirror + Drive-if-connected via `persistRegistry`), and `commitInitialLibraries(toolLocs, holderLocs)` (first-run wizard — ONE write, avoids the stale-ref problem of looping the single-add actions). `loadHolders(holderLibsArg?)` takes an explicit list because refs lag a dispatch within the same tick. `persistRegistry` is also **exported in the context value** so `ShopConnect` (and any future caller) can commit a registry loaded directly from Drive without going through a wizard action — it dispatches `SET_LIBRARIES`, mirrors to localStorage, and saves to Drive best-effort.
- **UI**: `LibrarySetup.jsx` (wizard) adds multiple tool then holder libraries; Settings → Fusion Libraries shows two lists with add/remove + a "default for new tools" radio; `LandingPage` shows a **library filter chip row** (only when `tool_libraries.length > 1`, wired through `applyFilters`'s `libraryFilter` arg); `ToolDetail` shows a muted "In library: …" note at the bottom; `HolderPicker` groups holders by `_libraryName`; `AddToolFlow` + `ImportFlow` have a target-library picker (default + override) for new tools; `MergeFlow` live-fetches by the master tool's `library_id` (cache keyed per library).
- **Demo/local mode**: tools tagged `library_id: 'demo'` / `'local'` (holders `_libraryId: 'demo'`) so the note renders and the single-library filter stays hidden.
- **Deferred (not built)**: linking a machine to specific libraries; moving tools between libraries; cross-library `tool_id` dedup.

-----

## Local (No-Autodesk) Browse Mode

`LoginScreen.jsx` offers a second path besides "Sign in with Autodesk": **"Browse a local library file"** — uploads a `fusion_tool_library.json` directly (no APS/Google sign-in). `enterLocalMode(file)` (`AppContext.jsx`) parses it with the same `groupByTrackingId` / `buildLogicalTool` / `combineToolsByToolId` pipeline as `loadTools`, then dispatches `ENTER_LOCAL_MODE` (sets `localMode: true` + `tools`).

- **Read-only by a single central guard**: `downloadFusionList` and `uploadFusionList` (`AppContext.jsx`) both throw immediately when `localModeRef.current` is true ("Local mode is read-only — connect to Autodesk to load or save changes"). Every save/sync/reconcile path already routes through these two functions and already surfaces errors as toasts, so this one guard makes editing fail gracefully everywhere with no per-screen changes.
- **What works**: search/filter/view (`LandingPage`, `ToolDetail`), and ProShop CSV export (`exportFullLibrary`, available from the local-mode topbar).
- **What doesn't**: any save — Edit/Save, Add Tool, Sync Job, Duplicate, Delete, reconcile-on-open, normalize, etc. all show the read-only toast (or fail silently where already wrapped in try/catch, e.g. reconcile-on-open).
- **UI**: `App.jsx`'s `AppShell` renders a separate `LocalModeTopBar` (badge + ProShop CSV export + "Exit local mode") and a reduced route set (`/`, `/tool/:id` only) when `localMode` is true — bypasses the APS/Google onboarding gates entirely. `exitLocalMode()` resets to `initialState` (keeping saved library locations) and returns to `LoginScreen`.

-----

## Tech Stack

- **Frontend**: React + Vite (hosted on GitHub Pages — use HashRouter, not BrowserRouter)
- **Fusion library storage**: Autodesk Platform Services (APS) Data Management API
- **Holder library storage**: APS Data Management API (read-only — same mechanism as tool library)
- **Metadata storage**: Google Drive API v3 (single file, optional)
- **Auth**: Two separate flows:
  - APS PKCE OAuth (`Single Page App` type — no client secret) — required
  - Google OAuth implicit flow via `@react-oauth/google` — optional
- **Brand**: the app is named **ToolDex**. Identity = the end-mill **mark** on the brand-blue tile + the **"ToolDex" wordmark** (Space Grotesk; "Tool" in `--text`, "Dex" in `--blue`). Both live in one component, `src/components/BrandLogo.jsx` (`<BrandLogo>` lockup, plus `ToolDexMark` / `ToolDexWordmark`), used by the top-bar header and the login screen — mirrors the ToolDex Design System brand reference (`assets/tooldex-mark.svg` + `guidelines/brand-logo`). Don't reintroduce "Tool Library"/"Fusion Tool Library" as the app name; that label only survives where it refers to the actual Fusion 360 library file (e.g. the importer).
- **Icons**: `lucide-react` for UI icons; custom SVG silhouettes for 26 tool types in `ToolTypeIcon.jsx`
- **Design system / tokens**: the visual language is the **ToolDex Design System** (a separate design reference, not in this repo). `src/index.css` `:root` is the canonical token layer reconciled from it — surface/text ramps, `--blue` action color, `--iso-*` material-group colors, `--holder-*` holder-size colors, the type scale, spacing, radius, shadow, and motion tokens. Build UI against these tokens; don't hard-code hex inline.
- **Fonts**: brand webfonts loaded from Google Fonts in `index.html` — **Space Grotesk** (`--font-display`, wordmark/titles) and **JetBrains Mono** (`--font-mono`, all measured data: tool IDs, machine #s, speeds/feeds, badges). Interface body text stays on the system-UI stack (`--font-sans`). All three are `:root` tokens; the mono/display faces degrade to the system stack if the webfonts fail to load.
- **No backend server** — everything runs client-side

-----

## Environment Variables

Required in `.env` (never commit this file — use `.env.example` as template):

```
VITE_APS_CLIENT_ID=           # APS app client ID (Single Page App type)
VITE_APS_CALLBACK_URL=        # Must match APS app callback exactly, incl. trailing slash
VITE_GOOGLE_CLIENT_ID=        # Google OAuth client ID (optional — for metadata)
VITE_METADATA_FILE_ID=        # Google Drive file ID for tool_metadata.json (optional)
```

**⛔ Never modify, recreate, or delete the `.env` file.** It contains real API keys that are already configured. If a new environment variable is needed, tell the user exactly what to add and let them add it manually.

APS setup: create a "Single Page App" at https://aps.autodesk.com — **not** Web App. PKCE requires SPA type. Register the callback URL (GitHub Pages URL for deploy, `http://localhost:5173/Master_Tool_Data/` for dev).

Google setup: authorized JavaScript origins must include `https://incrementaldan.github.io` (no path, no trailing slash).

-----

## API Keys & Secrets

The real API keys are stored in GitHub Actions Secrets — not in the repo.
A `.env` file exists locally for development only. Do not modify, recreate, or delete it.
If a new API key or environment variable is needed:
- Tell me the variable name needed
- I will add it to both the local `.env` and GitHub Secrets manually
- Do not attempt to add secrets yourself

-----

## Deployment

Deployment is **fully automated via GitHub Actions** — see `.github/workflows/deploy.yml`.

- **Trigger**: every push to `main` (and manual "Run workflow" from the Actions tab) builds the site and publishes it to GitHub Pages.
- **Secrets**: the workflow injects `VITE_APS_CLIENT_ID`, `VITE_APS_CALLBACK_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_METADATA_FILE_ID` from **GitHub Actions Secrets** at build time. These live in the repo Settings, not in the code.
- **Pages source**: repo Settings → Pages → Source is set to **GitHub Actions** (not "Deploy from a branch"). The old `gh-pages` branch is no longer the publish source.

**To get changes live**: merge to `main`. That's it — Actions builds and deploys automatically.

**Linting (catches the blank-screen class of bug)**: `npm run lint` runs ESLint (flat config in `eslint.config.js`). It's intentionally **minimal** — only `no-undef` + `react/jsx-no-undef` (used-but-not-imported symbols, e.g. `<X>` without importing `X`, which the Vite build does NOT catch — it's a runtime `ReferenceError` → blank page) plus `react-hooks/rules-of-hooks`. Not a style gate. The **Tests** CI workflow (`.github/workflows/test.yml`) runs `npm run lint` before `npm test`, so a missing import fails the PR check instead of reaching the browser. `.tsx` uses the typescript-eslint parser (with `no-undef` off — TS checks references itself).

**⛔ Do NOT run `npm run deploy` from an agent, cloud, or CI session.** That command bakes env vars from a local `.env`, which does not exist in those environments — it will publish a credential-less build and break the live site (shows "Configuration Required"). `npm run deploy` is only valid as a manual fallback on a developer machine that has a complete local `.env`. The normal, preferred path is always GitHub Actions.

-----

## Token & Storage Security Rules

**These are non-negotiable — do not change without understanding the implications:**

- APS token lives in `window._apsToken` (memory only). Never write it to localStorage, sessionStorage, or cookies.
- The `aps_code_verifier` and `aps_nonce` use sessionStorage only during the OAuth redirect — they are deleted immediately after the callback is processed.
- The library location (`{ hubId, projectId, folderId, itemId, fileName }`) is safe to store in localStorage (`aps_library_location`) — it is not sensitive.
- The holder library location is stored in localStorage (`aps_holder_library_location`) — also not sensitive.
- **Always re-download the Fusion library from APS immediately before uploading a new version.** Never write from the in-memory copy alone — a teammate may have saved changes since your last load.
- Never add extra fields to the Fusion JSON. Fusion 360 validates its JSON strictly and will flag tools as errors if unrecognized fields are present. All extra fields go in `tool_metadata.json` on Google Drive only.

-----

## Data Model

### Tool Types

26 types, all lowercase with spaces (not underscores). Grouped by family:

**End mills**: `flat end mill`, `ball end mill`, `bull nose end mill`, `radius mill`, `tapered mill`, `chamfer mill`, `lollipop mill`, `dovetail`, `slot/key cutter`, `form mill`, `thread mill`

**Circle-segment**: `circle segment barrel`, `circle segment lens`, `circle segment oval`, `circle segment taper`

**Drills / hole tools**: `drill`, `center drill`, `spot drill`, `reamer`, `counter bore`, `counter sink`

**Taps**: a single internal type `tap`. The cut/form distinction lives in the metadata-only `tap_sub_type` (`'cut' | 'form'`, alongside the `is_sti` boolean). On write the Fusion type is `tap right hand` or `tap left hand` depending on `cutting_direction`; both Fusion tap types read back to internal `tap` (see Left-hand taps under Hole-Making Tool Presets).

**Other**: `boring head`, `turning general`, `face mill`

The full list is in `TOOL_TYPES` exported from `src/schema/toolSchema.js` (which re-exports from `tool-extractor.tsx`).

### Internal Tool Object (merged Fusion + metadata)

Key fields — see `src/schema/toolSchema.js` for the complete list:

```json
{
  "id": "UUID — permanent, links Fusion JSON and metadata JSON",
  "tool_type": "flat end mill",
  "description": "tool description",
  "vendor": "manufacturer name (metadata)",
  "tool_id": "Tool ID = ProShop 'Tool #' (metadata-owned; mirrored to Fusion product-id; previous IDs kept in metadata legacy_ids[])",
  "purchasing": {
    "manufacturers": [
      { "id": "uuid", "name": "Helical", "edp": "12334", "edp_url": "", "mfg_num": "", "mfg_num_url": "", "order": 0 }
    ],
    "vendors": [
      { "id": "uuid", "manufacturer_id": "uuid-of-helical", "name": "MSC Industrial", "vendor_num": "99377473", "vendor_num_url": "", "price": 34.76, "order": 0 }
    ]
  },
  "diameter": 0.5,
  "flute_length": 1.0,
  "overall_length": 3.0,
  "number_of_flutes": 4,
  "material": "carbide",
  "coating": "AlTiN",
  "spindle_speed": 8000,
  "cutting_feedrate": 50.0,
  "feed_per_tooth": 0.003,
  "plunge_feedrate": 10.0,
  "notes": "freeform notes (metadata only)",
  "tags": ["roughing", "stainless"],
  "preferred_machine": "M300",
  "material_suitability": ["316L", "6061"],
  "last_used_job": "1042",
  "updated_by": "username",
  "revision_notes": "what changed and why",
  "merge_history": [],
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "selected_holder_guid": "guid of the selected holder (metadata only)",
  "assemblies": []
}
```

### Fusion JSON ↔ Internal Model ↔ ProShop

The `fusionToolToInternal()` and `internalToFusionTool()` functions in `src/schema/toolSchema.js` handle all conversion. Key field mappings:

| Internal Field   | Fusion JSON Field       | ProShop Field     | Notes                                  |
|------------------|-------------------------|-------------------|----------------------------------------|
| `id`             | `guid`                  | —                 | Permanent, never changes               |
| `tool_type`      | `type`                  | —                 | Mapped via `FUSION_TYPE_MAP`           |
| `description`    | `description`           | `Tool Description`|                                        |
| `diameter`       | `geometry.DC`           | `Diameter`        |                                        |
| `flute_length`   | `geometry.LCF`          | `Flute Length`    |                                        |
| `overall_length` | `geometry.OAL`          | `Overall Length`  |                                        |
| `number_of_flutes`| `geometry.NOF`         | `No.ofFlutes` (export id `numberOfFlutes`) |                       |
| `spindle_speed`  | `start-values.presets[0].n` | `RPM`        |                                        |
| `cutting_feedrate`| `start-values.presets[0].v_f` | `Feed Rate` |                                       |
| `vendor`         | — (metadata only)       | `Manufacturer`    | Manufacturer name — **never** written to Fusion |
| `location`       | `expressions.tool_vendor` | `Location`      | Fusion's **"Vendor"** UI field is repurposed as the cabinet location (e.g. "LC-8") |
| `shoulder_length`| `geometry['shoulder-length']` | —          | Hyphenated key (not `LSCH`); normalization sets it = MIN OOH |
| `tip_angle`      | `geometry.SIG`          | `tipAngle`        | Drill/spot/counter-sink point (included) angle — **Fusion-native** (read+write both JSON and TSV paths) for `drill`, `center drill`, `spot drill`, `counter sink`. Fusion wins; metadata is a transition fallback. **Not** `chamfer mill` — see `taper_angle` / `INCLUSIVE_ANGLE_TYPES` below |
| `cutting_direction`| `geometry.HAND`       | `Cutting Direction`| **Fusion-native** boolean (`true` = `Right Hand`, `false` = `Left Hand`). Read from / written to `geometry.HAND`; never hardcode `true`. Fusion wins; metadata fallback. Not imported from ProShop (ambiguous `CW`/`CCW` values) |
| `thread_pitch`   | `geometry.TP`           | —                 | **Fusion-native** numeric pitch (tool's unit) for `thread mill` and `tap` (`THREAD_PITCH_TYPES`); written with `expressions.tool_threadPitch`. Distinct from `pitch` (the human thread **designation** string, e.g. `"5/16-24"`, metadata-only, ProShop `Thread`/`Pitch`) |
| `taper_angle`    | `geometry.TA`           | `Taper` (export id `taper`) | Written only when non-zero (or original Fusion entry already had a non-zero value). For `chamfer mill` and `tapered mill` (`INCLUSIVE_ANGLE_TYPES`), the UI shows this as "Included/Inclusive Tip Angle (°)" = 2 × `geometry.TA` — see below |
| `tip_diameter`   | `geometry['tip-diameter']` | `Tip Diameter` (export id `tipDiameter`) | **Fusion-native both ways**: read from `geometry['tip-diameter']`, Fusion wins over metadata (metadata is a transition fallback, same as `tip_angle`). Written only when non-zero (or original Fusion entry already had a non-zero value) |
| `min_ooh`        | — (metadata only)       | `Length Below Holder - MIN OOH` (export id `lengthBelowShankDiameter`) | Minimum stick-out floor — see the three-length-concepts table + ProShop Field Priority Rules |
| `tool_id`     | `product-id` (metadata-owned, mirrored) | `Tool #` (export id `toolNumber`) | **Metadata-owned** (source of truth), mirrored to Fusion `product-id`; metadata wins on read. **Primary match key for Phase 2** |
| `purchasing.manufacturers[]` / `purchasing.vendors[]` | — (metadata only) | `Approved Brand` / `Vendor` / `EDP#` / `Cost` (sub-table) | Normalized purchasing model — see Purchasing / Vendor Data Model section |

**Important**: `tool_id` (our field) = Fusion's `product-id` field (shown as "Vendor Number" in Fusion UI) = ProShop's `Tool #` (the ProShop primary key). It is the primary key for Phase 2 tool matching and for grouping ProShop CSV rows on import. It is **metadata-owned** (the source of truth lives in `tool_metadata.json`) and **mirrored** to Fusion's `product-id` on write; on read, metadata wins and falls back to `product-id` only for pre-TMS tools. Previously-assigned IDs retired by a re-number live in metadata `legacy_ids[]`.

**Assembly export**: When exporting a tool with an assembly selected, the assembly gauge length is written as `geometry.assemblyGaugeLength` (Fusion-native, nested in `geometry` — **not** a root-level `assembly-gauge-length`). Its value is **holder gauge length + OOH**, in the tool's unit. OOH is stored in the tool's unit (written raw to `geometry.LB`); only the holder's `gaugeLength` (in the holder's unit) is converted into the tool's unit via `convertLength` before adding the OOH.

### Metadata Schema (`tool_metadata.json`)

Stored in a single file on Google Drive. The file contains an array of metadata objects — one per **logical tool**. The `id` field is the tool's **`tracking_id`** (`FTL-XXXXXX`), falling back to the Fusion `guid` for pre-migration untracked tools — it is **not** keyed per Fusion instance. `buildMetadataTool` in `src/schema/toolSchema.js` is the authoritative source of the full field set (the example below is abridged); add new metadata fields there and read them back in `mergeFusionAndMetadata` / `buildLogicalTool`. Note `tool_id` **is** written to metadata — it is **metadata-owned** (source of truth) and mirrored to Fusion's `product-id`; `legacy_ids[]` (retired IDs) is metadata-only. Other metadata-only fields include the structured `location` object (internal `tool_location`), `bin_size_id`, and `legacy_locations[]` (see Location System) — the composed display string is derived, not stored.

```json
{
  "id": "tracking_id (FTL-XXXXXX); falls back to Fusion guid for untracked tools",
  "tool_id": "human-readable Tool ID (metadata-owned; mirrored to Fusion product-id)",
  "legacy_ids": ["A-3"],
  "vendor": "",
  "purchasing": {
    "manufacturers": [
      { "id": "uuid", "name": "Helical", "edp": "12334", "edp_url": "", "mfg_num": "", "mfg_num_url": "", "order": 0 }
    ],
    "vendors": [
      { "id": "uuid", "manufacturer_id": "uuid-of-helical", "name": "MSC Industrial", "vendor_num": "99377473", "vendor_num_url": "", "price": 34.76, "order": 0 }
    ]
  },
  "coating": "",
  "notes": "",
  "last_used_job": "",
  "preferred_machine": "",
  "material_suitability": [],
  "speed_feed_refs": [
    { "preset_id": "pre_M_aus_316", "operation_type": "rough", "sfm": 350, "chip_load": 0.002 }
  ],
  "tags": [],
  "updated_by": "",
  "revision_notes": "",
  "selected_holder_guid": "guid from the holder library",
  "primary_photo_id": "Drive file ID of the primary photo (optional)",
  "primary_photo_name": "filename of the primary photo (optional)",
  "attachments": [
    {
      "file_id": "Google Drive file ID",
      "filename": "original filename",
      "type": "photo | spec_sheet | model_3d | fusion_file | other",
      "uploaded_at": "ISO timestamp"
    }
  ],
  "assemblies": [
    {
      "assembly_id": "generated UUID (via generateAssemblyId / generateId)",
      "instance_guid": "guid of the Fusion entry this assembly maps to (the join key)",
      "holder_guid": "guid from the holder library",
      "holder_description": "cached holder description at creation time",
      "ooh": 2.125,
      "linked_preset_guids": ["preset-guid-1", "preset-guid-2"],
      "notes": "",
      "created_at": "ISO timestamp",
      "source": "merge | manual | fusion"
    }
  ],
  "merge_history": [
    {
      "merged_at": "ISO timestamp",
      "merged_by": "user email or name",
      "fields_changed": ["spindle_speed", "cutting_feedrate"],
      "revision_note": "Job 1042 — proven at these speeds",
      "previous_values": { "spindle_speed": 8000 }
    }
  ]
}
```

### Holder Library

The holder library is a separate JSON file stored in APS (same hub/project as the Fusion tool library). It is **read-only** in the app — holders are managed externally in Fusion 360.

Key holder object fields:
```json
{
  "guid": "permanent UUID",
  "description": "holder description (e.g. BT40 ER32 100mm)",
  "gaugeLength": 100.0,
  "unit": "millimeters | inches",
  "vendor": "manufacturer name"
}
```

`holders` and `holderLibraryLocation` are available via `useApp()`. The holder library location is stored in localStorage (`aps_holder_library_location`). If not configured, holders are unavailable in AssemblyForm (picker disabled).

**Linking the tool and holder libraries** — both are linked from Settings via inline `FilePicker` components (same flow as the holder picker; no full-page takeover). The "Fusion Libraries (Autodesk)" card in Settings holds both pickers. `beginChangeLibrary` / `changingLibrary` still exist in AppContext/App.jsx and still trigger the full-page `LibrarySetup` flow when there is **no** library location yet (first-time setup only) — but they are **not used from Settings** for changing an already-linked library. Do not re-add `beginChangeLibrary` calls to Settings.jsx. A same-file guard blocks linking the same physical file (by `itemId`) as both tool and holder library — this is applied in both the Settings inline picker and in `LibrarySetup` (first-run tool picker).

-----

## Units (inches / millimeters)

**Goal:** every **tool** and **holder** carries its **own unit** (`inches` or `millimeters`), on top of a **global default unit** set in Settings. The app works cleanly for an **inch-default shop** (like ours) *and* an **mm-default shop**. A tool's unit is always read from the record (never assume inches), conversions are centralized in `src/utils/units.js`, and display formats off the active unit.

**Where a tool's unit comes from:** an **existing** tool's unit is pulled from its Fusion entry (`fusionToolToInternal`) and shown read-only in `ToolForm`. When **creating** a tool, `ToolForm` exposes an inches/mm selector (defaulting to `getDefaultUnit()`); the chosen unit is written back to Fusion (`internalToFusionTool` writes `tool.unit`) with the geometry interpreted in that unit. So you author a new tool in mm or inches independently of existing tools, and Fusion receives it in that unit.

**Canonical model — every length is stored in its record's OWN unit.** There is **no** hidden inches-canonical length. A tool's lengths (`diameter`/DC, `flute_length`/LCF, `overall_length`/OAL, `shoulder_length`, `corner_radius`, **`ooh`**, **`min_ooh`**, `tip_diameter`, radii, `thread_pitch`, …) are all in the tool's `unit`; a holder's `gaugeLength` is in the holder's `unit`. Everything is read raw from / written raw to Fusion (`fusionToolToInternal` / `internalToFusionTool` / `readOohFromFusion` / `splitToFusionInstances` — no ÷25.4/×25.4 on tool geometry). OOH (`geometry.LB`) is treated exactly like the other geometry.

**Convert only at genuine cross-unit boundaries**, always via `src/utils/units.js`:
- `convertLength(value, fromUnit, toUnit)` — the one conversion primitive (`toInches`/`fromInches` wrap it). `MM_PER_IN = 25.4`.
- `getDefaultUnit()` / `setDefaultUnit()` — the shop-wide default (localStorage `app_default_unit`, default inches), set by the **Default Unit** toggle in Settings and used by `newTool()` and as the fallback display unit.
- `unitAbbr(unit)` → `'in'`/`'mm'`; `formatLength(value, unit)`; `lengthEps(unit)` → unit-aware match tolerance (≈0.0005").

Current cross-unit boundaries (all handled with `convertLength`):
- **Holder gauge + OOH → `assemblyGaugeLength`** (`splitToFusionInstances`, `fusionExport`): the holder's `gaugeLength` is in the *holder's* unit (a mm holder may sit on an inch tool), so it's converted into the *tool's* unit before adding the OOH (already in the tool's unit).
- **ProShop import** (`ImportFlow`): the import has a **ProShop file unit** selector. `min_ooh` merged onto an existing tool is converted from the file unit into the matched tool's unit; a brand-new tool created from a ProShop row adopts the file unit (its lengths taken as-is).
- **Display of a holder's gauge in a tool's context** (`ToolDetail`): converted holder-unit → tool-unit. The holder picker shows each holder in its **own** unit.

**The field registry** marks every `unit: 'length'` field with `canonicalUnit: 'native'` (uniformly — the value is in the record's own unit). `fieldLabel(field, unit)` derives the `(in)`/`(mm)` suffix from the passed record unit. **Same-unit comparisons need no conversion** — within one tool, `ooh`, `min_ooh`, `shoulder_length`, and the validation chain are all in that tool's unit, so they compare/assign directly (`normalizeLibrary`, `validateGeometry`, `AssemblyForm`). Preset-name OOH and preset/OOH matching use the tool's unit with a `lengthEps(unit)` tolerance.

> When you touch a length, it is in **its record's own unit**. Convert (via `convertLength`) only when crossing between two records of possibly-different units (tool↔holder) or from an external source (a ProShop file) — never to reach a hidden inches canonical.

-----

## Holder Library & Assemblies

An **Assembly** records a specific tool + holder + OOH (Out of Holder length) combination that has been proven in a job. Assemblies are stored per-tool in `tool_metadata.json` under `assemblies[]`.

### Three length concepts (MIN OOH vs. shoulder length vs. per-assembly OOH)

These are easy to confuse — they are distinct and have a strict ordering:

| Concept | Internal field | Lives in | Scope | Meaning |
|---|---|---|---|---|
| **MIN OOH** ("Length Below Holder - MIN OOH") | `min_ooh` | **metadata only** | per logical tool | The *minimum* stick-out — the smallest a tool can extend from the collet and still be held properly. A **floor**: no assembly may stick out less; any assembly may stick out more. |
| **Shoulder length** (`tool_shoulderLength`) | `shoulder_length` | **Fusion** (`geometry['shoulder-length']`) | per logical tool (shared) | The unbroken shoulder of the tool. Defaults to MIN OOH; may be overridden, but only **smaller** (≤ MIN OOH and ≤ each instance's `geometry.LB`). |
| **OOH / stick-out** ("Length below Holder") | per-assembly `ooh` → `geometry.LB` | **Fusion** (per instance) | per assembly | The actual stick-out for that holder setup. Edited per assembly, **≥ MIN OOH**, can be larger. |

Strict ordering (`flute_length ≤ shoulder_length ≤ min_ooh ≤ overall_length`, and per-assembly `ooh ≥ min_ooh`):
`validateGeometry` (`src/schema/toolSchema.js`) checks the chain and ToolForm **surfaces violations as non-blocking warnings** (it does not prevent save — only `validateTool` hard-blocks). `AssemblyForm.handleSave` **hard-blocks** any per-assembly `ooh < min_ooh`.

- **MIN OOH source of truth**: pulled from **ProShop** (`lengthBelowShankDiameter` column) during import (`ImportFlow.psRowToTool` / `matchProShopToTools` — ProShop is authoritative, always overwrites). The import has a **ProShop file unit** selector; `min_ooh` is converted from the file unit into the tool's own unit (a new tool created from a ProShop row adopts the file unit). It is the initial source of truth through the full first-import + normalization workflow. It is **never written to a Fusion field** (Fusion has no native "minimum" field) — it reaches Fusion only indirectly, as the shoulder length (which normalization sets equal to it).
- **Normalization rule** (implemented in `normalizeLibrary`): when a tool has a `min_ooh`, set `shoulder_length = min_ooh` and **floor** every assembly's OOH at `min_ooh` (raise any instance below the floor up to it). Lengths can be adjusted manually afterward; that's expected to be rare.

### OOH (Out of Holder) — per-assembly stick-out
- OOH = how much of the tool sticks out of the holder during cutting (aka gauge length / stick-out / "Length below Holder")
- **Stored in the tool's own unit**, exactly like the rest of the tool's geometry (mm for a metric tool)
- **Source field**: `geometry.LB` (Body Length) in Fusion JSON — this is "Length below Holder" in the Fusion UI, and `tool_bodyLength` in the Fusion CSV export. Each instance carries its own `geometry.LB`. Do NOT use `geometry.assemblyGaugeLength` as the source; that field is holder gauge length + OOH (what we WRITE on export), not the per-instance OOH source of truth.
- No conversion on read/write: `readOohFromFusion` returns `geometry.LB` raw, and `splitToFusionInstances` writes OOH raw to `geometry.LB`/`tool_bodyLength`. `geometry.assemblyGaugeLength` is recomputed as holder gauge length (converted into the tool's unit) + OOH, in the tool's unit.
- Editable per assembly in `AssemblyForm`, which blocks any value below `min_ooh` (the input's `min` is `min_ooh`, with a "Use" button to snap to the floor).

### Assembly lifecycle
1. **Manual creation**: User clicks "+ Add Assembly" in ToolDetail → fills in holder (via HolderPicker), OOH, linked presets, notes
2. **Auto-created during Phase 2 merge**: When an imported job tool has `incoming_ooh > 0` and new presets are being added, CommitStep prompts the user to create a new assembly or link to an existing one

### Linking presets to assemblies
Each assembly has a `linked_preset_guids[]` array. Preset GUIDs must be stable when passed through the merge flow — the assembly is created in CommitStep using the GUIDs from `presetsToAdd`, so those GUIDs must NOT be regenerated between DiffStep confirmation and CommitStep commit.

### `assemblyUpdate` in `mergeTool()`
`mergeTool()` accepts an `assemblyUpdate` as its 7th argument:
```js
// Create new assembly:
assemblyUpdate = { type: 'create', assembly: { assembly_id, holder_guid, holder_description, ooh, linked_preset_guids, notes, created_at, source } }

// Merge new preset GUIDs into an existing assembly:
assemblyUpdate = { type: 'link', assembly: { ...existingAssembly, linked_preset_guids: [...old, ...new] } }

// No assembly action:
assemblyUpdate = null
```

-----

## Source Layout

```
src/
  App.jsx                         # Root: auth gates, routing, topbar, ToastStack
                                  # AppShell gate order (each else-if short-circuits):
                                  #   processingAuth → demoMode → localMode →
                                  #   !apsAuthenticated (LoginScreen) →
                                  #   !libraryLocation && !changingLibrary && !shopConnectChosen
                                  #     (ShopConnect — new-device only) →
                                  #   !libraryLocation || changingLibrary (LibrarySetup) →
                                  #   !googleAuthenticated && !metadataSkipped (MetadataConnect) →
                                  #   Full App
                                  # shopConnectChosen is local useState(false) — resets on page
                                  # refresh; returning devices skip the ShopConnect gate entirely
                                  # because libraryLocation is already set from localStorage.
  main.jsx
  index.css                       # All styles — single file, CSS custom properties, dark theme

  context/
    AppContext.jsx                 # Global state + all async actions (saveTool, mergeTool, etc.)
                                  # Exposes: tools, holders, holderLibraryLocation, isSaving,
                                  #          user, notify, mergeTool, saveTool, deleteTool,
                                  #          markSetupStep, markSetupStepInSettings, etc.

  schema/
    fieldRegistry.js              # Central field registry — source of truth for
                                  # all field metadata: labels, types, units,
                                  # Fusion paths, ProShop columns, type applicability.
                                  # Add new fields here first before touching anything else.
    toolSchema.js                 # Tool types, field labels, fusionToolToInternal,
                                  # internalToFusionTool, splitToFusionAndMetadata,
                                  # mergeFusionAndMetadata, validateTool, generateId,
                                  # generateAssemblyId (alias for generateId)

  services/
    apsService.js                 # APS PKCE OAuth + Data Management API read/write
    driveService.js               # Google Drive API (metadata only)
                                  # OAuth scope: drive (not drive.file — required for shared drives)
                                  # All API calls include supportsAllDrives=true
                                  # listFolderChildren + copyDriveFile back the ProShop photo import
                                  # findMetadataInFolder(folderId) — searches for an existing
                                  #   tool_metadata.json in a folder (null = My Drive root);
                                  #   returns { id, name, modifiedTime } or null
                                  # connectToMetadataFile(fileId) — stores a file ID in localStorage
                                  #   so loadTools picks it up as the connected metadata file
                                  # checkSharedFilesInFolder(folderId) — parallel-checks for
                                  #   materials.json, vendor_registry.json, shop_settings.json
                                  #   in the same folder; returns { [filename]: boolean }
    searchEngine.js               # In-memory faceted search + filter logic
    duplicateDetector.js          # Weighted similarity scoring for Phase 2 matching
    mergeQueue.js                 # Phase 2 queue state: parseIncoming, buildQueue
    reconcile.js                  # Reconcile-on-open: sharedSignature, instanceSig,
                                  # classifyStrays (duplicate/newAssembly/conflict), hasReconcileWork

  utils/
    fusionExport.js               # exportSingleTool, exportFullLibrary,
                                  # copyToolToClipboard, copyToolsToClipboard
                                  # All accept optional selectedAssembly param for OOH export
    proShopExport.js              # ProShop CSV export (always maintain this)
    presetNaming.js               # composePresetName, parsePresetName, presetMatchesAssembly,
                                  # OP_TYPES / opTypeWord / matchOpType
    holderNaming.js               # holder short names (strip NBT, drop SK<n> C, override map)
    speedsAndFeedsCalc.js         # speeds & feeds calculator helpers

  components/
    LandingPage.jsx               # Search + facets + sort + grid/list toggle + machine filter
                                  # Uses .landing-layout (flex): .landing-sidebar (72px, Sync Job btn)
                                  # + .landing-main (flex:1, all search/results content)
                                  # Machine filter chips appear only when machines are configured;
                                  # default machine pre-selected on load via machineInitialised ref
    ToolDetail.jsx                # Detail view with frozen left action sidebar + sticky header
                                  # Sections: Identity (incl. machine tool#), Geometry,
                                  #           Assemblies, Presets, Setup, History, Merge History
                                  # Right sidebar: Identity, Photo, Purchasing, Notes & Tags, Files
    ToolForm.jsx                  # Edit form with sticky action bar + dirty guard
    LocationSystemSettings.jsx    # Settings section: configure Location Systems
                                  # (levels/delimiters/ProShop export), normalize
                                  # (analyze→preview→commit), library unmatched panel.
                                  # Ported from docs/LocationSystemUI.tsx. Exports LivePreview.
    LocationPicker.jsx            # ToolDetail "Assign Location" picker — pick system +
                                  # level options + bin (auto-suggested), writes via
                                  # AppContext.assignToolLocation
    ToolCard.jsx                  # Grid and list card variants with hover actions
                                  # Uses data-field tokens: .description-badge, .tool-id-pill,
                                  # .machine-num-badge, .location-tag
    ToolTypeGrid.jsx              # Tool type selector tiles (icons size 36)
    FacetFilters.jsx              # Cascading facet filter UI
    AddToolFlow.jsx               # New tool flow (extractor or manual)
    ImportFlow.jsx                # Bulk Fusion JSON / ProShop CSV import
                                  # Reached via Settings → Import. Step 2 hosts Import ProShop Photos
                                  # as a sub-section (button → ImportPhotosModal)
    ImportPhotosModal.jsx         # One-time ProShop photo import: Drive folder browser +
                                  # progress/summary (see ProShop Integration → ProShop photo import)
    MetadataConnect.jsx           # Google Drive connect flow + shared-drive-aware folder picker.
                                  # Skipped when ShopConnect already authenticated Google Drive
                                  # (setGoogleUser sets googleAuthenticated=true). On every folder
                                  # navigation, runs findMetadataInFolder + checkSharedFilesInFolder
                                  # in parallel with listFolders (no extra latency). When
                                  # tool_metadata.json is found, shows a green callout with ✓/—
                                  # status for all 4 metadata files so the user can confirm the
                                  # full set before clicking Connect.
    ShopConnect.jsx               # Post-Autodesk-login onboarding gate for new devices.
                                  # Appears only when no libraries are configured (libraryLocation=null).
                                  # Two paths:
                                  #   A) Connect existing shop — Google OAuth → Drive folder picker →
                                  #      shop_settings.json preview callout (shop name, library count,
                                  #      file status badges) → calls persistRegistry to auto-link all
                                  #      libraries; bypasses both LibrarySetup and MetadataConnect.
                                  #      If shop_settings has no tool_libraries, Drive is still
                                  #      connected (setGoogleUser) and LibrarySetup is shown next.
                                  #   B) Set up new shop — sets shopConnectChosen=true → falls through
                                  #      to LibrarySetup wizard exactly as before.
                                  # Returning devices (libraryLocation already in localStorage)
                                  # never see this screen.
    HolderPicker.jsx              # Modal for selecting a holder from the holder library
    ReconcileModal.jsx            # Reconcile-on-open prompt: delete duplicates, add/delete
                                  # new assemblies, review conflicts (→ Sync Job diff)
    AssemblyCard.jsx              # Read-only assembly display (holder, OOH, linked presets)
                                  # with inline edit/delete
    AssemblyForm.jsx              # Form for creating/editing assemblies
                                  # Fields: holder (HolderPicker), OOH, linked presets, notes
    NormalizeModal.jsx            # One-time normalization: preset operation-type assignment
    DescRenameModal.jsx           # Per-tool description rename confirmation (buildDesc suggestions)
    PresetPanel.jsx               # Preset editor panel (speeds/feeds per preset)
                                  # CollapsedCard shows linked machine (Cpu icon + model name)
                                  # Machine filter chip row (below material tabs, machines only)
    CamPresetPicker.jsx           # Modal "mini Materials page" — pick a CAM preset
                                  # for a preset's material (search by alloy + group pills)
    SpeedFeedSection.jsx          # ToolDetail panel: per-CAM-preset SFM + chip-load
                                  # reference (metadata speed_feed_refs[]); shows
                                  # derived RPM + feed from the tool's own dia/flutes
    BrandLogo.jsx                 # ToolDex brand: mark + "ToolDex" wordmark
                                  # (BrandLogo lockup / ToolDexMark / ToolDexWordmark);
                                  # used by the top-bar header + LoginScreen
    LibrarySetup.jsx              # First-run APS library location picker. Reached via ShopConnect
                                  # "Set up new shop" path, or when ShopConnect connects Drive but
                                  # finds no tool_libraries, or directly (changingLibrary=true from
                                  # Settings). Not shown for returning devices or when ShopConnect
                                  # path A auto-links libraries from shop_settings.
    LoginScreen.jsx               # APS PKCE login gate (unauthorized visitors)
    Settings.jsx                  # Settings — one of 4 top-bar chrome-style tabs
                                  # Sections: Account (sign-out), Setup & Import (6-step tracker —
                                  # the Fusion Libraries (tool + holder pickers) and Tool Metadata
                                  # (Google Drive) config panels are embedded INSIDE their steps,
                                  # not separate cards), Shop (+ Save button), Machine Numbers,
                                  # ProShop Export, Rename, Advanced
    ToolExtractorTab.jsx          # Hosts the tool-extractor image/spec extraction UI
    Toast.jsx                     # Fixed bottom-right toast stack

    icons/
      ToolTypeIcon.jsx            # 26 hand-crafted SVG tool silhouettes

    MergeFlow/                    # Phase 2: sync job values to master
      index.jsx                   # Queue orchestration, live APS fetch, step routing
      ImportStep.jsx              # Clipboard paste (Ctrl+V) + file upload
      MatchStep.jsx               # Match confirmation (fuzzy matches only)
      DiffStep.jsx                # Side-by-side diff with per-field checkboxes + preset matching
      CommitStep.jsx              # Revision note + assembly detection + "Commit & Next / Finish"
      NewToolStep.jsx             # No-match detected: add to library or skip
      QueuePanel.jsx              # Batch queue sidebar with status badges
      SummaryStep.jsx             # End-of-batch summary + bulk clipboard copy

tool-extractor.tsx                # Source of truth for tool types, field visibility,
                                  # Fusion↔ProShop mapping, and image extraction UI
```

-----

## Search & Filter System

The landing page IS the search page. All filtering runs in memory — no API calls during search.

**Cascading faceted search**: each filter narrows the available options for all subsequent filters based on the current result set. Select "Flat End Mill" → type "0.5" diameter → flute count filter shows only counts that exist among 0.5" flat end mills in the library.

**Tool type is multi-select**: clicking a tile in the type grid toggles it on/off (`ToolTypeGrid`'s `selected` is an array; `onSelect` toggles membership). `activeFilters.toolTypes` is an array of 0+ types — `applyFilters` (`searchEngine.js`) matches a tool if its `tool_type` is in that array (empty array = any type). This lets you search across types that could do the same job (e.g. "flat end mill" + "bull nose end mill" together). `getFacetFields(toolTypes)` (`toolSchema.js`) unions the extra per-type facets (e.g. Corner Radius, tap-only fields) across all selected types. The URL stores selected types as a comma-separated list (`?type=flat+end+mill,bull+nose+end+mill`).

Filters: tool type (tile grid, multi-select) → diameter → flutes → flute length → overall length → material → coating → vendor → preferred machine → material suitability → tags.

Sort options: recently updated, diameter ↑/↓, vendor A–Z, description A–Z. View modes: grid, list. Both persist in localStorage.

-----

## ProShop Integration

ProShop manages inventory and purchasing. This app owns tool specifications. Relationship:

- **Export single tool**: ProShop-compatible CSV row (always maintain this)
- **Export full library**: Complete ProShop CSV for bulk re-import
- **Import**: One-time Fusion JSON or ProShop CSV import to populate initial library

ProShop export must never be removed even as the app evolves toward a future ERP.

**Column header convention differs by direction**:
- **Export** (`tool-extractor.tsx` `PS_MAIN_COLS`, `src/utils/proShopExport.js`) writes ProShop's **API attribute id** names (camelCase, e.g. `lengthBelowShankDiameter`, `numberOfFlutes`, `tipTo1stFullThread`) as column headers — ProShop's UI matches these on import regardless of display label, and extra/unmapped columns are harmless.
- **Import** (`src/components/ImportFlow.jsx`) reads a real ProShop export, whose headers are the **UI display names** (e.g. `Length Below Holder - MIN OOH`, `No.ofFlutes`, `Tip to 1st Full Thread`) — these often but not always match the API id.

**Multi-row groups (Approved Brands)**: ProShop exports one row per `Tool #` normally, but a tool with multiple Approved Brand / purchasing options spans **multiple rows sharing the same `Tool #`** — geometry/spec columns are populated only on the first row of the group, and each row contributes one manufacturer/vendor pair (`Approved Brand` / `Vendor` / `EDP#` / `Cost`) to the normalized `purchasing.{manufacturers,vendors}` model — see Purchasing / Vendor Data Model. Import groups rows by `Tool #` before matching (`handleProShopFile`) and builds the normalized shape via `buildPurchasingFromGroup` (`src/components/ImportFlow.jsx`); export emits the same row shape via `buildBrandRows`/`buildProShopCSV` (`tool-extractor.tsx`) and `exportFullLibrary` (`src/utils/proShopExport.js`).

### Tool Group letter ↔ tool_type classification

ProShop's **Tool Group** column (`toolGroupLetter`, e.g. `A`, `B`, `L`, `R`, `TD`...) is this shop's own filing scheme for the physical tool cabinets — see `PS_GROUPS` (`tool-extractor.tsx`) for the full letter → meaning reference list. `AUTO_GROUP` maps our `tool_type` → group letter for **export** (`toolToExtractor`'s `grouping: tool.grouping || AUTO_GROUP[tool.tool_type] || 'M'`, written to the `toolGroupLetter` column via `PS_MAIN_COLS`).

**Import** (`psRowToTool`, `src/components/ImportFlow.jsx`) needs the reverse — a brand-new tool created from an unmatched ProShop row has no Fusion entry to read `tool_type` from, so it must be inferred from the row. `typeFromProShopGroup(letter, { description, cornerRadius })` (`tool-extractor.tsx`, re-exported from `toolSchema.js`) is the reverse of `AUTO_GROUP`. Several letters cover more than one `tool_type` (`AUTO_GROUP` is many-to-one), so it disambiguates using cues from the row:

- **A** (Square and Bull Endmill) → `bull nose end mill` if `CornerRad` is non-zero, else `flat end mill` — square end mills have no corner radius, bull nose end mills do.
- **B** (Ball Endmill) → always `ball end mill`. ProShop's stock group-B label also mentions "Drill Mill", but this shop doesn't file drill mills under B (and "drill mill" isn't one of our tool types), so `typeFromProShopGroup` never returns it and the `PS_GROUPS` label was shortened to just "Ball Endmill" to stop suggesting it.
- **F** (Ream and Bore) → `counter bore` if the description contains "bore", else `reamer`.
- **L** (Chamfer Tool) → `counter sink` if the description contains "sink", else `chamfer mill`.
- **M** (Special Tooling) → keyword match on the description (`dove`→`dovetail`, `lolli`→`lollipop mill`, `barrel`/`oval`/`taper`→the matching circle-segment type), else `form mill`.
- All other letters with a single `AUTO_GROUP` entry (C, D, E, I, J, K, N, O, R, TD, TF) map straight across (e.g. `R`→`tap`, `TD`→`boring head`).
- Letters with **no** corresponding `tool_type` (G/H/P/Q/S/T/TA-TU — inserts, saws, turning holders/inserts, CMM styli) return `null`; `psRowToTool` falls back to `flat end mill` for these — they're rare in this shop's data and already get `no_fusion_link: true`, flagging them for manual cleanup.

The row's `Tool Group` value itself is always preserved as-is into `tool.grouping` (so export round-trips the original letter even if `typeFromProShopGroup` guessed differently than ProShop's own filing).

### ProShop photo import (one-time)

A one-time bulk action that copies the shop's existing ProShop tool photos into the app's attachment system as each tool's **primary photo**. Launched from the **"Import ProShop Photos"** button in the Import flow (`ImportFlow.jsx`), which opens `ImportPhotosModal.jsx` (a Drive folder browser reusing `MetadataConnect`'s picker pattern — My Drive + shared drives, nothing saved, picked fresh each run). The work lives in `AppContext.importProShopPhotos(sourceFolderId, { onProgress })`.

- **Source must be in Google Drive** (My Drive or a shared drive the connected account can open) — the importer uses the Drive API to browse and copy; there is no local-disk path. The modal shows an amber note saying so.
- **Folder layout (confirmed against real data)**: the **main photo is a top-level file** in the picked folder, named `tools_{tool_id}_….{img}` (any image — png/jpg/gif/webp/avif, matched by extension OR Drive `mimeType` starting `image/`). Same-named **subfolders** hold only the `300w.png` / `600w.png` / `900w.png` resized variants and are **ignored** — the importer scans top-level image files only and never descends into subfolders. (The original task spec had this backwards — main photo "in a subfolder" — it is not.)
- **ProShop ID** is the segment between the **first and second underscore** of the file name (`tools_A242_… → A242`). Matching to `tool.tool_id` is **dash/space/case-insensitive** (`normId` strips `[\s-]` and uppercases) so `D241`, `D-241`, and `d 241` all match the same tool.
- **Skips**: files with no extractable ID, no matching tool (logged), tools that already have a `primary_photo_id` (never overwrites), and a second photo for a tool already imported in the same run.
- **Copy is server-side** (`driveService.copyDriveFile` → Drive `files.copy`, no byte transfer through the browser); the source folder is never modified. The photo is copied into the tool's `tool_files/{trackingId}/` folder (`ensureToolFolder`) and set as `primary_photo_id` / `primary_photo_name` — see **Tool File Attachments & Photos**.
- **Metadata-only write**: a primary photo is metadata, not a Fusion field, so the action loads `tool_metadata.json` once, sets the photo on each matched tool's record (`buildMetadataTool`), and calls `saveAllMetadata` **once** at the end — it does **not** route through `writeLogicalTool` per tool (which would re-download/re-upload the whole Fusion library hundreds of times). In-memory tools are updated via `UPDATE_TOOL`.
- **Re-runnable**: safe to run again; already-photographed tools are skipped. Returns a summary (`imported` / `skippedHasPhoto` / `noMatch` / `errors`) the modal renders with live progress.
- New Drive helpers: `listFolderChildren(parentId)` (files **and** folders, with `mimeType`) and `copyDriveFile(fileId, name, parentFolderId)` in `driveService.js`.

-----

## ProShop Field Priority Rules

These rules apply during the **initial ProShop CSV merge** and on any **subsequent ProShop sync**. "PS wins" = use the ProShop value, overwriting the Fusion value. "Flag" = surface to the user for a manual decision; do **not** auto-resolve.

| Field | Rule | Notes |
|---|---|---|
| Tool description | PS wins | Always via the per-tool rename confirmation UI — see Description Rename Workflow |
| `vendor` (manufacturer) | PS wins | From `Approved Brand`; metadata-only, **never** written to Fusion |
| `tool_id` | Fill gap only | From `Tool #` — only set if the tool doesn't already have one |
| `location` (cabinet) | Fill gap only | From `Location`; Fusion's "Vendor" UI field (`expressions.tool_vendor`) holds the cabinet location → internal `location` |
| `purchasing` (Approved Brands → manufacturers/vendors) | PS wins, replace when present | Built from every row sharing a `Tool #` via `buildPurchasingFromGroup` — see Purchasing / Vendor Data Model |
| `min_ooh` (MIN OOH floor) | PS wins | From `Length Below Holder - MIN OOH` (export id `lengthBelowShankDiameter`); metadata-only, always overwrites |
| `geometry['shoulder-length']` (shoulder length) | Set to MIN OOH at normalization | See MIN OOH rule below |
| per-assembly `ooh` → `geometry.LB` | Floored at MIN OOH | See MIN OOH rule below |
| `tsc_capable` (through-spindle coolant) | PS wins | From `Through Coolant` (`true`/`false`); boolean capability flag |
| `custom_grind` | PS wins | From `Custom Grind` (`true`/`false`, ProShop id `customgrindtool`); same PS-wins boolean pattern as `tsc_capable`. Metadata-only — appears in the Geometry section as "Custom Grind" |
| `tip_to_first_thread` (taps) | Fill gap only | From `Tip to 1st Full Thread`, converted from the file unit — see note below |
| All other differences | **Flag** to user | Do not auto-resolve |

### MIN OOH floor rule (read carefully)

ProShop's **MIN OOH** (internal `min_ooh`, from the `lengthBelowShankDiameter` column) is the authoritative minimum stick-out **floor** for the whole logical tool — see the three-length-concepts table under **Holder Library & Assemblies**. ProShop is the source of truth for it through the first-import + normalization workflow. It is **metadata-only** — never written to a dedicated Fusion field (Fusion has none); it reaches Fusion via shoulder length.

**Implemented in `normalizeLibrary`** (and the intended behavior on any later ProShop sync):

- Set the shared shoulder length (`shoulder_length` → `geometry['shoulder-length']`) **equal to** MIN OOH.
- **Floor** every assembly's OOH (`geometry.LB`) at MIN OOH — raise any instance whose stick-out is below the minimum up to it. Instances already ≥ MIN OOH are left alone (each keeps its own larger, proven stick-out).

```js
// normalizeLibrary — per logical tool, when min_ooh is present
shoulder_length = min_ooh;                    // shoulder defaults to the floor
assemblies = assemblies.map(a => ({
  ...a,
  ooh: (a.ooh != null && a.ooh < min_ooh) ? min_ooh : a.ooh,   // floor, never lower a larger OOH
}));
```

After normalization, shoulder length and per-assembly OOH can be adjusted manually (rare). `AssemblyForm` continues to block any per-assembly OOH below `min_ooh`. Note the floor applies **per instance** — a multi-assembly tool keeps each proven stick-out, only correcting ones that fall below the minimum.

### Tip to 1st Full Thread (taps)

`tip_to_first_thread` (see Hole-Making Tool Presets → Tap & thread mill metadata fields) is wired into ProShop CSV import — `psRowToTool` (new tools, adopts the file unit) and `matchProShopToTools` (fill-gap merge onto existing tools, converted via `convertLength` from the file unit into the tool's own unit, same as `min_ooh`) — reading the confirmed ProShop column `row['Tip to 1st Full Thread']` (export id `tipTo1stFullThread`).

### Vendor / Location field mapping (Fusion repurposes "Vendor")

Fusion's **"Vendor"** UI field — stored as `expressions.tool_vendor` in the Fusion JSON — is repurposed to hold the **tool cabinet location** (e.g. "LC-8"), **not** the manufacturer:

```js
// Fusion → internal
tool.location = stripQuotes(expressions.tool_vendor);   // Fusion "Vendor" = our location
tool.vendor   = psData.vendor;                          // PS Manufacturer = actual vendor (metadata only)

// internal → Fusion
expressions.tool_vendor = `'${tool.location || ''}'`;   // write location back to Fusion's "Vendor"
// tool.vendor (manufacturer) is NEVER written to Fusion
```

This is a permanent convention and **already implemented** (`fusionToolToInternal` / `internalToFusionTool` in `src/schema/toolSchema.js`). Never write the manufacturer name into Fusion's vendor field — it would appear as the cabinet location in Fusion's UI.

**Root-level `vendor` field**: Fusion also stores a plain-string `vendor` at the root level of the tool object (unquoted value of `expressions.tool_vendor` — Fusion re-derives one from the other, same expression/native pairing as all other fields). `internalToFusionTool` writes it as `fusionObj.vendor = tool.location || ''` **after** the `isMetadataOnly` guard — it cannot be set inside the `fusionObj = { ... }` literal because the field registry marks our internal `tool.vendor` (manufacturer) as `metadataOnly: true`, and the guard would strip it. The post-guard assignment bypasses this correctly. The value is always `tool.location` (the cabinet location), never the manufacturer.

-----

## Purchasing / Vendor Data Model

Each tool's purchasing/sourcing info lives in metadata as `purchasing: { manufacturers: [], vendors: [] }` — a normalized two-table model (not a flat list). This replaced an earlier flat `purchasing[]` shape (one entry per ProShop Approved-Brand row), which couldn't represent "the same manufacturer's part sold by two different vendors at different prices" or give rows stable IDs for drag-reorder.

```json
"purchasing": {
  "manufacturers": [
    { "id": "uuid", "name": "Helical", "edp": "12334", "edp_url": "https://...", "mfg_num": "", "mfg_num_url": "", "order": 0 }
  ],
  "vendors": [
    { "id": "uuid", "manufacturer_id": "uuid-of-helical", "name": "MSC Industrial", "vendor_num": "99377473", "vendor_num_url": "https://www.mscdirect.com/product/...", "price": 34.76, "order": 0 },
    { "id": "uuid", "manufacturer_id": "uuid-of-helical", "name": "Butler Brothers", "vendor_num": "", "vendor_num_url": "", "price": 30.74, "order": 1 }
  ]
}
```

- `manufacturers[]` — one entry per manufacturer that makes this tool. `edp` is the manufacturer's part number. `mfg_num` is a separate manufacturer-assigned number with **no ProShop column** (purely internal).
- `vendors[]` — one entry per vendor that sells this tool, linked to a manufacturer via `manufacturer_id`. `vendor_num` is the *vendor's own* catalog/stock number — distinct from the manufacturer's `edp`. `price` is a number.
- `*_url` fields are optional strings; empty string = no link. When present, the corresponding number renders as a clickable link with a small `ExternalLink` icon.
- `order` on both arrays drives drag-to-reorder position (manufacturers reorder among themselves; vendors reorder within their manufacturer group).
- A per-vendor `lead_time` field is anticipated but not yet implemented — see the `// TODO` comment in `buildMetadataTool` (`src/schema/toolSchema.js`).

### EDP# disambiguation (ProShop import/export)

ProShop's CSV has a single `EDP#` column per Approved-Brand row, but it's ambiguous — sometimes the manufacturer's part number, sometimes the vendor's own stock number. `VENDORS_WITH_OWN_NUMBERS` (`src/schema/vendorRegistry.js`) resolves this:

- **Import** (`buildPurchasingFromGroup`, `src/components/ImportFlow.jsx`): for each row, if `Vendor` is in `VENDORS_WITH_OWN_NUMBERS` → that row's `EDP#` becomes the vendor's `vendor_num`; otherwise it becomes the manufacturer's `edp` (first non-empty value per manufacturer wins).
- **Export** (`buildBrandRows`, `tool-extractor.tsx`): for each manufacturer/vendor pair, the `EDP#` column = `vendors[].vendor_num || manufacturers[].edp`.
- `mfg_num` has no ProShop column in either direction.

### `vendorRegistry.js` (data-driven)

`src/schema/vendorRegistry.js` is now **data-driven** — the live list of entities comes from `vendor_registry.json` on Drive (see **Shared Drive Files**), not hardcoded arrays. The module holds:
- `DEFAULT_VENDOR_REGISTRY` — the migration seed used to create the Drive file on first run, assembled from the data that used to be hardcoded here + in `urlGenerators.js` (manufacturer/vendor names, URL patterns, own-catalog-number flags, and the ProShop unique-id map as each entity's `proshop_id`). **No entries were lost in the migration.**
- An **active registry** (`setActiveVendorRegistry` / `getActiveVendorRegistry`) — `AppContext` sets it after the Drive file loads, so the pure helpers below resolve against live data even when called from non-React modules (`urlGenerators.js`, `tool-extractor.tsx`, the ProShop import).
- Helpers (read the active registry, or an explicitly passed one): `getManufacturerNames()` / `getVendorNames()` (replace the old `MANUFACTURER_LIST` / `VENDOR_LIST` arrays — call them in render so datalists reflect live data), `entityByName(name)`, `vendorHasOwnCatalogNumber(name)` (drives the Vendor# field's default visibility in the Purchasing UI), and `resolveVendorName(value)`. `urlGenerators.js` reads each entity's `edp_url_pattern` / `vendor_num_url_pattern` and substitutes `{edp}` / `{edp_lower}` / `{vendor_num}` — the token-substitution logic stays in `urlGenerators.js`.

#### Preferred name + aliases (`name` / `aliases[]`)

Each entity has one **preferred (canonical) `name`** — the only one shown on tools and exported — plus an **`aliases[]`** array of alternate spellings. ProShop's "Brand" field is free text with no consistency (we'd type `"GARR"` or `"Helical"` instead of `"GARR Tool"` / `"Helical Solutions"`, plus misspellings), so aliases collapse those variants into one entity. **Aliases are match-only — never shown or exported.**

- **`entityByName(name)`** matches on the canonical name **OR any alias** (case-insensitive). This makes URL generation, `vendorHasOwnCatalogNumber`, etc. resolve correctly when a tool stored an alias.
- **`resolveVendorName(value)`** canonicalizes in priority order: ProShop unique-id (`MSC1`) → name/alias match → **the preferred `name`**; unknown free text passes through unchanged. Used by the ProShop import (`ImportFlow`'s `resolveVendorName` for Approved Brand / Vendor) and the **AI extraction sanitizer** (`tool-extractor.tsx` snap-data: `approvedBrand` is canonicalized via `resolveVendorName`; `vendor` is canonicalized then validated against `getVendorNames()`).
- The seed merges the known duplicates: `"GARR Tool"` (alias `"GARR"`) and `"Helical Solutions"` (alias `"Helical"`). Add new aliases in the `/vendors` editor's **"Also known as"** field, **not** as separate entities.

### Purchasing UI (`PurchasingSection.jsx`)

A collapsible "Purchasing" panel in `ToolDetail`'s right column. Nested table: outer rows are manufacturers (Manufacturer / MFG# / EDP#), each with an inner table of its vendors (Vendor / Cost / Vendor#). `[+ Add manufacturer]` / `[+ Add vendor]` buttons. Drag-to-reorder follows the same pattern as `PresetPanel.jsx` (`GripVertical` handle, hover-to-reveal delete `×`) — manufacturers reorder among themselves, vendors reorder within their manufacturer group.

-----

## Shared Drive Files (materials / vendor registry / shop settings)

Three shop-wide JSON files live in the **same Drive root as `tool_metadata.json`** and are loaded at startup **in parallel** with the metadata (in `loadTools`, when Google is connected). Each is **created from its default content if it doesn't exist yet**; a load failure on any one falls back to its default and never blocks the library load. All three are exposed via `useApp()` as `state.materials` / `state.vendorRegistry` / `state.shopSettings` (defaulting to their seeds before load), with save functions `saveMaterials` / `saveVendorRegistry` / `saveShopSettings`. **Foundation only — no UI yet.**

**How they are found (never need separate selection):** `loadOrCreateSharedJson` calls `getMetaParentFolderId()` (the parent folder of the connected `tool_metadata.json`) to locate them. Their Drive file IDs are cached in localStorage under the keys in `SHARED_FILES`; on a fresh machine (empty cache) the function searches the metadata folder by name and re-caches. A missing file is created from its default seed. This means connecting `tool_metadata.json` once is sufficient — the other three files auto-join on the next `loadTools`. The `MetadataConnect.jsx` folder picker checks for all four files in parallel during browsing and shows a ✓/— status grid in the callout so users can confirm all files are present before connecting (see **Google Drive — Shared Drive Support** below).

- **Generic Drive-file plumbing** lives in `driveService.js`: `loadOrCreateSharedJson(name, cacheKey, default)` and `saveSharedJson(name, cacheKey, content)`, with the file names + localStorage cache keys in `SHARED_FILES`. Content is pretty-printed (`JSON.stringify(data, null, 2)`) like all Drive JSON. Cache keys are cleared on `signOut()`.

- **`materials.json`** (default in `src/schema/sharedDefaults.js`, **`version: 2`**) — shop-editable material taxonomy, **the single source of material in the app**, in **three tiers**:
  - `groups[]` = the standard ISO turning groups (`P` Steel, `M` Stainless, `K` Cast Iron, `N` Non-Ferrous, `S` High-Temp Alloys, `H` Hardened Steel), each with a `color` (per-group token for preset color coding — no prior material→color map existed, so these seed it), a short `code` (the fallback token used in preset names, e.g. `SS`/`AL`), and an `iso` flag.
  - `presets[]` = **CAM presets** — the middle layer that becomes the Fusion **speed/feed preset group name** (`{ id, group_id, name, code, description, iso_513, kennametal, vdi_3323, order }`). Each carries the equivalent material code in three standards (ISO 513 / Kennametal / Haas-VDI 3323) so manufacturer charts cross-reference (a manufacturer's `material_code_system` says which column applies — see vendor registry). The optional short `code` overrides the group code in preset names; seeded presets leave it blank.
  - `materials[]` = individual **alloy records** (`{ id, group_id, preset_id, label, aliases[], category, condition, code, iso_513, kennametal, notes, order }`). `aliases[]` are the alternate names the shop looks a material up by (6061-T6, SS316, 18-8…); `preset_id` links the alloy **up** to its CAM preset. **Seeded full** from the shop's material reference docs (`/Material REF Docs`) — values to be audited against the charts there.

  The preset material picker (`PresetPanel`: Group → CAM Preset), name composition, and coloring all read this file — see Preset naming convention. **Migration note:** the seed only applies when the Drive file is *missing*; a shop with an existing `version: 1` `materials.json` must use **"Load reference data"** in the Materials editor (or delete the Drive file) once to adopt the 3-tier seed. `MATERIAL_CODE_SYSTEMS` (also in `sharedDefaults.js`) lists the three classification standards.

- **`vendor_registry.json`** (default = `DEFAULT_VENDOR_REGISTRY` in `vendorRegistry.js`) — the unified entity list (see `vendorRegistry.js` above). Each entity carries a preferred `name` + `aliases[]` (match-only alternates). Manufacturers also carry **`material_code_system`** (`'iso_513' | 'kennametal' | 'vdi_3323' | null`, from `MATERIAL_CODE_SYSTEMS`) — which material-classification standard that manufacturer publishes, so its catalog's material codes map to the CAM presets' code columns. Each tool's `purchasing.manufacturers[]` / `vendors[]` are intended to reference entity IDs from this list; the `is_manufacturer` / `is_vendor` flags determine which picker an entity appears in.

- **`shop_settings.json`** (default in `sharedDefaults.js`) — `{ shop_name, default_units, machine_number:{start,skip}, machines:[], default_machine_id:null, tool_id_system:{mode,separator,start,skip,digits,location:{cabinet_identifier,drawer_identifier}}, import:{...}, aps:{...}, setup_steps:{fusionConnected,metadataConnected,normalized,proshopMerged,proshopPhotos,machineNumbers,proshopExported} }`. **Wired into behavior**: `default_units` is mirrored to `setDefaultUnit` on load; `machine_number.{start,skip}` drives renumber/add-tool; `tool_id_system` drives the configurable Tool ID System (see that section) — `mode` controls ID generation/display and `machine_linked` mode keeps `machine_number` in sync. `setup_steps` holds ISO timestamps written by `markSetupStepInSettings()` (AppContext) each time a setup step completes — shared across devices via Drive. The **6 canonical `SETUP_STEPS`** (exported from AppContext, in order) are: `fusionConnected`, `metadataConnected`, `normalized`, `proshopMerged`, `machineNumbers`, `proshopExported`; `proshopPhotos` is a sub-step tracked in `setup_steps` but not in `SETUP_STEPS`. **`metadataConnected` is step 2** — it completes the moment Google Drive connects (a declarative effect in AppContext marks it for both live sign-in and a restored session); seeding derives it from `googleRef.current`, and `loadSetupProgress`'s migration back-fills it (and `machineNumbers`) on an established library (`proshopExported` true). **Still NOT wired**: the `import` and `aps` sub-objects (the import/APS flows don't write them back yet).
### Machine Configuration

CNC machines are configured in `shop_settings.json` under `machines[]` (each with a `default_machine_id` for pre-selection). Machine data is informational — it never drives toolpath behavior or blocks saves.

**Machine data model** (`machines[]` entry):
```json
{
  "id": "uuid",
  "model": "Brother Speedio M300X3",
  "machine_type": "Machining Center",
  "taper": "BT30",
  "max_rpm": 16000,
  "horsepower": 12,
  "through_coolant": true,
  "through_coolant_psi": 1000,
  "order": 0
}
```
`MACHINE_TYPES` = `['Machining Center', '5-Axis', 'Mill-Turn', 'Lathe / Turret', 'Other']`.
`TAPER_TYPES` = standard spindle taper names (BT30/40/50, CAT40/50 with dual-contact variants, HSK-A63/A100/E32/E40, Other).

**Preset machine link** — each preset carries a metadata-only `machine_id` field (null when unlinked). It is stored in `preset_meta[guid].machine_id` in `tool_metadata.json` (alongside `operation_type`) and read back in `mergeFusionAndMetadata`. **Never written to Fusion JSON.** New blank/ref-seeded presets are pre-populated with `shopSettings.default_machine_id`; copied presets keep the original's `machine_id`.

**Taper compatibility hint** (`taperMatches`, `PresetPanel.jsx`) — when a preset's linked assembly has a holder, checks whether the machine's taper string appears (case-insensitive substring) in the holder description. Mismatch shows a ⚠ warning next to the machine picker in `EditCard`. Informational only, non-blocking. `'Other'` taper never flags.

**Landing page filter** (`LandingPage.jsx`) — rendered only when `shopSettings.machines.length > 0`. Default (non-strict): shows tools with presets linked to the selected machine **plus** tools with no machine-linked presets at all. Strict toggle: shows only tools with at least one preset explicitly linked to the machine. Initialized to `default_machine_id` once on first load via `machineInitialised` ref (doesn't re-apply when `shopSettings` reloads). The `machineFilter` state `{ machineId, strict }` is passed as the third argument to `applyFilters` (see `searchEngine.js`).

**Preset panel filter** (`PresetPanel.jsx`) — a second filter chip row (below the material tabs, only when `machines.length > 0`) lets the user narrow the visible preset cards to a single machine. Drag-to-reorder is disabled while either filter (material or machine) is active. The `CollapsedCard` shows the linked machine's model name (small `Cpu` icon + model) when `preset.machine_id` is set.

**Settings UI** — the Machines configuration lives **inside the Shop card** as a subsection (not a separate card). Includes: default machine picker (pre-selects the machine in the landing filter and new presets), machine list with expand-to-edit inline form, drag-to-reorder (`useDragReorder`), delete confirmation, `+ Add Machine` button (`AddMachineForm` local component). Changes to individual machines auto-save on the row's Save button; the default machine picker has a "Save Machines" button at the bottom.

### Editor UIs (`/materials`, `/vendors`, Settings)

Three editor pages, reached from the top-bar chrome-style tabs (**Library**, **Materials**, **Vendors**, **Settings**). Inline editing, no modals. `MaterialsEditor` uses drag-to-reorder via the shared `useDragReorder` hook (`src/components/useDragReorder.js`, HTML5 DnD that renumbers `order`); `VendorsEditor` does **not** reorder (filter/sort instead — see below).

- **`MaterialsEditor.jsx`** (`/materials`) — a **65/35 two-column layout** (`.mat-layout`, same proportions as `ToolDetail`). **Left (main):** a hierarchy-graph toggle — two separate node buttons, **CAM Presets ──made up of⟶ Material Alloys** (`.mat-hier`) — switches the main list between the two; color-coded full-name **group filter pills** (`.mat-gpill`, e.g. "P — Steel", tinted by group color) drive both lists, alongside a full-width **search box at the top of the page** (matches CAM presets by name/code/description/standard codes + their alloys, or alloys by name/alias/code). CAM presets render as **rich rectangles** (`.cam-card`: left border in the group color, group badge, name + description, the three standard codes ISO 513 / Kennametal / Haas-VDI as columns, and the alloy chips that compose the preset); Material Alloys render as expand-to-edit rows (label/aliases/group/linked CAM preset/condition/code/codes/notes). Click a card/row to expand its inline editor (Delete lives inside the editor). **Right (reference):** the **Material Groups** card (drag-reorder via `useDragReorder`, editable color/label/**code**, ISO groups not deletable, `+ Add Group`) plus the **"Load reference data"** action (resets the whole library to the bundled seed — one-off migration). Autosaves to `materials.json` on each change via `saveMaterials`. **This library is the only source of material** in the app (the preset picker + naming + coloring all read it) and **group colors drive preset color coding** — see Preset color coding below.
- **`VendorsEditor.jsx`** (`/vendors`) — one list over `vendorRegistry.entities`; per row: name, **MFG**/**VENDOR** toggle pills (both can be active), **Has Own #** (vendor only), expand-to-edit **Also known as** (aliases) + (manufacturers) a **Material code system** dropdown (`MATERIAL_CODE_SYSTEMS`) + URL patterns with a live preview. **No drag-reorder** — a toolbar offers a name/alias **filter**, a role filter (All/MFG/Vendor), and an **A–Z/Z–A sort** (alphabetical by default). Rows use a CSS grid (`.vendor-row`) so the MFG/VENDOR/Has-Own-# columns stay **vertically aligned** even when a row isn't a vendor (the Has-Own-# cell is `visibility:hidden`, not removed). The **MFG/VENDOR pills are color-filled when active** (indigo / teal) — these `.vendor-role-pill` colors are scoped to this page only, not the shared chip tokens. Autosaves to `vendor_registry.json` via `saveVendorRegistry` (which also refreshes the active registry).
- **`Settings.jsx`** — sections around the 6-step workflow: **Account** (sign-out), **Setup & Import** (unified checklist with live-data warnings + Drive timestamps), **Shop** (name + default-unit + **Machines subsection** + Save button), **Machine Numbers**, **ProShop Export**, **Rename**, **Advanced**. The Machines subsection is **inside the Shop card** (not a separate card) — it contains the default machine picker, the machine list (expand-to-edit inline, drag-to-reorder, delete confirmation, `AddMachineForm`), and a "Save Machines" button. The Setup & Import checklist **embeds two config panels inline under their steps** (not as separate cards): the **Fusion Libraries** panel (tool + holder inline pickers) under step 1 `fusionConnected`, and the **Tool Metadata (Google Drive)** panel under step 2 `metadataConnected` — both are plain `render*Panel()` functions (NOT components) so the `FilePicker`'s navigation state survives re-renders. Steps with an embedded panel render no `StepAction` button (they self-serve). The Tool Metadata panel deliberately does **not** show the Fusion library file name (that's the Fusion Libraries step's job). The "Save Shop Settings" button is inside the Shop card and writes `shop_settings.json` (unit toggle takes effect immediately). The Setup & Import tracker reads `setupProgress` (localStorage flags) + `shopSettings.setup_steps` (Drive timestamps) and calls `markSetupStepInSettings` to write both.

### Preset color coding (from `materials.json` group colors)

Presets are tinted by their material's ISO-group color (the ToolDex design system colors anything tied to a material by its ISO 513 group). `presetMaterialColor(query, materials)` (`src/utils/presetNaming.js`) resolves the stored `material.query` against the library (`findMaterialInLibrary` → group color), falling back to the legacy keyword map (`materialIsoGroup` → `MATERIAL_CODE_TO_ISO_GROUP`: `AL`/`BRONZE`/`BRASS`→N, `SS`→M, `STEEL`/`MILD`→P, `CI`→K, `TI`→S; plastics/unknown → null) so pre-library/imported material strings still color. `PresetPanel.jsx` (`groupColorOf`) applies it as a left-border accent on each preset card (collapsed + edit) and on the material label / group-divider dot. The **`.preset-tag` chip itself is colored by the material's ISO group**: each host sets the `--badge-color` CSS custom property from `presetMaterialColor` (`AssemblyCard`/`AssemblyForm` linked presets, `PresetPanel` collapsed card via its `accentColor` prop, Sync Job `DiffStep`/`CommitStep` new-preset rows), and the chip class derives its text + border from it (flat `--input-bg` fill, no leading dot). When `presetMaterialColor` returns null (unknown material), the host passes `undefined` and the chip falls back to the CSS default `--iso-p` (steel). The old per-data-type emerald `.preset-tag` token and the standalone `<PresetDot>` component were removed in the design-system pass — color now lives on the tag via `--badge-color`. The seeded ISO-group colors are `:root` tokens (`--iso-p/m/k/n/s/h`); the shop's `materials.json` `groups[]` may override them at runtime.

-----

## Description Rename Workflow (normalization step)

During initial normalization, tool descriptions are rationalized. The ProShop description takes priority, but each tool passes through a per-tool confirmation UI — descriptions are **never** silently renamed.

**Reuse the existing generator** — `buildDesc()` lives in `src/utils/toolNaming.js` (re-exported from `tool-extractor.tsx` for the extraction UI) and composes a standardized description from a tool's structured fields (e.g. `0.5 4FL EM 1.000LOC`, `#80 135DEG CARB DRILL`). It is a **generator** (specs → description), not rename/diff detection — use it to produce the *suggested* new description; check that file before writing any new naming logic.

For taps, `buildDesc` strips the UNC/UNF thread-series designation from `pitch` via `stripThreadSeries()` — it's implied for inch taps — but **keeps** NPT/NPTF (pipe threads change the tap's form and aren't implied). E.g. `1/4-20 UNC` → `1/4-20 CUT TAP`, but `1/8-27 NPT` → `1/8-27 CUT TAP NPT`.

`LETTER_DRILLS` (`src/utils/toolNaming.js`) deliberately **omits `E` (0.25")** — nobody in the shop calls a 1/4" drill an "E", even though it's technically on the letter-drill chart. `smartDiam` falls through to the fraction `1/4` for that size instead. Don't re-add `E` without re-confirming shop convention.

**Step-by-step UI** (a step in `NormalizeModal`, or a follow-on modal) — for each tool in sequence:

1. Show current Fusion description and PS description side by side
2. Show the suggested new description (PS description, or one generated via `buildDesc()`)
3. User can: Accept suggestion / Edit and accept / Keep Fusion description / Skip
4. "Next →" advances to the next tool; a progress indicator shows X of N
5. At the end, "Apply all renames" writes the confirmed descriptions in one batch

This is, alongside the preset operation-type assignment, one of the few normalization steps requiring per-tool user decisions; the two may share a single pre-flight review modal if the UX allows.

**Priority rule**: PS description wins by default; if the PS description is blank, keep the Fusion description. User confirmation is **always** required. (Implemented in `src/components/DescRenameModal.jsx` — a standalone per-tool rename confirmation modal that uses `buildDesc(toolToExtractor(t))` for suggestions and commits via `saveFullLibrary`. `NormalizeModal` handles the preset operation-type assignment step.)

-----

## Phase 2 — Compare & Merge ✅ Implemented

When a programmer proves better speeds/feeds in a job, they can sync those values back to master:

1. Copy tool(s) from Fusion 360 — Fusion's right-click copy puts tool data on the clipboard as **TSV** (tab-separated, a CSV-family format), not JSON
2. Go to "Sync Job" in the app (left sidebar on the Library page) → paste (Ctrl+V anywhere on the import screen)
3. App builds a batch queue — auto-matches each tool by priority:
   - **`tool_id` exact match** — primary (Fusion's `product-id` field)
   - **GUID exact match** — secondary
   - **Geometry fuzzy match** — fallback, requires user confirmation
   - **No match** → route to "Add to Library" flow
4. For each matched tool: side-by-side diff → select which fields to commit → enter revision note
5. Live re-fetch from APS before each diff (60-second cache) — detects if a teammate updated master during the session
6. Summary screen shows results; "Copy All Committed Tools to Clipboard" exports the committed tools as **TSV** for pasting back into Fusion

**Clipboard / import format**: the Fusion clipboard interchange is **TSV in both directions** — `copyToolToClipboard` / `copyToolsToClipboard` (`src/utils/fusionExport.js`) emit TSV, and `parseIncoming` (`src/services/mergeQueue.js`) parses Fusion CSV/TSV from a right-click copy. The importer **also** accepts a pasted Fusion library **JSON** file (it tries JSON first, then falls back to CSV/TSV), so JSON is a supported import path — but it is not the clipboard-copy format. The TSV uses the same tabular column layout as the full library import/export (including the `holder_segments` / `shaft_segments` columns).

Merge history is appended to `merge_history[]` in `tool_metadata.json`.

### Preset matching in Phase 2 (DiffStep)

Presets are matched **by name (case-insensitive)**, not by GUID. This is because a preset copied from master to a job retains its GUID, making GUID matching unreliable for detecting conflicts vs. new presets.

`matchPresets()` in DiffStep categorizes each incoming preset into one of four buckets:

| Category | Condition | Action |
|----------|-----------|--------|
| `unchanged` | Same name, values identical | Shown grayed out; nothing to commit |
| `blocked` | Same name, different values, same assembly context (or no OOH) | Shown grayed out; no update offered — different conditions mean it's not directly comparable |
| `conflicts` | Same name, different values, **different assembly context** | User asked: "Create new preset" or "Ignore" |
| `newPresets` | No name match in master | User can select to add; always included in commit |

**Assembly context comparison** (`checkDifferentAssembly`): a preset is considered to have a different assembly context if the incoming OOH differs from every existing assembly linked to that master preset by more than 0.0005" (or if the holder GUID differs). If the incoming tool has no OOH data (`incoming_ooh == null || <= 0`), presets with value differences are always `blocked` (not conflicted).

### Transient fields on imported tools during Phase 2

These fields are set on the incoming tool object during parsing and are used by DiffStep/CommitStep but are **never saved to metadata**:

- `incoming_ooh` — OOH value from the imported tool's `geometry.LB` (JSON) / `tool_bodyLength` (CSV/TSV), taken raw in the tool's own unit. **Not** from `assembly-gauge-length` (which is holder gauge + OOH)
- `incoming_holder_guid` — holder GUID from the imported tool (if present)
- `_incomingHolderDesc` — pre-resolved holder description string (set during import parsing)

### Preset GUID rules during merge

- **New presets** (`newPresets` bucket): keep their incoming GUID — this GUID is used by the assembly record created in CommitStep to link the preset to its assembly
- **Conflict presets resolved as 'create'**: MUST receive a **new** GUID (via `generateId()`), because the incoming preset's GUID equals the master preset's GUID (it was copied from master). The new preset's name is composed with the **standard convention** via `composePresetName()` (`<MaterialCode> <OOH> <HolderShort> - <Operation>`, e.g. `SS 2.125 30-SK13-60 - Rough`) using the incoming OOH + holder + parsed operation type — **not** by appending `"(OOH: …)"` to the incoming name. Falls back to the incoming name only if the convention can't be composed.
- **`presetsToAdd` GUIDs must be stable** between DiffStep confirmation and CommitStep commit — do not regenerate them

### CommitStep assembly detection

If the incoming tool has `incoming_ooh > 0` AND there are presets in `presetsToAdd`, CommitStep shows an "Assembly Detected" panel with three options:
- **Create new assembly** — generates a new assembly record linked to the new preset GUIDs
- **Link to existing assembly** — merges the new preset GUIDs into a user-selected existing assembly
- **Skip** — no assembly action; presets are added without assembly context

The `assemblyUpdate` object is passed as the 7th argument to `mergeTool()`.

### `mergeTool()` call signature from CommitStep

```js
await mergeTool(
  masterTool,
  mergedFields,        // { fieldName: incomingValue, ... } for selected flat fields
  revisionNote,
  mergedBy,
  [],                  // presetChanges — always empty (we never overwrite existing presets)
  newPresetList,       // presetsToAdd from DiffStep
  assemblyUpdate       // { type: 'create'|'link', assembly: {...} } or null
);
```

-----

## Sync & Merge Workflows

There are **three distinct ways tool data gets reconciled** across the Fusion library, metadata, and incoming job edits. They are complementary — keep them straight:

| Workflow | Trigger | Scope | Conflicts | Code |
|---|---|---|---|---|
| **Load-time auto-combine** | Every load + bulk write | Whole library, by ProShop # | Never silently overwrites — strays preserved in `_instancesRaw` | `combineToolsByToolId` |
| **Reconcile on open** | Opening a tool (ToolDetail) | One logical tool vs. live Fusion library | Surfaced — hands off to Sync Job diff | `reconcileTool` / `applyReconcile` |
| **Sync Job (Phase 2)** | User pastes job tools | Batch queue of incoming tools | User picks per-field/per-preset | `MergeFlow` / `mergeTool` |

All three ultimately persist through `writeLogicalTool()` (re-download → drop everything this tool owns → append fresh split instances).

### 1. Load-time auto-combine (`combineToolsByToolId`)

In `src/schema/toolSchema.js`. Runs **silently** in `loadTools` (after `groupByTrackingId` + `buildLogicalTool`) and in bulk writes (`saveFullLibrary`, `normalizeLibrary`). Folds separate logical tools that share a `tool_id` into **one** logical tool so a tool copied/dumped under a fresh GUID or tracking ID doesn't show up as a separate entry:

- One instance per **distinct** (holder, OOH); identical (holder, OOH) instances collapse to one assembly.
- Presets are unioned by name; the **primary** tool's shared fields win.
- **Never destroys conflicting data** — every raw entry is kept in `_instancesRaw`, so the reconcile-on-open pass can still detect a folded sibling whose shared fields differ. `mergeLogicalTools` also **unions** each folded tool's `_registeredAssemblies` so legit app-known instances aren't later misflagged as strays.

### 2. Reconcile on open (`reconcileTool` / `applyReconcile`)

Catches entries **dumped straight into the Fusion library from Fusion 360** (bypassing Sync Job). Runs automatically once per opened tool in `ToolDetail` (skipped while editing); it **re-fetches the live Fusion library** (`fetchRawLibrary()` — an APS call each open) so it sees changes made since login.

- **Match scope**: a raw entry belongs to this tool if it shares the tool's **tracking ID OR ProShop #**.
- **Registered = metadata**: the "known" instances are the tool's metadata assemblies' `instance_guid`s, attached to the logical tool as `_registeredAssemblies` by `buildLogicalTool` (and unioned by the combine). A raw whose guid isn't registered is a **stray**.
- **Shared signature** (`sharedSignature` in `src/services/reconcile.js`): a normalized fingerprint of everything *except* the per-instance dimensions — excludes `holder` and `geometry.LB`/OOH (and `geometry.assemblyGaugeLength`). Includes `type`, geometry (DC/LCF/OAL/NOF/RE/SFDM/TA/shoulder/SIG/TP), `description`, `product-id`, `BMC`, and presets (name + speeds/feeds, **GUID-independent**). Numbers rounded (4dp; feed-per-tooth 6dp).
- **Classification** of each stray (`classifyStrays`):
  - shared sig **differs** from canonical → **conflict** → "Review…" navigates to the Sync Job diff prefilled (`navigate('/merge/:id', { state: { reconcileIncoming } })`).
  - shared sig matches, (holder, OOH) matches a known assembly → **duplicate** → offer delete.
  - shared sig matches, (holder, OOH) is new → **new assembly** → offer add or delete.
- **No-metadata fallback**: when `_registeredAssemblies` is empty (Google Drive not connected), "new assembly" detection is **disabled** — only true duplicates and conflicts surface, and distinct holder/OOH instances are kept silently. This prevents misflagging a legitimate multi-assembly tool's extra instances as strays.
- **Applying** (`applyReconcile(tool, { adopt, dropRaws })`): one `writeLogicalTool` call. Adopted strays become registered assemblies **keyed by their own guid** (and get normalized to the tool's shared fields on rewrite); dropped strays are removed. The write drops by tracking ID **plus** the supplied stray guids, so ProShop-matched strays carrying a *different* tracking ID are still cleaned up. Conflict resolution goes through the merge flow, **not** `applyReconcile`.
- UI: `src/components/ReconcileModal.jsx`. Pure logic + helpers: `src/services/reconcile.js` (`sharedSignature`, `instanceSig`, `classifyStrays`, `hasReconcileWork`).

### 3. Sync Job (Phase 2)

The explicit, user-initiated batch flow — see the **Phase 2** section above. The reconcile-on-open "conflict" path reuses this exact diff screen: it passes the stray entry as the incoming tool (`location.state.reconcileIncoming`) and, because `preselectedId` is set, skips MatchStep straight to DiffStep against the open tool.

-----

## UI Layout — ToolDetail

The ToolDetail view uses a three-zone layout:

1. **Frozen left sidebar** (`.tool-action-sidebar`): action buttons that don't scroll
   - Edit, Duplicate, Sync Job, Copy JSON, Download JSON, ProShop CSV, Delete
   - Each is a `SidebarBtn` (large icon + wrapped label + title tooltip)
   - Collapse to icon-only on mobile (`max-width: 768px`)

2. **Sticky header** (`.tool-sticky-header`): stays at top of viewport while scrolling
   - Back button, tool type icon, tool type label
   - Description in a violet rounded badge (`.description-badge`)
   - Tool ID in an amber pill (`.tool-id-pill`)

3. **Scrollable main content** (`.tool-detail-main`): two-column layout (`.detail-layout`, ~65% / 35% via `grid-template-columns: 65fr 35fr`)
   - Left column (`.detail-layout-left`): Geometry, Setup, Assemblies, Presets, History (incl. Merge History)
   - Right column (`.detail-layout-right`): Identity (Cabinet location + machine tool # T/H/D in one row), Photo, Purchasing, Notes & Tags, Files & Attachments

Machine tool number is shown inside the Identity section, in the same row as the Cabinet/location chip (not as a standalone block). The Identity section no longer shows `Type` (redundant with the tool-type label in the sticky header) or `Manufacturer` (now covered by the Purchasing section) — it shows "No identity info yet." when neither location nor machine number is set. History and Merge History are combined in one panel at the bottom of the left column.

**Mobile** (`max-width: 768px`): `.detail-layout` collapses to a single column and `.detail-layout-right` is reordered (`order: -1`) to appear **above** `.detail-layout-left` — Identity/Photo/Purchasing/Notes are seen first, before Geometry etc.

### Data-field visual token system

**Universal rule**: every named data type has exactly one CSS token class. Use it everywhere that type appears as a **standalone chip or badge** (cards, sticky headers, inline lists). In a label:value detail grid the plain value is correct; the class is for when the data appears without a label next to it.

**When changing any token's style, update ALL usages across the codebase** — not just the CSS definition.

| Data Type | Class | Shape | Color |
|---|---|---|---|
| Tool Description | `.description-badge` | Rounded rect (r=7px) | Violet — `rgba(124,58,237,…)` |
| Tool ID | `.tool-id-pill` | Pill | Amber — `#f59e0b`, mono (`--font-mono`) |
| Holder | `.holder-pill` | Pill | Colored by **holder SIZE** via `--badge-color` (host sets it from `holderColor`); default teal `--holder-default`, mono |
| Machine Tool # | `.machine-num-badge` | Slightly rounded rect (r=5px) | Green — `#4ade80`, mono |
| Location/Cabinet | `.location-tag` | Rounded rect (r=7px) | Indigo — `#818cf8`, mono |
| Preset Name | `.preset-tag` | Pill | Colored by **material's ISO group** via `--badge-color` (host sets it from `presetMaterialColor`); default `--iso-p` (steel) |

All six classes are defined in `src/index.css` in the "Data-field visual tokens" block.

**`--badge-color` pattern (holder + preset)**: these two badges are no longer a single flat color. The class carries a default `--badge-color` and derives its fill/border/text from it (`color-mix`); each host sets `--badge-color` per instance via an inline style (`style={{ '--badge-color': color }}`). For holders the color comes from `holderColor(description)` (returns a single base color — canonical `--holder-*` per known size, stable-hash fallback, teal `--holder-default` for unknown); for presets from `presetMaterialColor(query, materials)` (the material's ISO-group color). Pass `undefined` when there's no color so the CSS default applies. This replaced the old approach where `holderColor` returned a `{bg,border,text}` object overriding all three inline and `.preset-tag` was a flat emerald token.

**`.dia` glyph utility**: the orange diameter symbol. Wrap the `⌀` in `<span className="dia">⌀</span>` everywhere a diameter renders inline (`ToolCard` meta badge, `QueuePanel`, `MatchStep`); the number/units stay neutral. `.dia { color: var(--orange); font-weight: 600 }`.

**Current usages:**
- `.description-badge` — `ToolCard` (grid + list), `ToolDetail` sticky header
- `.tool-id-pill` — `ToolCard`, `ToolDetail` sticky header, `AssemblyCard` operator tag (as `.tag-proshot-oval` — physical tag format exception)
- `.holder-pill` — `AssemblyCard`, `ToolDetail` (assembly groups, pending assembly, export picker), `PresetPanel` (single-assembly preset card)
- `.machine-num-badge` — `ToolCard` badge, `ToolDetail` Identity section (T/H/D)
- `.location-tag` — `ToolCard` badge (when location is set)
- `.preset-tag` — `AssemblyCard` linked presets, `AssemblyForm` matched presets, `PresetPanel` collapsed card, `DiffStep`/`CommitStep` new-preset rows

**Exception**: `AssemblyCard` uses its own `.operator-tag` / `.tag-box` / `.tag-proshot-oval` layout to match the physical shop tag format. That internal layout is intentional and is not subject to this rule.

-----

## Inline help — `InfoTip` (`src/components/InfoTip.jsx`)

**Universal rule**: when a piece of UI encodes a non-obvious rule, constraint, or quirk of an external system (Drive/Fusion/ProShop behavior, terminology, "why can't I just edit this," workflow gotchas) — put the explanation in an `InfoTip` right next to it, not in a permanent paragraph of body text. A short label is for people who already know what it means; the `ⓘ` is for the person hitting it for the first time, and it doesn't compete for visual space once they do.

- `<InfoTip text="…" alignRight={false} />` renders a small `HelpCircle` icon that reveals `text` in a hover tooltip (`.info-tip` / `.info-tip::after` in `src/index.css`). Pass `alignRight` when the tip sits near the right edge of its container so the popup doesn't clip off-screen.
- This is distinct from a `title=""` attribute (plain browser tooltip, used for short one-line action hints like sidebar buttons and topbar icons) — reach for `InfoTip` when the explanation is multi-sentence or explains *why*, not just *what*.
- **Current usages**: `DiffStep` (preset-matching categories, assembly detection), `Settings` (Google Drive metadata-file location semantics — why the location can't be changed in-app and how to actually move the file in Drive's own UI).
- Originally local to `DiffStep`; promoted to a shared component when `Settings` needed the same pattern. Reuse it rather than redefining a local copy or writing a standalone explanatory paragraph.

-----

## Google Drive — Shared Drive Support

The Google Drive metadata folder picker supports shared drives (team drives). Key requirements:

- **OAuth scope**: `https://www.googleapis.com/auth/drive` — NOT `drive.file`. The `drive.file` scope blocks `drives.list` and prevents browsing shared drive contents. Using `drive` is required for any app that needs to browse or create files in shared drives.
- **API calls**: All Drive API calls (`files.get`, `files.list`, `files.create`, `files.update`) must include `supportsAllDrives=true`. Folder listings also need `includeItemsFromAllDrives=true`.
- The folder picker in `MetadataConnect.jsx` shows a "Shared Drives" section above "My Drive" when shared drives are available. Clicking a shared drive navigates into it; the section header updates to show the drive name.
- **Connecting to an existing metadata file** — on every folder navigation, the picker runs `findMetadataInFolder` and `checkSharedFilesInFolder` in parallel alongside `listFolders` (no extra round-trip latency). If `tool_metadata.json` is found, a green callout appears with a ✓/— status line for `materials.json`, `vendor_registry.json`, and `shop_settings.json`. "Connect to this file" stores the file ID in localStorage via `connectToMetadataFile(fileId)` and completes setup. "Create here" checks for an existing file first — if one is found, it prompts to connect to it instead of silently creating a duplicate. The three shared files never need separate selection; they are auto-located from the metadata file's parent folder on every `loadTools`.

-----

## Tool File Attachments & Photos

Each tool can have a primary photo and a list of other file attachments (spec sheets, 3D models, Fusion files, etc.). Files are stored in Google Drive under the metadata root folder:

```
[metadata root]/
└── tool_files/
    └── {trackingId}/
        ├── photo.jpg
        ├── spec_sheet.pdf
        └── tool.step
```

- **Folder creation**: `ensureToolFolder(trackingId)` in `driveService.js` finds or creates `tool_files/{trackingId}/` under the metadata root. The `tool_files/` folder ID is cached in localStorage (`drive_tool_files_folder_id`). The cache key is cleared on `signOut()` via `localStorage.removeItem(TOOL_FILES_FOLDER_CACHE_KEY)`.
- **Upload**: `uploadToolFile(folderId, file, fileName)` uses the Drive multipart upload API.
- **Download/view**: `fetchFileBlob(fileId)` fetches a Drive file as a Blob (authenticated). For images, a Blob URL is opened in a new tab. **Do NOT revoke the Blob URL after opening** — the browser tab holds its own reference and may still be loading a large file; the URL is GC'd automatically when the tab closes. For PDFs, the Google Drive preview URL (`/preview`) is opened directly.
- **Delete**: `deleteToolFile(fileId)` sends a Drive DELETE. 404 is treated as success internally (already gone). Any error that reaches the AppContext `deleteToolAttachment` handler is a real failure and **must NOT silently proceed** to wipe the metadata record — that would orphan the file in Drive with no way to recover. The handler re-throws and shows a toast.
- **All Drive calls** must include `supportsAllDrives=true`. `fetchFileBlob` includes it.

### Metadata fields
- `primary_photo_id` / `primary_photo_name` — Drive file ID + filename of the primary photo. Stored in `tool_metadata.json` per-tool. Displayed in the Identity section of ToolDetail.
- `attachments[]` — array of `{ file_id, filename, type, uploaded_at }`. `type` is one of `photo | spec_sheet | model_3d | fusion_file | other`. Displayed in the collapsible "Files & Attachments" panel in ToolDetail.

### UI components
- `FilesSection.jsx` — collapsible panel showing the attachments list with view/download/delete per file.
- `AttachmentUploadModal.jsx` — upload modal supporting file picker, drag-and-drop, and clipboard paste. `photoMode` prop restricts to image types only.
- Photos are also uploaded via the Identity section's photo slot (not via FilesSection).

### Tool card
Each tool card receives a `data-photo-id` attribute when a primary photo exists — reserved for a future hover preview feature.

-----

## Hole-Making Tool Presets

Drills, reamers, taps, center drills, spot drills, counter bores, and counter sinks are **hole-making tools**. Boring heads are treated as **turning tools**, not hole-making. These categories affect preset fields and naming.

### Constants (`src/utils/presetNaming.js`)

```js
export const HOLE_MAKING_TYPES = new Set([
  'drill', 'center drill', 'spot drill', 'reamer', 'counter bore', 'counter sink', 'tap',
]);
export const TURNING_TYPES = new Set(['turning general', 'boring head']);
```

### Preset field behavior by tool category

| Category | Has op type? | Preset fields |
|---|---|---|
| **Milling** (all end mills, etc.) | Yes (Rough/Finish/etc.) | Full set: spindle/surface, cutting feed, feed/tooth, plunge, ramp, stepdown/stepover |
| **Hole-making** (drill, reamer, tap, etc. — excluding spot drill, see below) | **No** — `opType` forced to `null` | Fields the app **seeds/edits** — drills/reamers: spindle, surface speed, plunge (`v_f_plunge`), retract (`v_f_retract`), feed/rev (`use-feed-per-revolution`), coolant; taps: spindle, surface speed, coolant. But anything an incoming **Fusion** preset already carries (real exports for taps/drills often include the full milling-style feed set when values were entered) is **preserved, not deleted** — only `use-stepdown`/`use-stepover` (non-milling), `ramp-angle`/`n_ramp` (hole-making/spot), and `f_n` (tap/spot) are stripped, and no new step/feed expressions are ever added. |
| **Spot drill** (carve-out, see below) | **No** — `opType` forced to `null` | Milling-style cutting-feed set (cutting, feed/tooth, lead-in/out, transition, ramp feed) **plus** drill-specific plunge/retract feedrates and `use-feed-per-revolution`. **No** `f_n`, `n_ramp`, `ramp-angle`, stepdown/stepover. |
| **Turning** (turning general, boring head) | No | Spindle, surface speed, cutting feed (`v_f`), feed/rev (`f_n`), plunge, coolant |

`normalizePreset(p, tscCapable, toolType)` in `src/schema/toolSchema.js` is the single point that conditions preset fields by tool type — pass `toolType` whenever calling it.

### Spot drill preset carve-out

Confirmed from a real Fusion-exported spot drill: its presets are shaped like a **milling preset for feeds** (`v_f`, `f_z`, `v_f_leadIn`, `v_f_leadOut`, `v_f_ramp`, `v_f_transition`) **plus drill-specific** `v_f_plunge`, `v_f_retract`, `use-feed-per-revolution: false` — but **without** `f_n`, `n_ramp`, `ramp-angle`, `use-stepdown`/`use-stepover`/`stepdown`/`stepover`. Spot drill is the **only** exception to the Hole-making row above; it still has `opType` forced to `null` (it stays in `HOLE_MAKING_TYPES` for **naming** purposes — `composePresetName`, the "ASSEMBLY" section label, and hiding the Operation dropdown / Ramp spindle speed field).

This is implemented with an `isSpotDrill` flag (`toolType === 'spot drill'`), kept distinct from `isDrillFamily`/`isHoleMaking`/`isMilling` in three places:

1. **`normalizePreset`** (`src/schema/toolSchema.js`) — `isSpotDrill` is excluded from `isDrillFamily`/`isHoleMaking`/`isMilling`. It gets its own output branch writing the full field list above; `f_n` is deleted (not emitted), and the stepdown/stepover/ramp-angle/n_ramp deletions that apply to hole-making tools also apply to spot drill.
2. **`internalToFusionTool`** (`src/schema/toolSchema.js`) — `isSpotDrillTool` makes the flat-field sync gate `!isHoleMakingTool || isSpotDrillTool` (so `cutting_feedrate`/`feed_per_tooth`/`ramp_feedrate`/`lead_in_feedrate`/`lead_out_feedrate` sync for spot drill same as milling), and the expression-regeneration gates for `tool_feedCutting`/`tool_feedPerTooth`/`tool_feedRamp`/`tool_feedTransition` include `isSpotDrillTool`. `isDrillFamilyTool` (`isHoleMakingTool && !isTapTool`) **stays true** for spot drill, so the 3 drill-specific expression companions (`tool_feedRetract`, `tool_feedPerRevolution`, `tool_feedRetractPerRevolution`) and `tool_feedPlunge` are written exactly as for other drill-family tools.
3. **`PresetPanel.jsx`** — `CollapsedCard` and `EditCard` each compute `isSpotDrill = toolType === 'spot drill'`, exclude it from `isDrillFamily` (so the generic drill-family FEEDRATES section — which would show Feed/Rev — doesn't render), but include it in `isHoleMaking` (so naming/ASSEMBLY/Operation/Ramp-spindle-speed behave like other hole-making tools). It gets its own FEEDRATES section (Cutting, Feed/tooth, Lead-in, Lead-out, Transition, Ramp feedrate, Plunge, Retract). The `EditCard`'s initial `fx` (formula-link state) overrides `v_f_plunge` to `'manual'` for spot drill — `DEFAULT_FX`'s `v_f_plunge: 'formula'` derives it from `f_n`, which doesn't exist for spot drill and would zero out the loaded plunge feed on mount.

The same `HOLE_MAKING_TYPES` guard is applied in **three places**; keep them in sync if the set changes:

### Preset naming for hole-making tools

`composePresetName` is called with `opType: null` for hole-making tools — the name omits the ` - Rough`/` - Finish` suffix. Any legacy preset names with a ` - Rough` suffix on a hole-making tool are **stripped during `normalizeLibrary`** (the `opType` is forced to `null` and the name recomposed without it).

The same `HOLE_MAKING_TYPES` guard is applied in **three places**; keep them in sync if the set changes:
1. `normalizePreset` in `src/schema/toolSchema.js`
2. `normalizeLibrary` in `src/context/AppContext.jsx`
3. `handleConfirm` (conflict preset rename) in `src/components/MergeFlow/DiffStep.jsx`

### Left-hand taps

Fusion has a real `tap left hand` type (in addition to `tap right hand`). The app stores both under the internal type `tap`; the Fusion type on write is determined by `tool.cutting_direction`:

```js
// internalToFusionTool
const fusionType = tool.tool_type === 'tap'
  ? (tool.cutting_direction === 'Left Hand' ? 'tap left hand' : 'tap right hand')
  : (FT_MAP[tool.tool_type] || tool.tool_type);
```

On read, `fusionToolToInternal` sets `cutting_direction` from the raw Fusion type string for taps (not from `geometry.HAND`):

```js
cutting_direction: rawType === 'tap left hand' ? 'Left Hand'
  : (geo.HAND === false ? 'Left Hand' : 'Right Hand'),
```

### New Fusion preset fields for drills

- `v_f_retract` — retract feedrate (drill-specific). Already in `blankPreset()` as `0`.
- `use-feed-per-revolution` — boolean flag (drill-specific). Fusion uses feed/rev for drilling operations.

These fields are **never written for milling tools** — `normalizePreset` strips them for non-drill-family types.

### Preset editor formula links (`PresetPanel` `EditCard` `fx`) — never derive a field from an inapplicable source

The preset editor links paired speed/feed fields with a per-field `fx` state (`'formula' | 'manual'`): editing one field marks it manual and recomputes its partner (`computeFormulaDraft` on mount + on diameter/flute change; `handleNumChange` on each keystroke). The paired relationships are `v_c↔n`, `v_f↔f_z`, `v_f_plunge↔f_n`, and one-directional followers `v_f_leadIn/leadOut/transition = v_f` and **`v_f_retract = v_f_plunge`**.

**The trap:** a field defaulting to `'formula'` is recomputed from its source on open — so if that source isn't shown/used for the tool type (and is therefore 0), opening the preset **silently zeroes a real value**. `DEFAULT_FX` is the milling convention; other tool types need per-type overrides in `initialFx` (which the draft init must also use — not raw `DEFAULT_FX`). Current overrides:

- **Milling & spot drill** — plunge has no feed-per-rev (`f_n`) field, so `v_f_plunge:'manual'` (source of truth) + `f_n:'formula'` (derived). Without this, plunge was recomputed from the absent `f_n` (=0) on open **and** on every spindle-speed change, zeroing a proven plunge feed.
- **Turning/boring** — no feed-per-tooth (`f_z`), so `v_f:'manual'` + `v_f_plunge:'manual'`; the `n`/`v_c` cutting- and plunge-feed cascades in `handleNumChange` are skipped (`&& !isTurning`). Otherwise `v_f` was zeroed from `f_z`(=0) on open and on speed changes.
- **Retract feedrate** (`v_f_retract`, drill family + spot drill) — **defaults to the plunge feedrate and follows it** as plunge changes (mirrors Fusion's native `tool_feedRetract = tool_feedPlunge`), a one-directional follower like lead-in/out. A stored retract that already **differs** from plunge is treated as an override → `'manual'` on open so it's preserved; typing in the field overrides it. `setPlunge` cascades retract for the milling/spot-drill plunge fields (which use a plain setter, not `handleNumChange`). Added to `FORMULAS` + `FIELD_PRECISION` (`speedsAndFeedsCalc.js`). Not shown on other tool types (`v_f_retract:'manual'` there).

When adding a feed field or tool type, ask: *does this field's formula source exist for this tool type?* If not, default it `'manual'` in `initialFx` and skip its `n`/`v_c` cascade. These are **UI-only** functions — the round-trip audit doesn't exercise them, so `normalizePreset`/`internalToFusionTool` remain the authority on what's actually written per type.

### Tap & thread mill metadata fields

All metadata-only (never written to Fusion) — added to `tool_metadata.json` via `buildMetadataTool` / `mergeFusionAndMetadata`:

- **`tap_sub_type`** (`'cut' | 'form'`, **no default** — stored as `''` when unset) — 2-way chip on the tap page. The view renders "—" when empty; the edit toggle has no pre-selected state. **Never default to `'cut'`** — a form tap imported before this field was set would be mis-labelled. An independent **`is_sti`** boolean (STI/Helicoil thread-insert tap) sits alongside it — a tap can be both an STI tap and a cut or form tap, so this is no longer a 3-way cut/form/sti group. Boolean metadata fields like `is_sti` (and `tsc_capable`) automatically get correct Yes/No facet options — `searchEngine.js`'s boolean-facet handling is generalized to any `type: 'boolean'` registry field, not hardcoded.
- **`point_type`** (`appliesToTypes: ['tap']`) — dropdown: Bottoming / Modified Bottoming / Plug / Taper / Spiral Point / Spiral Flute. **Tap-only** (previously also shown for drill/center drill/spot drill/counter sink — narrowed to taps only).
- **`tip_to_first_thread`** — the Z distance from the tap's tip to where the first full thread starts (chamfer length). `canonicalUnit: 'native'` like other lengths — stored in the tool's own unit, no conversion needed within a tool. ProShop column: `Tip to 1st Full Thread` (export id `tipTo1stFullThread`) — see ProShop Field Priority Rules.
- **Thread mill capability fields** (`appliesToTypes: ['thread mill']`): `tpi_min` / `tpi_max` — the TPI range the mill can cut, distinct from `pitch` (the specific thread designation it's set up for) — and `thread_profile_angle` (degrees).

### ProShop Thread column parsing (`resolveThreadSize` / `threadKey`)

ProShop exports thread designations without UN-series suffixes and encodes STI/Helicoil as an inline token. The app normalizes both sides so they match:

- **`threadKey(s)`** (`src/schema/toolSchema.js`) — strips `unc`/`unf`/`unef`/`uns`/`un` and whitespace/`#` to produce a comparison key. Used on both sides of any thread match (ProShop import and any future lookup).
- **`resolveThreadSize(raw)`** (`src/schema/toolSchema.js`) — parses a raw ProShop Thread value:
  - Detects and strips `STI` / `Helicoil` tokens → sets `is_sti: true`
  - Detects metric threads (`M<n>` prefix) → sets `thread_unit: 'metric'`
  - Normalizes via `threadKey` and matches against `INCH_THREAD_SIZES` / `METRIC_THREAD_SIZES` to find the canonical list entry (restoring the UNF/UNC suffix we store)
  - Returns `{ pitch, is_sti, thread_unit }` — spread directly onto the tool object
  - Called with `r['Thread'] || r['Pitch'] || ''` (ProShop uses the `Thread` column; some exports use `Pitch`)
- **`flute_design`** (`fieldRegistry.js`) — `appliesToTypes` excludes `tap` (`NO_TAP` constant). Taps don't have a flute design field.
- **`tap_thread_unit`** controls which thread-size list the UI shows (inch or metric). It is **independent of the tool's overall Fusion unit** — the tool's geometry stays in whatever unit it was created in; this field only determines which thread-designation dropdown appears (`INCH_THREAD_SIZES` vs. `METRIC_THREAD_SIZES`). **It must be present in `THREAD_FIELDS`** (`src/schema/toolFieldLayout.js`) — `ThreadBlock` in `ToolFields.jsx` gates the Inch/Metric toggle on `has('tap_thread_unit')`, where `has` checks that list. If it gets dropped from `THREAD_FIELDS` the toggle silently disappears and the metric thread list becomes inaccessible.

-----

## Data Migration / Backwards Compatibility

**Do not write backwards-compatibility code.** The tool library data has not been fully migrated to this app yet, so there is no live data to protect. When a field changes shape or a new field is added, update the code for the new shape only — do not add migration shims, `|| ''` fallbacks for renamed fields, or dual-read logic for old vs. new formats. If existing stored data needs updating, that will be handled as a deliberate one-off migration step, not silently in the app code.

-----

## Code Standards

- **Pretty-print all JSON written to Google Drive.** Every JSON file persisted to Drive (`tool_metadata.json`, and any future Drive JSON) must be serialized with `JSON.stringify(data, null, 2)` — never compact/single-line. These files need to be human-readable for debugging directly in Drive. All metadata writes route through `driveCreate` / `driveUpdate` in `src/services/driveService.js`, which already do this; keep it that way and apply the same to any new Drive-file write. (This applies to **file content** only — Drive API request bodies like upload metadata or folder-create payloads can stay compact.)

- **Never hardcode field paths outside `fieldRegistry.js`.** New code must reference a field's Fusion path / ProShop column / type / applicability through `FIELD_REGISTRY` (and its helpers) — do not introduce new hardcoded `geometry.*` / `expressions.*` / ProShop-column literals elsewhere. The registry is the single source of truth for field metadata. **Known existing exceptions** (the Fusion converter in `toolSchema.js`, the ProShop export in `tool-extractor.tsx`/`proShopExport.js`, and `FIELD_VISIBILITY`) predate this rule and are tracked in `SCHEMA_AUDIT.md` (FR1–FR4) for a deliberate, audit-guarded refactor — don't add to them.

- **Never substitute default values for missing fields in descriptions.** `buildDesc` (`src/utils/toolNaming.js`) and any description/name generator must **omit** an absent field, not invent a value — e.g. a tool with no material set must not print `CARB` (don't fall back to `"carbide"`); a missing angle/corner-radius/LOC is left out, not zero-filled. A blank field means "unknown," and the description must not claim otherwise. (This is distinct from the **preset-name** convention's documented `GEN` material fallback in `composePresetName`, which is intentional — see Preset naming convention.)

- **`materials.json`, `vendor_registry.json`, `shop_settings.json`** live in the same Drive root as `tool_metadata.json` and are loaded at startup (in parallel, created from their defaults if missing). See **Shared Drive Files** below.

- **ISO material group IDs (P, M, K, N, S, H)** are the canonical material identifiers used in preset color coding (`materials.json`).

- **`vendor_registry.json` uses a single unified entity list** — `is_manufacturer` and `is_vendor` flags determine an entity's role, not separate manufacturer/vendor arrays.

- **Design new data structures with a future SQLite migration in mind.** The app currently stores data in Fusion JSON + Google Drive JSON files, but the data model is intentionally relational. When adding new entities or relationships: use **stable UUIDs** (not positional indexes or derived keys), prefer **normalized shapes** (foreign-key references rather than embedded copies), and keep IDs that a relational table would naturally separate from IDs it would join on. You don't need to over-engineer for SQL — just don't make choices that would require years of untangling to move to a database later. The existing patterns (tracking IDs, assembly UUIDs, `purchasing.manufacturers[]/vendors[]`, location system `zone/station/drawer/bin` UUIDs) are the model to follow. See **TODO / Future Work → SQLite migration** for more context.

-----

## Key Constraints

- **Tool IDs are permanent** — they are the Fusion `guid`, link the two JSON files, and are referenced in merge history. Never reassign them.
- **APS token in memory only** — `window._apsToken`, never localStorage. The refresh token is stored in `sessionStorage` (`aps_refresh_token`) so the session survives page refreshes within the same browser tab.
- **Always re-download before write** — call `downloadFusionList()` immediately before any `uploadFusionList()`.
- **No extra fields in Fusion JSON** — Fusion validates strictly. Only Fusion-native fields go in the library file; everything else goes in `tool_metadata.json`. Exception: `geometry.assemblyGaugeLength` is a Fusion-native field (nested in `geometry`; = holder gauge length + OOH, not OOH alone), safe to write.
- **`tool_id` is the primary match key** — it is **metadata-owned** (source of truth in `tool_metadata.json`), mirrored to Fusion's `product-id`; metadata wins on read, falling back to `product-id` for pre-TMS tools. There is no separate `product_id` field — manufacturer part numbers live per-manufacturer in `purchasing.manufacturers[].edp` (see Purchasing / Vendor Data Model).
- **Every length is stored in its record's own unit** (tool lengths in the tool's unit, holder gauge in the holder's unit) — OOH/min_ooh included. Convert only at cross-unit boundaries via `src/utils/units.js` (`convertLength`); never to a hidden inches canonical.
- **Preset GUIDs are stable through the merge flow** — `presetsToAdd` GUIDs must not be regenerated after DiffStep. The assembly record in CommitStep uses them.
- **Conflict presets must get a new GUID** — when a conflict preset is resolved as 'create', the incoming preset's GUID matches the master, so `generateId()` must produce a fresh one.
- **GitHub Pages = HashRouter** — never switch to BrowserRouter.
- **ProShop export is permanent** — never remove `proShopExport.js` or the export buttons.
- **Speeds & feeds display**: round to 4 decimal places for display using `round4()` — values are stored at full precision.
- **Deployment is automated via GitHub Actions** — do NOT run `npm run deploy` from agent/cloud/CI sessions. See the Deployment section above.
- **Google Drive scope must be `drive`** — do not downgrade back to `drive.file`; it breaks shared drive browsing.
- **Library wrapper preserves `version`** — the Fusion library file on disk is `{ "data": [...], "version": 36 }`. `downloadFusionList` / `uploadFusionList` in `AppContext.jsx` cache all wrapper-level fields (other than `data`) via `libraryWrapperRef` and write them back on every save. Never reconstruct the upload payload as bare `{ data: list }` — stripping `version` can make Fusion treat the file as incompatible and reassign GUIDs or lose holder links.
- **Orphaned metadata is harmless but permanent** — when a tool is deleted directly from Fusion 360 (outside the app), its `tool_metadata.json` entry persists indefinitely; no prune/cleanup pass exists anywhere. Only `deleteTool` (via the app UI) removes the metadata record. This is safe because `generateTrackingId` (`FTL-` + random 6-hex-digit, ~16.7M values) and `generateId` (random UUID) have effectively zero collision probability — a brand-new tool will never accidentally inherit an old deleted tool's stale metadata. Orphaned entries accumulate silently but cause no functional harm.
- **Missing/trashed metadata file is surfaced, not silent** — a deleted metadata file 404s, and a **trashed** file still reads and writes through the Drive API, so the app would otherwise keep saving notes/tags/photos into a file sitting in the trash (and a 404 looks identical to "no metadata"). `getMetadataFileHealth()` (`driveService.js`) checks the linked file's `trashed` flag + existence on every `loadTools`; the result drives `state.metadataFileWarning` (`null | 'missing' | 'trashed'`) and a red `MetadataFileBanner` (`App.jsx`) pointing the user to Settings to relink/recreate. The check is best-effort (an inconclusive error reports healthy — never a false alarm), and **moving** a file within Drive keeps its ID, so it still loads and correctly raises no warning. **Tool file attachments live under the metadata file's parent** (`tool_files/{trackingId}/` via `ensureToolFolder`/`getMetaParentFolderId`), so if the metadata file is deleted/recreated elsewhere, previously-imported photos stay in the old parent's `tool_files` folder — re-running the import re-copies + relinks them against the current file.

-----

## TODO / Future Work

- **Speeds & Feeds Reference — link to stepdown/stepover as a %.** Each tool carries `speed_feed_refs[]` (metadata-only: `{ preset_id → materials.presets, operation_type (rough/finish/… or null), sfm, chip_load }`) — a per-CAM-preset + per-operation SFM + chip-load starting-point table, edited in `SpeedFeedSection.jsx` (a panel in ToolDetail's left column, same save pattern as `PurchasingSection`). The material cell opens the shared **`CamPresetPicker`** modal (search "6061"/"1018" → its CAM preset), the operation is an `OP_TYPES` dropdown, and the Save button shows a `.spinner` while the `writeLogicalTool` round-trip is in flight (it's a local `saving` state, not the global `isSaving`). The section shows derived RPM + feed per row using the tool's own diameter + flute count (`deriveRPM`, generic over the tool's unit; feed via chip_load × rpm × flutes). **Next step (deferred):** express stepdown/stepover as a % (e.g. of diameter) and connect them so the reference drives full proven preset values rather than just SFM/chip-load — the user explicitly scoped this for later. These values are a manual starting point today; a future path could also pull from existing Fusion presets.

- **Local mode, phase 2 — full edit with manual re-export.** Today's local browse mode (see above) is read-only. A bigger follow-up: allow editing/saving everything in-memory while in local mode (tools, presets, assemblies, metadata), plus a "Download updated library" button that produces a new `fusion_tool_library.json` (and `tool_metadata.json` if applicable) for the user to manually re-upload to Autodesk/Drive themselves. **This is a big ask** — `writeLogicalTool`, `saveFullLibrary`, `renumberLibrary`, `deleteTool`, `addTool`, `normalizeLibrary`, and the whole Phase 2 merge flow all currently assume `uploadFusionList`/`downloadFusionList` hit APS; each would need a local-mode branch that mutates `toolsRef`/state in place and marks the library "dirty" instead of calling APS, plus export/download plumbing for the edited JSON. Confirm scope before starting.

- **SQLite migration (future, no audit needed now).** The current storage layer (Fusion JSON in APS + `tool_metadata.json` on Drive) works for the shop's scale, but several data structures were deliberately designed with a future SQLite backend in mind: stable UUIDs at every entity level (`tracking_id` FTL-XXXXXX, assembly `assembly_id`, vendor/material/machine `id`s, location system `zone.id`/`station.id`/`drawer.id`/`bin.id`), normalized relational shapes (`purchasing.manufacturers[]` / `purchasing.vendors[]`, `assemblies[]` with a foreign-key `instance_guid`, `preset_meta` keyed by GUID, `speed_feed_refs` with a `preset_id` FK), and parent-id chains in the location hierarchy. **No code audit or migration work needed now** — just keep this in mind when adding new data structures: prefer stable UUIDs over positional indexes, avoid denormalized blobs when a normalized join table would be cleaner, and don't collapse IDs that a relational row would naturally separate. The goal is that a future migration produces clean tables, not a years-long untangling.

- **"No Fusion Link" tools shouldn't need a Fusion entry at all.** Currently `no_fusion_link: true` is just a reminder flag (`src/components/ImportFlow.jsx` `psRowToTool`) — every logical tool, flagged or not, still gets a real placeholder entry written into the Fusion library on save (`saveFullLibrary` → `splitToFusionInstances`, which always emits ≥1 instance). So a ProShop row with no Fusion match still creates a brand-new (mostly-empty) entry in the shared Fusion library immediately on import/normalize. ImportFlow's Review step now warns about this before saving (see `newPlaceholderCount`), but the underlying behavior is unchanged. **This is a big ask to fix properly** — it means supporting logical tools with **zero** Fusion instances (metadata-only, "not in Fusion yet"), which breaks the "every instance is a real Fusion tool entry, minimum 1" assumption used throughout `writeLogicalTool`, `saveFullLibrary`, `groupByTrackingId`/`buildLogicalTool` (which currently builds `tools` state *from* Fusion instances), and reconcile. Likely belongs alongside the local-mode/no-Fusion-connection work above — both need a "tool exists in our app but not in Fusion (yet)" state. Confirm scope before starting.
