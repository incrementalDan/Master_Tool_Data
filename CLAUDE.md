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

## ⚠️ Running the app in an agent / cloud / CI session — READ BEFORE `npm run dev` OR `vite build`

**There is NO `.env` file in an agent session. There never has been, and there never will be.** The keys live on the developer's machine and in GitHub Actions Secrets (see API Keys & Secrets). This is not a broken setup and there is nothing to diagnose.

**What that causes, every time:** `App.jsx` gates on `VITE_APS_CLIENT_ID` / `VITE_APS_CALLBACK_URL`, and Vite substitutes `import.meta.env` at **build time**. With those unset the gate is a compile-time constant, so:
- `npm run dev` and `vite build` render **"Configuration Required"** and nothing else.
- The built bundle is React + vendor code with the **entire app tree dead-code-eliminated** — grep it for any app string (`modal-backdrop`, a class name, a component) and you get zero hits, and its byte size does not change when you add a component.

⚠️ **DO NOT INVESTIGATE THIS. It is expected, and it has cost real time more than once.** It means only one thing: `vite build` verifies *that the code compiles*, nothing more. **`npm run lint` and `npm test` are the real gates.**

### To actually SEE the app — demo mode

`?demo=true` runs the whole UI against bundled sample data (`src/demo/`) with no Autodesk or Drive connection. **This is how you look at anything visual** — a new screen, a layout, a drawing, a banner. Do not settle for reasoning about markup you rendered to a string.

Pass the two vars **on the command line**. This satisfies the gate for one process and leaves no file behind — ⛔ never create, modify or recreate `.env`, `.env.local` or any other env file:

```bash
VITE_APS_CLIENT_ID=demo-local-only \
VITE_APS_CALLBACK_URL=http://localhost:5173/Master_Tool_Data/ \
  npx vite --port 5173
# then open  http://localhost:5173/Master_Tool_Data/?demo=true#/
```

Chromium + Playwright are available in the cloud container for driving and screenshotting it (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; Playwright itself is a global install, so import it by absolute path rather than from the project's `node_modules`). Search the library, open a tool, click the thing, screenshot it — that is what caught the tool-profile drawing being 89% empty shank.

⚠️ **If a feature is invisible in demo mode, that is a gap to FIX, not to work around** — add the case to `src/demo/*.json` and assert it in `demo.test.js`, the way `A-265` (the one demo tool with shaft segments) exists so reach, undercut and the Tool Profile can be seen at all.

**Never run `npm run deploy` here** — see Deployment.

-----

## Before you say "done" — check the diff against these

**Eight questions, run against your own changes before reporting them finished.** Every one is here because it has ALREADY caused a real bug in this repo — none are aspirational, and each names what it caught so it can't be waved off as theory. Keep this list short: a checklist that grows past ~8 stops being run, exactly like a flag that fires too often becomes wallpaper.

The rest of this document explains **decisions**. This section is the only part meant to be run as a **test on your own diff**.

**1. Does Fusion have a field for anything I touched?**
If yes — does my code write it *there*, not just to metadata? (See "If Fusion has a place for it, Fusion must have it".)
→ *Caught: linking tools to holders stored `holder_id` and left half the library carrying wrong holder geometry in Fusion.*

**2. Every Fusion-native field I wrote — did I write its expression too?**
Fusion re-derives the native value from the expression on load, so a stale expression silently undoes the write. **Delete** the expression when the value is empty; never write `''`. And no app-only field may leak into the Fusion JSON. (For a field pushed on its own, the pair belongs in `FUSION_FIELD_PATCHERS` — see **Pushing ONE field to Fusion**.)
→ *Caught: `product-id` reverting on 4 holders; the recurring stepdown/stepover flag; OOH silently reverting.*

**3. What happens on the second run?**
Same input twice — does the second report nothing to do? **This is the highest-value question in the list.** Nearly every bug the user has had to find was invisible on one pass and obvious on two.
→ *Caught: the holder GUID ping-pong; "N refreshed" inflated by float round-trip noise.*

**4. Is every link I store an ID?**
⚠️ **NOT A JUDGEMENT CALL — there is nothing to weigh.** A link stores a stable, database-ready id: a UUID, a tracking id, or a config slug. Never a ProShop number, a description, a location, a machine number, or any other human-facing value — every one of those is **mutable by design** (a ProShop number is re-numberable; that is what `legacy_ids` is *for*), so a link built on one severs itself the first time the shop renumbers or renames anything. If a request says "link them by the ProShop number", that means *look it up* by ProShop number and *store the id*. Am I recovering a relationship by parsing a formatted name, or by trusting a foreign system's GUID? (See "Relational integrity — every link is an ID".)
**Enforced, not remembered:** `relationalIntegrity.test.js` scans the whole metadata record and fails on any link-shaped field holding a human identifier — **including a field that doesn't exist yet**. If it fails on a field you just added, that is the check working; register it and confirm it holds an id.
→ *Caught: presets orphaned by an OOH rename; three holder queries keyed on Fusion's GUID, silently covering a fraction of the tools; `selected_holder_guid` missing from the inventory entirely.*

**5. Can this fail and still look like it worked?**
Write first, then update memory. No silent no-ops. A bulk save must **merge**, not replace.
→ *Caught: `applyHolderPushPlan` keyed on object identity doing nothing; linking claiming success after a failed Fusion write.*

**6. Whose unit is each number in?**
- Every length is in **its own record's** unit — a tool's in `tool.unit`, a holder's in `holder.unit`. There is **no hidden inches canonical**. Convert only at a genuine boundary (tool↔holder, ProShop file→tool), always via `convertLength`.
- The **shop default** (`shop_settings.default_units` → `getDefaultUnit()`) is a default for **new** records and a fallback **display** unit. It is **never** the unit of an existing record — reading it to interpret a stored value is always wrong.
- A field can carry its **own** unit, independent of the record's: `tap_thread_unit` (a **metric tap on an inch-unit tool** — the thread designation list is metric while the geometry stays in inches), and `input_was_mm` (an inch-stored tool deliberately **named** in mm). Never infer either from `tool.unit`.
→ *Caught: a test subtracting 2 **inches** from a millimetre holder; ProShop `min_ooh` imported without converting from the file's unit.*

**7. Would this be right in an mm-default shop?**
The app must be correct for a metric shop, not just ours. Five places inches hide:
- **Hardcoded unit suffixes** — `" in"` in a Fusion expression. Fusion parses the number *through* the suffix, so `"5 in"` on a mm tool loads as 127mm. Derive `lenUnit` from the record.
- **Unit-dependent formulas** — `rpmToSFM`/`sfmToRPM` divide by **12** (in, ft/min) or **1000** (mm, m/min). Omit the flag and a metric tool's surface speed is off by ~83×. (Feed relations are unit-independent — only `v_c`↔`n` is not.)
- **Tolerances and epsilons** — `lengthEps`, `snapTol`, `PRESET_SIGNIFICANCE`'s `len: true` floors, `readAboveGaugeFlags`. An inch-sized tolerance is 25× too loose in mm.
- **Display precision and labels** — 4 decimals inch / 3 metric; `fieldLabel(field, unit)` for the `(in)`/`(mm)` suffix.
- **Inch-only reference charts** — drill numbers and fractions. A metric tool must not snap to `1/16`.
→ *Caught: a `.0571"` (1.45mm) tool falsely snapping to "1/16", which ALSO suppressed its metric label; `EditCard` having to pass `isMetricTool` into the speed cascade.*

**8. If I added a flag or banner — can the user make it go away?**
Does the action that fixes it actually stop the detector firing? A flag that re-fires after it's been dealt with is a nag loop.
→ *Caught: Normalize permanently disabled by a gate that could never be satisfied; the "assembly numbers corrected" flag that couldn't be saved away.*

**What this does NOT catch:** "I misunderstood what was actually wanted." No checklist reaches that — it's why an explicit adversarial pass ("what's broken about what you just built?") stays worth asking as its own turn.

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

`<MaterialCode> <OOH> <HolderDescription> - <Operation>[ <StrategyLabel>]` — e.g. `SS 2.125 NBT30-SK13C-60 - Rough` or `SS 2.125 NBT30-SK13C-60 - Finish Adaptive`. (Names composed before the short form was retired read `SS 2.125 30-SK13-60 - Rough`; they are deliberately NOT rewritten — see the holder-name rule below.) The name is a **durable reference** to the preset's assembly + operation — the LINK is `preset_meta.assembly_id`. Helpers in `src/utils/presetNaming.js`: `composePresetName`, `parsePresetName`, `presetMatchesAssembly` (seeds the FK for a preset that has none, matching the holder token — tolerant of the retired short form via `holderTokensMatch` — and the OOH within 0.0005 in), `OP_TYPES`/`opTypeWord`/`matchOpType`.

**Intensity prefix + strategy label (new-format milling only)** — for a **new-format** preset (has a `strategies` object), `composePresetName` wraps the operation word with two optional pieces: an **intensity prefix** in FRONT (the intensity meter: light → `Fine`, aggressive → `Fast`, normal → nothing) and a short **strategy token** after (`presetStrategyLabel`, `src/schema/camStrategies.js`): the selection is exactly a quick **group** → its short `nameToken` (`Adaptive`/`Facing`/`3D`/`Engrave`); **one** strategy → that strategy's name (`Bore`, `2D Contour`); exactly the **two pinned picks** (2D Contour + Bore) → both (`2D Contour + Bore`); **anything else** (2+ arbitrary strategies) → nothing (the user names it by hand). So a name reads `SS 2.125 NBT30-SK13C-60 - Fine Finish 3D`. `nameModifier` (the badge) mirrors the same Fine/Fast. `EditCard.composeName` passes the just-changed selection/intensity so both track live; `setIntensityVal` recomposes the name on meter change.

**Small bore replaces the operation tail.** A small-bore preset already implies a fine finish, so `composePresetName`'s `smallBore` flag emits **`SM Bore`** in place of the intensity word + Rough/Finish word + strategy label (which would otherwise read "Fine Finish Bore"). `SM Bore` is an existing `OP_TYPES` alias for `small_bore`, so old-format names still parse back correctly; a new-format preset reads its bucket, so nothing is corrupted. The toggle recomposes the name (passing `on` explicitly — the draft hasn't settled).

**Auto-name vs. hand-typed name — and never going stale.** `composeName` is a **live preview** that rebuilds the name on every material / assembly / operation / intensity / strategy change, so a hand-typed name must be protected or an unrelated edit silently wipes it (this matters most for the documented "2+ arbitrary strategies → name it by hand" case). `EditCard` tracks **`nameManual`**, and every auto-rename path goes through **`nextName`** (not `composeName` directly), which is a no-op while it's set. A **↺ Auto** button appears whenever it's on to resume auto-naming; a **just-created** preset is exempt via the `isFresh` prop (`freshGuidRef`, cleared on save/cancel) so its `"New Preset"` / `"… (copy)"` placeholder isn't mistaken for a custom name.

**The open-time check is STRUCTURAL, not an equality test** (`isAutoPresetName`, `presetNaming.js`). Comparing the stored name to the currently-composed one can't tell "custom" from "stale": an auto name goes stale the moment anything it's built from changes (a **Fusion-side edit**, a renamed CAM preset, a different OOH), and a stale auto name looks exactly like a hand-typed one — which would freeze it as `nameManual` forever. Instead the name's **shape** is checked: a `" - "` tail built only from tokens the composer emits (optional `Fine`/`Fast`, an `OP_TYPES` word, an optional label from `ALL_STRATEGY_LABELS`; or a standalone `SM Bore`) is **ours** → refreshed silently on open (no `touch()`, so opening doesn't mark the preset dirty; the corrected name persists on the next save). Anything else (`"… - Rough Job 1042"`, a legacy `"AL FIN"`, free prose) is **the user's** → `nameManual`. So a preset re-synced from Fusion self-corrects its name, while custom names survive.

**Old → new format conversion translates the old op-types.** `rough_fast` / `fine_finish` / `small_bore` are the OLD way of saying what the intensity meter + Small Bore toggle say in the new format, so `convertToNew` maps them (`OLD_OP_TO_NEW`): `rough_fast` → roughing + `aggressive`, `fine_finish` → finishing + `light`, `small_bore` → finishing + the Small Bore toggle, then recomposes the name. Related: **`opTypeToBucket` must treat `rough_fast` as roughing** — a bare `op === 'rough'` test sent it to *finishing*, so an old Rough Fast preset opened (and converted) as a Finish preset.

**Intensity is NEW-format; the old `rough_fast`/`fine_finish`/`small_bore` op-types are OLD-format — they don't coexist.** A new-format preset's `operation_type` is its strategy **bucket** (always `rough`/`finish`); the intensity lives in `preset_meta.intensity`. The `Fine`/`Fast` prefix is **display-only** — it must NOT parse back into the old `fine_finish`/`rough_fast` op-types (which would double up to "Fine Fine Finish"). So `overlayPresets` (`logicalTools.js`) resolves `operation_type` **by format**: a new-format preset reads its **bucket** (`readStrategyBucket` → rough/finish), never the name; an **old**-format preset (no `strategies`) still parses the name via `parsePresetName` (preserving `rough_fast`/`fine_finish`/`small_bore`) exactly as before. Locked by `logicalTools.test.js`.

⚠️ **A holder has ONE name: its DESCRIPTION.** There is no short name any more — the abbreviated form (`30-SK13-60` for `NBT30-SK13C-60`) is retired, along with the strip-`NBT` / drop-the-`C` regexes and the override map that produced it. The app owns the holder library, so the description IS the holder's identity, and deriving a second spelling meant the same holder appeared two ways depending on where you looked. `holderNameToken(description)` (`src/utils/holderNaming.js`) is the seam every composed name goes through; it returns the description verbatim.

⚠️ **Names ALREADY STORED keep the old spelling and are deliberately NOT rewritten** — a preset name and an `asm_number` are a *reference*, not a link (the real links are `preset_meta.assembly_id` and `assembly.holder_id`), so stale spelling costs nothing and a mass rename would have re-derived 283 of 302 assembly numbers and 69 of 335 preset names at once. `holderTokensMatch(a, b)` normalises the retired form on BOTH sides so the two spellings compare equal; it is a **comparison tolerance, never a name generator** — nothing composes from it. Three places depend on it, and each would misbehave loudly without it: `presetMatchesAssembly` (seeds `assembly_id` for a preset with no FK — every legacy preset would stop matching), `backfillAsmNumbers` (where it now gates only the BANNER, not the compare — see below), and `shouldRetireAsmNumber` / `updateAssembly` (would retire every old-spelling Auto number into `legacy_asm_numbers`, the searchable list meant for real ProShop RTA numbers). `operation_type` is stored on the in-memory preset and cached in metadata (`preset_meta`), but is **never written into the Fusion JSON** (Fusion validates strictly) — it lives in the name. On import, operation_type is parsed from the name; the name wins on conflict.

**Auto-name builds incrementally**: `composePresetName` tolerates missing pieces — `materialQuery`, `ooh`, `holderShort`, and `opType` can each be `null`/absent, and the name is composed from whatever is filled in (blank pieces are filtered before joining — including the material, which contributes **no token at all** when it resolves to nothing, so the name simply starts at the OOH). `EditCard.composeName` (`PresetPanel.jsx`) no longer early-returns when there's no linked assembly or no operation type selected — the live preview updates as soon as *any* relevant field is set, instead of waiting until everything (incl. a holder) is filled in.

**Legacy bare-word preset names — whole-name fallback**: many pre-migration presets don't follow the convention at all; the entire name is just the operation word/abbreviation (e.g. `"Rough"`, `"R"`, `"Finsh"`, `"SM Bore"`). `parsePresetName` first tries `matchOpType` on the tail after `" - "` (the normal convention); if that yields nothing (no separator, or the tail doesn't match), it retries `matchOpType` against the **whole trimmed name**. This lets `normalizeLibrary` auto-assign `operation_type` for these bare names instead of prompting the user in `NormalizeModal`. `OP_TYPES`'s `finish` aliases include `'FINSH'` (a common misspelling) alongside `FINISH`/`FIN`/`F`. Covered aliases: Rough ← `R`/`Rough`/`Roughing`; Finish ← `FIN`/`F`/`Finish`/`Finsh`/`Finishing`; Small Bore ← `SM BORE`/`SM HOLE`/`Small Bore`/`Small Hole`. Add new aliases to `OP_TYPES` (`src/utils/presetNaming.js`) rather than special-casing strings elsewhere.

**Embedded-token op-type scan**: real Fusion preset names carry the operation as one token among others — `"AL FIN"`, `"BRZ ROUGH"`, `"AL SM BORE"`, `"GF Nylon Fine Finish"`, `"AL-150-FIN"`. The whole-name/`" - "` matches above miss these, so `parsePresetName` has a final fallback to `scanOpTypeInName` (`src/utils/presetNaming.js`): split the name on spaces **and** dashes, match op aliases as standalone tokens (single-letter `R`/`F` never match inside a word like `BRZ`), **longest alias first** so `Fine Finish` beats `Finish` and `SM HOLE` (small bore) beats a trailing `FIN`.

**Material comes from the Materials library** (`materials.json` — see Shared Drive Files): it is the **single source of material in the app**, a **3-tier taxonomy** — ISO **groups** (P/M/K/N/S/H) → **CAM presets** (the speed/feed preset name pushed to Fusion, carrying each standard's code: ISO 513 / Kennametal / Haas-VDI 3323) → **materials** (individual alloys, each with `aliases[]` for "look it up by the name we know it by" and a `preset_id` linking up to a CAM preset). The preset material picker in `PresetPanel` (`EditCard`) is a single **Material field** that opens the **`CamPresetPicker`** modal — a compact, read-only "mini Materials page" (search + color-coded group pills + the same rich CAM-preset rectangles, sourced from `state.materials`). Search matches a CAM preset's own fields **and its alloy names/aliases**, so typing `6061`/`1018`/`316L` surfaces the right CAM preset; or browse the group pills. Selecting a card links the preset to that CAM preset; the field's `×` clears it. ("Filter by type" — metal/plastic/all — is a separate Fusion-native field next to it.) The old hardcoded `MATERIALS` / `MATERIAL_QUERY_MAP` list in `PresetPanel` was removed.

**The link is a stable ID, the name is derived (foreign-key pattern — store the id, render the name).** A tool preset stores the CAM preset's **stable id** in an app-only **`material_preset_id`** (metadata-only, in `preset_meta` alongside `machine_id` — never written to Fusion), NOT the mutable display name. Renaming a CAM preset in the Materials editor therefore never orphans the presets pointing at it — the name shown (and the name pushed to Fusion via `material.query` / `stock-materials`) is always resolved **live from the id** against `state.materials`. This mirrors how locations/jobs/machines store ids and compose their label at read time. Helpers (`src/utils/presetNaming.js`): `findCamPresetById`, `camPresetIdForQuery` (id from an exact CAM-preset-NAME query only — not alloy/group/legacy codes), `syncPresetMaterialName(preset, materials)` (refresh `material.query` + `stock-materials` from the id; also **adopts** the id from a name-matched query so pre-existing name-only links become rename-proof; **tolerates a dangling id** — keeps the stored name), and `backfillMaterialPresetIds(tools, materials)` (load-time walk, mirrors `backfillAsmNumbers` — called at all `loadTools` build sites + demo; persisted lazily on each tool's next save). `PresetPanel` renders a `resolvedPresets` (= `presets.map(syncPresetMaterialName)`, `useMemo` on `[presets, materials]`) so a rename reflects **immediately** without reload, and emits the resolved list on every save so Fusion's stored name catches up per-tool. `CamPresetPicker.onSelect` stamps `material_preset_id = cp.id` (+ `material.query`/`stock-materials` from `cp.name`); `clearMat` drops all three; the ref-seed at blank-preset creation sets it too. `normalizePreset` pulls `material_preset_id` out of the preset before the Fusion write (app-only). **Legacy/imported material strings** that aren't a real CAM preset name (group labels like `"Stainless Steel"`, alloy names, `"AL FIN"`) keep resolving by name via `findMaterialInLibrary` exactly as before — they get no id and are left untouched. Backwards-compatible/additive (no re-entry); the only case needing a re-pick is a CAM preset that was **already renamed before** this feature captured its id (the old name in `material.query` can no longer be matched) — that case is **surfaced, not silent** — but first, **grade-based auto-linking resolves most of it silently**: the shop's legacy strings carry the alloy GRADE (`"AL 6061"`, `"SS316 FIN"`, `"17-4 PH"`, `"303/416"`), and every grade already lives in the Materials library as an alloy with a `preset_id`, so **`camPresetIdFromGrade(query, materials)`** resolves the CAM preset with no guessing (grade tokens from each alloy's label + aliases, longest-first, matched with a DIGIT boundary so `"316"` never matches inside `"3160"`; letters may abut, so `"SS316"`/`"AL6061"` work). **`autoLinkMaterialByGrade(tools, materials)`** stamps the FK at load for any preset with a grade in its string and no link yet (in memory, persisted on next save, idempotent) — and `normalizeLibrary` stamps it too (it previously set only the material NAME, leaving every normalized preset permanently unlinked). Because the link is the **alloy's `preset_id`**, renaming a CAM preset to carry its grades (`"Al Wrought"` → `"Al Wrought - 6061+"`) changes nothing — matching never reads a CAM preset's name, and adding a grade is just adding an alias to the alloy. Deliberately NARROWER than `suggestCamPresetName`, which also falls back to a bare-code default (`"AL"` → the wrought preset): a string with **no grade** (`"AL FIN"`, `"SS"`, `"BRZ"`) is a judgement call and stays user-confirmed.

**Bare codes are a SHOP decision made once per code, in normalization.** `"AL"`/`"SS"`/`"ST"` name only a broad family, so the right CAM preset depends on what the shop actually runs — which the app can't know but the shop can state once. `NormalizeModal` therefore surfaces a **"Shop default material"** block above the per-preset list: one row per bare code found across the un-normalized presets, showing the code, its label, how many presets use it, and a `CamPresetPicker`. Picking there applies to **every** preset holding that code, so a first normalization bulk-fixes the gradeless remainder instead of asking per preset. Helpers (`src/utils/presetNaming.js`): **`bareMaterialCode(query, materials)`** — the broad legacy code (via `matchMaterial`) for a string that resolves to **nothing** in the library **and** carries **no grade** (anything already resolvable returns `null`, so nothing auto-linkable is ever asked about) — and **`bareCodeGroups(presets, materials)`** → `Map(code → presets[])`, skipping presets that already hold a `material_preset_id`. Resolution order for a preset's material in the modal: **explicit per-preset pick → grade match → the shop's default for its code**; each code row pre-fills from `suggestCamPresetName` (the legacy hint) purely as a starting value — the shop's choice is what applies, and clearing a row leaves those presets unchanged.

**`resolveCamPresetId(preset, materials)` is THE cascade — one resolver, shared by the load backfill AND `normalizeLibrary`.** Order: existing FK → exact CAM-preset name → (stop if the query still resolves in the library by name — a group label / alloy displays fine, never override it on a guess) → grade → **rename**. `syncPresetMaterialName` runs it, so stamping the key and deriving the name are the same step and cannot drift.

**`camPresetIdForRenamedQuery` — a CAM preset renamed by APPENDING detail.** The commonest way a name-only link goes stale: `"Al Wrought"` → `"Al Wrought - 6061+"`, `"Steel Low Carbon"` → `"Steel Low Carbon - 1018"`. Unlike a bare code this is not a judgement call, so it self-heals. **Three guards, each of which a looser rule gets wrong**: **exactly one** candidate (`"SS Austenitic"` prefixes both the 304 and the 310/316 preset — ambiguous, never guessed); the match must end on a **word boundary** in the target (otherwise `"P"` "uniquely" resolves to `"Pure Copper"`); and **≥2 tokens** — a CAM preset name is a phrase, a bare shop code (`"AL"`, `"SS"`, `"STEEL"`) is one token and stays the user's call, so without this `"AL"` would swallow `"Al Wrought - 6061+"`. Measured over the real 359-preset library: 128 presets healed across 3 renames, 25 left for the user across 7 bare strings, second run a no-op.

⚠️ **`syncPresetMaterialName` returns the SAME reference when everything already agrees.** Callers use identity to decide whether there is anything to persist — a fresh object per load would make every tool look dirty forever and a bulk fix could never report "nothing to do" on its second run.

**`normalizeLibrary` DERIVES the name from the resolved key, it doesn't just stamp the key.** `material.query` / `stock-materials` are what Fusion receives, so a preset linked by grade or by a rename would otherwise keep its **stale** name and normalize would write that stale name straight into Fusion. It seeds the user's `matOverrides` pick, then runs `syncPresetMaterialName` — the same resolver as load. ⚠️ Note normalize only processes **untracked** tools ("Already-tracked tools: rebuild unchanged"), so on an already-normalized library it is a no-op and cannot be used as a bulk material fix — that is what `relinkPresetMaterials` is for.

**`AppContext.relinkPresetMaterials({ dryRun })` (`libraryOps.js`) — the explicit "write it down now" pass.** The load backfill resolves everything in memory on every load but only reaches the file when a tool happens to be saved, so a pre-FK library (or one where a CAM preset was renamed) shows the right thing while the stored records stay stale indefinitely. ⚠️ **It diffs the STORED RECORDS, not `toolsRef`** — in-memory tools have already been healed by the load backfill, so comparing against them would always report nothing to do while the file stayed wrong. Metadata-only and surgical: patches each record's `presets[]` material fields **and** its `preset_meta[guid].material_preset_id` (both, or the next load reads the old link back), leaving every other key alone — `upsertMany` merges by id, so records it wasn't handed survive. Preview→commit UI is the **Preset Material Links** card in Settings. Locked by `presetMaterialRelink.test.js` (incl. idempotence and the never-drop-records invariant). ⚠️ It is **metadata-only** — Fusion keeps the old material name until the **Fusion** block of the same card runs `pushPresetFieldToFusion(tools, 'material')` (see **Pushing ONE field to Fusion**). Only the NAME lives in Fusion (the id is app-only), so a preset whose name didn't change needs no push at all; measured on the real library, 128 metadata corrections → 104 Fusion pushes (the other 24 are on `no_fusion_link` tools).

So what remains flagged is: **`unresolvedMaterialPresets(presets, materials)` returns EVERY preset that has a material but no CAM-preset FK** — including one whose string resolves to a **group** (`"Steel"`) or an **alloy** (`"316L"`). ⚠️ Those were previously treated as "resolves by name — fine" and skipped, which made them **invisible**: they display and colour correctly while being unlinked, and per the SHOP RULE above the only thing Fusion resolves as a material is a CAM preset NAME, so they reach Fusion as dangling references too. The row's **`reason`** (`group` / `alloy` / `unknown`) is what `MaterialLinkBanner` shows, because "stored: Steel" on its own reads like a non-problem. Measured on the real library this closed a silent hole of 8 presets: unlinked = flagged = 25, no remainder. **`MaterialLinkBanner.jsx`** shows them on the tool page with the stored string plus a one-click **Use \<CAM preset\>** re-link where `suggestCamPresetName` is confident (legacy imported strings like `"AL FIN"` land here too and want the same fix). Applying stamps the stable id + derived name + `stock-materials`, so it's rename-proof from then on; nothing is ever auto-changed. Locked by `presetNaming.test.js` / `fusionConvert.test.js`.

**`material.query` (Fusion-native) still holds the resolved name string** — the **CAM preset name** (from the id), else a **group label** (legacy) (e.g. `"SS Austenitic 316"` / `"Stainless Steel"`); Fusion accepts any string. It is the display/name-composition/color source (`findMaterialInLibrary`, `materialNameCode`, `presetMaterialColor` all read it) and the Fusion "Filter by Search" value — but it is NOT the material assignment (see next paragraph).

**`material.query` is NOT how Fusion assigns the material — `stock-materials[]` is.** Confirmed from a real Fusion export: the preset↔material link Fusion actually reads is a Fusion-native **`stock-materials`** array of material **names** (matched **by name, no UUID** — the assigned material's uuid appears nowhere in the tool/preset), while `material.query` is only the free-text **"Filter by Search"** box. The two are **independent** — a real export carries `material.query: "SS"` alongside `stock-materials: ["SS Harder","Steel, High-Carbon"]` (note: *different* names, and **multiple** materials). So when the user picks a CAM preset, `PresetPanel`'s `CamPresetPicker.onSelect` (and the ref-seed at blank-preset creation) stamps **`preset['stock-materials'] = [cp.name]`** alongside `material.query = cp.name` — the CAM preset name matches the exported stock-material file's `description`/filename (see `materialExport.js`), so Fusion resolves it. Clearing the material (`×`) drops `stock-materials` too. `stock-materials` is **Fusion-native**, so `normalizePreset` (`fusionConvert.js`) leaves it in `...rest` **untouched** — it never injects it from `material.query` (would push a name Fusion can't resolve for legacy group-code queries like `"AL"`) and never clobbers a richer Fusion-set assignment. **This means Fusion links by name — no UUID is stored or needed, and material files never need re-importing from Fusion.** Deferred/low priority: the app has no first-class multi-material `stock-materials` editor, so re-picking a material won't rewrite an existing multi-value Fusion assignment, and the "Filter by Search" (`material.query`) text is left populated (Fusion itself leaves it blank when a material is assigned) — irrelevant until the search/filter field matters. Locked by `fusionConvert.test.js`.

**SHOP RULE — Fusion's material library is GENERATED from ours, so the two must match name-for-name.** The app's Materials library is the single source of material; Fusion's stock-material library is exported from it (one file per CAM preset, named for that CAM preset — see `materialExport.js`), and the shop's original Fusion material library was **wiped and replaced** with that generated set. (An APS sync would be the real answer; it isn't available, so the export/import is the mechanism.) Consequence: **a `stock-materials` name that isn't a current CAM preset name is a DANGLING reference to the deleted library** — Fusion matches by name, so it resolves to nothing. On the real library that is 6 presets holding `"SS Harder"` / `"AL 6061"`.

**Flagged, never auto-corrected — but ALWAYS one click from clearable.** `stockMaterialIssues(presets, materials)` returns each offending preset with what Fusion holds (`unknown[]`) and what its own CAM-preset FK implies (`expected`); **`MaterialLinkBanner`** shows them on the tool page with a **Use \<CAM preset\>** action per row (plus Fix-all). ⚠️ The action is not a convenience — without it this flag is a **nag loop**: `stock-materials` has no field in the preset editor, and the material shown there is already CORRECT, so the tool page looks fine and the only way to clear it is to re-pick a material that appears unchanged. Applying is not a guess either: it writes the CAM preset the preset is **already linked to**, and only `stock-materials` moves. A row with no FK (`expected == null`) gets no button — there is nothing to apply, so the user picks a material in the editor. Locked by `presetNaming.test.js` ("stops firing once the row's own `expected` is applied", and a second case asserting the load backfill doesn't undo the fix). ⚠️ **Both writers must PRESERVE a non-matching `stock-materials`, or the flag can never fire**: `syncPresetMaterialName` and `FUSION_PRESET_PATCHERS.material` apply the identical rule (rewrite only when it's absent, equals the new name, or equals the OLD query — i.e. plainly derived from the name being corrected). They are the two places that touch this one field and they must not drift; clobbering it in either would destroy the only evidence the reference was ever stale. Locked by `presetNaming.test.js` + `presetMaterialPush.test.js`.

Three resolver helpers (`src/utils/presetNaming.js`) read a stored `material.query` back against the library — `findMaterialInLibrary(query, materials)` (→ `{group, preset, alloy}`, matching most-specific first: alloy label/alias → CAM preset name → group label/id, with each level filling in the levels above it), `materialNameCode(query, materials)` (the **preset-name token**: alloy `code` → CAM preset `code` → group `code` → group id, and **nothing else** — see the rule below), and `presetMaterialColor(query, materials)` (group color, library first). The codes (edited in the Materials editor) are what appear in the convention name, e.g. `SS 2.125 NBT30-SK13C-60 - Rough` (a CAM preset with a blank `code` inherits its group's — the editor shows the inherited value as the field's placeholder). All three name-composition call sites resolve the code this way: `PresetPanel.composeName`, `normalizeLibrary` (via `materialsRef`), and `DiffStep` conflict naming.

⚠️ **A name code is ONE TOKEN.** `parsePresetName` reads a composed name back **positionally** (material → OOH → holder), so a code containing a space shifts every field after it: `AL CAST 2.125 NBT30-SK13C-60 - Rough` parses as material `AL`, **no OOH**, and a holder of `CAST 2.125 NBT30-SK13C-60` — which silently stops `presetMatchesAssembly` seeding that preset's `assembly_id`. The code is free text the shop types, so `materialNameCode` **strips whitespace** at the one seam every composed name goes through, and the seed ships single tokens (`ALC`, `SSDUP`, `STLPH`, …). Locked by `presetNaming.test.js` (a round-trip) + `sharedDefaults.test.js` (the seed). ⚠️ Known remaining edge, deliberately not guarded: a **purely numeric** code (an alloy coded `316`) is read back as the OOH. Rejecting a code the shop chose is worse than the narrow failure; the field's tooltip says one word.

⚠️ **THE SHORT NAME IS LIBRARY DATA — there is NO hardcoded fallback, and re-adding one is a regression.** `materialNameCode` used to fall through to `matchMaterial`'s built-in code table (`AL`/`SS`/`STEEL`/`MILD`/`BRONZE`/`BRASS`/`TI`/`CI`/`PLASTIC`), written before the Materials library existed. Two things were wrong with it: the shop couldn't edit its own vocabulary, and it was **coarser than the library it shadowed** — every non-ferrous CAM preset resolves to group N whose code is `AL`, so a **brass** preset could only ever name itself `AL 2.125 …`. The fix is the tier that was already there: a CAM preset's own `code` beats its group's, and an alloy's beats both. A string that resolves to **nothing** now yields **no token at all** — the name simply starts at the OOH (`2.125 NBT30-SK13C-60 - Rough`) instead of asserting an uneditable guess. ⚠️ It is **not** replaced by a `GEN` placeholder either: `materialToCode` returns `''` for a blank, because a placeholder claims a material nobody chose — the same rule `buildDesc` follows for tool descriptions. That — that is true rather than tidy, and `MaterialLinkBanner` already flags exactly those presets as unlinked. `matchMaterial` survives as a **recognition** heuristic only (colour fallback, import inference, `bareMaterialCode`), never as a name source. Locked by `presetNaming.test.js`.

**Legacy keyword matcher kept only as a recognizer**: `matchMaterial(str)` (maps `"AL FIN"`/`"SS316"`/etc. → a canonical code via keyword/token rules) is **no longer used by the picker**. It survives solely so (a) `mergeFusionAndMetadata` can still infer `material.query` from a preset **name** on import when Fusion left it blank (the shop encodes material only in names like `"AL FIN"`), and (b) `presetMaterialColor` can still colour a pre-library/imported material string not yet in `materials.json` (so an unlinked preset doesn't also go grey). It is **not** consulted by `materialNameCode`. `MATERIAL_CODE_TO_ISO_GROUP` + `materialIsoGroup` back that color fallback. **`"BZN"` is intentionally NOT mapped** (ambiguous). Grade detail collapses to the broad code in the legacy path; the library path preserves whatever alloy/CAM preset the user defined.

### Stepdown / stepover three-way sync (Fusion gotcha)

Each Fusion preset stores stepdown and stepover in **three** places that must agree: the `use-stepdown`/`use-stepover` **boolean**, the **numeric** `stepdown`/`stepover`, and an **expression string** (`expressions.tool_stepdown` / `tool_stepover`, e.g. `".018 in"`). **Fusion re-derives the checkbox from the expression on load** — so if we write the boolean `false` but leave a leftover expression, Fusion flips the flag back to `true` on the next pull (the recurring "use stepdown/stepover became true" bug). `normalizePreset` (`src/schema/fusionConvert.js`) is the single point that keeps all three consistent: the **boolean is the source of truth**, the numeric value is sourced from the field *or* parsed from the expression (the value sometimes lives only in the expression), the step expression is **stripped whenever the flag is disabled**, and — the value-side of the same bug — when the flag is ON and the **numeric changed**, a *literal* expression (`".018 in"`) is **rewritten** to the new number (same unit suffix kept; formula expressions are never rewritten; an unchanged value keeps its expression byte-for-byte). Without the rewrite, an edited stepdown/stepover silently reverts to the stale expression's value on Fusion's next load. Locked by `src/schema/fusionConvert.test.js`. Any new code that writes presets to Fusion must preserve this invariant — never set a step boolean or number without syncing the expression.

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
- Synced in: `splitToFusionInstances` (`logicalTools.js`) and `syncHolderExpressions` / `toFusionFormat` (`fusionExport.js`).

**The `reference_guid` placeholder** — Fusion writes the literal string `"<NEW TOOL GUID>"` into `reference_guid` on freshly created/duplicated tools that haven't been committed to the library yet. This is a sentinel telling Fusion to mint a brand-new GUID for the entry on its next save, discarding whatever GUID is supplied. The `...existing` spread in `internalToFusionTool` would carry this stale placeholder forward on every subsequent write — causing Fusion to generate a new GUID each sync and breaking the `instance_guid` join between metadata and the saved Fusion entry (the tool then surfaces as a stray on the next reconcile). `internalToFusionTool` strips this placeholder explicitly when `fusionObj.reference_guid === '<NEW TOOL GUID>'`. Real (non-placeholder) `reference_guid` values are left untouched.

### Preset expressions — sync, never inject (round-trip audit rule)

Fusion presets store expressions as **formulas** (e.g. `"tool_feedCutting/3"`) or **literals** (`"100 inpm"`), and many native presets store **numerics with no expression at all** — the numeric stands alone. Fusion re-derives every numeric from its expression on load, so an *injected* expression overrides a real stored value exactly like a stale one does (a drill with proven plunge feed 12 in/min + an injected default ternary comes back as 40 in/min).

**Rule** (`internalToFusionTool`): for **existing** presets, never ADD an expression key; for keys that are present, keep the original string **byte-for-byte when the paired numeric is unchanged** (preserves formulas and native formats — `approxEqual` absorbs Fusion's float noise) and rewrite a literal only when the value actually changed (compared against `existingPresetByGuid`). "Both absent" (no numeric, no change) also preserves — some native presets carry only the expression (e.g. drill `tool_feedPerRevolution`) and Fusion derives the numeric from it. Fusion's default formula set (`tool_spindleSpeed` ternary, `tool_feedPlunge` ternary, ramp/transition/retract links) is seeded **only for blank app-created presets** (`isBlankPreset`). **One speed mode + one feed mode only**: Fusion stores exactly ONE of `tool_spindleSpeed`/`tool_surfaceSpeed` and ONE of `tool_feedCutting`/`tool_feedPerTooth`/`tool_feedPerRevolution` per preset — never both (verified: 0 co-occurrences across 345 real reference presets). So blank seeding writes `tool_spindleSpeed` and `tool_feedCutting` (RPM + cutting-feed mode) but **NOT** the `tool_surfaceSpeed` or `tool_feedPerTooth` companion *expressions* — seeding those makes Fusion flag the tool on load and strip them ("warning, then fixes itself when opened"). The paired **numerics** `v_c`/`f_z` are still seeded (Fusion stores them standalone); only the redundant expressions are omitted.

### Valid Fusion coolant values

The only values Fusion accepts for `tool-coolant` are: `"flood"`, `"tool"` (TSC / through-spindle), `"disabled"`, `"air"`, `"flood tool"` (flood + TSC combined). **Not** `"through tool"`, **not** `"flood and through tool"`.

- Default for TSC-capable tools (`tsc_capable: true`): `"tool"`
- Default for non-TSC tools: `"flood"`
- `normalizePreset` remaps any stored `"flood and through tool"` → `"flood tool"` on every write
- **Coolant is a native+expression pair**: some native presets carry `expressions.tool_coolant` (`"'flood tool'"`) mirroring `tool-coolant`. `normalizePreset` rewrites a *present* expression when the coolant value changes (never adds one; byte-for-byte when unchanged) — otherwise Fusion re-derives the old coolant from the stale expression on next load

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

## Three-System Identification Architecture

The app has **three parallel, configurable identification systems**, designed to follow the **same** architectural principles so a user (and a developer) who understands one immediately understands the others. The canonical intent doc is **`docs/THREE SYSTEM CONTEXT PROMPT.md`** — read it before touching any ID, location, or assembly numbering feature.

| System | Config key | Identifies | Section |
|---|---|---|---|
| **Tool ID** | `tool_id_system` | the tool itself | **Tool ID System** (below) |
| **Location** | `location_config` | where the tool physically lives | **Location System** (below) |
| **Assembly ID** | `assembly_id_system` | a specific tool + holder assembly | **Assembly ID System** (below) |

Shared principles every system obeys: **(1)** stable UUIDs internally, human-readable strings composed at read time (never stored); **(2)** an explicit, user-chosen **selector for which way an ID is generated/configured** — Tool ID names it `mode` (the ID scheme); the Location system names each option a **"system"** (which physical location system a tool belongs to), the same role under a different word because it's tied to a real place; Assembly to get a `mode` from day one. Every option produces the same internal shape — only the generation logic differs. (The Bin's auto-increment-vs-fixed picker is a field *inside* a location system, **not** a mode/system itself.) **(3)** a preview→commit **normalize** action for legacy free-text; **(4)** **legacy tracking** in a `legacy_*` array (`legacy_ids[]` / `legacy_locations[]`) — searchable + used for import matching, with a per-system **`show_legacy` toggle** gating always-on display (Tool ID defaults on, Location/Assembly off; a search *match* always surfaces a legacy value regardless); **(5)** metadata is the source of truth (Fusion/ProShop are outputs); **(6)** UUIDs everywhere for a clean SQLite path. The three are configured as a related group in the setup checklist (`SETUP_STEPS`: `toolIdConfigured` / `locationConfigured` / `assemblyIdConfigured`, the last a disabled "coming soon" placeholder).

-----

## Tool ID System

A shop-wide, **configurable** scheme for how a tool's human-readable ID is generated and displayed, set in `shop_settings.tool_id_system`. The design rule that makes it simple:

- **Metadata-owned, mirrored to Fusion, mode-driven display.** `tool_id` (formerly `proshot_id`, renamed because the ID is no longer ProShop-specific) is **metadata-owned** — the TMS manages it, so it lives in `tool_metadata.json` and is the source of truth, **mirrored** to Fusion's native `product-id` on every write (an unmanaged free-text box that the TMS keeps in sync). **On read, metadata wins** (`mergeFusionAndMetadata`: `meta.tool_id || fusionInternal.tool_id`), falling back to Fusion `product-id` only for tools imported before the TMS assigned an ID. If someone edits the Fusion library directly and `product-id` drifts, metadata wins on the next save — same as any metadata-owned field (this is the same pattern as `machine_tool_number`, `metadataOnly: false` + "metadata wins"). The active **mode** only controls how the value is *generated*, how it's *labelled*, and whether the *ProShop URL* is shown — never *which* of the two stores wins. There is **no** second ID field. (Ownership mirrors `machine_tool_number`; display mirrors how `location` reuses Fusion's repurposed "Vendor" field.)
- **Legacy IDs.** Switching ID schemes and running **Settings → "Re-number all tools (new scheme)"** (`AppContext.renumberAllToolIds`) overwrites every tool's `tool_id` and retires each old value into a **metadata-only `legacy_ids[]`** array. Legacy IDs are matched on ProShop import (`matchProShopToTools`) and Phase-2 sync (`duplicateDetector.matchTool`, `method: 'legacy-id'`), are searchable (`searchEngine` — `matchedLegacyId` surfaces which one matched), and a new ID skips only an **exact** collision with a retired ID (partial digit overlap with a different prefix is allowed). Both "Assign IDs to unassigned tools" (`assignToolIds`, fills blanks only) and re-number write the value to **both** stores (metadata + Fusion `product-id`). **Duplicate clusters:** re-number works per Fusion **tracking-ID group**, but the library view folds entries that share a `tool_id` across different tracking IDs (`combineToolsByToolId` — usually a human-error duplicate in legacy/Fusion data). `duplicateIdClusters` (`combine.js`) surfaces these in the re-number preview as an amber warning with a per-cluster **Merge** (one shared new ID across all the cluster's groups → stays one tool, dedupe-able) vs **Split** (each group gets its own new ID → becomes separate tools) choice, plus Merge-all/Split-all. The chosen `consolidateIds` (tool_ids to merge) are passed to `renumberAllToolIds`; default is Merge. **Display:** ToolDetail shows a muted "Formerly:" line below the photo when `legacy_ids` is non-empty **and** `shop_settings.tool_id_system.show_legacy` is on (defaults **on** for Tool ID); a search result card shows "formerly X" **only** when the query matched that legacy ID (always, regardless of the toggle); nowhere else. The `show_legacy` toggle is the Tool ID System's instance of the shared per-system legacy-display toggle (see Three-System Identification Architecture) — Location's lives in `location_config.show_legacy` (defaults off).
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

A configurable, **database-ready** model for how tools are physically stored, in `shop_settings.json` under `location_config`. A shop defines **multiple independent systems**, each a **Zone → Station → Drawer → Bin** pattern where every upper level is optional and the Bin is always present (auto-incrementing or fixed). UI lives in **Settings → Location System** (`LocationSystemSettings.jsx`, rendered adjacent to the Tool ID System card) and the **Assign Location** picker in **ToolDetail** (`LocationPicker.jsx`). The approved UI prototype is `docs/archive/LocationSystemUI.tsx` — follow it for layout/copy/interaction; the app design system wins on visuals.

### Data model (`shop_settings.location_config`)

```json
"location_config": {
  "show_legacy": false,             // config-level: show retired location strings (default off)
  "systems": [{
    "id": "uuid", "name": "LC Cabinet",
    "normalized": false, "allowDuplicates": false,
    "proShopExport": "number_only",   // number_only | full | fixed
    "fixedExport": "",
    // How this system CLAIMS a bare number on ProShop import (mirror of
    // proShopExport) — see "Per-system import matching".
    "proShopImport": { "match": "any_unique", "triggers": [], "range": { "min": null, "max": null }, "flagGaps": true },
    "acknowledged_gaps": [],          // gaps ruled on — informational, NOT reserved
    "delimiters": { "zs": "-", "sd": "-", "db": "-" },
    "levels": {
      "zone":    { "on": false, "levelType": "Building", "customTypeName": "", "identFormat": "number", "customIdent": "", "options": [] },
      "station": { "on": false, "levelType": "Cabinet",  "customTypeName": "", "identFormat": "number", "customIdent": "", "options": [] },
      "drawer":  { "on": true,  "levelType": "Drawer",   "customTypeName": "", "identFormat": "custom", "customIdent": "LC", "options": [] },
      "bin":     { "fixed": false, "start": 1000, "fixedVal": "", "skip": [] }
    }
  }],
  "bin_sizes": [{ "id": "uuid", "label": "Standard", "slots": 1, "isDefault": true }]
}
```

Level `options[]` are stable-UUID entries `{ id, label, order }` (number/letter identifiers). A `custom` `identFormat` is a fixed prefix (e.g. `LC`) with no per-tool choice. `delimiters` are the three adjacent junctions (`zs`/`sd`/`db`); a non-adjacent junction (a middle level off) falls back to `-`. `bin_sizes` is a shared lookup (each entry carries a **UUID** `id`, not a literal like the old `'standard'` — clean SQLite path) — capacity-aware suggestion is a **future** feature (not built). A reserved `presetter: { serial_format, serial_start }` placeholder also lives in `shop_settings.json`.

**"System" is the Location analog of Tool ID's `mode`** — the user picks *which location system* a tool belongs to (the `systems[]` entry), the same role Tool ID's `mode` plays, named "system" because it maps to a real physical place (see Three-System Identification Architecture). The **Bin's `fixed` boolean** (auto-increment vs. fixed value, edited in the bin block of `LocationSystemSettings`) is just one field *inside* a system — it is **not** a mode/system of its own; `composeLocationString`/`buildPreview` read `bin.fixed` directly. **`show_legacy`** (config-level, default **off**) gates the muted "Formerly:" line of retired locations in `LocationPicker`; a search match always surfaces a legacy location regardless.

### Tool metadata additions (`buildMetadataTool` / `mergeFusionAndMetadata`)

Metadata stores **only IDs**, never the display string:

```json
"location": { "system_id": "uuid", "zone_id": null, "station_id": null, "drawer_id": null, "bin": 1405 },
"bin_size_id": "standard",
"legacy_locations": []
```

⚠️ **`bin` has ONE canonical shape — `normalizeBin`.** A fixed-bin system's `fixedVal` is a config **string**, so writing it straight through stored `"10000"` while every auto-increment system stored the number `10000`; and normalize stored **`null`** for a fixed bin, because the parser never captures one. Three write paths, three shapes for the same drawer. `normalizeBin(value)` is now applied at all of them (`routeProShopLocations`, `parseLocationString`, `LocationPicker`, and `buildMetadataTool` so a legacy string self-corrects on the record's next save): numeric → **number**, a non-numeric fixed label (`"SHELF"`) → string, blank → null. Adopting it changes nothing already stored — every comparison goes through `String()` — it just stops the drift.

The metadata key `location` (object) maps to the internal field **`tool_location`** (to avoid clashing with the internal `location` **string**). `legacy_locations[]` holds prior free-text strings retired by normalization.

### `tool.location` (string) — derived, not stored

The internal `tool.location` string (written to Fusion's "Vendor" field, `expressions.tool_vendor`) is **composed on read/write** from `tool_location` + the system config — never stored on the tool:

1. **Load time** (`loadTools`): for each tool with a `tool_location`, `resolveLocationString(tool_location, systems)` sets `location`; a `proShopLocationValue(system, composed)` is also stashed as **`proshop_location`** (per-system export rule). Tools with no structured location keep their legacy Fusion-vendor free text.
2. **Write time** (`writeLogicalTool`): the composed string overrides `location` before `splitToFusionInstances`, so a structured location is the single source of truth for the Fusion vendor field.

`toolToExtractor` emits `proshop_location ?? location` as the ProShop **Location** column.

### Pure helpers — `src/utils/locationSystem.js`

Framework-free. Key exports: `newLocationSystem(name)` / `newLevelOption(label, order)` (factories with UUIDs), `findSystem` / `levelOptions` / `findOption` / `levelTypeName`, `composeLocationString(loc, system)` and `buildPreview(system)` (the live-preview composer — order zone→station→drawer→bin, per-junction delimiters), `resolveLocationString(loc, systems)`, `proShopLocationValue(system, composed)` (number_only strips non-digits / full / fixed), `nextBin(system, usedBins)` (next number **above the highest in use** — never backfills a hole; **`null`** for a duplicates-allowed system, which has no meaningful "next") + `usedBinsForSystem`, `parseLocationString(str, system)` (lenient regex parse for normalization — a **custom prefix like `LC` is OPTIONAL**, so a bare ProShop bin number `140` parses to the same bin as `LC-140`; without this, tools whose location is stored as just the number were missed by Analyze, landing in "unmatched" so their bins weren't counted and the next-available bin came out wildly low), `analyzeSystem(tools, system)` (matched/unmatched/noLocation/nextBin), `libraryLocationStatus(tools, systems)` (library-wide assigned vs unassigned), `emptyLocation(systemId)`, `LEVEL_KEYS`.

**Duplicate-output detection** (`systemOutputSignature` / `systemStructureSignature` / `findSystemConflicts`): two systems "clash" when they could produce the same **user-visible ID**. The check runs on the composed **output recipe**, not the settings labels — a level's *type name* (Drawer/Cabinet/custom type) never appears in the string, so two systems that label their steps differently but emit the same segments still clash. Each segment reduces to what actually shows (custom prefix string / sorted set of option labels / fixed-bin value or `auto#`), compared **with** the junction delimiters (`output` clash = identical visible IDs possible) and **without** them (`delimiter` clash = same recipe, only the separator differs — a near-duplicate). `findSystemConflicts(systems)` → `Map(id → {type:'output'|'delimiter'|'name', otherId, otherName}[])`; duplicate (case-insensitive) **names** also flag. `LocationSystemSettings` renders these as **non-blocking** warnings (header badges + a `ConflictWarning` box in the open card) — it warns, it doesn't prevent saving (a half-edited new system briefly matching another shouldn't trap the user). Known limitation: detects fully-identical output recipes, not *partial* option-set overlap (two systems sharing only some labels).

### Normalization (migration action, not a toggle)

⚠️ **Normalize assigns UNASSIGNED records — it never re-routes a record already filed in another system, and it honours the per-system import rules.** Both guards exist because of the same real failure: an `LC` system whose custom prefix is OPTIONAL when parsing (so a bare ProShop number matches) parsed a fixed-bin drill index's composed `10000` as *LC bin 10000*. Analyze therefore offered to move all 19 drill-index tools into LC, and its "next available bin" read **10001** instead of 254. So `analyzeSystem(records, system, systems)` **skips any record with a `tool_location` in a different system** (moving between systems is the ProShop import's job — it routes by the rules — or a manual re-assign), and for unassigned records runs the same **`claimSystemForNumber`** cascade the import uses, so the most permissive pattern can't win by accident. Uniqueness is counted over the whole library, as on import. Locked by `locationSystem.test.js`.

Per system: **Analyze** (read-only `analyzeSystem` parse pass — no writes) → **preview** (matched count + next bin) → **commit** (`AppContext.normalizeLocationSystem(systemId)`). Commit assigns the parsed `tool_location` (LOCATION data **only** — never `tool_id`; see "Location ≠ ID" under Tool ID System) to every matched tool, **retires each tool's prior free-text location into `legacy_locations[]`** (mirrors how `renumberAllToolIds` retires `legacy_ids` — the retired string stays searchable via `searchEngine.matchedLegacyLocation`/`textSearch` and is not re-imported from ProShop), marks `system.normalized = true`, and does a **metadata-only batch write** (`saveAllMetadata` once — a full Fusion round-trip per tool would re-upload the whole library hundreds of times; the composed string re-syncs to the Fusion vendor field the next time each tool is individually saved) plus an optimistic in-memory update. The Location System is intentionally **find-and-assign-location only**; renumbering/ID generation is the Tool ID System's job (a location-system bin-renumber action is future work). The **Library Location Status** panel (below all system cards, only once ≥1 system is normalized) shows the union of unassigned tools across all systems with an expandable table.

### ProShop import/export

- **Export**: composed string → ProShop `Location` column, transformed by the tool's system `proShopExport` rule (`number_only` strips to just the bin digits / `full` / `fixed`).
- **Import** (`ImportFlow.matchProShopToTools`): compared on the **bin number only** (ProShop's `Location` is a bare number, no `LC-` prefix; `locationNumber()` strips the app's prefix). **Which system a number belongs to is decided by the per-system import cascade** — see "Per-system import matching" below. When the tool has **no** structured `tool_location` and a system claims the number, the app **takes over** — it assigns a **structured `tool_location`** (`bin` = ProShop #) so the location composes `LC-…` and persists in metadata even for no-Fusion tools (a free-text location can't persist for those). Once the tool owns a structured `tool_location`, a number **mismatch is flagged** for review (not overwritten, not ignored) — resolving with "Use ProShop #" updates `tool_location.bin`. See ProShop Field Priority Rules → the location rule.

### Per-system import matching — which system owns a bare number

**ProShop stores a location as a bare number with no system prefix**, so a number alone cannot say which location system it belongs to. The old rule required **exactly one** bin-only system and silently gave up otherwise — a shop with two systems got no structured locations at all. Rather than hardcode any shop's conventions, **each system carries its own `proShopImport` rule** and the systems are evaluated as a **cascade** — the config equivalent of the long IF statement a shop would otherwise write in a spreadsheet. It is the mirror image of the per-system `proShopExport` rule, lives in the same place, and drives **both** the initial bulk import and the location-only re-import.

```json
"proShopImport": { "match": "any_unique", "triggers": [], "range": { "min": null, "max": null }, "flagGaps": true },
"acknowledged_gaps": []
```

`match`: `off` (never claims) | `any_unique` (a number appearing exactly once file-wide) | `range` (`[min,max]`; **both bounds empty claims NOTHING** — a half-finished setting is not "every number") | `triggers` (specific values the user typed — a sentinel like `10000` meaning "in the drill index", paired with `allowDuplicates`). Helpers in `src/utils/locationSystem.js`: `newImportRule`, `systemImportRule` (read-with-default), `parseTriggerList`, `claimSystemForNumber`, `countLocationNumbers`, `routeProShopLocations`, `isBinOnlySystem` (moved here from `ImportFlow` — one source of truth), `findBinGaps`, `pruneAcknowledgedGaps`, `libraryLocationIssues`. UI: the collapsible **ProShop location import** block in `LocationSystemSettings` (collapsed by default — setup once, then forget).

**Three rules that are easy to get wrong, all regression-tested** (`locationSystem.test.js`):

- **Uniqueness is judged across the WHOLE file, never row by row.** Streaming would call the FIRST occurrence of a repeated number unique and hand it to the wrong system. Hence `countLocationNumbers` as a pre-pass, threaded into both import entry points as `locCounts`.
- **An explicit trigger wins over a generic rule, regardless of system order.** A sentinel is recognizable as one because the user *typed it in*, not because of how often it happens to appear — if it showed up just once in an export, an `any_unique` system earlier in the order would swallow it.
- **An established shop with no rules configured keeps the previous behaviour exactly** (`hasConfiguredImportRules` → `legacyClaimSystem`: single bin-only system claims everything). Without the fallback, shipping this would silently stop an existing shop's import from assigning locations. The config is purely additive — nothing to re-enter.

⚠️ **Configuring ANY system switches the legacy fallback off for ALL of them**, so a system still on `off` silently claims nothing — `LocationImportModal` warns by name when some systems are configured and others aren't.

A system that isn't bin-only (a selectable drawer/station level) is **flagged, never half-assigned** — a bare number can't supply the level choice.

⚠️ **One out-of-range bin must not become hundreds of gaps.** Reporting every empty number between a system's lowest and highest bin collapses the moment ONE bin sits far above the rest: a real run produced **768 "skipped number" rows** from a single tool left on bin 1000 in a cabinet that ends at 253. That is both wallpaper and untrue — nothing is skipped up there, the sequence simply ended. **`analyzeBinSequence`** therefore reads a run of more than `GAP_RUN_LIMIT` (25) consecutive empties as the END of the sequence: bins at or above it are reported as **`outlier`** issues (naming the tools, which is the actually-actionable finding — an outlier is nearly always a tool belonging to a different system), and gaps below it are returned **grouped into runs** so consecutive holes are one row. `findBinGaps` is the flat-number form of the same result.

**A gap is informational, NEVER a reservation.** `acknowledged_gaps[]` is deliberately separate from `levels.bin.skip[]` (the reserved-numbers list `nextBin` avoids): dismissing a gap silences the report row without making the number unassignable, and `pruneAcknowledgedGaps` **drops the acknowledgement the moment a tool lands in that bin**. Filling a gap must always stay possible.

**Auto-assignment moves FORWARD; holes are filled only by a person.** `nextBin` continues **above the highest bin in use** — it deliberately does **not** return the lowest free number. A gap means a bin whose tool hasn't been accounted for yet, and very often something IS physically sitting in it, so handing that number to the next new tool would quietly double-book a drawer. The two halves are one rule: `nextBin` skips a hole, which is exactly what makes it safe for `LocationPicker` to still accept that number when typed in by hand (it blocks only an **already-occupied** bin, never a gap). Locked by `locationSystem.test.js`.

**A duplicates-allowed system gets NO suggestion at all** — `nextBin` returns `null`. Such a system isn't a sequence (a shop may park every tool on one sentinel bin), so continuing past the highest value would invent a number nobody asked for. That matters more than it looks: `LocationPicker` falls back to the suggestion when the bin field is left **blank**, so a silently-wrong pre-filled number saves itself unless the user remembers to overwrite it. With no suggestion the picker instead **requires** a bin (`binMissing` disables Set location) and says why.

### Location Issues panel — derived, never stored

The durable worklist (`libraryLocationIssues(tools, systems)` → `LocationIssuesPanel`): duplicate bins in a system that doesn't allow them, out-of-range **outlier** bins (with the tools on them), plus gap **runs**. **Recomputed on every render like `analyzeSystem`** — there is no saved report, so it's always reachable, always current, and each row disappears by itself as the tool behind it is fixed. Distinct from the import-time exception list (which is about rows in a CSV; this is about tools in the library).

### Location-only ProShop re-import (`LocationImportModal`)

⚠️ **An insert tool's location lives on its COMPONENTS, not on the tool** (`holdsOwnLocation`). A pairing (a face mill = body + inserts) is not a thing in a drawer — its two halves are, each with its own ProShop number and its own bin. So a paired tool whose components are linked is **excluded** from `analyzeSystem` and `libraryLocationStatus`: it has no location by design, and listing it as "unassigned" is a row the user can never clear. Measured on the real library that was **8 of 21** apparent unassigned tools — enough to make every count on the Location screen look wrong. A pairing with **no** components linked still counts (nothing is holding its location). `libraryLocationStatus.total` counts the same population, so assigned + unassigned add up to the total shown beside them.

⚠️ **A component is a real physical object in a real drawer, so for LOCATION it is treated exactly like a tool** — same structured `tool_location`, same systems, same bins, same duplicate/gap detection. The split between `tool_metadata.json` and `tool_components.json` exists only so a component can never reach Fusion; it is **never a user-facing distinction**. Consequences, all live: `LocationPicker` already pooled tools + components as `locRecords`; `libraryLocationIssues` and the Location Issues panel take that same pooled list (counting only tools reported every component's bin as a *skipped number*, and hid a tool↔component bin clash); and `importLocationsFromProShop` takes `[{ id, location, isComponent }]`, writing `tool_metadata.json` and `tool_components.json` in one pass. A component chip in the issues panel navigates to the insert tool that pairs it, since a component has no page of its own. Locked by `locationSystem.test.js`.

Reads a full ProShop export and touches **nothing except each tool's location** — matching on `Tool #` only (tolerant of dash/space/case, and `legacy_ids`). Two things a real export makes necessary: an insert tool's holder body / insert are each their **own** ProShop row but are **component** records (`tool_components.json`), so a `Tool #` hitting one is reported as a component rather than the misleading "no tool in the library"; and the export's trailing **`TOTALS`** summary row (blank description + group) is skipped so it can't appear in the worklist as a missing tool. ⚠️ **This is a DELIBERATE EXCEPTION to the ProShop location rule**: everywhere else a ProShop location that disagrees with a structured location the app already owns is **flagged, never overwritten**. Here **ProShop wins outright** — the action exists precisely to correct locations the app got wrong, and every tool being corrected is in exactly the state that rule would flag, so flagging would turn the cleanup into hundreds of one-at-a-time decisions. **The dialog states this plainly before committing**, and previews every old → new change. Prior locations are retired into `legacy_locations[]` (still searchable). Idempotent — a second run reports nothing to update.

`AppContext.importLocationsFromProShop(assignments)` is a **metadata-only batch write** (one `upsertMany`), same reasoning as `normalizeLocationSystem`: a Fusion round-trip per tool would re-upload the whole library hundreds of times. ⚠️ So **Fusion still holds the old location** until each tool's next individual save — the result panel **says so explicitly** rather than leaving it to be discovered, and the **Fusion sync** action below settles it in one pass.

### Pushing ONE field to Fusion (`pushFieldToFusion`)

Location **is** a Fusion-native field (its repurposed "Vendor" box), but `normalizeLocationSystem` and `importLocationsFromProShop` are metadata-only batch writes — so Fusion keeps the OLD location until each tool is next saved individually, which can take months. The **Fusion sync** block in `LocationIssuesPanel` is the explicit "make Fusion agree now" pass: preview (`dryRun`) → commit.

⚠️ **`pushFieldToFusion` is FIELD-scoped; `writeToolsToFusion` is TOOL-scoped. Do not reach for the wrong one.** `writeToolsToFusion` rebuilds each entry from the app's model via `splitToFusionInstances` — correct when the whole entry is the point (re-stamping baked holder geometry), but the wrong instrument for "Fusion's copy of this one value is stale": it would rewrite geometry, presets and every expression across hundreds of tools to correct a single string, silently applying any other app↔Fusion drift on the way. `pushFieldToFusion` instead downloads each library once, finds each tool's own entries by guid, sets **only** the named field, and leaves every other byte alone. An entry that already agrees is not rewritten, so a second push has nothing to do.

**Per-PRESET fields go in `FUSION_PRESET_PATCHERS` + `pushPresetFieldToFusion`** (`libraryOps.js`) — same contract, but a preset field lives inside `start-values.presets[]` keyed by **preset guid**, not as a scalar on the entry. Simpler in one respect: preset material has **no paired `expressions.*` entry**, so there is no native+expression pair to keep in step. Two rules the `material` patcher exists to enforce:
- ⚠️ **Only a value DERIVED from a CAM-preset id is ever pushed.** `value()` returns null for a preset with no `material_preset_id` (a bare code / legacy string), so a judgement call is never pushed over Fusion — the push can only assert what the FK determines.
- ⚠️ **`stock-materials` is corrected, never invented or clobbered.** It is the link Fusion actually reads (matched by name). Absent/empty → **left absent** (`normalizePreset`'s standing rule: a name Fusion can't resolve is worse than none). Equal to the OLD query → corrected alongside it. **Anything else** — a different single name (`["SS Harder"]` next to query `"SS Austenitic 316"`, on 6 real presets) or a multi-value assignment — is a dangling reference to the replaced Fusion material library (see the SHOP RULE above): **left alone and surfaced** in the push dialog's `flagged[]`, so the push never quietly does less than it claims. The name is still corrected in either case. Same rule as `syncPresetMaterialName` — the two must not drift.

A preset is replicated onto every instance, so all its copies move together — `presetCount` (distinct presets) and `count` (entry×preset rewrites) are both reported. `no_fusion_link` tools are skipped (nothing in Fusion to correct). Idempotent. Driven by the **Fusion** block of the **Preset Material Links** card in Settings. Locked by `presetMaterialPush.test.js`.

**Fields go in `FUSION_FIELD_PATCHERS`** (module scope, `libraryOps.js`), one entry per pushable field: `read(entry)` (what Fusion holds — **the expression wins**, since Fusion re-derives the native from it), `value(tool)`, `apply(entry, val)` (a NEW entry with only that field changed). ⚠️ Each patcher owns the **whole native+expression pair**, so a caller can never write half of one and have Fusion revert it on the next load — and it **deletes** the expression when the value is empty, never writes `''`. Add a patcher rather than a bespoke push; the pairing rule and the delete-don't-blank rule are easy to get wrong once per field. Locked by `src/context/fusionFieldPush.test.js` (incl. "exactly two keys differ" and non-mutation of the input entry).

Scoped to tools the app actually owns a location for (`tool_location.system_id` set, Fusion-linked) — a legacy free-text location IS Fusion's own value, so there is nothing to correct there.

### Context actions (AppContext)

`saveLocationConfig(locationConfig)` (persists the `location_config` sub-object), `assignToolLocation(tool, toolLocation, binSizeId)` (single-tool assign/clear via `writeLogicalTool` — composes into Fusion vendor + metadata), `normalizeLocationSystem(systemId)` (the commit above), `importLocationsFromProShop(assignments)` (the location-only re-import above). All exposed in the context value.

-----

## Assembly ID System

The third parallel identification system (see Three-System Identification Architecture), configured in `shop_settings.assembly_id_system`. It generates a **human-readable number for each tool+holder assembly**, stored on the assembly record as **`asm_number`** (metadata-only) — the value predominantly shown on an assembly. Pure helpers live in `src/utils/assemblyIdSystem.js` (`composeAsmNumber`, `autoAsmNumber`, `shouldRetireAsmNumber`, `nextAsmSerial`/`usedAsmSerials`, `resolveAsmSeparator`, `trimOoh`, `backfillAsmNumbers`, `ASM_MODES`, `previewAsmNumber`) — framework-free, mirroring `toolIdSystem.js`.

**Two ID layers — digital reference vs. physical serial (do not confuse):** `asm_number` is the assembly's **DIGITAL reference** — how it's referenced in software (a ProShop RTA#, an ERP id, our Auto string). It is **mutable**: it can be reassigned/renumbered, so retired values go to a metadata-only **`legacy_asm_numbers[]`** array exactly like `tool_id` → `legacy_ids` (searchable, `show_legacy`-gated display). The **IMMUTABLE** serialized ID is the separate **physical** layer — the presetter measurement (`measured_*` below), which represents the real assembly in the machine. **Retire rule (`shouldRetireAsmNumber`):** Auto is a pure product of other fields (holder + tool_id + OOH) and is always re-derivable, so an Auto value is **never** retired; legacy retention applies **only** when replacing a NON-derived external value (RTA / ERP / serial) with a new one — i.e. renumbering *from* ProShop/ERP *to* Auto, not the reverse. The rule: retire the old value iff it's non-empty **and** ≠ what Auto would compose for that assembly (`autoAsmNumber`).

### `assembly_id_system.mode` options
- **`auto`** (default) — `{holderDescription}{sep}{tool_id}{ooh}`, e.g. `NBT30-SK13C-60-1001-2.125`. The holder token is its **description**, verbatim (`holderNameToken()`) — there is no short form any more, and numbers already stored keep the old spelling (see the holder-name rule under Preset naming); `tool_id` falls back to the last 6 of the assembly UUID; `ooh` has no trailing zeros, in the tool's unit. `separator` inherits `tool_id_system.separator` when null. A pure product of its fields — re-derivable, so never retired to legacy.
- **`proshop_rta`** — user-entered ProShop **RTA#** (Rotating Tool Assembly number). A text field appears in `AssemblyForm`; not auto-generated. **ProShop CSV import/export is TBD** (TODO in `proShopExport.js`).
- **`sequential`** — plain incrementing integer from `serial_start`. The next serial is `nextAsmSerial(serial_start, usedAsmSerials(tools))` (only plain-integer `asm_number`s count as used).
- **`erp_external`** — disabled "coming soon" placeholder.

### Generation & backfill
- **Single generation hook:** `writeLogicalTool` (AppContext) stamps `asm_number` on any assembly missing one (per the active mode; sequential walks a counter over all tools), so every save path (`addAssembly`/`updateAssembly`/merge/reconcile/normalize) gets numbers. RTA/ERP modes are skipped (left for the user/UI). Only fills when absent — it doesn't overwrite an existing number.
- **Load backfill** (`backfillAsmNumbers` in `loadTools`): **auto** mode only — composes the deterministic string in-memory for assemblies missing it (persisted lazily on the tool's next save). Sequential/RTA are **not** backfilled on load (a serial needs stored state; RTA needs user input) — they get their number at creation/entry. (A future bulk "assign assembly numbers" action, mirroring Assign IDs, would number pre-existing sequential assemblies.)
- **Retirement (digital reference).** When a stored `asm_number` is replaced, the old value is retired into `legacy_asm_numbers[]` **iff** `shouldRetireAsmNumber(old, autoAsmNumber(...))` — i.e. only non-derived external values (RTA/ERP/serial), never re-derivable Auto values. Today the only live mutation point is the **ProShop RTA# edit** in `AssemblyForm` (which computes the retirement and carries `legacy_asm_numbers` through the save). A future bulk "re-number assemblies" action (external → Auto) reuses the same helper. Retired values are searchable (`searchEngine.matchedLegacyAsmNumber` + `textSearch` — which also now matches the current `asm_number`) and shown as a muted "Formerly:" line on `AssemblyCard` gated on `assembly_id_system.show_legacy` (default off; a search match always reveals).

### The preset↔assembly link is a FOREIGN KEY, not the name

**`preset.assembly_id`** (metadata-only, in `preset_meta`) is the authoritative preset→assembly link — many presets → one assembly, so the key lives on the preset. Read it via **`assemblyForPreset(preset, assemblies, unit)`** / **`presetsForAssembly(assembly, presets, unit)`** (`presetNaming.js`); the preset editor's Assembly dropdown writes it.

**`presetMatchesAssembly` — which parses the holder short-name and OOH out of the preset's display NAME — is ONLY an import/legacy seed.** Fusion has nowhere to store our FK, so the name carries the link across that boundary; but a formatted string is a transport format, never a join key. It is used in exactly two places now: as the fallback inside the two resolvers while a preset has no FK yet, and in **`backfillPresetAssemblyLinks(tools)`** (load-time, in-memory, persisted on next save) which seeds the FK once from the current name match. `AssemblyForm`'s preview still name-matches deliberately — it previews an assembly that doesn't exist yet, so there's no id to match on.

**`assemblies[].linked_preset_guids`** is the **reverse index**, recomputed from the FK in `writeLogicalTool` on every write so it can never drift. It is no longer a second source of truth. (It was previously the only FK and was write-only — the merge flow wrote it, nothing read it — which is what let a stale OOH silently orphan a preset.)

### Changing an assembly's OOH/holder re-derives everything built from it

The OOH and holder are **baked into derived names** — the assembly's Auto `asm_number` (`{holderDescription}{sep}{tool_id}{ooh}`) and every linked **preset name** (`AL 2.125 NBT30-SK13C-60 - Rough`). Editing them without re-deriving doesn't just leave stale text: a stale OOH in a preset name **breaks `presetMatchesAssembly`** (which links preset→assembly by the OOH parsed out of the name), silently **orphaning the preset** from its assembly. ⚠️ **Changing the holder must move the FK, not just the guid.** `resolveHolderForWrite` consults **`holder_id` first** and treats `holder_guid` as a hint (Fusion re-issues guids, so the FK has to win in general) — so a patch that sets a new `holder_guid` while carrying the old `holder_id` forward resolves the OLD record, bakes its geometry, and then migrates `holder_guid` **back** to it. That is not a no-op: the user's choice is actively reverted, in metadata and in Fusion, with a success toast, and creating a new assembly appears to work only because it has no prior FK in the way. Both places that can move a holder re-point `holder_id` — **`AssemblyForm`** (the live edit path, which saves through `saveTool`) and **`updateAssembly`** — nulling it when the chosen holder has no app record yet, which makes the write resolve by guid and re-stamp the FK itself. Locked by `toolActions.test.js`.

So `updateAssembly` (`toolActions.js`) also re-derives on any OOH/holder change — it's the one place that still knows the OLD values:

- **`asm_number`** — only in **`auto`** mode (the one mode derived from field values). It composes the number for the old and new field values; if the stored number equals the old-derived one it was ours and is simply replaced (an Auto value is re-derivable, never worth retiring), otherwise it's an external value (an RTA carried over from another mode) and is retired into `legacy_asm_numbers`. `proshop_rta` / `erp_external` / `sequential` numbers are **not** derived from these fields and are left untouched.
- **Preset names** — every preset linked to that assembly (by `linked_preset_guids` **or** `presetMatchesAssembly` against the OLD values) is recomposed via the shared **`autoPresetName(preset, assembly, materials)`** (`presetNaming.js`), which derives format/operation/intensity/strategy/small-bore from the preset itself so it can't drift from what the editor shows live. A **hand-typed name is never rewritten** — the same `isAutoPresetName` structural check the editor uses gates it (see Auto-name vs. hand-typed name).

Self-healing in miniature: unambiguous → repaired silently; the user's own name → left alone. Locked by `toolActions.test.js`.

⚠️ **A number spelling the holder the RETIRED short way is stale, and is corrected — silently.** `backfillAsmNumbers` used to run its compare through `holderTokensMatch`, so `30-SK13-60-1001-2.125` was judged EQUAL to the freshly-composed `NBT30-SK13C-60-1001-2.125` and never recomputed — no save, re-stamp, or bulk write could ever fix it. The compare is now **strict**; the tolerance moved to the `_asmNumbersFixed` **flag** instead. So the number self-heals on the tool's next write (an ordinary save, or `writeToolsToFusion` — the holder re-stamp pass, which persists metadata too), while the "N assembly numbers corrected" banner stays quiet for a spelling-only change. Every stored number spells the holder the old way, so counting them would raise that banner on the whole library at once — a flag nobody can act on. A number stale for a **real** reason (the OOH moved, the tool was renumbered) still flags, even when the spelling is corrected in the same step. Silent when unambiguous, surfaced when it's news. Locked by `assemblyIdSystem.test.js`.

**Load-time correction of a stale Auto `asm_number`** (`backfillAsmNumbers`). The edit path above can't catch every source of staleness — the OOH can change in Fusion, a Tool ID renumber changes the id token, a holder description can change, and assemblies may pre-date Auto mode being configured. Because an Auto number is a **pure product** of holder + tool_id + OOH **and has no edit UI** (`AssemblyForm` exposes the field only in `proshop_rta` mode), a stored value that differs from the composed one is always **stale, never custom** — so `backfillAsmNumbers` **re-derives** it (it previously only filled a missing one) and reports each change on the tool via a runtime **`_asmNumbersFixed`** array (`[{from, to}]`), surfaced as a blue "N assembly numbers … corrected — Save" banner in `ToolDetail` that lists **old → new** so a flag is always diagnosable. ⚠️ **The checker MUST compose exactly like the stamper** (`writeLogicalTool`) — same holder resolution (cached `holder_description`, then the holder library by `holder_guid`) and the same `trimOoh` rounding. If the two ever disagree, the flag fires on every load and *cannot be saved away*, because each side keeps recomputing its own value: a permanent false positive. Both causes are regression-tested. Only **corrections** are counted (a first-time fill is normal stamping, not news). This is **strictly `auto`-mode**: the function already early-returns for every other mode, so `proshop_rta` / `erp_external` / `sequential` numbers — which are NOT derived from these fields — are never touched and never flag. In-memory at load, persisted on the next save (which clears the flag); idempotent, so a correct library is a no-op. ⚠️ Corollary: switching an existing shop **from `proshop_rta` to `auto`** means those RTA numbers get re-derived at load — the Auto value is the source of truth in that mode.

### Gauge-length tiers (per assembly — CRITICAL, never confuse)
All metadata-only, added to the assembly record (`buildMetadataTool` / `buildLogicalTool`):
- **`geometry.assemblyGaugeLength`** (Fusion JSON, **not** an assembly metadata field) — Fusion's `holder gauge length + OOH`; we write it on export but **never override** the formula (breaks the holder link). Read-only from our side.
- **`target_gauge_length`** — our calculated collet-correction value (SK collets shift actual gauge by shank-vs-range). **Formula TBD — store null.** Never written to Fusion. Data-only, no UI.
- **`measured_gauge_length`** — actual pre-setter reading; **immutable once set**. Shown read-only in `AssemblyCard` ("Measured gauge length: … · date · by", or "Not yet measured"), clearly distinct from OOH. Entry is future presetter work (no edit field yet).
- **`measured_at`** / **`measured_by`** — ISO timestamp + user who measured. **`measured_serial`** — the **immutable physical serialized ID** tying this record to the real measured assembly (data-only, no UI). `presetter: { serial_format, serial_start }` in `shop_settings.json` reserves the integration. This `measured_*` block is the immutable *physical* counterpart to the mutable *digital* `asm_number`.

### Settings + display
- **Settings → Assembly ID System** card (adjacent to Tool ID + Location, buffered into the page draft like everything else): mode radios, the `auto` separator (with "inherit from Tool ID"), `sequential` start, a live `previewAsmNumber`, the RTA note, and the **`show_legacy`** toggle (parity with the Tool ID card). Saving marks the `assemblyIdConfigured` setup step (now a real, completable step — no longer the disabled placeholder).
- **`asm_number` is shown predominantly** on `AssemblyCard` (a mono blue badge at the head of the assembly, before the holder pill) and is editable only in `proshop_rta` mode (`AssemblyForm`). No change to export/Fusion logic — `geometry.assemblyGaugeLength` is unchanged.

-----

## Tool Status — Active / Retired / Beta

A tool's lifecycle, in `tool_status` (metadata-only, `'active' | 'retired' | 'beta'`). Pure helpers in **`src/utils/toolStatus.js`** (framework-free, mirroring `toolIdSystem.js`), rendered by the one **`StatusBadge.jsx`**.

⚠️ **ACTIVE IS THE DEFAULT *AND* THE ABSENCE OF AN ANSWER.** `statusOf()` returns `'active'` for a missing field, a null, and an unrecognised value — so every record that predates this field reads correctly and **nothing has to be migrated**. Two consequences follow directly:
- The app **cannot tell "nobody said" from "somebody said Active"**, so the ProShop import treats `Status` as **authoritative** rather than fill-gap-else-flag. Same reasoning as `center_cutting`; flagging would fire on the whole library.
- A status word nobody understands (`"On Order"`) reads as **active**, never retired — an unknown value is not evidence a tool is out of service.

| Status | ProShop `Status` | In the app |
|---|---|---|
| **Active** | `Active` | The normal state. No badge (see below); header untouched. |
| **Beta** | ⚠️ **not exported at all** | Being trialled in CAM, not bought. Blue badge; the generated description carries a `BETA` marker. |
| **Retired** | `Archived` | Out of service. Grey badge + the replacement, resolved live from `replaced_by`. |

⚠️ **RETIRING IS NOT DELETING.** The shop keeps running a retired tool on jobs that are already programmed, and may even buy more of one to finish an old job. So a retired tool stays in Fusion, stays in ProShop (as `Archived`), stays searchable, and keeps its presets and assemblies. What retiring changes is what someone reaches for when programming a **new** job — hence the badge, the header wash, the `RETIRED` marker in the description (the only thing Fusion can show), and the replacement link.

**ProShop's column is `Status`** (Id + API both `status`), an indexed String. Measured on the shop's real export: `Active` 270 / **blank 40** / `Archived` 1 (`A-6 (Ar)`, "NOT USED …"). **Blank is ACTIVE**, not unknown.

⚠️ **A BETA TOOL IS OMITTED FROM THE ProShop EXPORT ENTIRELY — `buildProShopRows` returns NO rows for it.** It is a tool the shop may never buy, so it has no place in ProShop's inventory. Exporting it with a **blank Status cell would be actively harmful**, not merely useless: blank reads back as **Active**, so the next round-trip would quietly promote every beta tool. `exportSingleTool` returns **`false`** and `exportFullLibrary` returns **`{ skipped }`** — every caller reports it via `proShopExportMessage`, because "Exported 245 tools" when 3 were left out is a true-sounding number that isn't true.

⚠️ **The ProShop import never overwrites `beta`.** Status is otherwise PS-wins, but beta is an app-only state ProShop cannot express — a row saying Active is ProShop lacking the concept, not evidence against it.

### `replaced_by` — its own field, not a typed link

**`replaced_by`** holds the replacement tool's **tracking id** (metadata-only; ProShop has no equivalent attribute — its only Tools foreign keys are Made Of, Recommended Pre-drill Size and Insert). It is deliberately **NOT** part of `linked_tools`: that relationship is **symmetric and role-free** by design ("these go together", stored on both sides), and "A was replaced by B" is **directional**. Folding a direction into it would break the invariant that panel is built on. A future "categorize the type of connection" can absorb this as one type; until then it stays a plain FK.
- ⚠️ **A dangling `replaced_by` is SHOWN, never silently dropped** — it is the only remaining record that this tool was replaced at all. The header reads "(replacement removed)"; the edit form offers Clear.
- Leaving `retired` **clears** it (`setStatus`): "replaced by X" on a tool nobody retired is a stale claim.
- The picker is **`ToolLinkPicker`** — the same search the landing page runs, so a ProShop #, EDP# or retired ID finds the replacement exactly as it would anywhere else.

### Status markers in the description — BETA and RETIRED

Fusion has nowhere to store a status, and the description is the **one field a programmer reads when picking tools for a new job**. So the status rides in the description, always at the END. ⚠️ **The two markers follow DIFFERENT rules, on purpose** — see `applyStatusSuffix` / `withRetiredMarker` in `toolStatus.js`.

**`RETIRED` — ENFORCED, and auto-pushed to Fusion.** A deliberate, granted exception to "descriptions are never silently renamed". ⚠️ **The shop keeps running retired tools on already-programmed jobs** — they may even buy more of one to finish an old job — so retiring is *not* deleting. The marker exists precisely so that a programmer in **Fusion**, who cannot see this app, doesn't pick it for a **NEW** job. Applied by **`withRetiredMarker`** at both write paths (`writeLogicalTool` and `saveFullLibrary`), so every save carries it to Fusion by itself; un-retiring takes it off again. It only ever appends to the end, and it is a pure function of `tool_status`, so it can never go stale.
- ⚠️ **Re-applied AFTER the 3-way Fusion merge, not just at entry.** The merge can *adopt* Fusion's description (someone renamed the tool there and the app didn't), and an adopted value arrives without the marker — quietly breaking the invariant until somebody toggled the status. Enforcing it last means "a retired tool's description says RETIRED" holds whatever the merge decided. Locked by `retiredMarkerPush.test.js`, which asserts on the entry actually **uploaded to Fusion** rather than on the helper.
- ⚠️ **The replacement is NOT baked into the description.** It stays the `replaced_by` id, resolved live. A Tool ID renumber would otherwise strand a stale ProShop number inside every retired tool's name — the "store the id, render the name" rule.

**`BETA` — OFFERED, never applied.**

Every tool is created in this app, so its FIRST description is *generated*, and that is where the marker belongs: `buildDesc` appends ` BETA` when `f.status === 'beta'` (wrapped around the switch — it has 36 return sites and the rule belongs in exactly one place). Turning Beta **on** in `ToolForm` adds the marker only to a description that still equals what `buildDesc` would produce (one the form generated); a **hand-typed** name is never touched. Turning Beta **off** raises a prompt (`betaSuffixStale` → "Remove it"), it does not edit anything. `hasBetaSuffix` matches only at the END, so a tool genuinely named `BETA GRADE EM` survives.

### Display + filtering

- **`StatusBadge` renders NOTHING for an Active tool** unless `showActive` is passed. Active is the great majority of the library, so a badge on every card is wallpaper by day two — the point is that a tool which *isn't* active stands out. Uses the `--badge-color` token pattern, so a status can't render two ways on two screens.
- **The tool page header takes a colour wash** for a non-active tool (`.tool-sticky-header[data-status]` + `--status-wash`), on **both** the view and edit headers so it doesn't vanish mid-edit. An active tool's header is untouched.
- **Landing-page chip row**, always shown (unlike the machine row it needs no configuration). **Active + Beta on by default; Retired off** (`DEFAULT_VISIBLE_STATUSES`) — a retired tool is still in the library and still findable, it just isn't in the way. The row names what is hidden, and warns when every status is off, so a tool you can't see is never mistaken for a tool that isn't there.
- ⚠️ **`applyFilters` does NOT filter when `statuses` is absent or empty.** Every caller that doesn't know about status — the link picker, the merge flow, anything searching to FIND a specific tool — must keep seeing the whole library; hiding a retired tool from a lookup reads as the tool being gone.

Locked by `src/utils/toolStatus.test.js` + the `Status` column in `proShopRealExport.test.js`. Backwards-compatible/additive: nothing to re-enter.

-----

## Insert-Style Tools (holder body + insert pairings)

⚠️ **A COMPONENT IS A TOOL EVERYWHERE EXCEPT FUSION AND PROSHOP.** This is the rule to apply first when touching anything that walks the library. A holder body or an insert is a **real physical object** the shop buys, stores in a drawer, and looks up — so on the app's own side it must be treated **exactly like a tool**: same structured `tool_location`, same location systems, same bins, same duplicate/gap detection, same ID handling, same search. The two files (`tool_metadata.json` vs `tool_components.json`) exist for **one reason only** — a component must never reach Fusion, and separate storage makes that structurally impossible rather than something every writer has to remember. That is a storage detail; it is **never** a user-facing distinction and **never** a reason to treat the record differently in app logic.

**Only two boundaries legitimately differ:** **Fusion** (which sees one entity per *pairing* and must never see a component), and **ProShop** (which stores each component as its own `Tool #` row, and each *pairing* as a combined `holder/insert` id). Everywhere else, pool them.

⚠️ **The failure mode is always "I wrote `tools` where I meant records."** It is silent and it has already happened: `libraryLocationIssues` counted only tools, so on a real library **every component's bin was reported as an empty "skipped number"**, and a tool and a component sharing one drawer was invisible. `analyzeSystem` had the same hole, so normalize's "next available bin" would hand out a bin a component was already in. **When a function takes a library list, name the parameter `records` and pass `[...tools, ...components]`** — `LocationPicker`'s `locRecords` is the reference. Known remaining gaps are listed under TODO (search, and the Tool ID actions).

An insert-style tool (turning holders, boring bars, groovers, threaders, face mills, indexable drills, …) is **two separate physical objects paired for use**: a **holder body** and an **insert** — each with its own `tool_id`, location, and purchasing — plus a **pairing** (not a physical object) connecting one of each into the single unit Fusion sees as one tool entity. Canonical intent doc: `INSERT_TOOL_ARCHITECTURE_PROMPT` (the spec this was built from); pure logic + config: **`src/schema/insertFamilies.js`** (tested in `insertFamilies.test.js`).

- **The pairing IS the logical tool.** The spec sketched a separate `tool_pairings[]` array, but a pairing is 1:1 with the Fusion entity (which already carries description, presets, machine links, history), so it's an embedded **`pairing` object on the tool's metadata record** instead: `{ family, holder_component_id, insert_component_id, rta_number }` (in `buildMetadataTool` / `mergeFusionAndMetadata`; `null` for regular tools). One card in the library grid per pairing, exactly as Fusion sees it.
- **Components are metadata-only records — NEVER written to Fusion** (Fusion sees one entity per pairing; component entries would pollute the CAM library). They live in **`tool_components.json`**, the 5th shared Drive file (`{ version: 1, components: [] }`, seeded by `DEFAULT_COMPONENTS`, loaded/saved through the standard shared-file plumbing — `state.components` / `saveComponents`). Each record: stable UUID `id`, `role` (`holder_body` | `insert`), `family`, plus the tool-record essentials — `tool_id`, `description`, `designation` + a small per-role spec set (`COMPONENT_SPEC_FIELDS`), `unit`, structured `tool_location` / `bin_size_id` / `legacy_locations`, `purchasing` (same normalized shape as tools), primary photo, `notes`. Actions in `src/context/componentActions.js`: `saveComponent` (upsert), `assignComponentLocation` (metadata-only — never a Fusion round-trip), `uploadComponentPhoto` / `deleteComponentPhoto` (photos in `tool_files/{component id}/`). **No standalone browse page** (per spec) — components are reached only through the picker.
- **Internal family vocabulary** (`INSERT_FAMILIES`): `milling_insert`, `indexable_drill` (**`hasTier3Assembly: true`** — the existing Assembly system layers on top), the turning families (`od_turning`, `boring_bar`, `back_boring_bar`, `id_threader`, `od_threader`, `od_groover`, `id_groover`, `face_groover`, `part_off`, `knurling` — all `hasTier3Assembly: false`; the pairing itself is the turret-ready tool), and **`generic_insert`** ("Insert-Tipped / Indexable (other)") — the **catch-all for the ~5% of otherwise-solid tools that run an insert tip** (an insert-tipped key cutter / ball mill, etc.); `hasTier3Assembly: true` (keeps the holder + OOH assembly like a milling insert) and **no `PROSHOP_FAMILY_MAP` entry** (arbitrary types have no combined-ID convention). `suggestedTypes` maps families to Fusion tool types for pre-selection only.
- **Any tool type can be an insert tool.** The pairing/component model is entirely metadata-only, so a pairing can sit on ANY `tool_type` — nothing about it touches Fusion or the schema. There are two ways a tool becomes insert-style: (a) **always-insert types** auto-open the paired view (below); (b) **every other type opts in via the `ToolForm` edit-mode "Insert-Style Tool" toggle** — checking it sets `tool.pairing = newPairing(defaultActivationFamily(tool_type))` (natural family for known insert types, else `generic_insert`), with a **full-family dropdown** to refine it; unchecking clears the pairing (confirm prompt if components are linked — the component records are kept, just unlinked). This toggle is the single activation path (there is **no** view-mode "set up pairing" panel — it was removed). `INSERT_CAPABLE_TYPES` is now only a "possible" hint, not a gate.
- **Always-insert types open the paired view by default** (`ALWAYS_INSERT_TYPES` = `face mill`, `turning general`, `boring head` — **not** `drill`, which opts in via the toggle like any solid tool). For these types ToolDetail shows the paired view with a **derived family** even before any pairing is stored (`autoInsertFamily`: face mill → `milling_insert`, boring head → `boring_bar`, turning general → `od_turning` — the one ambiguous case, defaulted for the user to correct). The always-insert toggle is hidden in `ToolForm` for these types (they can't be "turned off"). This **auto (unsaved) pairing is never written until the user links a component** — `saveTool` is only called from `PairingSections.setComponent` (persisting the pairing + the chosen family together on the first link). While unsaved, the family renders as an **editable dropdown** in the pairing bar (`familyEditable = no component linked`); once a component is linked it's a read-only pill. **Tool-level Photo/Location/Purchasing hide on `hasComponents`** (≥1 component linked), NOT on the mere presence of a pairing — so an existing insert tool's tool-level data stays visible through the auto-view/setup transition and only disappears once data has actually moved onto a component. `PairingSections` takes `pairing` + `stored` props (keyed by `tool.id` so the draft family resets per tool); Unpair shows only for a `stored` pairing.
- **ProShop's letter prefixes live ONLY in `PROSHOP_FAMILY_MAP`** (sync boundary — never in UI labels, family ids, or search). `splitCombinedProShopId('TF-194/TO-195')` classifies a combined id **order-insensitively** into `{ family, holder_id, insert_id }`; `composeCombinedProShopId` emits holder-first, running each component `tool_id` through `ensureProShopPrefix` (keeps an existing prefix, prepends for bare numbers) and returns `''` for a family with no ProShop convention (e.g. `generic_insert`). `back_boring_bar`'s `TL` insert prefix is assumed shared with `boring_bar` — verify against a real ProShop export.
- **⚠️ The ORDER of a combined id is NOT a convention — which half is the body is STORED, never re-derived.** Both `holder/insert` and `insert/holder` occur in the real library. For the families whose ProShop letters carry meaning (`I`/`G`, `TF`/`TO`, …) `splitCombinedProShopId` classifies by prefix and order is irrelevant. But the shop deliberately files an **insert end mill** under the ordinary end-mill letter so ProShop's search still finds it (`A-123`), giving its body an arbitrary letter — so for `generic_insert` the letters say nothing and positional order is a **guess**. `pairingFromCombinedId` therefore returns **`order_unconfirmed: true`** on the positional fallback, `derivePairings` stores the resolved numbers as **`pairing.holder_proshop_id` / `insert_proshop_id`**, and `PairingSections` **asks once** ("Which of these is the holder body?") — the answer is stored, and swapping also flips each existing component's `role`. ⚠️ This matters because **`insertComponentIndex` turns those roles into real component records** on the next ProShop import, so an unconfirmed guess would create both components back-to-front; it now prefers the stored numbers over parsing. **Output is always holder body first** (`composeCombinedProShopId`), which also now composes for a no-convention family instead of returning `''` — that was the one case most needing generation and it had to be typed by hand. This is the **transport-format** rule from **Relational integrity**: a formatted string carries the link across the Fusion boundary, it is never the link.

- **The `/` in a Fusion product-id IS the insert-tool indicator** (any tool type). Fusion carries an insert tool as ONE entry whose `product-id` is the two ProShop numbers joined with a slash (`TF-194/TO-195`, `A-103/ I-98` — spacing varies); ProShop itself never uses the slash (each component is its own `Tool #` row with its own location + purchasing — confirmed against `FUSION TOOL Library REF/`). **Load-time auto-detect** (`derivePairings`, called in `loadTools` / demo / local — read-only, like `backfillAsmNumbers`): a tool with a combined `tool_id` and no stored pairing gets an **in-memory** `pairing` — family via `pairingFromCombinedId` (known prefix pair → its family; else the tool type's `defaultActivationFamily`, i.e. `generic_insert`, with holder = first token / insert = second), component links resolved by ProShop number (`normProShopId`, dash/space/case-insensitive) against existing component records (null until they exist). Persisted lazily on the tool's next save. **Round-trip is safe**: `internalToFusionTool` writes `product-id: tool.tool_id` verbatim, so the combined id pushes back to Fusion unchanged, and the pairing/components never leak (metadata-only) — locked by `fusionConvert.test.js`.
- **ProShop upload populates the components by number** (`ImportFlow.matchProShopToTools`). ProShop has each component as its **own** `Tool #` row (never a slash — confirmed against the real export), so `insertComponentIndex(tools)` maps each insert tool's two ProShop numbers → `{ role, family }`, and a row whose `Tool #` hits the index **routes to a component record instead of a tool** (create if new via `newComponent`, else update) — filling its own `location` (free text) + `purchasing` (same `buildPurchasingFromGroup`, multi-row Approved-Brand supported). It **never falls through to `psRowToTool`**, so no Fusion-only placeholder is minted for a component (see TODO). Components are saved to `tool_components.json` on commit (`saveComponents`, upsert by id); the pairing → component links are re-resolved by ProShop number on the next load (`derivePairings`), so a **reload is needed** for the freshly-imported components to appear linked in the paired view (data is persisted immediately, linking is lazy). Verified end-to-end against `FUSION TOOL Library REF/ProShop Reference Data/`. **ProShop *export* of pairings (two rows back out) is still deferred.**
- **Assembly numbers — both component ids ALWAYS included** (the operator needs both drawers): tier-3 families keep per-assembly `asm_number` with the id token `{holder_id}+{insert_id}` (`pairedAsmIdPart` — fed into the normal `composeAsmNumber`; `writeLogicalTool` and `backfillAsmNumbers` are pairing-aware and now take components). Non-tier-3 families get a **pairing-level** number `{holder_id}/{insert_id}` (`pairingAsmNumber`) — **derived at render, never stamped/stored** (re-derivable like any Auto value); their single instance is skipped by asm stamping/backfill. In `proshop_rta` mode the manual **RTA# lives on the pairing** (`pairing.rta_number`, edited in the pairing bar) — RTA is structurally the 2-tier pairing, regardless of whether a tier-3 assembly also exists.
- **UI (`ToolDetail`)**: when `tool.pairing` is set, **`PairingSections.jsx`** renders a **pairing bar** (family pill, pairing asm# / RTA# field, the composed **Combined ID** with an explicit "Apply as Tool ID" action — generation never auto-runs — and Unpair) plus **two component group cards** (Holder Body / Insert), each duplicating **Geometry & setup (specs), Photo, Location, Purchasing** for its component. Groups are told apart by `--pairing-accent` (holder body = `--holder-default` teal, insert = `--orange`; `.pairing-*` CSS block). The tool-level Photo/Location/Purchasing panels are **hidden** once components are linked (`hasComponents`); Jobs, Notes & Tags, Files, Presets, History stay shared; the Geometry section is retitled **"Combined Geometry (Fusion)"**; the Assemblies section renders only for `hasTier3Assembly` families. Activation is the `ToolForm` edit-mode toggle (above) — there is no view-mode setup panel. **`ComponentPicker.jsx`** is the searchable select-or-create-inline modal (same reusable-entity pattern as purchasing manufacturers). `PhotoSlot` was extracted to `PhotoSlot.jsx` (generic `record` prop); `LocationPicker` gained `record` + `onAssign` props and counts component bins in suggestions/collision checks.
- **Demo**: `src/demo/demo_components.json` + a `pairing` on FTL-00000A (the boring bar) render the full linked paired view in `?demo=true`; the face mill (FTL-00000B, product-id `I-167/ G-168`) is **auto-detected** by `derivePairings` from its combined product-id — classifying `milling_insert` with empty component slots + keeping its tool-level purchasing/location visible. Tool saves stay read-only in demo, but component/shared-file edits use the in-memory demo branch.
- **Deferred (not built)**: ProShop CSV **export** of pairings (two rows back out — the translation helpers are ready + tested; confirm the format against a real ProShop export first), search matching on component `tool_id`s, component delete/cleanup, the rare dual-insert-per-body case, `Q` (saw arbor) / `T` (hardware) prefixes. (ProShop **import** → component population is now wired — see above.)

-----

## Probe (CMM Stylus) Support — a real tool type, deliberately minimal

A **probe** is a real Fusion tool type (`type: "probe"` — confirmed from a shop export, `FUSION TOOL Library REF/Probe REF/`) used for in-machine touch-probing, not cutting. It gets **just enough** support to be a first-class tool — searchable, has a Tool ID, matches on Sequence Detail import, shows its geometry and baked holder — **without** the full editing/creation/extraction machinery every milling/turning/hole-making type gets. That asymmetry is deliberate, not an oversight: probe's Fusion schema (geometry AND presets) is different enough from every other type that plugging it into the generic editing pipeline would either need ~50 rows of new `FIELD_VISIBILITY` matrix entries for no real benefit, or would corrupt it outright (see below) — for one shop tool (today), full support isn't worth either cost.

- **NOT added to `TOOL_TYPES` (`TT` in `tool-extractor.tsx`).** This is the one deliberate scope line: it keeps probe out of the Add-Tool type grid, the search page's type-filter tiles, and the legacy `FIELD_VISIBILITY` index-matched matrix (index-based on `TT`'s position — inserting a type there means appending one column to ~50 rows, a maintenance trap for a type that needs none of that support). A probe is never *created* through the app; it always arrives already loaded from the Fusion library (exactly the real-world case — it's already in the shop's library). This means it also can't be filtered by the type-grid tile on the search page — findable by text search (tool_id, description) instead, an acceptable trade for how few of these exist.
- **Reads generically, no code needed.** `fusionToolToInternal` already maps `geometry.DC`/`SFDM`/`OAL`/`LCF`/etc. by field name, not by type — so diameter, shaft diameter, overall length all populate correctly with zero special-casing, and the modern `fieldRegistry.js`/`fieldsForType()` system (which ToolDetail/ToolForm actually render from, NOT the legacy `FIELD_VISIBILITY` matrix) gracefully shows only the `appliesToTypes: 'all'` fields for an unlisted type — no crash, no empty page.
- **⚠️ The one real bug this would otherwise cause — preset corruption on EVERY save.** A probe preset's real shape is tiny (`{ guid, name, v_f_leadIn, v_f_link, v_f_measure }` — Lead-In/Link/Measure feedrate; no spindle speed, no `v_c`, no stepdown/stepover, no coolant). Before the fix, `normalizePreset` had no `probe` branch, so it fell into `isMilling` and injected a full fictitious milling preset shape (`n`, `v_c`, `v_f`, `f_z`, `use-stepdown`/`use-stepover`, ramp fields, …) — and because a probe preset has neither `n` nor `v_c`, `internalToFusionTool`'s `isBlankPreset` check also read TRUE, seeding Fusion's default-formula block on top. **This would have fired on every ordinary write** — renumber, Assign/Re-number Tool IDs, location assign — none of which touch the preset editor. Fixed with an `isProbe` branch in both functions (`src/schema/fusionConvert.js`): `normalizePreset` returns the preset almost untouched (only the universal app-only-key strip applies), and `internalToFusionTool` skips the flat speed/feed sync block and never treats a probe preset as "blank." Locked by the `probe (CMM stylus) round-trip` suite in `fusionConvert.test.js` **and** by the real reference file (`Probe REF/Probe Only.json`) now included in `scripts/roundtrip-audit.mjs`'s file list — `probe` shows as a clean type with zero unexpected diffs.
- **Holder: preserved, never adopted into the app's holder library.** A probe's baked Fusion holder (the measuring head, e.g. `"Blum TC52/TC62 with BT30 - BTH 25"`) is a real, one-off object — this shop doesn't reuse it on any other tool, so it's deliberately never entered into `holder_library.json`. Two things make this safe by construction rather than by exception:
  - `splitToFusionInstances`'s existing fallback (`base.holder = resolved ? buildHolderObject(resolved.entry) : (raw.holder || undefined)`) already preserves the raw Fusion holder byte-for-byte whenever no app holder record resolves — which a Blum stylus holder never will, since it's never imported. No code change needed here; this is the same fallback every unmatched holder already gets.
  - `'probe'` was added to **`HOLDER_LINK_SKIP_TYPES`** (`src/utils/holderLink.js`, alongside `'turning general'`) so it's excluded from the **Link tools to holders** worklist — otherwise its assembly (which `buildLogicalTool` auto-creates from the baked holder guid/description, same as any tool) would sit in the "candidate/none" tier forever, asking the user to link a holder that will never have a second user. It still shows on the Assemblies section of `ToolDetail` (holder description + OOH) via the existing `HolderTag` fallback path — that's the "see it and reference it" part, just without being pulled into the Holder Management System's identity/push/re-stamp machinery.
- **ProShop group letter "S — CMM Styli"** was already seeded in `PS_GROUPS` (pre-existing). `AUTO_GROUP['probe'] = 'S'` was added so an existing probe tool exports with the correct Tool Group column. The reverse direction (`typeFromProShopGroup`'s `'S'` case) is **deliberately left unmapped** — a bare ProShop row with group `S` still falls back to the documented "no tool type" behavior (`flat end mill` + `no_fusion_link`, flagged for manual cleanup), the same as the other insert/saw/holder letters. This keeps the only entry point for a `probe`-typed tool as "already exists in the Fusion library," matching how the real one actually got here.
- **Icon**: a small dedicated case in `ToolTypeIcon.jsx` (thin shaft + ball tip, no flutes — it doesn't cut).
- **Presets are READ-ONLY for a probe** (`PresetPanel`, `isProbe`). The app deliberately does not build a probe preset editor (its shape — Link/Lead-In/Measure feedrate + strategy association, no spindle speed, no material, no stepdown/stepover — is nothing like the milling editor). The milling `EditCard` would both mis-render a probe preset AND, on Save, inject milling fields (`n`/`v_c`/`v_f`/`use-stepdown`/`strategies`/…) that `normalizePreset`'s probe passthrough would then carry straight into the Fusion probe preset. So for a probe the Presets section shows the preset (with a muted "Managed in Fusion") but hides **Edit / Add / Delete / drag-reorder**; only the read-only "Copy as Fusion JSON" export stays. This is the primary guard against preset corruption — the ordinary write path (renumber, tool-ID/location assign) never opens the editor and is already clean (round-trip audit), and the read-only UI closes the one path that could inject. The data-layer fix above is the backstop.
- **Never gets a material — skipped everywhere material is assigned.** Fusion's probe preset editor has no material selector, so every material path is a no-op for a probe, in three places that each had to be checked: (1) **`overlayPresets`** takes a `{ toolType }` option and does NOT run the name→material `matchMaterial` inference for a probe — otherwise a probe named with a stray material keyword ("AL …") would get a `material.query` injected in-memory that then leaks to Fusion via the passthrough; (2) **`NormalizeModal`** renders "—" for BOTH the material picker and the op-type dropdown on a probe (same as it already does for op-type on hole-making), so a user can't pick a material/op that would be written into the probe; (3) **`normalizeLibrary`** short-circuits (`isProbeTool` → returns each preset untouched) so even a stray `matOverride` can't assign a material/op/name to a probe. The material-linking detectors (`unresolvedMaterialPresets`, `stockMaterialIssues`, `autoLinkMaterialByGrade`, `backfillMaterialPresetIds`, `bareCodeGroups`) all already skip a preset with no `material.query`, so a probe never appears in `MaterialLinkBanner` either. Locked by `logicalTools.test.js` (the overlayPresets gate) + `fusionConvert.test.js` (round-trip).
- **Minor accepted cosmetic quirk**: a couple of `fieldRegistry.js` fields with `appliesToTypes: 'all'` or a broad `NO_*` set (e.g. `flute_length` → `geometry.LCF`, which Fusion's own probe schema happens to also carry, value `6`, meaning unknown/internal to Fusion) will display on ToolDetail with a label that doesn't really apply to a probe (e.g. "Flute Length: 6mm"). Left alone deliberately — narrowing `appliesToTypes` further for one type is exactly the kind of per-type exception surface this feature avoids opening, and the value is harmless clutter, not wrong data.
- **One-time normalize note**: running **Normalize** on a probe leaves its preset entirely untouched (the `normalizeLibrary` `isProbeTool` short-circuit above) — `operation_type` stays null, the name stays "Default preset", no material is assigned. In `NormalizeModal` the probe's preset row shows "—" in both the material and op-type columns, so there is nothing to decide.
- **⚠️ The probe's machine tool number is LOCKED at T99 — never renumbered/reassigned.** The machine calls the probe at a fixed T#; the reference probe is T99, and 99 already lives in the reserved `machine_number.skip` list `[98, 99, 100]` which holds it FREE for the probe. The bug this closes: now that the probe is a real tool sitting on a *reserved* number, every machine-number bulk op (`renumberLibrary`, `fixDuplicateMachineNumbers`, the ImportFlow assign, `normalizeLibrary`'s collision reassignment) would otherwise try to move it *off* 99. The fix is a **type lock**: **`MACHINE_NUMBER_LOCKED_TYPES = new Set(['probe'])`** in `src/utils/idSystems.js`, and **`isExcludedFrom(tool, 'machine_number')` returns true for a probe by type** (on top of the per-tool `id_system_exclusions` flag). Because every machine-number op already respects `isExcludedFrom`, that single predicate covers `renumberLibrary` (skips it, doesn't consume a number), `fixDuplicateMachineNumbers` (skips it), and the Settings "machine number issues" detector (`findMachineNumbersToFix` is called on `tools.filter(!isExcludedFrom(…, 'machine_number'))`, so a probe on reserved 99 is NOT flagged — but a *real* tool wrongly on 99 still is). Two mutation sites don't route through `isExcludedFrom` and got explicit guards: **`normalizeLibrary`** keeps a locked tool's number verbatim (no `resolveMachineNumberCollision`), and **ImportFlow `assignMachineNumbers`** skips locked tools in BOTH modes (the `'all'` renumber-from-30 would otherwise overwrite it; `'fill'` already keeps it via `hasMachineNumber`). The Settings renumber **preview** (`startPreview`) also skips locked types (keying off the Fusion `type`, which is `'probe'`) so it doesn't promise a change that won't happen. The lock is machine-number-ONLY — a probe still gets a real **Tool ID** and **Location** (not auto-excluded from those). **Deferred (simple, later):** a Settings control to set the probe's T# to something other than 99 — until then the probe simply keeps whatever machine number it already carries, and `MACHINE_NUMBER_LOCKED_TYPES` is the seam that control will build on. Locked by `idSystems.test.js`.

-----

## The Problem Being Solved

Current workflow:

1. Open master tool library in Fusion 360 (stored in Autodesk cloud)
1. Copy a tool into a job file
1. Edit speeds, feeds, and other details for that job
1. Forget (or avoid) syncing changes back to master
1. Result: outdated master, lost edits, duplicates everywhere

This app fixes that by being the authoritative place to manage tools, with a proper compare/merge workflow (Phase 2) for committing proven job values back to master.

### A tool copied into a job is a FULLY INDEPENDENT COPY (no live link to master)

This is the foundational fact the whole sync design rests on. When a programmer copies a tool from the cloud master library into a job file, Fusion makes a **complete, independent snapshot** — there is **no maintained link** back to the master. The relationship is **one-way at copy time** (the job pulls a snapshot); after that the job's copy and the master evolve separately. Consequences that drive the architecture:

- **Nothing updates an in-job tool from master automatically.** Once a job tool has connected toolpaths it doesn't sync with the cloud library at all — editing the master (or this app) has zero effect on it. Getting a new/updated preset onto a tool **already in a job** requires an **in-job replace**: Fusion's own "replace tool from library," or a third-party add-in that reaches into the open job and swaps it. There is no file/clipboard shortcut (see **Copy preset as Fusion JSON**).
- **This is why Phase 2 (compare/merge) exists.** Proven job edits can only come back to master by **re-importing the job tool and diffing it** against master — there's no live feedback channel to read them off automatically.
- **It's also why duplicates proliferate.** Independent copies with no back-link are exactly what let the old workflow spawn divergent, unsynced versions of the "same" tool.

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
├── shop_settings.json           ← Shop-wide settings (shared)
├── parts.json                   ← PARTS module: parts → routings → operations (shared)
├── tool_components.json         ← Holder body / insert component records for insert-style tools (shared)
├── program_details.json         ← Parsed Sequence Detail per program: condensed tool list + version (shared)
├── holder_library.json          ← The APP-OWNED holder library: holder records + parts (shared)
└── ProgramFiles/{O####}/        ← Each program's RAW posted files, byte-for-byte untouched

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

- **Registry** lives in `shop_settings.json` (shop-wide on Drive) under `tool_libraries[]` / `holder_libraries[]` / `default_tool_library_id`. Each entry is an APS location `{ id, hubId, projectId, folderId, itemId, fileName, order }` where **`id === itemId`** is the canonical **library_id**. It is **also mirrored to localStorage** (`aps_library_registry`) so an APS-only session (Drive optional) still knows which libraries to load — Drive wins when present, the mirror is the fallback/seed. `seedShopSettingsRegistry` (`src/context/appState.js`) seeds the registry from the mirror, then the legacy single-location keys (`aps_library_location` / `aps_holder_library_location`), so an established single-library shop upgrades with no data migration.
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

⚠️ **`.env` exists ONLY on the developer's machine.** In an agent, cloud or CI session it is absent by design — see "Running the app in an agent / cloud / CI session" above for what that breaks (`vite build`, `npm run dev`) and how to run the app anyway. Do not treat its absence as a problem to solve.

APS setup: create a "Single Page App" at https://aps.autodesk.com — **not** Web App. PKCE requires SPA type. Register the callback URL (GitHub Pages URL for deploy, `http://localhost:5173/Master_Tool_Data/` for dev).

Google setup: authorized JavaScript origins must include `https://incrementaldan.github.io` (no path, no trailing slash).

-----

## API Keys & Secrets

The real API keys are stored in GitHub Actions Secrets — not in the repo.
A `.env` file exists **on the developer's machine only** — never in an agent, cloud or CI session (see the section above). Do not modify, recreate, or delete it, and do not create a substitute.
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

**⛔ Do NOT run `npm run deploy` from an agent, cloud, or CI session.** That command bakes env vars from a local `.env`, which does not exist in those environments — it will publish a credential-less build and break the live site (shows "Configuration Required"). That same missing `.env` is why a local `vite build` here produces an app-less bundle and `npm run dev` shows the config screen — expected, not a fault; see "Running the app in an agent / cloud / CI session" near the top for how to run the app anyway. `npm run deploy` is only valid as a manual fallback on a developer machine that has a complete local `.env`. The normal, preferred path is always GitHub Actions.

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

The `fusionToolToInternal()` and `internalToFusionTool()` functions in `src/schema/fusionConvert.js` (exported via the `toolSchema.js` barrel) handle all conversion. Key field mappings:

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
| `product_link` | `product-link` (+ `expressions.tool_productLink`) | — | The **ProShop tool page URL**, composed from `tool_id` (`A-25` → `…/procnc/tools/A/A-25$`) by `proShopLinkForWrite` (`src/utils/proShopUrl.js`) at every `writeLogicalTool`. ⚠️ **In `proshop` ID mode the ProShop page WINS** — it is the shop's own record of the tool, so it overwrites whatever else is in the field, including the **manufacturer product page** a scanned spec sheet puts there (that link also lives in `purchasing.*_url`, which is metadata and is not touched). The one no-op is a link **already pointing at this tool**, however spelled — 11 real ones carry a pasted browser session tail (`$hour=…&page=…&token=…`) and 1 has no trailing `$`: same page, not wrong, so rewriting them would be churn. Nothing is written at all when the URL **can't be composed** — a blank id, or a **combined insert id** whose ProShop page is `/procnc/rtas/{year}/{n}$` — so an insert tool's real RTA link survives. Skipped entirely in any non-`proshop` ID mode (the Tool ID isn't a ProShop number there). Locked by `proShopUrl.test.js`, incl. "would rewrite NOTHING in the existing library" |
| `tool_id`     | `product-id` (metadata-owned, mirrored) | `Tool #` (export id `toolNumber`) | **Metadata-owned** (source of truth), mirrored to Fusion `product-id`; metadata wins on read. **Primary match key for Phase 2** |
| `purchasing.manufacturers[]` / `purchasing.vendors[]` | — (metadata only) | `Approved Brand` / `Vendor` / `EDP#` / `Cost` (sub-table) | Normalized purchasing model — see Purchasing / Vendor Data Model section |

**Important**: `tool_id` (our field) = Fusion's `product-id` field (shown as "Vendor Number" in Fusion UI) = ProShop's `Tool #` (the ProShop primary key). It is the primary key for Phase 2 tool matching and for grouping ProShop CSV rows on import. It is **metadata-owned** (the source of truth lives in `tool_metadata.json`) and **mirrored** to Fusion's `product-id` on write; on read, metadata wins and falls back to `product-id` only for pre-TMS tools. Previously-assigned IDs retired by a re-number live in metadata `legacy_ids[]`.

**Assembly export**: When exporting a tool with an assembly selected, the assembly gauge length is written as `geometry.assemblyGaugeLength` (Fusion-native, nested in `geometry` — **not** a root-level `assembly-gauge-length`). Its value is **holder gauge length + OOH**, in the tool's unit. OOH is stored in the tool's unit (written raw to `geometry.LB`); only the holder's `gaugeLength` (in the holder's unit) is converted into the tool's unit via `convertLength` before adding the OOH.

### Metadata Schema (`tool_metadata.json`)

Stored in a single file on Google Drive. The file contains an array of metadata objects — one per **logical tool**. The `id` field is the tool's **`tracking_id`** (`FTL-XXXXXX`), falling back to the Fusion `guid` for pre-migration untracked tools — it is **not** keyed per Fusion instance. `buildMetadataTool` in `src/schema/metadataModel.js` is the authoritative source of the full field set (the example below is abridged); add new metadata fields there and read them back in `mergeFusionAndMetadata` (same file) / `buildLogicalTool` (`logicalTools.js`). Note `tool_id` **is** written to metadata — it is **metadata-owned** (source of truth) and mirrored to Fusion's `product-id`; `legacy_ids[]` (retired IDs) is metadata-only. Other metadata-only fields include the structured `location` object (internal `tool_location`), `bin_size_id`, and `legacy_locations[]` (see Location System) — the composed display string is derived, not stored.

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
      "type": "photo | spec_sheet | data_extraction | speeds_feeds | model_3d | fusion_file | other",
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

The Fusion holder library is a separate JSON file stored in APS (same hub/project as the Fusion tool library). ⚠️ **It is no longer the source of truth** — the app owns `holder_library.json` on Drive (see **Holder Management System** below); the Fusion file is an import source and an export target. `state.holders` is the raw Fusion list, still read at load and still the fallback for a holder the app hasn't imported yet.

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

### Reach & undercut — the necked shank above the flutes

A **reach** tool keeps its cutting diameter (or a hair under it) for some distance **above** the flutes, so it can drop into a deep pocket without the shank rubbing. An **undercut** is that neck ground a little *under* the cutting diameter. All three fields are **metadata-only** (`reach`, `has_undercut`, `undercut_diameter`). Pure helpers: `src/utils/toolReach.js`.

⚠️ **THE APP MUST NOT CHANGE WHAT IS IN FUSION HERE, AND THIS IS THE GOVERNING RULE.** Fusion is the more correct source for shaft geometry: the app has no segment UI, and how each tool type relates shaft segments, shoulder length and Fusion's own **collision detection** is not something the app models. So reach is read *from* Fusion and stored beside it — nothing writes back, nothing is corrected, and **no warning fires** on a segment tool whose shoulder looks imperfect. Locked by a whole-library test asserting zero shaft segments altered and zero app-only keys in the Fusion JSON across all 303 tools, with the undercut answered by hand.

⚠️ **`REACH_TYPES` — face mills and boring heads are excluded.** A face mill's body steps down from its cutting diameter because that is its shape, not because anything was relieved to clear a pocket wall, so the arithmetic produces a real number describing something else entirely (a 2" face mill computes to 1.16). Boring head and turning are out via `NO_BORING_TURN`; face mill is named explicitly. ⚠️ The gate is enforced in **`deriveReach` as well as the registry** — a UI-only gate would still let the seed stamp a number into the metadata file that nothing renders.

**The rule, and it is exact:** `reach = flute_length + every leading shaft segment still at or below the cutting diameter`, stopping at the **first** segment that goes above it. Fusion stores `shaft.segments[]` tip-first (same bottom-up ordering holder segments use), in the tool's own unit.

⚠️ **THE STOP IS AT THE START OF THE FIRST OVERSIZE SEGMENT, not partway through it.** That segment is usually a taper (`.038 → .125`) crossing the cutting diameter somewhere in the middle, and interpolating the crossing point is an obvious-looking "improvement" that would move every number in the library. Don't: the whole-segment answer is what the shop wrote by hand. `1mm (.039) 3FL EM .059LOC .203 REACH` = LCF `.059` + one `.144` neck segment = **exactly** `.203`, and the same rule reproduces `.5 REACH`, `.312REACH`, `.4 reach` and `12x Reach` across the real library. Locked by `toolReach.test.js`, which asserts against the real export rather than a fixture.

⚠️ **`reach` is NULL, never `flute_length`, when there is no neck.** Every tool reaches as far as its flutes, so storing that would put a number saying nothing on ~280 records — and it is what makes the description rule fall out for free (see below). Blank is the honest default and the one the seed is allowed to fill.

⚠️ **AN UNDERCUT IS A FACT ABOUT THE GEOMETRY — the neck above the flutes is narrower than the cutting diameter. That is the whole rule.** It is not a judgement about *why* it is narrower, or by *how much*. A key cutter's arbor genuinely is narrower than its cutter, so it is undercut; a saw, a lollipop stem and a dovetail shank likewise. How much of an undercut it is does not change what it is.

⚠️ **DO NOT RE-ADD A PERCENTAGE THRESHOLD.** An earlier pass gated it at 92% of the cutting diameter so those tools would not count — real undercuts clustered at 96–97%, structural necks at 61% and below. It was wrong twice: the number was reverse-engineered from a gap that happens to exist in today's 303 tools (wrong the first time a tool lands in between), and the question it answered — "was this deliberately relieved?" — is not the question being asked.

**The only tolerance left is for FLOAT NOISE** (`NOISE = 1e-6`), which is a different kind of thing: it asks *"is this actually narrower, or the same number after a JSON round trip"*, never *"is it narrow enough to count"*. Set far below any real grind (a tenth is 0.0001") and far above a double's ~1e-15 relative error. A half-thou under **is** an undercut.

**Three answers, not two.** `hasUndercut` is `true` (a narrowed neck), `false` (Fusion drew a shaft and nothing is narrowed — the app *can* say no), or `null` (**Fusion drew no shaft at all**, so it genuinely cannot say; the shank could be reduced and simply undrawn). `null` is what leaves the question open for the shop.

⚠️ **THESE ARE ARITHMETIC, NOT RECORDED OPINIONS — so they are RE-DERIVED on every load, not filled in once.** Reach IS flute length plus the neck; change either and the reach genuinely changed, so freezing a stored value means the number silently stops describing the tool. Same shape as an Auto `asm_number`: *a pure product of its fields, so a stored value that differs from the composed one is always stale, never custom*. The stored copies exist only so the values are **searchable** and so a tool whose shaft Fusion never drew can still carry a **hand-typed** number.

**`resolveReachForTools(tools)`** is that load-time pass (all five `loadTools` build sites, incl. demo and local mode). ⚠️ **The segments win wherever they can answer** — a typed reach survives only on a tool with no drawn shaft. It returns the **same array and the same tool references** when everything already agrees, so callers can use identity to tell there is nothing to persist. Idempotent. Measured on the real library: **20 reach · 18 undercut · 33 explicit "no" · 252 unknown**, second run a no-op.

⚠️ **`undercut_override` IS A SEPARATE FIELD ON PURPOSE.** Comparing a stored boolean against the derived one cannot tell *"the shop said so"* from *"this is ours and went stale"* — the same reason preset names check their SHAPE rather than equality, and with only two possible values a stored-vs-derived compare is pure guesswork. The pill writes the override; **`↺ Auto`** clears it and hands the answer back to the segments. An override to **No** drops the derived diameter, because it then describes nothing.

⚠️ **A DERIVED DIMENSION IS READ-ONLY IN THE UI** — Reach and Undercut Ø render as read-outs ("from the shaft segments") wherever the segments answer them. Rendering them as inputs invites a value the next load silently re-derives away, which is the failure this whole rule exists to remove. They become editable only where Fusion drew no shaft. **`reachIsDerived(tool)`** is the one predicate: it asks whether there are segments to read, **not** whether a reach came out of them — a drawn shaft whose first segment is already wider than the cut has an answer, and the answer is *"no reach past the flutes"*. ⚠️ Reach was an input while the Undercut Ø beside it was not, so on a segmented tool a typed reach looked like it worked and was gone on the next load.

⚠️ **"CANNOT SAY" MUST NOT RENDER AS "NO" — IN BOTH PILLS.** The undercut pill exists TWICE (the tool page's `ToolFields` and the Tool Profile's Cutter panel), and the bug had to be fixed in each; a fix to one is not a fix. `has_undercut` has three states and the pill has two buttons, so the compare has to be strict: `!!null === false` lit **No** on every tool Fusion drew no shaft for — asserting an answer nobody had gone and got, and hiding that the question was open. Neither button is lit for `null`, and the hint under it says which case it is (*"From the shaft segments"* vs *"Fusion drew no shaft — nothing to derive it from"*); the second was previously shown in both cases, pointing at data that did not exist.

**The description names reach ONLY when it exceeds the flute length** — the user's rule, and the reason `reach` stays null otherwise. `applyReachSuffix` wraps `buildDesc` rather than touching its 36 return sites (same precedent as `applyStatusSuffix`, which still lands last): `1mm (.039) 3FL EM .059LOC .203 REACH`. ⚠️ A **thread mill's** reach predates the field — the shop recorded it in the shoulder length — so that legacy read fires **only while `reach` is blank**, otherwise the name would carry REACH twice. One `reachToken` helper spells it for both.

⚠️ **METADATA-ONLY IS NOT A GAP HERE.** Fusion has no "reach" field — it has the **segments the number is computed from**, and those already round-trip untouched (`shaft` survives the `...existing` spread in `internalToFusionTool`; verified across all 303 real tools: zero segments altered, zero app-only keys leaked). So "if Fusion has a place for it, Fusion must have it" is satisfied by the segments, not by mirroring a derived scalar into a field Fusion would reject.

⚠️ **NO VALIDATION, AND THAT IS DELIBERATE.** Reach is not in `validateGeometry`'s length chain and raises no warning, not even on a segment tool whose shoulder disagrees with it. The only things anyone is confident of are the ones already enforced elsewhere (a stick-out cannot exceed the OOH / MIN OOH); everything past that would be a guess about tool types the app does not yet model. Do not add a reach↔shoulder rule without the shop defining one first.

**Searchable from the landing page**: `reach` is a numeric facet (in the tolerance list alongside `diameter`/`flute_length`) and `has_undercut` a Yes/No one. `undercut_diameter` is deliberately **not** a facet — it is optional even when the pill is on. In the UI (`ToolFields`) the undercut is a **Yes/No pill toggle** (`.undercut-pill`, orange), and the diameter box is hidden in **both** modes until the pill is on — an empty box next to a "No" asks for the diameter of something that isn't there. All three are in `VIEW_HIDE_WHEN_EMPTY`, so they appear only on tools that carry an answer.

**Deferred to Phase 2** (see TODO): a segment editor, writing segments back to Fusion, extraction of reach from a spec sheet, and reconciling the handful of tools that recorded reach in `shoulder_length` with no usable neck segment.

### Tool Profile — the whole tool on one dimensioned drawing

Fusion splits a tool across four tabs (General / Cutter / Shaft / Holder), so no screen ever shows the tool. **`ToolProfileModal.jsx`** does: one vertical silhouette, tip down as it hangs in the spindle, with the geometry as engineering-print dimensions whose **value boxes ARE the editable fields**. Opened by the **Profile** button in `ToolDetail`'s action sidebar. Pure geometry: `src/utils/toolProfile.js`.

⚠️ **DELIBERATELY A SEPARATE POP-UP.** It does not replace the Geometry section — that keeps working exactly as it did. Additive until the two are merged on purpose.

**The stack it draws** (confirmed against a real export and Fusion's own Shaft tab): `0 → LCF` the flutes at the cutting diameter · `LCF → LCF + Σh` the shaft segments (stored **tip-first**; Fusion's Shaft TAB numbers them top-down, so the table here is the reverse of the array) · `LCF + Σh → OAL` plain shank at the shank diameter.

⚠️ **SHOULDER LENGTH IS A DIMENSION, NOT A SOLID** — the unbroken shoulder measured from the tip, so it *overlaps* whatever the stack already drew. It renders as a band **on top** of the solid, only over the span past the flutes, with its top edge drawn. Drawing it as a region would double-count the flutes; drawing it *underneath* hid it entirely and left only its overhang showing, which read as a second block of a different colour. On a tool whose segments disagree with it, the app still has no opinion (see **Reach & undercut**).

### Editing the shaft segments

⚠️ **THE SHAFT PROFILE IS DEFINING GEOMETRY — the same class of field as the cut diameter or the overall length, not an add-on.** Fusion's UI makes it look optional (its own tab, off to the side, most tools without one), and the app ignored it entirely until now — but a tool whose real shank is narrower than Fusion thinks is a tool that crashes, and the shop used to carry that difference as tribal knowledge because CAM had no collision detection to catch it. Recording it accurately is what moves the surprise from the machine (where it costs money) to CAM (where it costs nothing).

**The practical test, and it is the one to run on any new code touching it:** *every path that carries the diameter must carry the shaft.* Each of these was a real hole found by asking exactly that:

| Path | What was wrong |
|---|---|
| `fusionToolToInternal` / `internalToFusionTool` | — (built with the feature) |
| `splitToFusionInstances` | — (`shaftEdited`, below) |
| `buildMetadataTool` / `mergeFusionAndMetadata` | — (built with the feature) |
| **`DRIFT_FIELDS` + `driftEqual`** | an array needs its own compare — see below |
| **`sharedSignature`** (reconcile) | a stray with a different shaft read as a duplicate |
| **`DIFF_SECTIONS`** (Sync Job) | absent from the Geometry diff — the one screen where the user decides which geometry wins |
| **`parseIncoming`** (clipboard TSV) | the column was written but never read, so a pasted job tool arrived with **no** shaft — which then diffs as *deleted* |
| **`buildFusionTsv`** (clipboard/CSV out) | read the raw Fusion entry, so an app edit exported the OLD profile and a no-Fusion tool exported **none** |
| **`valuesEqual`** | sorted and stringified arrays — `[object Object]`, and sorting throws away the tip-first order that IS the geometry |
| **`combineToolsByToolId`** | `isPrim` excluded every array, so two records sharing a ProShop number that disagreed about the shaft merged silently |
| **`fieldRegistry`** | no entry → `fieldLabel` returned undefined and the banner showed the raw key |
| ProShop export/import | **correctly absent** — ProShop has no shaft column and never did |
| Spec-sheet extraction | **correctly absent** — the proposal machinery is scalar; a segment list from a scan is deferred |

⚠️ **A SEGMENT LIST RENDERS THROUGH ONE FUNCTION** — `formatShaftSegments` (`toolProfile.js`), used by both the drift banner and the Sync Job diff, so the two can never describe the same geometry differently. `String([{…}])` is `[object Object]`, which reads as corrupted data on exactly the screens where someone is deciding which profile is right.

⚠️ **THE APP'S PROFILE IS CANONICAL, NOT PER-INSTANCE** — in the TSV export as everywhere else, the same as the diameter (which has always come from the tool, never from each raw entry). Instances that disagree are surfaced by the drift path; they are never silently split across two exports.


⚠️ **FUSION'S SHAFT DATA IS GOOD — THERE IS NOTHING HERE FOR THE APP TO FIX.** Most of this app's features exist to correct or complete Fusion data. This one does not. The app previously ignored shaft segments entirely and they were edited in Fusion only; this is the same capability with a better UI than Fusion's disconnected Shaft tab. **Nothing derives, normalizes, corrects or warns about a segment.** A person types a number and saves, exactly like diameter or flute length.

**Tools get segments LATER, and that has to work** — the shop often creates a tool as a reference and measures the real shaft when it arrives. Adding a profile to a tool that has none is a first-class case, not an edge one.

⚠️ **AN ORDINARY SAVE MUST ALTER NOTHING.** `shaft` is written only when the app's segments differ from **the profile the app READ** — decided **once per tool** in `splitToFusionInstances` (`shaftEdited`), never per instance. Comparing per instance looks equivalent and is not: two instances of one logical tool *can* disagree in a real library (measured: 2 tools do), and a per-instance compare would "heal" that on any unrelated save by writing whichever profile the app read as canonical over the other — **silently deleting a real segment**. Locked by a whole-library test: 303 instances through the real write path, **0 shafts altered**.

⚠️ **A SHAFT THAT DISAGREES IS FLAGGED AND ASKED, never resolved automatically.** The app cannot know which profile is the real tool, so `shaft_segments` is in **`DRIFT_FIELDS`** and in **`sharedSignature`**, and it goes through the same paths every other shared field does. That covers both ways it goes out of step, because `detectFusionDrift` compares the app's copy against **every** instance:
- **edited in Fusion and synced back** → the app's stored copy differs from Fusion's → `DriftBanner`, per-field Keep Fusion / Keep app.
- **ONE instance edited and not the others** → the app's copy matches the canonical instance and differs from the one that moved → same banner. On the real library that is the 2 tools above, and **only** those 2: measured, the shaft key newly splits exactly them and adds no other noise.
- **a stray entry found on open** → `sharedSignature` now carries the profile, so a stray whose shaft differs classifies as a **conflict** (→ Sync Job diff) instead of a duplicate or new assembly that would be silently adopted or deleted.
- **write-time** → `mergeSharedFieldsWithFusion` adopts a Fusion-side change the app did not make, and on a both-edited collision keeps the app's value while **recording** the conflict rather than discarding Fusion's.

⚠️ `driftEqual` needs its own branch for it — the profile is an ARRAY, and the default string compare reads every segment as `[object Object]` and never sees a difference. The tolerance matches the numeric one (5e-5): a JSON round trip is not an edit. ⚠️ An established library stays **quiet**: metadata that has never stored a profile is "not populated", not drift, so nothing fires until a tool is next saved.

⚠️ **AN EDIT REACHES EVERY INSTANCE.** Instances of a logical tool differ **only** by holder and OOH — a hard rule, because these are physical tools held to tight tolerance and a different shaft would be a different tool. So an edited profile fans out to all of them.

**The `!= null` gate** distinguishes "the app has no opinion" (`null` — write nothing) from "the user emptied it" (`[]` — remove the `shaft` object). Without it, ~250 tools that never had a shaft would gain an empty one.

**mm is a first-class case, and the risk is NOT arithmetic.** Every segment is in its record's own unit and nothing converts — the Fusion write, the TSV export (factor 1, unlike the holder's, which crosses records) and the drift compare all pass the numbers through untouched, so a metric tool needs no conversion anywhere. What did hide were **inch-flavoured constants**: the new-segment seed fell back to `0.05` height and `0.25` diameter (a 0.1mm segment at 0.25mm on a bare metric tool), the input `step` was `0.001` (a thou in inches, sub-micron in mm), and `formatShaftSegments` rounded to 4 places regardless. All three are now derived from the record's unit via `unitPrecision` / `convertLength`, mirroring the holder module's `newSegmentHeight`. ⚠️ The drift tolerance stays a flat `5e-5` — that is what **every** numeric length in `driftEqual` uses, and it absorbs float round-trip noise (relative, ~1e-16) rather than expressing a machining significance, so it is right at mm magnitudes too; changing it here alone would make the shaft drift differently from the diameter.

⚠️ **The demo library carries a METRIC segmented tool** (`B-301`, a 6mm long-reach ball mill) alongside the inch one. Until it existed there was no metric tool in the demo **at all**, so every unit-flavoured default, step and label in this feature was unreachable in the one place things get looked at. `demo.test.js` asserts at least one segmented demo tool is metric.

**No expression pairing to keep in step** — verified across the real library, `shaft.segments` has no `expressions.*` counterpart (only `tool_shaftDiameter`/`tool_shaftAxisAngle` exist, and neither is the profile). A plain array write, which is why this is small.

⚠️ **The table is listed TOP-DOWN, the way Fusion's own Shaft tab numbers them — the stored array is the reverse (tip-first).** Every edit maps back through the reversed index; getting that wrong silently puts the segment on the opposite end of the tool (the same trap `insertSegmentAt` documents for holders). A new segment continues from the face it attaches to rather than jumping the profile.

**The tool page names it** — a **Shaft Profile** row in the Geometry grid, beside the diameter and the OAL it belongs with, summarised by `formatShaftSegments` and opening the Tool Profile on click. A read-out in both modes (it is edited in the modal), and **hidden when there is none** — most tools have a plain shank, so a "no profile" row on the whole library is wallpaper. Outside the modal there was previously nothing saying a tool had a profile at all.

⚠️ **THE EDITOR READS EVERY STORED ROW; THE DRAWING READS ONLY THE DRAWABLE ONES.** Two functions, and mixing them up deleted data. **`shaftRows`** returns the list as stored — that is what the table edits and writes back. **`shaftSegments`** is `shaftRows` minus anything with no height (a zero-height region cannot be drawn) and is the drawing's read only. Editing off the *filtered* list meant a segment vanished the instant its height went momentarily blank — which is **every retype**, because a `type="number"` input reports `''` for partial text like `.` on the way to `.2`. The height field was, in practice, uneditable: clearing it removed the row. Each drawable segment carries **`index`**, its position in the stored array, so the drawing and the table hover the same segment across a zero-height row.

⚠️ **NO INPUT IN THE PROFILE CARRIES A LITERAL `step`** — `stepFor(field, unit)` derives it from the registry and the record: a length one decade coarser than its display precision (`0.001` in / `0.01` mm), an angle half a degree, a count 1. `0.001` is a thou in inches and a **micron** in mm, so every arrow-key nudge on a metric tool was a thousandth of nothing — in the segment table AND in every dimension box on the drawing.

⚠️ **A BLANK CELL IS MID-EDIT, NOT A ZERO.** The cell being typed into holds its raw text; the stored number moves only when that text parses. Leaving a cell blank snaps it back to its last good value — **removing a segment is what the `×` is for**, and a dimension that must have a value has no meaningful empty state. Deleting a row also clears the pending cell, whose index would otherwise point at a different segment.

**NOT TO SCALE, and it says so.** X and Y are scaled independently — a real tool runs 20:1 to 60:1, so a true-proportion drawing is a hairline. Every CAM tool-library screen distorts this the same way; the drawing is marked `NTS` rather than pretending otherwise.

⚠️ **THE LONG SHANK IS BROKEN, and both halves of that rule were learned the hard way.** On a Ø.039 × 2.5" micro end mill the flutes are 2% of the length: drawn linearly the one thing worth seeing got ten pixels and the rest of the canvas went to an empty cylinder. An **interrupted view** (`BREAK_KEEP`, zigzag symbol) is the standard print answer.
- **The trigger is what the break is FOR** — the part *below* the shank being squeezed (`BREAK_BELOW = 0.30`), not the shank's own share. Testing the shank broke tools that needed no break (a 2"-flute ball mill on a 4" body is half shank and its flutes already have half the canvas). Set well clear of ordinary tools (a bull mill sits at 38%) so the break marks genuinely long-reach micro tools rather than flickering between two tools that look the same.
- ⚠️ **The magnification is CAPPED (`MAX_MAG = 6`).** Filling the canvas with whatever sits below the shank works until that part is itself tiny: a 1/8" chamfer mill has a .058" cutting length on a 1.5" body, and blowing it up to fill the drawing made a chamfer tip look like a 1" flute.

**Dimensions nest shortest-innermost**, the way a print stacks dimensions sharing a datum — laying them out in registry order put MIN OOH (2.5") outside Shoulder (4.0"), lines crossing for nothing. Lengths go left, diameters right (bumped to a second lane only when two would collide), and the **shank diameter is placed at 78% up the shank, never mid** — mid-shank is exactly where the break symbol goes. ⚠️ Labels use a **short name table (`SHORT`)**, not the registry label: `fieldLabel` carries "(in)", which is both redundant beside the unit in the box and wider than a lane, so neighbouring labels overlapped. This is the one place the registry label is deliberately not used, display-only.

**Which dimensions appear is gated by the SAME `appliesToTypes` the form uses**, so a tap is never asked for a corner radius and a drill never for a taper. Tip shapes are modelled only where the shop actually runs them (ball / drill point / corner radius / chamfer-tapered-to-`tip_diameter`); anything else draws **flat**, and a chamfer mill with no stored tip diameter draws flat rather than being given an invented cone.

**Colour is muted by design** — three greys for the structural parts so the one warm colour, the flutes, is what the eye lands on. The amber matches the colour Fusion gives the cutting portion, so the drawing reads as familiar rather than as a second convention.

**The modal resolves its own draft** through `resolveReachFields` on open, so reach and undercut agree with the drawing even for a tool that has not been through the load-time pass — and they keep agreeing as segments are edited.

⚠️ **Editing follows `commitPurchasing`'s rule**: the modal stays open and keeps the draft until the save resolves, and a failed save says so instead of closing. Locked by `toolProfileUi.test.jsx`, which renders every tool in the real library and asserts **no `NaN`/`Infinity` reaches an SVG path** (a tool with no flute length or a zero diameter divides by zero on the way to a scale, and an SVG with NaN in a path silently draws nothing).

⚠️ **The demo library carries two tools with shaft segments** — `A-265` (the inch long-reach micro end mill, mirroring the real one) and `B-301` (a **metric** 6mm long-reach ball mill). Without them, reach, undercut and this whole drawing are invisible in `?demo=true` — which is where they get looked at, and the metric one is the only metric tool in the demo at all. `demo.test.js` asserts both.

### Three length concepts (MIN OOH vs. shoulder length vs. per-assembly OOH)

These are easy to confuse — they are distinct and have a strict ordering:

| Concept | Internal field | Lives in | Scope | Meaning |
|---|---|---|---|---|
| **MIN OOH** ("Length Below Holder - MIN OOH") | `min_ooh` | **metadata only** | per logical tool | The *minimum* stick-out — the smallest a tool can extend from the collet and still be held properly. A **floor**: no assembly may stick out less; any assembly may stick out more. |
| **Shoulder length** (`tool_shoulderLength`) | `shoulder_length` | **Fusion** (`geometry['shoulder-length']`) | per logical tool (shared) | The unbroken shoulder of the tool. Defaults to MIN OOH; may be overridden, but only **smaller** (≤ MIN OOH and ≤ each instance's `geometry.LB`). |
| **OOH / stick-out** ("Length below Holder") | per-assembly `ooh` → `geometry.LB` | **Fusion** (per instance) | per assembly | The actual stick-out for that holder setup. Edited per assembly, **≥ MIN OOH**, can be larger. |

Strict ordering (`flute_length ≤ shoulder_length ≤ min_ooh ≤ overall_length`, and per-assembly `ooh ≥ min_ooh`):
`validateGeometry` (`src/schema/toolFactory.js`) checks the chain and ToolForm **surfaces violations as non-blocking warnings** (it does not prevent save — only `validateTool` hard-blocks). `AssemblyForm.handleSave` **hard-blocks** any per-assembly `ooh < min_ooh`.

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
    AppContext.jsx                 # Provider wiring ONLY: auth, per-library IO
                                  # (downloadFusionList/uploadFusionList), shared-Drive-file
                                  # debounced writes, registry actions, local/demo modes,
                                  # loadTools. Exposes everything via useApp() — the action
                                  # implementations live in the sibling modules below and are
                                  # composed in via useMemo'd factories (stable identities).
                                  # SETUP_STEPS re-exported from appState.js.
    appState.js                    # Pure (non-React): initialState, reducer, SETUP_STEPS,
                                  # localStorage keys, multi-library registry helpers
                                  # (seedShopSettingsRegistry, defaultToolLibraryId, …)
    toolActions.js                 # createToolActions(ctx): writeLogicalTool + saveTool,
                                  # addTool, cloneTool, mergeTool, deleteTool, assembly CRUD,
                                  # assignToolLocation, normalizeLocationSystem,
                                  # reconcileTool, applyReconcile
    libraryOps.js                  # createLibraryOps(ctx): saveFullLibrary, renumberLibrary,
                                  # assignToolIds, renumberAllToolIds, normalizeLibrary
                                  # (shop-global bulk ops across all linked libraries),
                                  # writeToolsToFusion (TOOL-scoped: rebuilds each
                                  # entry) and pushFieldToFusion + FUSION_FIELD_PATCHERS
                                  # (FIELD-scoped: patches one native+expression pair
                                  # in place, everything else byte-for-byte). Reach for
                                  # the right one — see "Pushing ONE field to Fusion".
    attachmentActions.js           # createAttachmentActions(ctx): uploadToolPhoto,
                                  # uploadToolAttachment, deleteToolAttachment,
                                  # importProShopPhotos
    programActions.js              # createProgramActions(ctx): importSequenceDetail,
                                  # setProgramProven, fetchSequenceCsv — the posted
                                  # Sequence Detail CSV (raw file to Drive untouched,
                                  # condensed list to program_details.json) + the
                                  # rename-archive versioning
    componentActions.js            # createComponentActions(ctx): saveComponent,
                                  # assignComponentLocation, uploadComponentPhoto,
                                  # deleteComponentPhoto (holder body / insert records —
                                  # metadata-only writes to tool_components.json)
                                  # Factory pattern: each takes { dispatch, notify, IO fns,
                                  # render-synced refs } so actions never see stale state;
                                  # factories must never import AppContext.jsx (cycle).

  schema/
    fieldRegistry.js              # Central field registry — source of truth for
                                  # all field metadata: labels, types, units,
                                  # Fusion paths, ProShop columns, type applicability.
                                  # Add new fields here first before touching anything else.
    toolSchema.js                 # Thin BARREL — the public entry point everything imports
                                  # from (import paths unchanged). Re-exports the nine
                                  # modules below + TOOL_TYPES/labels/FIELD_LABELS.
                                  # Schema modules import each other DIRECTLY, never the
                                  # barrel (circular import).
    identity.js                   # generateId/generateAssemblyId, tracking IDs
                                  # (generateTrackingId/readTrackingId), stripQuotes,
                                  # familySignature, groupByTrackingId, readOohFromFusion,
                                  # machine numbers (generateMachineNumbers, getNext…,
                                  # applyToolIdToFusion, applyMachineNumberToFusion)
    extractionDiff.js             # Spec-sheet extraction → per-field PROPOSALS
                                  # against an EXISTING tool (sparse-in, type-gated,
                                  # unit-corrected) + the purchasing sub-diff.
                                  # See "Spec-Sheet Extraction onto an EXISTING tool"
    extractorConvert.js           # extractorToTool / toolToExtractor, getFacetFields,
                                  # getRequiredFields
    combine.js                    # combineToolsByToolId / duplicateIdClusters
                                  # (load-time duplicate folding)
    holderGauge.js                # computeGaugeLength, buildGaugeLengthExpression,
                                  # buildHolderObject (expression-derived gauge length)
    holderRecord.js               # The APP-OWNED holder record (holder_library.json):
                                  # newHolderRecord / fusionHolderToRecord /
                                  # holderRecordToFusion + the app-only strip guard
    holderIdentity.js             # The durable Fusion↔app holder link: holder_ref
                                  # + a segment match, BOTH required. matchFusionHolder /
                                  # auditFusionHolders / holderPushPlan. Fusion's holder
                                  # guid is NOT an identity — see "Holder identity"
    holderResolve.js              # Which holder a tool write takes its geometry from
                                  # (holder_id FK first, guid as a hint) + the
                                  # assembly-gauge backstop + backfillHolderIds
    holderOptions.js              # Holder type / taper / collet lookups in
                                  # shop_settings.holder_config (STABLE SLUG seed ids)
    fusionConvert.js              # fusionToolToInternal / internalToFusionTool /
                                  # normalizePreset — the round-trip seam the audit exercises
    threads.js                    # INCH/METRIC_THREAD_SIZES, threadKey, resolveThreadSize,
                                  # tap limit-tolerance + class-of-fit constants
    metadataModel.js              # buildMetadataTool / mergeFusionAndMetadata (the
                                  # tool_metadata.json record shape — add new metadata
                                  # fields here first)
    logicalTools.js               # buildLogicalTool / splitToFusionInstances /
                                  # splitToFusionAndMetadata
    insertFamilies.js             # Insert-style tools: internal family list
                                  # (hasTier3Assembly), PROSHOP_FAMILY_MAP (sync boundary
                                  # only), combined-ID split/compose, component factory,
                                  # pairing asm-number helpers
    camStrategies.js              # New-format preset toolpath strategies: verified
                                  # STRATEGIES vocabulary, QUICK_GROUPS, format
                                  # detection + read/write (isNewFormatPreset,
                                  # readStrategyBucket, buildStrategies,
                                  # writeBucketStrategies). See "Strategy section"
    toolFactory.js                # newTool, validateTool, validateGeometry

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
    toolStore.js                  # The tool-metadata REPOSITORY SEAM — every
                                  # read/write of tool_metadata.json goes through
                                  # loadAll / upsertMany / upsertOne / deleteById.
                                  # One swap point for the future SQLite backend,
                                  # and upsertMany MERGES by id (never a whole-file
                                  # replace) so a bulk save can't delete records it
                                  # wasn't handed (the G1 invariant). Do NOT call
                                  # driveService.{load,saveAll,upsert,delete}Metadata
                                  # directly outside this module.
    extractionService.js          # The ONE screenshot/PDF/text → tool-data call.
                                  # Shared by the add flow and "Scan spec sheet";
                                  # returns a SPARSE result (only what was answered)
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
    proShopHeaders.js             # ProShop CSV header canonicalization — accept BOTH
                                  # the display-name (real ProShop) and API-id (this
                                  # app's own export) header conventions on import.
                                  # canonicalProShopHeader / proShopRowsToObjects /
                                  # detectProShopFormat. See ProShop Integration.
    csv.js                        # The app's ONE quote-aware CSV tokenizer
                                  # (honors quotes across newlines) — shared by
                                  # every CSV reader so quoting can't drift
    sequenceDetail.js             # Sequence Detail CSV parsing + condensing to one
                                  # row per POCKET. ⚠️ Pass-through: values stay
                                  # strings, nothing is corrected against the library
    sequenceImport.js             # Match a posted CSV to a program (by FILENAME),
                                  # link tools by ProShop id incl. legacy_ids, flag
                                  # location/holder differences, block on the two
                                  # unrecoverable cases
    toolLabels.js                 # Label field rows + the dedupe rule (any
                                  # difference = a separate label)
    labelPrint.js                 # The DK-11201 tool tag: tagCSS / tagMarkup /
                                  # inchesAutoFit / printToolTags. COPIED from the
                                  # shop's Chrome extension — do not redesign
    toolProfile.js                # The tool's silhouette as a region stack
                                  # (flutes → shaft segments → shank), tip-first,
                                  # plus which dimensions each tool type offers.
                                  # See "Tool Profile"
    toolReach.js                  # Reach + undercut from the shaft segments.
                                  # Reach is seeded; the undercut is a person's
                                  # answer — see "Reach & undercut"
    presetNaming.js               # composePresetName, parsePresetName, presetMatchesAssembly,
                                  # OP_TYPES / opTypeWord / matchOpType
    holderNaming.js               # holderNameToken (a holder's name IS its
                                  # description) + holderTokensMatch, the
                                  # tolerance that still recognises the retired
                                  # short form in names already stored
    holderColors.js               # Holder colour: the one PICKED in the app,
                                  # auto-assigned from the record id when unset.
                                  # Nothing derives it from the description
    holderGeometry.js             # Derived holder geometry: gauge length, unit
                                  # conversion, extension OOH, the nominal-length check
    holderDescription.js          # Holder description compose + healer (preview→commit;
                                  # a description is NEVER rewritten automatically)
    holderAudit.js                # MIGRATION matching — messy legacy holders scored on
                                  # description + gauge (loose, user-confirmed).
                                  # NOT the identity matcher (holderIdentity.js)
    holderBody.js                 # Body-vs-extension segment signatures
    holderParts.js                # Body / extension as their own part records
    holderDuplicates.js           # Duplicate detection + merge (guid aliasing, so a
                                  # merge repoints every tool with zero tool writes)
    materialExport.js             # Fusion "stock material" JSON export — one file
                                  # per CAM preset (buildFusionStockMaterial /
                                  # buildDesignators / stockMaterialFilename +
                                  # exportStockMaterial[s]). See Materials editor.
    speedsAndFeedsCalc.js         # speeds & feeds calculator helpers — rpmToSFM/
                                  # sfmToRPM take a metric flag (÷1000 vs ÷12)
    presetFx.js                   # Preset editor formula-link (fx) logic —
                                  # DEFAULT_FX, initialPresetFx, computeFormulaDraft.
                                  # Test-locked "never clobber a stored value on open"
    boreCompensation.jsx          # Small-bore feed-per-tooth compensation factor +
                                  # SmallBoreIcon

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
                                  # (levels/delimiters/ProShop export + the collapsible
                                  # per-system ProShop IMPORT rule), normalize
                                  # (analyze→preview→commit), library unmatched panel,
                                  # and LocationIssuesPanel (derived duplicate/gap
                                  # worklist + Fusion sync via pushFieldToFusion).
                                  # Ported from docs/archive/LocationSystemUI.tsx. Exports LivePreview.
    LocationImportModal.jsx       # Location-ONLY ProShop re-import: upload a full
                                  # export, match on Tool #, preview old→new + the
                                  # exception list, commit. ProShop wins outright here
                                  # (the one exception to the flag-never-overwrite
                                  # location rule) and the dialog says so.
    LocationPicker.jsx            # ToolDetail "Assign Location" picker — pick system +
                                  # level options + bin (auto-suggested), writes via
                                  # AppContext.assignToolLocation; `record`/`onAssign`
                                  # props make it reusable for component records
    PairingSections.jsx           # Insert-style tool view: pairing bar (family, asm#/RTA#,
                                  # combined ID) + the Holder Body / Insert group cards
                                  # (each: specs, photo, location, purchasing) +
                                  # PairingSetupPanel. See Insert-Style Tools section
    ComponentPicker.jsx           # Searchable holder-body/insert picker modal with
                                  # inline create — the only way components are browsed
    ToolProfileModal.jsx          # The whole tool as one dimensioned drawing —
                                  # vertical silhouette, print-style dimensions
                                  # whose value boxes are the editable fields,
                                  # interrupted view for a long shank. Opened by
                                  # the Profile sidebar button. See "Tool Profile"
    PhotoSlot.jsx                 # Primary-photo slot (display + add/change/remove),
                                  # shared by ToolDetail and the component groups
    ToolCard.jsx                  # Grid and list card variants with hover actions
                                  # Uses data-field tokens: .description-badge, .tool-id-pill,
                                  # .machine-num-badge, .location-tag
    ToolTypeGrid.jsx              # Tool type selector tiles (icons size 36)
    FacetFilters.jsx              # Cascading facet filter UI
    AddToolFlow.jsx               # New tool flow: choose scan-or-manual → (scan)
                                  # ExtractionInput → extraction → straight into
                                  # ToolForm, pre-filled. No standalone extractor UI
    ImportFlow.jsx                # Bulk Fusion JSON / ProShop CSV import
                                  # Reached via Settings → Import. Step 2 hosts Import ProShop Photos
                                  # as a sub-section (button → ImportPhotosModal). Machine-number
                                  # step (4) is optional + non-destructive (see ProShop Integration).
                                  # Named-exports parseCSV + matchProShopToTools for reuse.
    ExtractionInput.jsx           # The screenshot / PDF / paste picker (drag, browse,
                                  # Ctrl+V). Shared by BOTH extraction entry points so
                                  # the upload behaviour can't drift
    ExtractUpdateModal.jsx        # "Scan spec sheet" upload for an EXISTING tool.
                                  # Upload only — every accept/reject happens inline
                                  # in ToolForm, at the field being changed
    ProShopImportModal.jsx        # Single-tool ProShop data import (ToolDetail "Import PS"
                                  # button) — finds this tool's row, previews field changes,
                                  # applies via saveTool. See ProShop Integration → Single-tool
                                  # ProShop import
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
    HoldersPage.jsx               # /holders — the app-owned holder library (list →
                                  # detail, import/push/merge/parts/normalize actions)
    HolderDetail.jsx              # One holder: geometry table, 2D profile, parts,
                                  # classification, usage, re-stamp. AUTOSAVES
                                  # (900ms after the last edit) + asks before
                                  # leaving with anything unsaved
    PushHoldersModal.jsx          # Push holder records to Fusion: preview → commit.
                                  # Names what it will NOT touch (half-matches)
    LinkToolsModal.jsx            # Link tools to holders: auto/near/manual tiers +
                                  # how many tools get corrected in Fusion
    HolderWorkflowBanner.jsx      # The holder workflow card (setup order + the
                                  # "edit here, not in Fusion" rule). Dismissible
    RestampModal.jsx              # Re-stamp a holder's tools: per-tool old→new assembly
                                  # gauge, a per-fix tolerance (never stored), pick rows
    HolderMergeModal.jsx          # Merge two holder records (survivor adopts the
                                  # loser's Fusion guids)
    HolderPill.jsx                # THE holder badge. <HolderTag> (connected)
                                  # resolves the record from an assembly's
                                  # holder_id / holder_guid and falls back to a
                                  # synthetic one, so every screen shows a
                                  # holder identically; <HolderPill> is the pure
                                  # form for callers holding a record already
    ProfileView.jsx               # 2D holder/tool profile drawing
    HolderPicker.jsx              # Modal for selecting a holder from the holder library
    ReconcileModal.jsx            # Reconcile-on-open prompt: delete duplicates, add/delete
                                  # new assemblies, review conflicts (→ Sync Job diff)
    AssemblyCard.jsx              # Read-only assembly display (holder, OOH, linked presets)
                                  # with inline edit/delete
    AssemblyForm.jsx              # Form for creating/editing assemblies
                                  # Fields: holder (HolderPicker), OOH, linked presets, notes
    NormalizeModal.jsx            # One-time normalization: preset operation-type assignment
    DescRenameModal.jsx           # Per-tool description rename confirmation (buildDesc suggestions)
    PresetPanel.jsx               # Unified preset editor — full-width slider UI
                                  # (speeds/feeds per preset). CollapsedCard shows linked
                                  # machine (Cpu icon + model). Machine filter chip row.
                                  # EditCard uses LinkedSlider/FactorSlider + a results
                                  # rail (MRR) + Small Bore + the Strategy section.
                                  # See "Unified Preset Editor" + "Strategy section".
    LinkedSlider.jsx              # Speed/feed slider over the fx cascade — soft-max
                                  # ceiling, unit-aware ranges, follower re-link control.
                                  # Wheel nudge uses a DYNAMIC step (~4% of the current
                                  # value, nice-rounded, floored at the field base step —
                                  # dynamicStep/niceIncrement in speedsAndFeedsCalc.js) so
                                  # a notch stays proportional (0.010→0.0005, 0.005→0.0002)
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
    PartDetailPage.jsx            # /parts/:id — the PART page: the same
                                  # part/program edit + add controls as the main
                                  # list (shared forms + mutations), plus the
                                  # all-tools list, per-program Tool List /
                                  # Sequence Detail tabs, proven toggle, labels
    ProgramUsageSection.jsx       # ToolDetail "Where Used" panel + toolProgramUsage
                                  # — the DERIVED tool→program scan. No stored link
    ToolListTable.jsx             # The condensed tool list (setup-sheet column
                                  # order) + row selection for partial printing
    SequenceDetailTable.jsx       # The full per-toolpath sequence, re-parsed from
                                  # the stored raw CSV on demand
    SequenceUploadModal.jsx       # Upload a posted CSV: file → preview → commit,
                                  # with the blocking rules shown, not just refused
    PartsPage.jsx                 # /parts — the Parts page (grouped + table over
                                  # one shared filtered/sorted set; PartsFilterBar
                                  # serves both). Helpers in src/utils/parts.js
    partsUi.jsx                   # Shared Parts-module widgets + select-state
                                  # helpers (CustomerBadge, ProgramNumBadge,
                                  # FixtureSwitch, Material/MachineSelect, …) AND
                                  # the one implementation of the part/routing/
                                  # operation inline edit forms + InlineConfirm —
                                  # reused by PartsPage, PartDetailPage,
                                  # AddProgramModal, ProgramPicker
    AddProgramModal.jsx           # Self-contained "Add program" flow (search/create
                                  # part → reserve program numbers). Reused by the
                                  # Parts page AND ProgramPicker
    ProgramPicker.jsx             # Shared program picker (search program # exact /
                                  # part # contains, or Add-new). Used by Sync-Job
                                  # CommitStep and the preset Programs block.
                                  # Exports SelectedProgramChip.
    ProgramsImportModal.jsx       # One-time CSV import of an existing program list
                                  # into /parts (Settings → Import Program List).
                                  # Parser in src/utils/programsImport.js
    Settings.jsx                  # Settings — one of 5 top-bar chrome-style tabs
                                  # Sections: Account (sign-out), Setup & Import (6-step tracker —
                                  # the Fusion Libraries (tool + holder pickers) and Tool Metadata
                                  # (Google Drive) config panels are embedded INSIDE their steps,
                                  # not separate cards), Shop (+ Save button), Machine Numbers,
                                  # ProShop Export, Rename, Advanced
    Toast.jsx                     # Fixed bottom-right toast stack

    icons/
      ToolTypeIcon.jsx            # 26 hand-crafted SVG tool silhouettes

    MergeFlow/                    # Phase 2: sync job values to master
      index.jsx                   # Queue orchestration, live APS fetch, step routing
      ImportStep.jsx              # Clipboard paste (Ctrl+V) + file upload
      MatchStep.jsx               # Match confirmation (fuzzy matches only)
      DiffStep.jsx                # Side-by-side diff with per-field checkboxes + preset matching
      CommitStep.jsx              # Revision note + assembly detection + job/program
                                  # link (ProgramPicker) + "Commit & Next / Finish"
      NewToolStep.jsx             # No-match detected: add to library or skip
      QueuePanel.jsx              # Batch queue sidebar with status badges
      SummaryStep.jsx             # End-of-batch summary + bulk clipboard copy

tool-extractor.tsx                # DATA AND LOGIC ONLY — no UI. Source of truth for
                                  # tool types, field visibility,
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

**Column header convention differs by direction** — but import accepts BOTH:
- **Export** (`tool-extractor.tsx` `PS_MAIN_COLS`, `src/utils/proShopExport.js`) writes ProShop's **API attribute id** names (camelCase, e.g. `lengthBelowShankDiameter`, `tipTo1stFullThread`) as column headers — ProShop's UI matches these on import regardless of display label, and extra/unmapped columns are harmless. **Two columns intentionally use ProShop's display name instead** (to match the shop's real ProShop export): the flutes column is **`No. of Flutes`** (not `numberOfFlutes`) and the purchasing part-number column is **`EDP#`** (not `vendorToolId`). Both still round-trip on import (the alias map canonicalizes `No. of Flutes`→`No.ofFlutes` and `EDP#`→`EDP#`). Purchasing still exports **one row per vendor/manufacturer** (multi-row Approved Brands via `buildBrandRows`), never suffixed columns.
- **Import** reads a real ProShop export, whose headers are the **UI display names** (e.g. `Length Below Holder - MIN OOH`, `No.ofFlutes`, `Tip to 1st Full Thread`) — these often but not always match the API id.
- **The two vocabularies barely overlap** (nearly every header differs by case, spacing, or entirely — `Tool #`↔`toolNumber`, `Length Below Holder - MIN OOH`↔`lengthBelowShankDiameter`, `EDP#`↔`vendorToolId`), so re-importing the app's OWN ProShop export used to match nothing. **`src/utils/proShopHeaders.js` fixes this with a header-canonicalization layer**: `canonicalProShopHeader(h)` maps either vocabulary onto the single set of display-name keys the importer already reads, and `proShopRowsToObjects(rows)` is the one seam that turns parsed CSV rows into canonical-keyed row objects. **Both** the bulk importer (`handleProShopFile`) and the single-tool importer (`ProShopImportModal`) route rows through it, so both formats import identically with **no manual toggle** — the format auto-detects. Unknown headers pass through unchanged (extra columns stay harmless). `detectProShopFormat(headerRow)` → `'proshop'` (real export) / `'tooldex'` (this app's export) / `'unknown'` drives only a small "Detected: …" note (`proShopFormatLabel`); matching never needs it. The alias map (`HEADER_ALIASES`) is the source of truth for accepted names — add new columns there, not as ad-hoc `r['…']` string variants. Locked by `src/utils/proShopHeaders.test.js` (both header sets → identical row objects). **`Location` + tap `Point Type` round-trip**: both are now in `PS_MAIN_COLS` (export API ids `location` / `pointType`) so they survive the app's own export → re-import (`proShopRoundtrip.test.js`). `matchProShopToTools` fills `point_type` onto an existing tool **fill-gap** (like `coating`); `location` follows the usual "app owns location once a structured `tool_location` is assigned" rule (only fills when the tool has none).

**Multi-brand purchasing — two layouts, both read**: ProShop exports multiple Approved Brands either as **multiple rows sharing the same `Tool #`** (geometry/spec on the first row only) OR as **suffixed columns in one row** (`Approved Brand`, `Approved Brand_2`/`EDP#_2`/`cost_2`/`vendor_2`, …). `buildPurchasingFromGroup` (`src/components/ImportFlow.jsx`) normalizes **both** via `brandTuples(row)` — a case/punctuation-insensitive scan that expands each row into `{brand, vendor, edp, cost}` tuples (base + `_2`.._8) — into the `purchasing.{manufacturers,vendors}` model (see Purchasing / Vendor Data Model). Import groups rows by `Tool #` before matching (`handleProShopFile`); export emits the multiple-rows shape via `buildBrandRows`/`buildProShopCSV` (`tool-extractor.tsx`) and `exportFullLibrary` (`src/utils/proShopExport.js`).

⚠️ **EVERY exported row carries the `Tool #` — that is the only thing tying a second Approved-Brand row back to its tool.** The export used to blank the whole main column block on continuation rows, leaving row 2 with a brand, a vendor and a price and **nothing to attach them to**: ProShop can't group it, and this app's own importer groups by `Tool #`, so re-importing our export silently dropped **every vendor after the first**. The row **shape** now lives in one place — **`buildProShopRows(f)`** (`tool-extractor.tsx`), shared by `buildProShopCSV` (single tool) and `exportFullLibrary` — so the two can't drift. A continuation row repeats the tool's **identity and descriptive** fields (Tool #, Description, Location, Tool Group, Tool Material, Through Coolant, …) and blanks only its **measurements** (`PS_FIRST_ROW_ONLY`: Cut Dia, LOC, Overall Length, Shank/Body Diameter, Corner Radius, Tip/Helix/Taper angle, Tip Diameter, No. of Flutes, MIN OOH, Tip to 1st Full Thread, TPI) — measured against the shop's real export, where row 2 of `A-1` repeats 20 fields and drops exactly the 11 measured ones. ⚠️ **`cost` deliberately repeats** even though the reference export happens to carry it once: price is per **vendor** in this app's model, so blanking it would lose the second vendor's price on the round-trip. Locked by `proShopRoundtrip.test.js` (export → parse → group → `psRowToTool`, asserting both vendors and the EDP# split survive).

⚠️ **ProShop's boolean-ish columns are NOT one format — write each the way ProShop stores it.** Measured across the shop's real export: the Boolean-**typed** attributes (`Through Coolant`, `Custom Grind`, `Full Profile`, `Backside Capable`, `Round Shank`) hold `true`/`false`, while `Center Cut` and `Double Ended` are **untyped** and hold `Y`/`N` (`true` never appears in Double Ended at all). The export also writes an explicit **`false`** rather than a blank — the app has no "unanswered" state for these, and ProShop's own export writes `false` on 309/310 rows. Import reads them all through `psBool`, so either spelling is accepted in both directions.

⚠️ **A field with a `proShopColumn` in the registry must be READ on import, not just exported.** `center_cutting` and `flute_type` were declared, exported, and never read back — so a tool round-tripped through ProShop lost them silently (81 and 17 tools in the real export). Their real display headers differ from the API ids we export (`CenterCut`, `FluteType/Chipbreaker`), which is what hid it. `center_cutting` is **PS-wins, not fill-gap-else-flag**: the app defaults it to `false`, so "nobody answered" and "answered no" are the same stored value and flagging would raise a conflict on every centre-cutting tool. `taper_angle` and `cutting_direction` remain deliberately unread (see their notes).

⚠️ **Two ProShop columns are read for ONE tool type each, because they mean different things elsewhere.** `Thread Type` (Form / Cut / Spiral Cut) is the app's `tap_sub_type` and is read **on taps only** — the column also appears on thread mills (`N-48`, `N-78` "Single Profile TM"), where a tap sub-type is meaningless. `Spiral Cut` (5 real taps) maps to **`cut`**; the spiral detail has nowhere to live today and is deliberately dropped rather than invented as a third sub-type. `Threads Per Inch` is read **on thread mills only**, where it is a RANGE (`"11-32"` on N-78, matching its own description "11 to 32 TPI") → `tpi_min`/`tpi_max`; the export emits the range for a thread mill and the single pitch-derived TPI for everything else (`tpiCell`). ⚠️ A **lone number is NOT a one-ended range** — that is the tap case (`R-81` = `"11"`), already implied by the thread designation.

⚠️ **A ProShop export ends with a `TOTALS` footer row — skip it at every import entry point** (`isProShopSummaryRow`, `proShopHeaders.js`): `Tool #` = `TOTALS`, no description, no group, every numeric column a library-wide sum. Imported as a tool it becomes a phantom record whose price is the value of the whole library ($13,982.79). The location-only importer already skipped it; the bulk importer and the single-tool modal did not. ⚠️ In the single-tool modal the filter is guarded — a per-tool export may carry no Description/Tool Group column at all, so if filtering would empty the file the rows are kept as-is.

⚠️ **`shank_diameter` is exported BLANK when unknown — never the cutting diameter.** Substituting the cut dia asserts a straight shank, which is wrong for every reduced-shank tool: measured on the shop's real export, of the 143 tools that DO carry a shank diameter **62 (43%) differ from the cut diameter**, so on the tools where the app would have to guess the guess is wrong roughly four times in ten. Because the column is now read back on import, that guess would be stamped on as fact. `toolToExtractor` and the `shankDiameter`/`bodyDiameter` export columns therefore have no fallback. (`buildFusionRow` still falls back to the diameter for Fusion's own TSV, where a shank diameter is required — that path is unchanged.)

⚠️ **`corner_radius` `null` → `0` is the one substitution kept** (`toolToExtractor`'s `?? '0'`), so re-import stamps `corner_radius: 0` on a tool that had none. Deliberate: `internalToFusionTool` writes `RE` only when non-zero, so `0` and unset behave identically downstream. Pinned in `proShopRealExport.test.js`, which asserts it may only ever fill a missing value, never rewrite a real one.

**The round-trip is exercised against the REAL export, not a fixture** (`src/utils/proShopRealExport.test.js`): all 245 real tools go import → export → import with zero drift across every mapped field and every purchasing row. A hand-written fixture agrees with whatever the code currently does, which is how the losses above survived a green suite.

⚠️ **A ProShop boolean is read through `psBool`, never an exact `=== 'true'`.** The shop's real export writes lowercase `true`/`false`, but an exact compare turns any other spelling (`TRUE`, `Yes`, `Y`, `1`) into a silent **false** — a wrong answer that reads like a real one rather than a no-op. `psBool` returns `null` for "not answered" so a fill-gap caller can still tell blank from false. Applies to `Through Coolant`, `Custom Grind`, `Full Profile`, `Backside Capable`, `Double Ended`.

⚠️ **`THROUGH_COOLANT_VALUES` (`src/utils/toolNaming.js`) must carry the values FUSION stores, not the extractor's retired picker labels.** `toolToExtractor` emits Fusion's `"flood tool"` for a `tsc_capable` tool and `normalizePreset` rewrites the old `"flood and through tool"` to `"flood tool"` on every write — so the set, which listed only the retired spellings, matched nothing and **every TSC tool exported `Through Coolant = false`** (and lost the ` TSC` suffix from `buildDesc`). The set now holds Fusion's `tool` / `flood tool` alongside the retired spellings.

### Single-tool ProShop import (`ProShopImportModal`)

The ToolDetail action sidebar has an **"Import PS"** button (`FileUp` icon, orange, next to the ProShop **export** button) that imports ProShop data for **one tool** without running the bulk importer. `src/components/ProShopImportModal.jsx`: upload a ProShop CSV (a whole-library export is fine), it finds the single row matching **this** tool and previews the exact fields it would fill/overwrite before applying.

- **Reuses the bulk importer's brain** — the modal imports `parseCSV` + `matchProShopToTools` (now **named exports** from `ImportFlow.jsx`) and runs the identical matching + merge rules against a **single-tool array** (`matchProShopToTools(groups, [tool], psUnit, components, systems, forceSingleMatch)`), taking the `matched` entry whose `toolIdx === 0`. So single-tool behavior (fill-gap vs. overwrite policy, unit conversion, Approved-Brand purchasing) is identical to bulk — there is no second matching implementation to drift.
- **Per-tool exports have no `Tool #` column** — a ProShop export scoped to one tool often omits `Tool #` entirely (the whole file is that tool), and its description may not fuzzy-match the app's. The modal detects "no `Tool #` column", groups **all** rows into one, and passes **`forceSingleMatch: true`** — `matchProShopToTools` then applies the one group to the one tool the user already picked (previewed before apply) instead of failing to match. A whole-library export (has `Tool #`) still matches this tool's row normally. `forceSingleMatch` is **modal-only** — the bulk importer never forces.
- **Apply** merges the additions via `saveTool({ ...tool, ...additions })` (metadata-only for a no-Fusion tool; a normal round-trip otherwise). **No other tools are touched and no machine renumbering happens.** No match → a "No matching row found" notice (not a silent no-op). Fill-gap fields where the app already holds a **different** value are **flagged, not overwritten** (attached as `_combineConflicts`, resolved later in `ConflictBanner`) — see ProShop Field Priority Rules; the modal previews them as a "differences to flag" table.
- Accepts **both** header formats via `proShopRowsToObjects` and shows the detected-format note, exactly like the bulk importer (see the header-convention note above).
- **Not yet handled** (flagged for later): if the tool is an **insert-style pairing**, ProShop stores each component (holder body / insert) as its own row — those still go through the bulk importer's component routing, not this per-tool button.

### Machine-numbering is optional + non-destructive on import (`ImportFlow` step 4)

The bulk import's final step originally renumbered **every** tool in the library from `#30` on save — fine for a first bulk import, destructive for an incremental one (adding a few ProShop tools would overwrite all existing machine numbers). Refined so incremental imports are safe:

- The **Review step (step 3)** has a direct **"Save to Drive"** that never touches machine numbers — the machine-number step is now genuinely optional (a second **"Assign Machine Numbers →"** button leads to it).
- **Step 4 numbering defaults to a non-destructive fill-gap mode** (`assignMode: 'fill'`): tools that already have a `machine_tool_number` keep it (shown `T## (kept)`); only tools missing one get the next free number (`getNextMachineNumber` threaded across the batch). An explicit **"Renumber the entire library from #30"** radio (`assignMode: 'all'`) restores the original overwrite-everything bulk behavior. Start/skip come from `machineNumberArgs(shopSettings)`, not hardcoded.
- `handleSaveToDrive(list)` now takes the list to save so both the direct-save (step 3, `fusionTools` untouched) and assign-then-save (step 4, `assignMachineNumbers(fusionTools, assignMode)`) paths share one writer.

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
| `tool_id` | Fill gap, else flag | From `Tool #` — set if the tool has none; a *different* id flags (unless it matched by exact id or a known `legacy_ids` value — an expected re-number, not a conflict) |
| `location` (cabinet) | ProShop over Fusion; flag app | From `Location` (a bare bin **number**, no `LC-` prefix); Fusion's "Vendor" UI field (`expressions.tool_vendor`) holds the cabinet location → internal `location`. **Compared on the number only** — see the location rule below |
| `purchasing` (Approved Brands → manufacturers/vendors) | PS wins, replace when present | Built from every row sharing a `Tool #` via `buildPurchasingFromGroup` — see Purchasing / Vendor Data Model |
| `min_ooh` (MIN OOH floor) | PS wins | From `Length Below Holder - MIN OOH` (export id `lengthBelowShankDiameter`); metadata-only, always overwrites |
| `geometry['shoulder-length']` (shoulder length) | Set to MIN OOH at normalization | See MIN OOH rule below |
| per-assembly `ooh` → `geometry.LB` | Floored at MIN OOH | See MIN OOH rule below |
| `tsc_capable` (through-spindle coolant) | PS wins | From `Through Coolant` (`true`/`false`); boolean capability flag |
| `custom_grind` | PS wins | From `Custom Grind` (`true`/`false`, ProShop id `customgrindtool`); same PS-wins boolean pattern as `tsc_capable`. Metadata-only — appears in the Geometry section as "Custom Grind" |
| `coating` | Fill gap, else flag | From `Coating`; a different value flags (case/space-insensitive compare) |
| `pitch` (thread designation) | Fill gap, else flag | From `Thread`/`Pitch` via `resolveThreadSize`; a different designation flags. `is_sti`/`tap_thread_unit` ride along only when pitch is being filled |
| `point_type` (taps) | Fill gap, else flag | From `Point Type` (ProShop id `pointType`); metadata-only. In `PS_MAIN_COLS` so it round-trips through the app's own export |
| `tip_to_first_thread` (taps) | Fill gap, else flag | From `Tip to 1st Full Thread`, converted from the file unit — see note below |
| `taper_angle` | **Never imported** | ProShop's `Taper` is uncontrolled free text in a different convention — see the note below. Export still emits it |
| All other differences | **Flag** to user | Do not auto-resolve |

**Fill-gap fields flag a difference — "informed, not blocked" (`matchProShopToTools`, `ImportFlow.jsx`).** For the fill-gap fields above (`tool_id`, `location`, `coating`, `pitch`, `point_type`, `tip_to_first_thread`), a ProShop value is applied only when the app has **no** value; when the app already holds a **different** value the import neither overwrites nor silently ignores it — it records a **field conflict** (`{ field, values:[appValue, psValue] }`) via the existing conflict channel (`tool._combineConflicts` → `buildMetadataTool` → `mergeToolConflicts`), surfaced on the tool page in `ConflictBanner` (**Keep <app>** / **Use <ProShop>**), exactly like a load-time combine conflict. The app value is kept until the user picks. Equal values are a no-op (strings compared case/space-insensitively via `psStrEq`; lengths within tolerance via `psNumEq`). The **ProShop-authoritative** fields (`vendor`, `purchasing`, `min_ooh`, `tsc_capable`, `custom_grind`, and the description-rename flow) still **auto-win** — they are not flagged (purchasing is a complex multi-row object the Keep/Use banner can't represent as a single value). Both importers carry this: the bulk flow (`handleApplyMerge`) attaches `_combineConflicts` per matched tool and shows a "N flagged differences" summary chip; the single-tool `ProShopImportModal` shows a "differences to flag" table (app value vs. ProShop value) and records them on apply. Locked by `src/components/proShopImportMerge.test.js`.

**Location is a special case — number-only, ProShop-over-Fusion (`matchProShopToTools`).** ProShop's `Location` is a bare bin **number** (`1405`), while the app composes a prefixed string (`LC-1405`) from the structured `tool_location` via the Location System. A same-ProShop-# match is the same physical tool, so the bin should agree. Comparison is therefore on the **number only** (`locationNumber(str)` in `src/utils/locationSystem.js` — strips non-digits; `LC-1405` and `1405` are the same bin):
- **App owns a structured `tool_location`** (`bin != null`): a number mismatch is **flagged** (`location` field conflict) — never silently overwritten. Once the app auto-names locations, ProShop imports are rare, so this is the drift catch. Resolving the flag with **Use \<ProShop #\>** updates `tool_location.bin` (not the raw string), and `writeLogicalTool` recomposes `LC-…` — handled in `resolveToolConflict` (`toolActions.js`).
- **No structured location** (legacy Fusion free-text, or empty): the app **takes over** — it assigns a **structured `tool_location`** (`bin` = the ProShop number) via `proShopStructuredLocation(psLoc, systems)`, not a free-text string. This is **critical**: a bare free-text location string has **nowhere to persist for a no-Fusion tool** (metadata stores only the structured `tool_location`; the free-text string normally lives in Fusion's vendor field, which a no-Fusion tool lacks) — so importing it as free-text silently dropped it on save. A structured location persists in metadata for every tool AND composes the `LC-` prefix (`composeLocationString` → `additions.location`). It **upgrades** a matching legacy free-text location too (so the whole library becomes app-owned). Requires **exactly one bin-only Location System** (`isBinOnlySystem`: zone/station/drawer off or a fixed `custom` prefix — a system with selectable level options can't be derived from a bare number); otherwise it **falls back to free-text** (fill when empty / overwrite when the number differs). A number already retired into `legacy_locations` is not re-imported (number-aware). `matchProShopToTools` and `psRowToTool` take the `location_config.systems` list; both bulk and single-tool importers pass it.

This supersedes the earlier "differing free-text location flags" behavior: with a bin-only system, ProShop import now **assigns structured locations** (app takes over) rather than storing free-text; only the app's own **structured** location flags a mismatch.

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

### Taper angle is never read from ProShop (uncontrolled column)

⚠️ **`taper_angle` is the one geometry field the ProShop import deliberately does not read.** ProShop's `Taper` column is uncontrolled free text — whatever the person filling the row thought was right — and it does not share the app's convention. The app stores **Fusion's HALF angle** (`geometry.TA`); ProShop's column is *mostly* the **INCLUDED** angle and not even consistently that. Measured across the shop's real export: `L-124` 90/45, `L-267` 90/45 and `L-250` 60/30 are included, while `L-189` 45/45 is the half angle. **No conversion is right for all four**, so neither importing the raw number nor halving it is defensible — the field is simply not imported (`psRowToTool`; `matchProShopToTools` never touched it and must not start). A new tool arrives with `taper_angle` unset and the user fills it in, where `ToolFields` labels it "Included/Inclusive Tip Angle" and halves it on the way in. **No value beats a wrong one** — this is the same rule as "never substitute default values for missing fields in descriptions".

This is the read direction only: **ProShop export still emits the `taper` column**, per the standing rule that ProShop export is never removed.

⚠️ **Symptom to recognize, because it blames the wrong thing.** Importing the raw number wrote an *included* angle into a *half*-angle field, so `L-250` carried 60 against Fusion's 30 and raised a `taper_angle` conflict — a flag on data that was correct in Fusion the whole time. It reads as the app being wrong about the tool, when the app was wrong about the column. For a Fusion-linked tool the stale metadata value is inert (`mergeFusionAndMetadata`: `fusionInternal.taper_angle ?? meta.taper_angle` — Fusion wins), so existing records need no migration; only the flag needs clearing.

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
- A per-vendor `lead_time` field is anticipated but not yet implemented — see the `// TODO` comment in `buildMetadataTool` (`src/schema/metadataModel.js`).

#### `registry_id` — the link to the vendor registry is a stable ID, the name is derived (foreign-key pattern)

Each manufacturer/vendor entry also carries a **`registry_id`** — the stable id of its **`vendor_registry.json` entity** (`entities[].id`), NOT the mutable display name. The name shown/exported is **derived live from the id** against the registry, so renaming an entity in the `/vendors` editor never orphans the tools pointing at it. (The per-entry `id` is a separate per-tool row uuid for drag-reorder; `registry_id` is the FK into the shared registry.) `registry_id` is `null` for a **genuinely free-text** name not in the registry — those keep resolving by name exactly as before (same tolerance as legacy material strings / the CAM-preset FK). Helpers in `src/schema/vendorRegistry.js`: `entityById`, `registryIdForName` (id from a canonical name / alias / ProShop-id match, else null), `syncPurchasingFromRegistry(purchasing, reg)` (refresh every manufacturer/vendor name **and every URL the entity has a pattern for** from its id; **adopt** the id from a name-matched entry so pre-existing name-only links become rename-proof; **canonicalize** the name; **tolerate a dangling id**), and `backfillPurchasingRegistryIds(tools, reg)` (load-time walk, mirrors `backfillMaterialPresetIds` / `backfillAsmNumbers` — called at all `loadTools` build sites + demo; persisted lazily on each tool's next save). Every purchasing **constructor** stamps the id at creation: `buildPurchasingFromGroup` (ProShop import, `ImportFlow.jsx`), `buildPurchasingFromExtractor` (AI extraction, `extractorConvert.js`), and `PurchasingSection`'s name edit (`withNameFk` — matching an entity sets the id + canonicalizes; free text clears it). `PurchasingSection` reads a **live-resolved** view (`syncPurchasingFromRegistry(tool.purchasing, state.vendorRegistry)`) in view mode so a rename reflects immediately without a reload; `metadataModel` persists `registry_id` on both arrays. Mirrors the CAM-preset FK (`material_preset_id`) — same store-the-id/render-the-name pattern, backwards-compatible/additive (the only re-pick case is an entity renamed **before** the id was captured **and** whose old name isn't kept as an alias). Locked by `vendorRegistry.test.js`.

#### ⚠️ A URL THE REGISTRY CAN COMPOSE IS DERIVED — THE PATTERN ALWAYS WINS

Same rule as the name above, applied to the links. Where an entity carries a URL pattern (`edp_url_pattern` / `vendor_num_url_pattern`), the composed URL **overwrites whatever is stored on the tool** — a scanned spec sheet's product link, an older generated URL, a hand-typed one. That is the entire reason the pattern lives centrally: when a manufacturer reorganises their site, **editing the one pattern in `/vendors` corrects every tool at once**. A URL pasted into a record is a static value nothing can mass-update, so it may not be allowed to win.

**A stored URL stands only where there is nothing to derive** — the entity has no pattern (or isn't in the registry at all), or the entry has no part number to substitute. There the pasted link IS the answer and is left untouched (`syncPurchasingFromRegistry` returns the same reference, so nothing looks dirty).

Applied at every seam, so the derivation can't be reached around: `syncPurchasingFromRegistry` (read-time + the load backfill + `PurchasingSection`'s view mode), `backfillUrls` (`PurchasingSection`, run on every `ToolForm` save), `buildPurchasingFromGroup` (ProShop import), and the display resolve in `MfgRow` / `VendorRow` (`generateManufacturerUrl(...) || stored`, **not** `stored || generated` — the old precedence). `applyUrlPattern` lives in `vendorRegistry.js` (a leaf) so the FK resolver can compose without importing `urlGenerators.js` back the other way. Locked by `vendorRegistry.test.js` — including "one edit to the pattern moves every tool", the keep-a-stored-URL-where-there-is-no-pattern case, and idempotence.

**Learning a pattern from one real link** (`learnUrlPattern`, `vendorRegistry.js`). A manufacturer with **no** pattern is a permanent blind spot — every one of its links is a static value nothing can mass-update. A scanned spec sheet hands over a product link **and** the part number it points at, which is the shape, so the extraction offers a **`mfg:url_pattern`** row: *"Learn Fraisa USA's link format"*. ⚠️ **It must prove itself** — a pattern is returned only when re-substituting the number rebuilds that exact URL, so a guess can never be stored (a wrong pattern silently overwrites the right link on every tool of that make). Skipped, deliberately, when the number appears **more than once**, appears only as a **fragment** of a longer id, is under 2 characters, or the URL carries **anything besides the part number** in its query/fragment (session ids, tracking blobs, catalog node ids — the "lots of embedded data" case, which has no learnable shape). Verified by re-deriving all six shipped patterns from a link each would produce.

⚠️ **Offered, never auto-accepted** (`kind: 'change'`) — it changes every tool of that manufacturer, so it is the one purchasing row that is always a decision. It is also the one accepted row that does **not** land on the tool: `ToolForm.savePatternRows` writes it to the manufacturer's registry entity, **before** the tool save, because `saveVendorRegistry` refreshes the active registry synchronously and `backfillUrls` then composes this tool's link from the pattern it just learned. A failed registry write is reported and stepped over — it must not cost the user their tool edit.

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

⚠️ **A section editor LEAVES EDIT MODE ONLY AFTER ITS SAVE RESOLVES.** View mode renders `tool.purchasing` — the **prop** — and the prop is still the PRE-save tool for the whole duration of the write. `handleSave` dropped out of edit mode *before* awaiting, so the rows the user had just typed **visibly disappeared** while the save was in flight; a linked save is a Fusion round-trip that downloads and re-uploads the whole library, so that window is seconds, not a frame. It also took the "Saving…" button away with it (nothing on screen said anything was happening), and a **failed** save silently discarded the edit — the panel was already showing the old value and the draft was gone. The ordering lives in **`commitPurchasing`** (exported from `PurchasingSection.jsx` purely so it can be tested — the ordering is the whole point and is invisible in a rendered snapshot), locked by `purchasingSave.test.js`. `PairingSections` already had the correct shape (`await onSave(draft); setEditing(false);` inside a try/catch) — follow that for any new section editor.

⚠️ **`ToolDetail.sectionSave` PROPAGATES the failure.** It used to swallow it, so a section could not tell a save that worked from one that didn't — which is what let the editor close on a failed save. `AppContext` already toasts the reason; the rethrow exists so the caller can keep the user's data on screen. Every `await onSave(...)` in a section must therefore have a `catch` (the two in `AssembliesSection` do).

**Saving state is LOCAL, not the global `isSaving`.** The global flag is true during ANY save in the app, so using it would put this panel in a saving state for an unrelated write. Same reasoning as `SpeedFeedSection`'s own `saving` state.

### Purchasing UI (`PurchasingSection.jsx`)

A collapsible "Purchasing" panel in `ToolDetail`'s right column. Nested table: outer rows are manufacturers (Manufacturer / MFG# / EDP#), each with an inner table of its vendors (Vendor / Cost / Vendor#). `[+ Add manufacturer]` / `[+ Add vendor]` buttons. Drag-to-reorder follows the same pattern as `PresetPanel.jsx` (`GripVertical` handle, hover-to-reveal delete `×`) — manufacturers reorder among themselves, vendors reorder within their manufacturer group.

-----

## Linked Tools (tap ↔ drill, reamer ↔ drill)

A **symmetric, role-free** tool↔tool relationship — "these go together": a tap and the drill that precedes it, a reamer and its drill. There is no direction and no parent; linking A to B links B to A. Pure logic in **`src/utils/toolLinks.js`** (`normalizeLinkIds`, `linkPatch`, `linkedTools`, `symmetrizeToolLinks`, `toolsNeedingLinkRepair`), UI in **`LinkedToolsSection.jsx`** (a panel directly under Purchasing in ToolDetail) + **`ToolLinkPicker.jsx`**.

- **⚠️ The link is the partner's TRACKING ID** (`tool.id` = `FTL-XXXXXX`), stored in the metadata-only **`linked_tools[]`**. You *look a tool up* by its ProShop #/EDP#/description — that is the picker's job — but a ProShop number is **re-numberable by design** (that is what `legacy_ids` exists for), so storing one would silently sever every link the next time the shop changed ID scheme. Standard **Relational integrity** rule: store the id, resolve the display at read time.
- **Metadata-only.** Fusion has nowhere to put a tool↔tool link, so it is never written there and `writeLogicalTool` is deliberately **not** used: that would re-download and re-upload the whole Fusion library *twice* (once per side) to store a field Fusion never sees. `AppContext.setToolLink(toolId, otherId, linked)` (`toolActions.js`) does one `toolStore.upsertMany` covering **both** tools, with an optimistic in-memory update that is **rolled back** if the write fails — claiming a link that didn't persist is worse than failing loudly. Same reasoning as `normalizeLocationSystem` / `importLocationsFromProShop`.
- **⚠️ Symmetry is stored on BOTH sides, and written in ONE save.** A JSON file per tool has no join table, so each side carries the other's id. Writing the pair in a single `upsertMany` is what makes that safe — a partial failure cannot leave A pointing at B while B knows nothing about A.
- **`symmetrizeToolLinks(tools)` is the load-time backstop** (wired into **all four** `loadTools` build sites alongside the FK backfills), for links written before this rule or by a future writer that forgets. It **only ever ADDS the missing reverse half**; persisted lazily on the tool's next save. Two invariants it must keep: it returns the **same array and same tool references** when everything already agrees (callers use identity to decide whether there is anything to persist — the `syncPresetMaterialName` rule), and it **KEEPS a dangling id** — "not in the list I was handed" is not "deleted" (the library may be partly loaded), so dropping one and persisting would destroy a real link. A dangling link is hidden from the *display* list (`linkedTools`) only.
- **Display**: each partner is a badge card carrying the three things needed to go find it — **tool ID, description, location** — and opens in a **new tab** (a plain `<a href="#/tool/:id" target="_blank">`, so middle-click and "open in new window" work too). Following the link is for *comparing* two tools, not navigating away from the one being read.
- **The picker reuses the landing page's search**, not a second implementation: `textSearch` + `sortResults` from `searchEngine.js`, so typing a ProShop #, EDP#, vendor number or retired ID behaves identically to the main search box and an exact ID match floats to the top. Plus a tool-type dropdown built from the types actually present. The tool itself and anything already linked are **removed** from results rather than greyed out.
- Gated on `googleAuthenticated || demoMode`; demo never sets `googleAuthenticated`, so a demo link stays in memory. Locked by `src/utils/toolLinks.test.js` (incl. idempotence, the identity invariant, and the dangling-link rule).
- **Deferred**: no *role* on a link (pilot drill vs. tap drill), no bulk linking, and no auto-suggestion by diameter/thread — the ask was explicitly "mainly just a way to link the tools".

-----

## The Parts module (parts.json) — Part → Routing → Operation

The shop's model, and now the app's:

| Tier | What it is |
|---|---|
| **Part** | the thing being made. **ONE record per part number, ONE page.** |
| **Routing** | a combination of operations — how we make it. A part can have **more than one**: different fixturing, machine, or process revision. |
| **Operation (OP)** | a sequential step, **and its program**. |

⚠️ **"Operation" is doing two jobs in one record today, on purpose.** Properly there are two things: an **Operation** — the step itself, what it *is* (its program, machine, setup, fixturing) — and a **Routing Step** — that operation's *place* in one routing's sequence. They are fused into one record while every operation belongs to exactly one routing, which is a faithful denormalization rather than a wrong model. See "Sharing an operation across routings" below for when they split and why waiting is safe.

Pure helpers: `src/utils/parts.js` (framework-free, mirrors `toolIdSystem.js` / `locationSystem.js`). Everything is stable UUIDs — one SQLite table per tier.

⚠️ **"ROUTING", NOT "JOB".** The floor says job; ProShop says routing, and so do we. In an ERP a **job is a work order** — a production run of a part (the shop's own setup sheet carries `WO 26-0027`). That record will be needed and it is **not this one**, so spending the word on this tier would recreate the collision this naming exists to avoid. "Routing" is also the standard term for the sequence of operations that makes a part.

⚠️ **"JOB" IS RESERVED — it means a FUSION JOB FILE, and nothing else.** The word had come to mean three things at once, so it now names exactly one: the job file a programmer copies a tool into, which is what **Sync Job** syncs *from* (`in-job`, `job presets`, `job tool` — all correct, all about that file). The middle tier is a **routing**, never a job. A link to a program is named `program*` — `programLink`, `program_linked`, `ProgramPicker`, `ProgramUsageSection`, `ProgramFiles/` — and the tool page's panel is **Where Used**. There is deliberately **no `last_used_job` field**: which programs a tool runs in is derived (below), and a preset's proven-on link is `operation_ids`. A future ERP **work order** will need the word "job" in its own right; leaving it on two other things is what would make that record impossible to name.

⚠️ **AN OPERATION CARRIES ITS OWN `program_number` — there is no programs[] table.** An OP has at most one program, so a separate record would be a 1:1 join that buys nothing and gives every link two things it could point at. `program_number` is **null** for a step with no program (inspection, deburr, an outside process) — never `0`, which would look like a real number to `nextProgramNumber` and to the CSV matcher. A program is found by `operationByProgramNumber`, the same way the posted CSV names it.

⚠️ **REV LIVES ON THE ROUTING, NOT THE PART.** The shop wants everything for a part number on one page; if a part were keyed `(part_number, rev)`, a new rev would be a second part and a second page. A rev that changes *how the part is made* is a new routing — which is one of the things that distinguishes two routings anyway.

⚠️ **A step with NO program never matches a numeric lookup.** `Number(null)` and `Number('')` are both **0**, so a bare numeric compare made every inspection/deburr step answer to program "0" — and to a null or blank query, which is how a caller that forgot to guard gets an unrelated operation back instead of nothing. `operationByProgramNumber` and `searchPrograms` both normalize through one helper; null on either side is never equal.

**Program numbers** are global, permanent and **computed** — `nextProgramNumber` = max + 1, never a stored counter that can drift. So deleting a non-max operation leaves "next #" untouched, and deleting the highest reclaims it. `updateOperationIn` **strips `program_number` from any patch** — permanent once reserved.

⚠️ **A program number is UNIQUE SHOP-WIDE, and that is load-bearing.** `operationByProgramNumber` returns the FIRST match and the posted-CSV import uses it to decide which operation a Sequence Detail belongs to — so two operations on one number means the detail attaches to one arbitrarily, the other reads as "no sequence detail", and that routing's tools **disappear from the tool → program → OP → part query**, which is the thing this module exists to answer. Nothing in the app can currently produce a duplicate (`nextProgramNumber` continues above the highest in use, the CSV import dedupes); **`duplicateProgramNumbers(file)`** is the detector for a hand-edited file or a future bulk action. Locked by `parts.test.js`.

### Revisions and sharing — two axes, one rule

**The operator must never have to know which copy to run.** That single rule cuts opposite ways on the two axes, which is why the answers look contradictory and aren't:

- **REV axis (the design changed) → DUPLICATE.** Rev A → Rev B re-posts every operation under **new program numbers**, top to bottom, even where the G-code is byte-identical. Mixing generations is what forces "for OP50 run the new Rev B number, but for OP60 run the old Rev A one" — tribal knowledge, and exactly the class of thing this module exists to eliminate. A rev is a **self-consistent set**.
  - ⚠️ **Rev freezing is therefore FREE — there is no copy step.** Rev B's OP50 is a new program number, so it gets its own `ProgramFiles/O####/` folder; Rev A's folder is untouched because nothing points at it but Rev A. Do **not** build a "copy the old rev's folder" action: duplicating files gives every copy a new Drive id (a rewrite of every record that referenced it) and creates two masters that can drift.
- **ROUTING axis (same rev, different strategy) → SHARE.** Two routings of one rev — e.g. prep on machine A then OP50/OP60 on machine B, versus all three on B — share the operations that are genuinely identical. The operator runs the same number either way, so there is nothing to know; **duplicating** is what would create the drift here (the programmer updates the CAM, updates one copy, the other silently goes stale).

### Sharing an operation across routings — NOT BUILT, deliberately deferred

`operations[].routing_id` is a single FK, so an operation belongs to exactly **one** routing and the ROUTING axis above cannot be represented yet. This is a known, dated limitation, not an oversight — and waiting costs nothing:

- **The migration is mechanical and lossless.** The operation record already holds exactly what a master operation should (program, machine, fixturing, setup). In the split-machine example `Prep-A` and `Prep-B` are genuinely two *different* operations — only OP50/OP60 are shared — so the record itself doesn't change at all when the split happens; only `routing_id` moves out into a link. Every existing operation maps **1:1** to one master operation + one routing step. Nothing is lost and no judgement call is deferred.
- **Vocabulary for when it lands:** an **Operation** is the step itself (its program, machine, setup); a **Routing Step** is that operation's place in one routing's sequence. Today the two are **fused into one record**, which is a faithful denormalization precisely *while* nothing is shared — a narrower model, not a wrong one.
- ⚠️ **The shortcut to refuse** is copying an operation into a second routing while KEEPING its program number — see the uniqueness rule above for exactly what breaks. The other shortcut (copy it under a NEW number) is the drift trap the REV/ROUTING split exists to avoid.
- ⚠️ Note the semantics that change on the day it lands, since they're the real cost: `deleteRoutingIn` can no longer cascade to its operations (another routing may still use them), which introduces an "operation belonging to zero routings" state, and per-routing ordering becomes a question `op_number` alone may not answer.
- **Trigger to revisit:** the first real part that needs two routings sharing an operation. Not before — ProShop can't represent it either, so nothing upstream is waiting on it.

**The throttling test this came from**, worth applying to the next ERP-shaped question: *cheap now, expensive later* → do it now (**identity and links** — stable ids, permanent numbers, FKs instead of display names; once real data accumulates under a wrong key you cannot recover it). *Mechanical later* → defer freely (**structure** — 1:N → M:N where every record maps cleanly; waiting costs a migration script, not a redesign). Rev-on-part would have been the first kind and was avoided; shared-operations is firmly the second.

**Material** is a specific **alloy** (`material_id` → `materials.materials[]`), with `material_custom` as the free-text escape. **A non-fixture operation stores NO material** — it derives from its part (`operationMaterial`), so editing the part cascades by construction with zero copies to drift. Only fixture ops carry their own.

**Mutations are pure `file → file`** (`updatePartIn` / `updateRoutingIn` / `updateOperationIn` / `deleteOperationIn` / `deleteRoutingIn` / `deletePartIn`), so the rules above are stated once and every screen shares them. Deletes cascade down the tiers. Each caller hands the result to `saveParts` (optimistic + debounced).

⚠️ **A part's operations run ROUTING BY ROUTING, never interleaved by OP number** (`operationsForPart`). Two routings are two different ways of making the part, so the vise setup's OP50 and the fixture-plate setup's OP50 are unrelated steps — sorting the pooled list by OP number alternates between them and reads as one impossible sequence. Within a routing it is OP order (numeric, so OP50 precedes OP160RB). This backs the part page's all-tools list and its label printing, which is where a wrong order actually costs something.

⚠️ **A part is created WITH its first routing, in ONE write** (`addPartWithRoutingIn`). Two `saveParts` calls in one handler both build off the same stale closure, so the second discards the first — which silently stored the routing and threw the part away. Any new "create A then B" flow composes one pure mutation the same way.

### Where a tool is used — DERIVED, never stored

⚠️ **There is no tool→program link field.** Every stored Sequence Detail row carries the tool it resolved to (`tool_ref`), so "which programs use this tool" is a scan of `program_details` — always current, nothing to maintain, nothing to go stale. `toolProgramUsage(toolId, programDetails, partsFile)` (`ProgramUsageSection.jsx`) is that scan; the panel shows program, part, routing, OP, the pockets it occupies, and whether that version is proven.

**This fixed a real bug**: the tool page read a stored `job_ids` field that the sequence import never wrote, so uploading a CSV linked nothing there. A tool linked to a program is linked to its part by the same derivation — operation → routing → part — and nothing stores that chain twice.

**A PRESET's link IS stored** — `preset_meta[guid].operation_ids`, metadata-only, never written to Fusion (it's in `normalizePreset`'s destructure with the other app-only per-preset keys). "This preset was proven on O1218" is an assertion a person makes; no posted file can tell us. The label is resolved live from the id, and a dangling one is **shown as "(program removed)", not hidden** — silently dropping a link is how provenance disappears unnoticed.

**A Sync Job commit links the PRESETS it touched, and nothing else.** `CommitStep` hands `mergeTool` a `{ operation_id, label }`; every preset updated or added in that commit gets the id appended to its `operation_ids`. A commit that touched no presets stores **no** link at all — the merge-history entry (`program_linked`) already records which program it came from, and tool→program is derived. ⚠️ This read `jobLink.job_id` into a `job_ids` array, both left from the pre-Parts-module `jobs.json` (all four names are now `program*`): the id came back `undefined`, so every commit with a program selected wrote `job_ids: [undefined]` onto its presets — a link nothing reads, on a key `normalizePreset` does **not** strip, so it would have leaked into the strictly-validated Fusion JSON. Locked by `toolActions.test.js`.

### The pages

⚠️ **`sortParts` computes each part's sort keys ONCE, not inside the comparator.** `partActivityAt` and `partNewestProgram` each walk (and sort) every operation on the part, so calling them per comparison re-derived the same two values O(n log n) times over the whole file — measured at 50/150/400 parts: 6ms / 26ms / **147ms**, on every keystroke in the search box. `partSortKeys` builds both in one pass over the file (**1.2ms at 400 parts**, and flat rather than quadratic); the ordering is byte-for-byte the same, and the per-part helpers stay as the single-part form.

- **`/parts` — the Parts page.** Every part, and with it every program number, in two renderings of **ONE filtered, sorted set**: a grouped list (Part → Routing → Operation) and a flat table. ⚠️ The search / filter / sort bar (`PartsFilterBar`) is **shared by both**, reading one `applyPartsFilters` result — a row you can find in one view is a row you can find in the other, by construction. Search reaches program #, part #, customer, material, machine, OP #, routing name and description; a hit on a PART's own fields keeps the whole part (searching a part number shows everything under it). Sort: **Recently updated (default, newest first)**, newest program #, part number, customer — with a direction toggle. A part's "activity" is the newest timestamp across the part and everything under it, so editing an operation floats its part to the top; ties fall back to the program number, which is what makes the default useful straight after a CSV import where every record shares one stamp. **`updated_at` is stamped inside the shared mutations** (`touch`), so no screen can edit a record without the sort noticing.
- **`/parts/:id` — the PART page.** The module proper: the part, its routings, every operation, the all-tools list, per-operation Tool List / Sequence Detail tabs, proven, and label printing. Full edit controls at every tier.
- Both render the **same shared forms** (`partsUi.jsx`: `PartEditForm` / `RoutingEditForm` / `ProgramEditForm` / `InlineConfirm` + the `*DraftOf` / `*FieldsOf` helpers) through the **same shared mutations**. There is deliberately no second implementation to drift.
- **`AddProgramModal`** walks part → routing → operation, and takes `partId` / `routingId` to open already scoped. A part with exactly **one** routing skips the routing step — the common case shouldn't cost a click for a choice that isn't one.

### CSV import (one-time)

**Settings → Import Program List** brings in the shop's existing list. Each row is one **operation**; rows group upward: **part by part_number alone**, **routing by (part, rev)**. ⚠️ The CSV has no concept of a routing, so **one routing per rev is the only honest reading** — the user splits or merges them afterward on the part page, which is two clicks there and an unrecoverable guess if the importer did it for them. Parser + build: `src/utils/programsImport.js`.

-----

-----

## Sequence Detail & Label Printing

**The point of this feature is to stop printing tool labels out of ProShop.** Getting a tool list into ProShop and printing labels takes too many clicks, and labels are often needed *before* the program is finished — so the same job gets uploaded to ProShop repeatedly just to reprint tags. The final Sequence Detail still goes to ProShop for operators; this does not replace that.

### ⚠️ THE GOVERNING RULE — THE CSV ALWAYS WINS

**The Sequence Detail CSV is a pass-through of proven job data. It is preserved, never corrected.**

It comes out of a **cascade post** — Fusion emits it at the same time as the G-code, from the same post logic — so it **matches the G-code exactly**. That is the entire point of it. ToolDex is *standard reference data*; the CSV is *what the machine will actually do*. A wrong OOH, holder, tool or T offset **causes a crash**, so printing an app-corrected value that was never proven in CAM is not acceptable.

Consequences that run through every file below:
- If ToolDex disagrees with the CSV (OOH, holder, description), **the CSV value is what gets stored and printed**. Matching against the library may only **add a foreign key** or **raise a flag** — never substitute a value.
- ⚠️ **LOCATION IS THE ONE DELIBERATE EXCEPTION — see "Location: the app wins" below.**
- **A 0.1" OOH difference is a different tool assembly**, not a data error to fix.
- Values stay **strings** end to end. No numeric round-tripping — `0.70` must not print as `0.7`.
- The uploaded file is stored **byte-for-byte untouched**.

If you find yourself writing code that "fixes" a CSV value against the library, stop.

### The data

`{programNumber}.csv` (e.g. `O1218.csv`) lists **every toolpath operation** in the program.

- **Seq# correlates directly to the `N##` in the G-code.** The operator reads it to find where in the program an operation happens and whether they can start there. A sequence number is output on a **tool change**; extra toolpaths under one tool change get `.1` / `.2` so they stay in order (`15`, `15.1`).
- **One tool can run at non-adjacent sequence numbers** (A-265 at 15 *and* 25), and **the same tool can occupy more than one pocket** in one program (T03 and T04 both A-35).
- **Row `0`** is a structured free-text header (program #, file name, POSTED stamp, cycle time, machine, stock). It is **uncontrolled free text in Fusion** and carries a known post typo (`OO1218`, double-O) — so **the program number inside the file is ignored entirely. The FILENAME is the truth.**
- **Row `0.5`** is the fixture line. Stored raw, not used yet (ToolDex has its own spot for fixtures).
- **T offset # ≠ ToolDex machine tool number.** Offsets are renumbered to match what's physically loaded and to stay under 98 (Brother control limit).
- **H and D always equal T** — the post enforces it, and the H column carries an (incorrect) gauge-length reference in newer files. So the CSV's H/D columns are **deliberately ignored** and both are derived from T (`offsetOf`).

### Modules

| File | Contents |
|---|---|
| `src/utils/csv.js` | The app's **one** CSV tokenizer (quote-aware across newlines), extracted from `programsImport.js` so quoting can't drift between two parsers |
| `src/utils/sequenceDetail.js` | `parseSequenceCsv`, `condenseTools`, `toolNumberOf`/`formatToolNumber`/`offsetOf`, `proShopIdKey`, `parsePosted`/`postedToIso`, `programNumberFromFileName` |
| `src/utils/sequenceImport.js` | `buildSequenceImport` (preview→commit, mirroring `buildProgramsImport`), `buildToolIndex`/`findToolByProShopId`, `buildHolderIndex`, `locationConflict`, `upsertDetail`/`detailsOf`, and `resolveRowLocation` — the location exception |
| `src/utils/toolLabels.js` | `labelFieldsOf`, `labelKey`, `labelRows` — the dedupe rule |
| `src/utils/labelPrint.js` | `tagCSS` / `tagMarkup` / `inchesAutoFit` / `printToolTags` — the tag layout |
| `src/utils/programFileSync.js` | Finding a program's posted file in a machine's Drive folder and judging whether ours is stale. Pure — the caller lists, this decides what the listing MEANS |
| `src/utils/sequenceCompare.js` | Aligning two posted versions row by row — forward-only, bounded lookahead, cell-level changes. Pure |
| `src/utils/programVersions.js` | Which versions of a program exist, derived from its Drive folder. Inverse of `archiveFileName` |
| `src/components/SequenceCompareModal.jsx` | The compare dialog: version pickers + one row per aligned operation |
| `src/components/useProgramFileSync.js` | The poll: one listing per folder, shared by every program on the page; visible-tab only |
| `src/components/ProgramFileStatus.jsx` | The indicator icon + `AutoImportedMark`. Reusable by file kind |
| `src/components/DriveFolderPicker.jsx` | The shared Drive folder-browse modal (My Drive + shared drives) |
| `src/context/programActions.js` | `importSequenceDetail`, `setProgramProven`, `fetchSequenceCsv`, `archiveFileName`, `listPostedFolders`, `importProgramFileFromDrive` |
| `src/components/PartDetailPage.jsx` | `/parts/:id` — the PART page |
| `src/components/ToolListTable.jsx` / `SequenceDetailTable.jsx` / `SequenceUploadModal.jsx` | the two tables + the upload dialog |

### Import — two blocking rules, everything else informs

- **Matched by FILENAME** (`O1218.csv` → program 1218), which resolves to the **operation** carrying that number; its routing and part come off that. OP and part number come from the ToolDex record, never the CSV header.
- **BLOCKING — no matching program record.** ToolDex is what assigns program numbers, so this should be rare and means something is genuinely wrong.
- **BLOCKING — a ProShop Tool # that resolves to no tool.** A tool list with a hole prints labels for an assembly nobody can look up.
- Both block the **whole upload**: a partially-stored program prints a partial set of labels, which is worse than printing none.
- **Legacy IDs count.** `legacy_ids[]` holds numbers retired by an ID-scheme renumber; a CSV posted before that renumber names the old number for a tool that is still in the library, and blocking there would be the app failing on a change *the app itself made*. The current id always wins when both resolve.
- **Combined insert ids match as an unordered SET of halves** (`proShopIdKey`), so Fusion's arbitrary order/spacing (`I-224 / G-223`, `G223/I224`) resolves to one tool. ⚠️ **Matching only** — the stored, displayed and printed value stays the CSV's own string. Re-rendering it in the app's canonical body-first order is a **later TODO** (it depends on the pairing's confirmed order, which isn't always known).
- **Holder matching is optional enrichment.** The CSV's holder string is stored and printed either way; a match only adds `holder_id` for later phases. Deliberately an exact (normalized) description match — a fuzzy guess would attach the wrong record to a proven assembly, and real holder matching (taper, collet, gauge length, extension) is its own phase.
- **Location: the APP wins** — the one exception, below.

### Location: the app wins (the one exception to CSV-always-wins)

⚠️ **`resolveRowLocation` (`sequenceImport.js`) — location is displayed and PRINTED from ToolDex, not from the posted file.** Everywhere else the CSV is fact because a wrong value is a crash. Location isn't that kind of value: the CSV's `LC` comes from **Fusion's vendor field**, which the app updates **lazily** (a tool's Fusion copy only catches up on its next individual save, or on the explicit `pushFieldToFusion` sync), so a posted file routinely names a bin the shop has since changed. ToolDex **owns** location — the Location System, the bins and the ProShop location import are all behind it — so the app's value is the current one, and the label's whole job is to send someone to the right drawer.

- **Display and print only.** The row still **stores** the CSV's own `lc` verbatim, and the raw file is never edited. Nothing about this "corrects" the import.
- **Falls back to the file** when the app has no location for that tool — including an **insert tool**, whose location lives on its components, so the pairing itself has none.
- **Resolved live** against the current library (not stored at import), so correcting a location in ToolDex reaches the tool list and the next label with no re-upload.
- The tool list shows a muted **`file: LC-244`** marker where the two differ — that difference is evidence Fusion's copy is stale, which the location **Fusion sync** action exists to fix.
- **Dedupe consequence**: two rows differing *only* by a stale posted location collapse to ONE label, because both resolve to the same drawer.

### Condensing — one row per POCKET

`condenseTools` keys on **T#, not on the tool**: the same tool in two pockets is two physical assemblies to set up and label, while one pocket appearing at non-adjacent sequence numbers is one entry that remembers both (`seqs: ['15','15.1','25']`). A blank on a pocket's first row is filled from a later row (the post repeats the assembly data), but **an existing value is never overwritten**.

### Display

Lives in the **Parts** tab, **not a new top-level tab**.

- **The PART page** (`/parts/:id`) holds a part + rev and every operation on it. The part header on `/parts` opens it; a new upload navigates straight there. It's a *part* page rather than a "job" page because a part can carry more than one set of programs, and the shop wants all of them on the one page for that part.
- ⚠️ **It carries the SAME edit controls as the main Programs list at every tier** — edit the part, edit or delete any routing or operation, add a new one — by rendering the **same shared forms** and the **same shared mutations**. See **The Parts module** for both. There is deliberately no second implementation to drift.
- Per program: **Tool List** and **Sequence Detail** tabs, the proven toggle, and a download of the current posted file.
- Per part: an **all-tools list** across every OP (with an OP column), because a part usually needs every label at once. **Sequence Detail is per-program only** — there is no part-level sequence.
- Tool List columns, in this order: G-Code T# · H Offset # · D Offset # · Dim Tag # · ProShop Tool # · Location · Description · Cut Dia · Tip · Holder · OOH · Tool Life (M) · Init D Offset. **Dim Tag #, Tool Life (M) and Init D Offset are deliberately empty placeholders** — wired in a later phase, and the space is held so the table doesn't reshuffle when they arrive. `RTA #`, `Gauge Len`, `WO #` and `Operator` are explicitly **not** columns.
- ⚠️ **Both flags are computed LIVE, not read from what was stored at import** — the location disagreement against the current tool, the unmatched-holder marker against the current holder library. Stored at import, fixing the library would leave the marker showing until someone re-uploaded the CSV: a flag the user can't clear.

### Labels — the deliverable

**The tag layout is COPIED from the shop's Chrome extension** (`docs/proshop_brother_label_extension_v9/content.js`), not redesigned. These labels are already printed, read and trusted on the floor, and the geometry is tuned to a physical label on a physical printer (the 0.04/0.02in nudge exists because the tag clipped without it). Only the data source changed: ToolDex's stored Sequence Detail instead of scraping the ProShop DOM. DK-11201, 3.5" × 1.1", 2.2" tag + 0.25" footer, inches-based auto-fit, one page per label.

- Print **all**, or tick individual rows and print just those. Available **per program** and **per part** (a part often needs every label for every OP at once).
- **The label carries the T# only** — not H or D.
- **RTA: the field stays on the label, the value is dropped.** A stale RTA is worse than a blank.
- ⚠️ **Dedupe: never print two labels that are 100% identical, and ANY difference makes it a separate label.** The consequences are deliberate and pull in opposite directions: the same tool in **two pockets** of one program prints **two** labels (two setups, different T#), while one pocket shared by **two OPs** prints **one** (nothing about it differs).
- A blocked popup is reported — it looks exactly like a broken button otherwise.

### The all-tools list names its programs, and won't quietly print a stale one

⚠️ **The part-level "All tools for this part" list POOLS several programs, so it showed no per-program status at all** — a full set of labels could be printed for a setup Drive had already moved on from, with nothing on screen to say so. The per-program cards were fine (their indicator sits next to their own print buttons); the pooled list was the hole.

Its header now carries one **chip per program with a stored detail** — the program badge and its `OpPill` inside a shared bordered chip (the chip is the program's identity), with that program's `ProgramFileStatus` icon beside it (the icon is its state). Clicking the icon pulls that program in, exactly as on its own card.

**A print button that would label an out-of-date setup turns amber** (`.sd-print-stale`, the same amber as the sync button it is warning about, so the two read as one condition). Clicking it **updates the stale programs first, then prints**. Both buttons carry it: *Print all labels* against every stale program on the part, *Print selected* against only the stale programs the selection actually touches — leaving the second unguarded would be a hole in the thing this exists to close.

⚠️ **PRINTING RE-CHECKS DRIVE AT CLICK TIME — it does not trust the indicator.** `guardedPrint` is the ONE print path (both all-tools buttons and both per-program buttons) and it always calls `fileSync.checkNow()` first, pulls in anything stale, then prints. The indicator is a poll: it can be minutes old, mid-refresh, or never have run, and a label that doesn't match what the machine will run is the one outcome this exists to prevent. The cost is one folder listing per print. If Drive can't be reached it prints what is stored and **says so** — unverified is not the same as known-good.

⚠️ **A RE-CHECK KEEPS THE LAST KNOWN STATUS** (`statusFor`, `useProgramFileSync`). Reporting `checking` on every refresh threw the previous answer away, and that was not a cosmetic flicker: the print guard reads these states, so during a background poll every program briefly looked fine, the amber warning dropped off the print button, and a click in that window printed labels for a setup Drive had already moved on from — then the poll landed and the warning reappeared, which is exactly what the user saw. `checking` is only honest before the FIRST answer.

⚠️ **The print window is opened SYNCHRONOUSLY in the click, then filled.** `openTagWindow()` + `printToolTags(labels, { win })`. A popup opened after an `await` has lost the user gesture and the browser blocks it — so re-checking Drive before printing would otherwise trade a stale-label bug for a print that silently never appears. Locked by `labelPrint.test.js`.

⚠️ **The print rebuilds its rows from the details it just fetched, not from the rendered ones.** `rowsFrom(map)` takes the detail map as an argument precisely so `updateThenPrint` can pass the freshly-stored details; reading the rendered `partRows` there would print the very version the update set out to replace, because React has not re-rendered yet. This is the whole bug the feature is meant to prevent, reintroduced one line later.

⚠️ **After an update, *Print all* passes NO key filter.** The refreshed program may hold different pockets, and the keys captured before the update would drop the new rows and keep vanished ones. *Print selected* deliberately keeps its filter — the selection is what was asked for, so a pocket that vanished simply doesn't print and one that appeared isn't selected.

### Proven / unproven

**Per program**, and the distinction matters: proven means **this program ran on the machine and did not crash**. Uploading a CSV never implies that — a person sets it deliberately, later. It applies to the **currently uploaded version** and **travels with that version**: archiving encodes it in the retired filename. **Phase 1 is display only** — it neither blocks nor alters printing.

### Storage & versioning

- **The condensed list** goes in `program_details.json`; **the raw file** goes to `ProgramFiles/{O####}/` untouched. Only the **latest** version's parsed data is stored.
- ⚠️ **The full sequence is re-parsed from the raw file on demand, not stored.** There is no second derived copy to drift, and what the Sequence Detail tab shows is *provably* the file the post wrote. Costs one Drive fetch when the tab is opened.
- **Version key = the POSTED timestamp** — set by post logic into both the CSV and the G-code, so it's what pairs them. Re-uploading the same stamp is the same version: no new archive copy, and the proven state is kept.
- **The current version keeps its original filename** (so "download the current file" is unambiguous); a new upload **renames** the previous one to `O1218_20260810-1051_proven.csv` — chronologically sortable, carrying the proven state of the version being retired. Renaming preserves the Drive file ID, so nothing referencing it breaks. **Archiving is best-effort**: failing to rename an old file must not cost the user the upload they actually asked for.
- Demo mode keeps an uploaded file's text in memory for the session, so the sandbox exercises the whole flow (including the Sequence Detail tab) without a demo-only field on the stored record.

### TODO — the Sequence Detail tab still shows the FILE's values

The **Tool List** and the **labels** now resolve location from the app (above), but the **Sequence Detail** tab re-parses the raw CSV and renders it as-is, so its `LC` column — and any other field the app has since corrected — **will be out of date**. That is defensible as far as it goes (that tab is deliberately "here is the posted file, provably"), but the two tabs can now disagree about the same tool, which needs a decision rather than a silent difference:

- Resolve the same fields there too, and mark which values came from the app?
- Keep it verbatim and label the tab as the raw file, so the difference reads as intentional?
- Split it — a "posted" view and a "current" view?

The same question widens later, since **holder and OOH** have the same lazy-Fusion problem in principle; the difference is that those are crash-relevant and location isn't, which is exactly why only location moved. Revisit when the CSV-assembly work lands (below) — that phase is where a row gains a real FK to an assembly and the question of "which value do we show" gets answered properly for every field at once, rather than one field at a time.

### Automatic posted-file sync (per-machine Drive folder)

Each machine carries the Drive folder its posted files land in — `program_folder_id` + a cached `program_folder_name` on the `shop_settings.machines[]` entry, picked with the shared **`DriveFolderPicker`** in Settings → Shop → Machines. A part page then checks those folders and says, per program, whether Drive has something newer than what the app holds.

⚠️ **THE SEARCH IS FOLDER-SCOPED, NOT MACHINE-SCOPED.** Two machines legitimately share one folder, and (per the shop) which machine a posted file sits under doesn't mean anything yet. So every configured folder is searched and a file found anywhere counts; the machine decides only **search order** and what the indicator *says*. A file found outside its own machine's folder is reported via **`wrongFolder`, which rides ALONGSIDE the state rather than replacing it** — it is still stale-or-current, and collapsing the two into one "wrong folder" state would hide whether there is anything to do.

⚠️ **THE VERSION KEY IS THE POSTED STAMP, AND IT LIVES INSIDE THE FILE — so the check is deliberately TWO-TIER.** Drive's `modifiedTime` comes free with a folder listing; reading a POSTED stamp costs a download *per program*. So the **poll** (`utils/programFileSync.js`, metadata only) asks "has the file changed since we took our copy?", and only the **pull** (`programActions.importProgramFileFromDrive`) downloads, reads the real stamp, and runs the same `buildSequenceImport` the manual upload runs. **One listing per FOLDER serves every program on the page** — a part with a dozen operations costs one or two Drive calls, not a dozen, which is the only reason this is cheap enough to sit on a timer (`useProgramFileSync`: on mount, every 5 min while the tab is VISIBLE, and on refocus; a hidden tab polls nothing).

⚠️ **`source_modified` is what stops this becoming a nag loop, and a same-version pull STAMPS AND STOPS.** The gap between the two tiers is real: a file re-saved (or merely re-synced) in Drive gets a newer `modifiedTime` with an unchanged POSTED stamp, and every record imported before this feature has no stamp at all. So `importProgramFileFromDrive` records the `modifiedTime` of the file it took, and when `sameVersion` holds it writes **only that stamp** — no re-upload, no archive rename, proven state and `raw_file_id` untouched. Re-uploading identical bytes to answer that would churn Drive across the whole library. Locked by `context/programFileSync.test.js`.

⚠️ **`uploaded_at` is a FALLBACK BOUND, never the comparison.** `source_modified` compares like for like. `uploaded_at` is when a *person* stored it — always later than the post, so using it as the comparison reads a file as ahead of itself. But one-directionally it is sound: stored *after* the Drive file last changed ⇒ we cannot be behind. That is what keeps a file the user **just uploaded by hand** from immediately showing amber, which is the most visible way this indicator could read as broken. It can only ever say "not stale".

⚠️ **The automatic path honours the SAME blockers as the manual upload.** A ProShop Tool # that resolves to no tool, or a program number ToolDex doesn't have, blocks the whole file — reported and skipped, never half-stored. An automatic path that relaxed that would store exactly the half-populated tool lists the rule exists to keep out, with nobody watching.

**A failed listing is an ERROR, not a missing file.** One unreachable folder (renamed, permissions changed) never blanks out the other folders, and a folder that couldn't be read reports "couldn't look" rather than "nothing there" — those are different answers and only one of them is about the file.

**An icon, never a banner** (`ProgramFileStatus.jsx`, the `.pf-status` token). It renders on every program on the page, so a banner-sized flag repeated a dozen times is wallpaper by day two. Four states — `missing` / `current` / `stale` / `error` — with the detail in the tooltip; only `stale` is a button, because it is the only one with anything to do. Renders **nothing** when no folders are configured or Drive isn't connected. **`AutoImportedMark`** (same file) marks a detail that arrived through an automatic pass rather than a person choosing to upload it: not a warning, just keeping "nobody vouched for these numbers" visible.

**Reusable by file KIND, because G-code is next.** `SEQUENCE_CSV` is a descriptor (`ext`, `label`, `numberOf`) threaded through `fileMatchesProgram` / `candidatesFor` / `useProgramFileSync`; the G-code sync is a second descriptor, not a second copy of the search-and-compare logic. The shape of the answer is identical — found / not found / ours is older / couldn't look — only the noun changes. Locked by `utils/programFileSync.test.js`.

**Additive to stored data** — `program_folder_id`/`program_folder_name` on a machine and `source_modified`/`source_file_id`/`auto_imported` on a `program_details` record all default cleanly on records that predate them. Nothing to migrate.

### Comparing two posted versions (reference only)

**Compare** on an operation opens `SequenceCompareModal` — pick two versions of that program's posted file and see what moved. ⚠️ **Deliberately OPT-IN and outside the update workflow**: taking an update stays one click that asks nothing, and this button writes nothing, blocks nothing, and corrects nothing. The CSV-always-wins rule is untouched — comparing two of them changes neither.

**The version list is DERIVED from Drive, not stored** (`utils/programVersions.js`). `program_details.json` keeps only the latest version on purpose, so there is no stored history; what there is, is the program's own `ProgramFiles/{O####}/` folder holding the current file plus every retired version already carrying its posted stamp and proven state in its name. `parseArchiveFileName` is the **inverse of `archiveFileName`** — they live in different modules and a change to either silently empties the list rather than failing, so a round-trip test pins them together. `driveService.listProgramFolderFiles` is **read-only** (never creates a folder — opening a compare must be able to answer "nothing to compare" without leaving an empty folder behind for every program anyone glanced at). ⚠️ The **current** version is identified by the stored `raw_file_id`, never by filename: it deliberately keeps its ORIGINAL name, so a folder legitimately holds a current `O1218.csv` alongside archived `O1218_*` copies and name-matching would pick whichever came first. A **pending** file (newer, in a machine's posted folder, not yet imported) is offerable as a side, so "it says it's out of date — what changed?" is answerable BEFORE taking the update; it is labelled by its Drive **modified time**, never dressed up as a posted stamp, because its real POSTED stamp is inside the file and hasn't been read.

**The Compare button greys out only when it can PROVE there is nothing to compare** (`canOfferCompare`, `programVersions.js`). Listing a program's folder per program on every part page would spend a handful of Drive calls on a button most people never press, so the answer comes from two free signals: a file waiting in Drive that hasn't been taken in (that IS a second version), and **`has_prior_versions`** — written by `importSequenceDetail` at the one moment it archives a file, so it cannot drift from whether the older copy exists. ⚠️ `undefined` means UNKNOWN, not none: records written before that field must keep offering Compare, or the app would hide versions sitting in the folder right now. Only an explicit `false` disables it. Additive and backwards-compatible.

**One row per aligned operation, not two files side by side.** With the columns doubled a side-by-side view is twenty across, and the thing worth seeing is the CELL that moved. A row the other version lacks is a blank half — that is the added/removed line. Compared fields (`COMPARE_FIELDS`): Sequence Description, ProShop Tool #, G-Code T#, Description, Holder, OOH. **Not compared**: Cut Dia, Tip, Location, RTA, Gage — the shop doesn't read them on a version compare.

⚠️ **Seq# is DISPLAYED but never COMPARED.** A sequence number is emitted on tool change, so inserting ONE operation renumbers everything after it; keying on Seq# would make a single insertion light up the rest of the program — the exact failure a compare exists to prevent. The number changing is the *symptom* of an added/removed row, which the alignment reports directly. Locked by a real-fixture test asserting a wholly-renumbered re-post reads as identical.

⚠️ **ORDER IS THE POINT — the alignment is strictly forward-only with a bounded lookahead** (`alignSequenceRows`, `MATCH_WINDOW = 8`). A textbook LCS is order-preserving but will pair a row with its twin far down the file, quietly reporting a **moved toolpath as "unchanged"** and everything between it as inserted. The order of operations is what the machine does, so a move IS the change. Past the window, rows are reported as removed and added where they actually are. Locked by a test asserting a moved operation never comes back `same`.

**Identity is `Sequence Description + ProShop Tool #`** — what the operation is plus what runs it. ⚠️ It deliberately **excludes holder and OOH**, because those are the changes most worth SEEING: if they broke the match, the very thing being looked for would render as an unrelated remove + add instead of a highlighted cell. Inside a replace block, rows are paired positionally only while `rowsRelated` holds (sharing a name **or** a tool); once they stop lining up it stops guessing and emits real removes and adds, rather than claiming an edit that never happened.

⚠️ **A number is compared as a NUMBER.** The post writes `0.70` where an older one wrote `0.7` — the same stick-out, and treating it as a difference would light up every row from a formatting change alone. Storage and display still keep the CSV's own string; this is comparison only.

**The direction is stated, not inferred.** The pickers read **From (older)** → **To (newer)**, a `+` / `−` marker sits in the Seq# cell of an added / removed row, and a caption under the table names both sides in words. ⚠️ The `+`/`−` carries the meaning WITHOUT colour — the row tints are close in hue for anyone who reads colour differently, and a tint alone cannot say which side a row is missing from.

**Known noise, left deliberately:** `t_description` (the tool's own description) is compared, so renaming a tool in the library lights up every row using it. That is a true difference, and it is the natural first candidate for the later "some differences matter more than others" ranking — which is also where a per-column importance weighting would live.

### The BULK pass — one run over every posted-files folder

`AppContext.bulkImportPostedFiles({ onProgress })` (`programActions.js`), driven by **Settings → Bulk Import Sequence Details** (`BulkSequenceImportModal`). It scans every configured folder, takes the newest copy of each program number, and imports everything it can in one pass. The point is the **program ↔ ProShop-ID links** across years of old jobs — once they exist, "which tools run in which programs" is answerable historically.

⚠️ **A file the app already holds is SKIPPED, not re-imported** (`isStale` against the stored `source_modified`). That makes a re-run cheap and idempotent and stops the pass rewriting proven records for nothing.

⚠️ **IT RELAXES EXACTLY ONE BLOCKER, and that one is a policy choice.** `buildSequenceImport({ allowUnmatchedTools, looseToolMatch })` — both **off** for a deliberate upload. An unmatched ProShop number stores the row with `tool_ref: null` and flags it instead of throwing the whole program away, because losing a program to one number mis-typed years ago defeats the point of the run. **The other blockers are structural and still block**: a detail is keyed on `operation_id`, so a file whose program ToolDex doesn't have has nothing to attach to; likewise a file that isn't a Sequence Detail export, or has no tool rows. Do not "fix" those by inventing a placeholder operation.

**Loose ProShop matching — the NUMBER, with the formatting tolerated.** ProShop's counter increments across all tool types, so the number alone is unique and the letter prefix is decoration. `bareProShopNumber` (`sequenceDetail.js`) + the `byNumber` indexes in `buildToolIndex`. Three guards, each of which a looser rule gets wrong:
- ⚠️ **Above `PROSHOP_MAX` (999) is not a ProShop number.** The counter hasn't reached four digits, so a bigger value is almost certainly a manufacturer part number typed into the wrong column — matching it on digits would attach a real program to the wrong tool.
- ⚠️ **A combined insert id holds TWO numbers**, so it never loose-matches; it still matches exactly, as an unordered set of halves.
- ⚠️ **A number claimed by two tools is AMBIGUOUS and matches nothing.** Shop-wide numbering means it shouldn't happen, but a loose match that picked one would attach a program to the wrong tool silently, in bulk.

A loose match is reported separately (`flags.loose`) from an exact one — it is a real match, just a looser one.

**Older exports parse without special-casing.** Only Seq#, Tool # and G-Code Tool # are required; every other column was already optional and renders blank. ⚠️ The header ROW is now found via the alias table rather than two literal strings — an old file writing `Seq` instead of `Seq#` used to fail to parse entirely, and the failure reads as "this isn't a Sequence Detail export" about the shop's own posted file.

**Provenance is stamped, never inferred.** Each record gets **`import_batch`** (the run's ISO stamp) at import time, and `BulkImportMark` reads that field. ⚠️ Deliberately NOT correlated by comparing a record's timestamp against when the run happened: a window gets it wrong in both directions — a manual upload made during a run would be falsely marked (exactly backwards; that one was reviewed), and a run over hundreds of files outlasts any window, so its later files wouldn't be marked at all. The marker appears on each program's header and once on the pooled all-tools header (a single bulk program taints the set for review purposes). `shop_settings.sequence_bulk_import` is a **log of the event** for the Settings card only — the badge never reads it, so the two cannot disagree.

**An unmatched row is visible where it matters.** `ToolListTable` renders the CSV's own ProShop number with an unlink marker. ⚠️ The consequence that makes it matter: an unmatched row contributes nothing to **Where Used**, which is derived from `tool_ref`. Those rows are the worklist of numbers to correct, and the run's report lists them per program.

⚠️ **`relinkStoredDetails` is what makes that flag CLEARABLE, and the run does it first.** `tool_ref` is resolved once at import and stored, so correcting a tool's ProShop number afterwards does **not** re-link the rows that missed it — and nothing else would: the file isn't stale, so the scan skips the program, and a same-version re-stamp keeps the prior record untouched. The flag would name a problem the user had already fixed, forever. The pass is metadata-only and Drive-free, only fills rows that currently have **no** tool, never overwrites a link that resolved, and returns the **same file reference** when nothing changed so a caller can tell there is nothing to persist.

**Two things are deliberately best-effort, for the same reason the archive rename is:** the `shop_settings.sequence_bulk_import` log (the import already happened and every record is stamped — losing the Settings line is not worth discarding the report) and a folder that couldn't be listed (reported, never treated as empty).

⚠️ **A same POSTED stamp counts as "already current", not as imported.** It reaches the same-version branch, stores nothing, and keeps its proven state — counting it as taken in would overstate the run and attach an unmatched-row count to a file that was never stored.

**Files that cannot be stored are skipped BEFORE downloading.** A posted folder holds other CSVs and every one parses to some number; fetching each just to be told there is no such program is a Drive call per stray file.

### Deferred from the bulk pass

(Implemented — kept for the reasoning.) **⚠️ THE BULK PASS DOES NOT BLOCK ON AN UNMATCHED ProShop NUMBER — the manual/auto single import still does.** Owner's call, decided: a deliberate upload of a current posted file stays strict (a Tool # that resolves to nothing means something is wrong and the person is right there to fix it); a run over years of old posted files must not throw away a whole program because one number was mis-typed years ago. In bulk the row is **stored with `tool_ref: null` and flagged**, and the file lands.

⚠️ **That is the ONLY blocker that can be relaxed, and it is a policy choice; the other three are structural.** A stored detail is keyed on `operation_id`, so `buildSequenceImport` cannot produce a record at all without a program to attach it to — a file whose program number ToolDex doesn't have is still skipped and reported, in bulk as everywhere. Same for a file that isn't a Sequence Detail export (no core columns to parse) and one with no tool rows (nothing to store). Do not "fix" those by inventing a placeholder operation.

**Flagging an unmatched row needs NO new stored field.** `tool_ref: null` is already the shape, and "which rows are unmatched" is derived (`tools.filter(t => !t.tool_ref)`) like every other flag in this module. The existing UI already degrades correctly — the tool list renders the CSV's ProShop number as a plain unlinked pill and the label falls back to the file's own location — so what is missing is only a visible marker, next to the `AutoImportedMark` that already says nobody vouched for these numbers. ⚠️ The consequence that makes the flag matter: an unmatched row contributes nothing to **Where Used**, which is derived from `tool_ref`. Those rows are the worklist of numbers to go correct.

**Matching an old ProShop number — match on the NUMBER, tolerate the formatting.** Every ProShop tool is already in the app, so a miss means the number is mis-formatted, was never in ProShop, or was never updated. ProShop increments its counter **across all tool types**, so the number alone is unique and the letter prefix is decoration:
- Normalize spacing/dashes/case before comparing (`proShopIdKey` already does this).
- Fall back to matching on the **bare number**, ignoring the letter prefix.
- ⚠️ **Guard: a value above 999 is not a ProShop number.** The counter hasn't reached four digits, so a large number is almost certainly a manufacturer part number someone typed into the wrong column, and matching it on digits would attach a real program to the wrong tool.
- The combined-insert form (`I-224 / G-223`) is an unordered SET of halves — already handled; the bare-number fallback must not break that.

**Older posted files have fewer columns** (no fixture line, no Cut Diameter, and others), so `parseSequenceCsv` needs a looser header match for the bulk path. ⚠️ The three columns it genuinely cannot work without stay required — Seq#, Tool #, G-Code Tool # — because a row without them is not a toolpath. Everything else is already optional and renders blank.

⚠️ **Anything the bulk pass loosens must not loosen the MANUAL upload.** A deliberate upload of a current posted file should still be strict — that is where a missing column means the wrong file was picked. Any tolerance added here belongs behind the bulk path's own flag, not in the shared parser's defaults.

### Explicitly OUT of scope (do not partially build these)

G-code upload/parsing (the versioning scheme already anticipates it) · tool assembly linking and the "CSV assembly" (a metadata-only assembly record with a stable FK, grayed out with a "not in Fusion" icon and a push-to-Fusion button) · real holder matching · Google Drive sync (a manual "is there a newer posted version" button + a per-machine folder picker) · editing imported data in the table · extra header fields (stock size, cycle time, machine, material, fixture) · ProShop CSV export of this data · wiring the placeholder columns · version history UI.


-----

## Shared Drive Files (materials / vendor registry / shop settings / jobs)

Shop-wide JSON files live in the **same Drive root as `tool_metadata.json`** and are loaded at startup **in parallel** with the metadata (in `loadTools`, when Google is connected). Each is **created from its default content if it doesn't exist yet**; a load failure on any one falls back to its default and never blocks the library load. All are exposed via `useApp()` as `state.materials` / `state.vendorRegistry` / `state.shopSettings` / `state.parts` / `state.components` / `state.programDetails` / `state.holderLibrary` (defaulting to their seeds before load), with save functions `saveMaterials` / `saveVendorRegistry` / `saveShopSettings` / `saveParts` / `saveComponents` / `saveProgramDetails` / `saveHolderLibrary` (`tool_components.json` holds the holder body / insert component records — see **Insert-Style Tools**; `program_details.json` holds the parsed Sequence Detail — see **Sequence Detail & Label Printing**).

**How they are found (never need separate selection):** `loadOrCreateSharedJson` calls `getMetaParentFolderId()` (the parent folder of the connected `tool_metadata.json`) to locate them. Their Drive file IDs are cached in localStorage under the keys in `SHARED_FILES`; on a fresh machine (empty cache) the function searches the metadata folder by name and re-caches. A missing file is created from its default seed. This means connecting `tool_metadata.json` once is sufficient — the other shared files auto-join on the next `loadTools`. The `MetadataConnect.jsx` folder picker checks for all of them in parallel during browsing and shows a ✓/— status grid in the callout so users can confirm all files are present before connecting (see **Google Drive — Shared Drive Support** below).

- **Generic Drive-file plumbing** lives in `driveService.js`: `loadOrCreateSharedJson(name, cacheKey, default)` and `saveSharedJson(name, cacheKey, content)`, with the file names + localStorage cache keys in `SHARED_FILES`. Content is pretty-printed (`JSON.stringify(data, null, 2)`) like all Drive JSON. Cache keys are cleared on `signOut()`.

- **Saves are optimistic + debounced (AppContext).** `saveSharedFile` (and `saveLocationConfig` / `markSetupStepInSettings`) update React state **synchronously** first, then write to Drive on a per-file 600ms debounce (`scheduleSharedWrite`). This is required: the editor inputs (Location / Materials / Vendors) are controlled by `state.{shopSettings,materials,vendorRegistry}`, so if a save awaited the Drive round-trip before updating state, **every keystroke would lag by the network latency** (the bug this fixed). Two corollaries: (1) sub-object writers to `shop_settings.json` must **merge via the reducer** (`SET_LOCATION_CONFIG`, `MARK_SETUP_TIMESTAMP`) off fresh state, never rebuild-and-replace the whole object from `shopSettingsRef.current` (stale mid-tick → clobbers a concurrent edit); (2) the debounced write flushes the **latest settled state from the ref** at timer time, so multiple same-tick writers coalesce into one correct write. Demo mode skips the Drive write entirely (in-memory sandbox). A pending debounced write is **flushed early** (with fetch `keepalive`) on `pagehide` / `visibilitychange→hidden` (`flushSharedWrites`) so an edit in the last 600ms isn't lost on tab close/refresh; in-app HashRouter navigation keeps the provider mounted so its timer fires normally.

- **`materials.json`** (default in `src/schema/sharedDefaults.js`, **`version: 2`**) — shop-editable material taxonomy, **the single source of material in the app**, in **three tiers**:
  - `groups[]` = the standard ISO turning groups (`P` Steel, `M` Stainless, `K` Cast Iron, `N` Non-Ferrous, `S` High-Temp Alloys, `H` Hardened Steel), each with a `color` (per-group token for preset color coding — no prior material→color map existed, so these seed it), a short `code` (the fallback token used in preset names, e.g. `SS`/`AL`), and an `iso` flag.
  - `presets[]` = **CAM presets** — the middle layer that becomes the Fusion **speed/feed preset group name** (`{ id, group_id, name, code, description, iso_513, kennametal, vdi_3323, order }`). Each carries the equivalent material code in three standards (ISO 513 / Kennametal / Haas-VDI 3323) so manufacturer charts cross-reference (a manufacturer's `material_code_system` says which column applies — see vendor registry). The optional short `code` overrides the group code in preset names; seeded presets leave it blank.
  - `materials[]` = individual **alloy records** (`{ id, group_id, preset_id, label, aliases[], category, condition, code, iso_513, kennametal, notes, order }`). `aliases[]` are the alternate names the shop looks a material up by (6061-T6, SS316, 18-8…); `preset_id` links the alloy **up** to its CAM preset. **Seeded full** from the shop's material reference docs (`/Material REF Docs`) — values to be audited against the charts there.

  The preset material picker (`PresetPanel`: Group → CAM Preset), name composition, and coloring all read this file — see Preset naming convention. **Migration note:** the seed only applies when the Drive file is *missing*; a shop with an existing `version: 1` `materials.json` must use **"Load reference data"** in the Materials editor (or delete the Drive file) once to adopt the 3-tier seed. `MATERIAL_CODE_SYSTEMS` (also in `sharedDefaults.js`) lists the three classification standards.

- **`vendor_registry.json`** (default = `DEFAULT_VENDOR_REGISTRY` in `vendorRegistry.js`) — the unified entity list (see `vendorRegistry.js` above). Each entity carries a preferred `name` + `aliases[]` (match-only alternates). Manufacturers also carry **`material_code_system`** (`'iso_513' | 'kennametal' | 'vdi_3323' | null`, from `MATERIAL_CODE_SYSTEMS`) — which material-classification standard that manufacturer publishes, so its catalog's material codes map to the CAM presets' code columns. Each tool's `purchasing.manufacturers[]` / `vendors[]` are intended to reference entity IDs from this list; the `is_manufacturer` / `is_vendor` flags determine which picker an entity appears in.

- **`shop_settings.json`** (default in `sharedDefaults.js`) — `{ shop_name, default_units, machine_number:{start,skip}, machines:[], default_machine_id:null, tool_id_system:{mode,separator,start,skip,digits,show_legacy,location:{cabinet_identifier,drawer_identifier}}, location_config:{show_legacy,systems:[…],bin_sizes:[…{uuid id}]}, assembly_id_system:{mode,separator,serial_start,show_legacy}, presetter:{serial_format,serial_start}, import:{...}, aps:{...}, setup_steps:{fusionConnected,metadataConnected,toolIdConfigured,locationConfigured,assemblyIdConfigured,normalized,holdersLinked,proshopMerged,proshopPhotos,machineNumbers,proshopExported} }`. **Wired into behavior**: `default_units` is mirrored to `setDefaultUnit` on load; `machine_number.{start,skip}` drives renumber/add-tool — and **`resolveMachineNumberCollision`** (`identity.js`), which reassigns a Fusion tool's incoming machine number on import/normalize when it's already used, is a **reserved/skip** number, OR is **below the start** (start + reserved numbers are treated as already assigned — e.g. a tool arriving as T2 with start T30, or on a reserved T99, is reassigned to the next free number and flagged via `_machineNumberConflict`). The same rule backs a **library-wide sweep** — Settings → **Machine number issues** card → `AppContext.fixDuplicateMachineNumbers` (`libraryOps.js`) — which walks the whole library (Fusion + no-Fusion), keeps the first tool on each valid number, and reassigns every duplicate, reserved, or below-start number (flagging each). `findMachineNumbersToFix(tools, start, skip)` (`identity.js`, reason: `duplicate`/`reserved`/`belowStart`) is the read-only detector the card's count/preview uses; `tool_id_system` drives the configurable Tool ID System (see that section) — `mode` controls ID generation/display and `machine_linked` mode keeps `machine_number` in sync. `setup_steps` holds ISO timestamps written by `markSetupStepInSettings()` (AppContext) each time a setup step completes — shared across devices via Drive. The **canonical `SETUP_STEPS`** (exported from AppContext, in order) are: `fusionConnected`, `metadataConnected`, `toolIdConfigured`, `locationConfigured`, `assemblyIdConfigured`, `normalized`, **`holdersLinked`**, `proshopMerged`, `machineNumbers`, `proshopExported`. **`holdersLinked`** ("Set up the holder library") sits **immediately after `normalized` and before `proshopMerged`** — connecting the library, normalizing it and getting the holders under control are one job (getting the **Fusion** data right); ProShop is a different system and may come before or after, but the holder step can't precede normalize (linking matches against tools that must already carry tracking IDs). Step 1 links the holder library *file*; this step is the **work** — import → normalize names → merge duplicates → link tools → push, listed in that order under the step in Settings with a button to `/holders` (the same order + the "edit here, not in Fusion" rule is on the Holders page in `HolderWorkflowBanner`). Like `fusionConnected`/`metadataConnected`/`normalized` it is **derived from the data by a declarative effect**, not from a click: a live (non-archived) holder record exists **AND** at least one assembly carries a `holder_id` — so a shop that did the holder work before the step existed checks off on load. It is deliberately **excluded from the established-shop seed** (a pre-holder-feature library genuinely still has this to do) but **included in `AUTO_DERIVED`**, so its auto-stamp can't be mistaken for "real recorded progress" and deny that seed. Its live-data warning reports no holders imported, or N tools not yet linked to a holder. `toolIdConfigured`/`locationConfigured` are the three-ID-systems group (configured in their Settings cards; `assemblyIdConfigured` is a **disabled "coming soon" placeholder** — `disabled: true`, excluded from the completion/progress math in `SetupGuide`); `proshopPhotos` is a sub-step tracked in `setup_steps` but not in `SETUP_STEPS`. **`metadataConnected`** completes the moment Google Drive connects (a declarative effect in AppContext marks it for both live sign-in and a restored session); seeding derives it from `googleRef.current`, and `loadSetupProgress`'s migration back-fills it (plus `machineNumbers`, `toolIdConfigured`, `locationConfigured`) on an established library (`proshopExported` true). **Still NOT wired**: the `import` and `aps` sub-objects (the import/APS flows don't write them back yet).
- **`parts.json`** (default `DEFAULT_PARTS` in `sharedDefaults.js`) — the Parts module: parts → routings → operations (see that section). Uses the ref-based debounce payload pattern (`partsRef`, like materials/shopSettings).
- **`program_details.json`** (default `DEFAULT_PROGRAM_DETAILS` in `sharedDefaults.js`) — the parsed Sequence Detail per operation: the **condensed tool list**, the POSTED version stamp, the proven flag, an `operation_id` FK, and a pointer to the raw CSV in Drive. Deliberately **condensed only** — the full per-toolpath sequence is re-parsed from the raw file on demand. See **Sequence Detail & Label Printing**. `saveProgramDetails` carries the same synchronous `onSaved` ref hook as `saveHolderLibrary` (the import saves, then immediately reads the ref back to archive the prior version).

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
  "color": "#4a8fff",
  "order": 0
}
```
`MACHINE_TYPES` = `['Machining Center', '5-Axis', 'Mill-Turn', 'Lathe / Turret', 'Other']`.
`TAPER_TYPES` = standard spindle taper names (BT30/40/50, CAT40/50 with dual-contact variants, HSK-A63/A100/E32/E40, Other).

**Machine colors + the `.machine-pill` token** — every machine has its own display color and renders as a colored pill everywhere its name appears standalone (`MachinePill.jsx`, the `.machine-pill` data-field token — same `--badge-color` mechanism as holder pills). Pure helpers in `src/utils/machineColors.js` (tested): `MACHINE_COLOR_PALETTE` (**blue and green first** — the first two machines get those), `machineColor(machine, machines)` (picked `color` else palette-by-list-position, so pre-color machines need no migration), `machineColorFor(machine_id, machine_label, machineOpts)` (resolves a program row's cached id/label against `machineOptions()`, which now stamps `color` on each option; null when the machine was deleted → pill renders in its default blue), and `nextMachineColor(machines)` (first unused palette color — seeds the Add Machine form). The user picks the color via `MachineColorPicker` (swatch row + custom color input) in the Settings machine editor + AddMachineForm. Pill sites: Parts page (grouped rows + table), AddProgramModal session list, ProgramPicker results, PresetPanel collapsed-card machine link, Settings machine list. The machine **filter chips** (LandingPage + PresetPanel) keep chip behavior but are tinted via `.chip.machine-chip` + `--badge-color`.

**Preset machine link** — each preset carries a metadata-only `machine_id` field (null when unlinked). It is stored in `preset_meta[guid].machine_id` in `tool_metadata.json` (alongside `operation_type`, `material_preset_id` — the CAM-preset foreign key, see Material comes from the Materials library — `job_ids`, and the unified-editor fields `small_bore` / `small_bore_diameter` / `f_z_base` / `intensity` — all written only when non-default) and read back in `mergeFusionAndMetadata` / overlaid in `logicalTools.overlayPresets`. **Never written to Fusion JSON** — every app-only per-preset field MUST be in `normalizePreset`'s destructure so it can't leak into the strict Fusion JSON (`strategies` is the exception — it IS Fusion-native). New blank/ref-seeded presets are pre-populated with `shopSettings.default_machine_id`; copied presets keep the original's `machine_id`.

**Tool-level preferred machine — FK by stable id (store the id, render the name).** A tool's **`preferred_machine_id`** (metadata-only) is the stable FK into `shop_settings.machines[]`; the **`preferred_machine`** string (shown as the blue card badge, part of `searchEngine` TEXT_FIELDS) is **derived live from the id**, so renaming a machine in Settings cascades to every tool. Distinct from the per-preset `machine_id` above (which machine a *speed/feed preset* is for) — this is which machine the *tool* is preferred on. Helpers in `src/utils/machines.js`: `machineById`, `preferredMachineIdForName` (id from an exact model match, else a loose contains — `"M300"` ~ `"Brother Speedio M300X3"` — else null), `syncPreferredMachine` (refresh the string from the id; adopt the id from a name-matched legacy string; tolerate a dangling id), `preferredMachineName` (live display resolve), and `backfillPreferredMachineIds(tools, machines)` (load-time walk, mirrors `backfillMaterialPresetIds` / `backfillPurchasingRegistryIds` — called at all `loadTools` build sites + demo; persisted lazily on next save). Edited via a machine dropdown in `ToolForm`'s Notes & Tags section (sets the id + caches the model name; a legacy free-text value with no matching machine is shown as `"(unlinked)"` until re-picked); `ToolCard` resolves the badge live via `preferredMachineName`. `null` for a legacy free-text value not matching any configured machine — those keep resolving by name, same fallback as the CAM-preset / vendor-registry FKs. Locked by `machines.test.js`.

**Taper compatibility hint** (`taperMatches`, `PresetPanel.jsx`) — when a preset's linked assembly has a holder, checks whether the machine's taper string appears (case-insensitive substring) in the holder description. Mismatch shows a ⚠ warning next to the machine picker in `EditCard`. Informational only, non-blocking. `'Other'` taper never flags.

**Landing page filter** (`LandingPage.jsx`) — rendered only when `shopSettings.machines.length > 0`. Default (non-strict): shows tools with presets linked to the selected machine **plus** tools with no machine-linked presets at all. Strict toggle: shows only tools with at least one preset explicitly linked to the machine. Initialized to `default_machine_id` once on first load via `machineInitialised` ref (doesn't re-apply when `shopSettings` reloads). The `machineFilter` state `{ machineId, strict }` is passed as the third argument to `applyFilters` (see `searchEngine.js`).

**Preset panel filter** (`PresetPanel.jsx`) — a second filter chip row (below the material tabs, only when `machines.length > 0`) lets the user narrow the visible preset cards to a single machine. Drag-to-reorder is disabled while either filter (material or machine) is active. The `CollapsedCard` shows the linked machine's model name (small `Cpu` icon + model) when `preset.machine_id` is set.

**Settings UI** — the Machines configuration lives **inside the Shop card** as a subsection (not a separate card). Includes: default machine picker (pre-selects the machine in the landing filter and new presets), machine list with expand-to-edit inline form, drag-to-reorder (`useDragReorder`), delete confirmation, `+ Add Machine` button (`AddMachineForm` local component). Changes to individual machines auto-save on the row's Save button; the default machine picker has a "Save Machines" button at the bottom.

### Editor UIs (`/materials`, `/vendors`, Settings)

Editor pages, reached from the top-bar chrome-style tabs (**Library**, **Materials**, **Vendors**, **Parts**, **Settings**; Parts = the Parts module, documented in its own section above). Inline editing, no modals. `MaterialsEditor` uses drag-to-reorder via the shared `useDragReorder` hook (`src/components/useDragReorder.js`, HTML5 DnD that renumbers `order`); `VendorsEditor` does **not** reorder (filter/sort instead — see below).

- **`MaterialsEditor.jsx`** (`/materials`) — a **65/35 two-column layout** (`.mat-layout`, same proportions as `ToolDetail`). **Left (main):** a hierarchy-graph toggle — two separate node buttons, **CAM Presets ──made up of⟶ Material Alloys** (`.mat-hier`) — switches the main list between the two; color-coded full-name **group filter pills** (`.mat-gpill`, e.g. "P — Steel", tinted by group color) drive both lists, alongside a full-width **search box at the top of the page** (matches CAM presets by name/code/description/standard codes + their alloys, or alloys by name/alias/code). CAM presets render as **rich rectangles** (`.cam-card`: left border in the group color, group badge, name + description, the three standard codes ISO 513 / Kennametal / Haas-VDI as columns, and the alloy chips that compose the preset); Material Alloys render as expand-to-edit rows (label/aliases/group/linked CAM preset/condition/code/codes/notes). Click a card/row to expand its inline editor (Delete lives inside the editor). **Right (reference):** the **Material Groups** card (drag-reorder via `useDragReorder`, editable color/label/**code**, ISO groups not deletable, `+ Add Group`), an **"Export for Fusion"** card (see below), and the **"Load reference data"** action (resets the whole library to the bundled seed — one-off migration). Autosaves to `materials.json` on each change via `saveMaterials`. **This library is the only source of material** in the app (the preset picker + naming + coloring all read it) and **group colors drive preset color coding** — see Preset color coding below.

  **Fusion stock-material export** (`src/utils/materialExport.js`) — Fusion's stock-material library wants **one JSON file per material** and doesn't understand our CAM-preset grouping, so the editor exports **one Fusion stock-material file per CAM preset** (reference exports live in `Material REF Docs/`). **Per preset:** a **"Fusion material"** download button in the open CAM-preset editor. **Bulk:** the right-column **"Export for Fusion"** card downloads one file for every **currently-shown** preset (so the group-pill filter / search scopes it — pick a group to bulk-export just that group; unfiltered = all). No zip dep — it triggers sequential downloads with a small gap (the browser may ask once to allow multiple). File shape (matches the confirmed working import): `description` + filename = the CAM preset **name**; `category` = `"Metal"` (all groups are metal — overridable param, not yet surfaced in UI); `uuid` = `""` (Fusion assigns one on import); `physicalMaterials` = `[]` (Fusion-internal render materials); `version` = `1`. **`designators`** (Fusion's "Keywords" search list, `buildDesignators`) = the preset's alloys + their aliases, the three standard codes (`iso_513`/`kennametal`/`vdi_3323`) + preset/group short codes, the group `label`/`id`, and the app `description` **with any already-listed alloy names stripped out** ("minus the alloys listed again"). Pure + test-locked (`materialExport.test.js`); no state/Drive writes (read-only download).
- **`VendorsEditor.jsx`** (`/vendors`) — one list over `vendorRegistry.entities`; per row: name, **MFG**/**VENDOR** toggle pills (both can be active), **Has Own #** (vendor only), expand-to-edit **Also known as** (aliases) + (manufacturers) a **Material code system** dropdown (`MATERIAL_CODE_SYSTEMS`) + URL patterns with a live preview. **No drag-reorder** — a toolbar offers a name/alias **filter**, a role filter (All/MFG/Vendor), and an **A–Z/Z–A sort** (alphabetical by default). Rows use a CSS grid (`.vendor-row`) so the MFG/VENDOR/Has-Own-# columns stay **vertically aligned** even when a row isn't a vendor (the Has-Own-# cell is `visibility:hidden`, not removed). The **MFG/VENDOR pills are color-filled when active** (indigo / teal) — these `.vendor-role-pill` colors are scoped to this page only, not the shared chip tokens. Autosaves to `vendor_registry.json` via `saveVendorRegistry` (which also refreshes the active registry).
- **`Settings.jsx`** — **Unified edit mode (one draft, one Save/Cancel).** The whole page is buffered: every section (Shop name/unit, **Machines**, **Tool ID System**, **Machine Numbers**, and the embedded **Location System** config) writes to local draft state — `buildDraft()` assembles the full `shop_settings` object; `managedSig()` projects the managed fields for a stable **`dirty`** compare against the saved `shopSettings`. There are **no** per-section Save buttons — a **frozen sticky header** holds the single **Save** (one `saveShopSettings(buildDraft())` write + `setDefaultUnit` + marks `toolIdConfigured`/`locationConfigured`/`machineNumbers`) and **Cancel** (re-sync every local state from `shopSettings`), enabled only when `dirty`. Editing any field auto-enters edit mode (= becomes dirty). While dirty: **library-wide actions are disabled** (Export, Renumber Library, Assign IDs, Re-number, photo import, rename — "save or cancel first"); a **`beforeunload`** guard catches close/refresh; an **idle prompt** (~3 min quiet → modal → +60s no response → auto-cancel/discard, `idleKick` restarts the timer on "Keep editing"); and **in-app navigation is intercepted** (top-bar tabs + internal links) → a Save / Discard / Stay prompt. The in-app guard is a context seam (`registerNavGuard({shouldBlock,onBlocked})` + `maybeBlockNav(proceed)` in AppContext) because `<HashRouter>` isn't a data router (no `useBlocker`); `TopBar`'s tab anchors call `maybeBlockNav` and `preventDefault` when blocked, and Settings' own links use a `guardedNavigate`. Tab-switch (browser tab) is intentionally **not** prompted. The Location editor takes `configOverride`/`onConfigChange` props to buffer into the page draft, plus a **`dirty`** prop. Normalize commits to the live library reading the **saved** config, so it's blocked **only while `dirty`** (unsaved changes) — "save settings first" — and becomes available once the page is saved, even though the editor stays buffered. (Gating on the mere presence of `onConfigChange` was a bug: the page is always buffered, so Normalize was permanently disabled and could never run.) The Machines sub-editor no longer saves immediately (its row "Save" is now "Done"; add/delete mutate the draft). Sections: **Account** (sign-out), **Setup & Import** (unified checklist with live-data warnings + Drive timestamps), **Shop** (name + default-unit + **Machines subsection**), **Machine Numbers**, **ProShop Export**, **Rename**, **Advanced**. The Machines subsection is **inside the Shop card** (not a separate card) — it contains the default machine picker, the machine list (expand-to-edit inline, drag-to-reorder, delete confirmation, `AddMachineForm`), and a "Save Machines" button. The Setup & Import checklist **embeds two config panels inline under their steps** (not as separate cards): the **Fusion Libraries** panel (tool + holder inline pickers) under step 1 `fusionConnected`, and the **Tool Metadata (Google Drive)** panel under step 2 `metadataConnected` — both are plain `render*Panel()` functions (NOT components) so the `FilePicker`'s navigation state survives re-renders. Steps with an embedded panel render no `StepAction` button (they self-serve). The Tool Metadata panel deliberately does **not** show the Fusion library file name (that's the Fusion Libraries step's job). The "Save Shop Settings" button is inside the Shop card and writes `shop_settings.json` (unit toggle takes effect immediately). The Setup & Import tracker reads `setupProgress` (localStorage flags) + `shopSettings.setup_steps` (Drive timestamps) and calls `markSetupStepInSettings` to write both.

### Preset color coding (from `materials.json` group colors)

Presets are tinted by their material's ISO-group color (the ToolDex design system colors anything tied to a material by its ISO 513 group). `presetMaterialColor(query, materials)` (`src/utils/presetNaming.js`) resolves the stored `material.query` against the library (`findMaterialInLibrary` → group color), falling back to the legacy keyword map (`materialIsoGroup` → `MATERIAL_CODE_TO_ISO_GROUP`: `AL`/`BRONZE`/`BRASS`→N, `SS`→M, `STEEL`/`MILD`→P, `CI`→K, `TI`→S; plastics/unknown → null) so pre-library/imported material strings still color. `PresetPanel.jsx` (`groupColorOf`) applies it as a left-border accent on each preset card (collapsed + edit) and on the material label / group-divider dot. The **`.preset-tag` chip itself is colored by the material's ISO group**: each host sets the `--badge-color` CSS custom property from `presetMaterialColor` (`AssemblyCard`/`AssemblyForm` linked presets, `PresetPanel` collapsed card via its `accentColor` prop, Sync Job `DiffStep`/`CommitStep` new-preset rows), and the chip class derives its text + border from it (flat `--input-bg` fill, no leading dot). When `presetMaterialColor` returns null (unknown material), the host passes `undefined` and the chip falls back to the CSS default `--iso-p` (steel). The old per-data-type emerald `.preset-tag` token and the standalone `<PresetDot>` component were removed in the design-system pass — color now lives on the tag via `--badge-color`. The seeded ISO-group colors are `:root` tokens (`--iso-p/m/k/n/s/h`); the shop's `materials.json` `groups[]` may override them at runtime.

-----

## Description Rename Workflow (normalization step)

During initial normalization, tool descriptions are rationalized. The ProShop description takes priority, but each tool passes through a per-tool confirmation UI — descriptions are **never** silently renamed.

**Reuse the existing generator** — `buildDesc()` lives in `src/utils/toolNaming.js` (re-exported from `tool-extractor.tsx` for the extraction UI) and composes a standardized description from a tool's structured fields (e.g. `0.5 4FL EM 1.000LOC`, `#80 135DEG CARB DRILL`). It is a **generator** (specs → description), not rename/diff detection — use it to produce the *suggested* new description; check that file before writing any new naming logic.

For taps, `buildDesc` strips the UNC/UNF thread-series designation from `pitch` via `stripThreadSeries()` — it's implied for inch taps — but **keeps** NPT/NPTF (pipe threads change the tap's form and aren't implied). E.g. `1/4-20 UNC` → `1/4-20 CUT TAP`, but `1/8-27 NPT` → `1/8-27 CUT TAP NPT`.

`LETTER_DRILLS` (`src/utils/toolNaming.js`) deliberately **omits `E` (0.25")** — nobody in the shop calls a 1/4" drill an "E", even though it's technically on the letter-drill chart. `smartDiam` falls through to the fraction `1/4` for that size instead. Don't re-add `E` without re-confirming shop convention.

**`smartDiam` size-naming rules (`src/utils/toolNaming.js`) — exact value wins, drill numbers are drills-only:**
- **Drill-chart naming (`#42`, letter drills) applies ONLY to `DRILL_NUMBER_TYPES`** (`drill`, `center drill`, `spot drill`, `reamer`). A milling tool that happens to sit within tolerance of a drill number (a 3/32" end mill at `.0938"` is 0.0003" from a `#42` at `.0935"`) must **not** be called `#42` — it falls through to its fraction/metric/decimal like any other mill. `buildDesc` passes `DRILL_NUMBER_TYPES.has(f.toolType)` as `smartDiam`'s third arg.
- **The parenthetical decimal is ALWAYS the tool's actual diameter field, never a chart/nominal value** — a real `.0938"` drill reads `#42 (.0938)`, not `#42 (.0935)`. The `#42`/`3/32`/`1.45mm` prefix is the nominal *label*; the value in parens is always `descDec(actual diameter)`. Never prioritize a rounded reference number over the more exact measurement.
- **Drill + fraction snap tolerance is `SNAP_TOL_IN = 0.0003"`, unit-aware via `snapTol(unit)`** — a diameter matches a drill#/letter/fraction only when within ±0.0003" of it (a metric tool/shop uses the mm equivalent, `0.0003 × 25.4`). `buildDesc` derives it from `f.unit` and threads it to `smartDiam` → `toFrac`/`isLikelyMetric` (one tolerance for all three). Genuine sizes store within ~0.0001" of nominal, so 0.0003" keeps them while rejecting near-misses: without a gate, snapping to the nearest 1/64 called `.0571"` (a 1.45mm tool, 0.0054" from 1/16") "1/16", and that false fraction match also suppressed `isLikelyMetric` (which bails if `toFrac` returns anything), silently dropping the metric label. `toFrac(d, tol)` / `isLikelyMetric(inches, tol)` / `smartDiam(inches, inputWasMm, isDrillType, tol)` all take the tolerance; it defaults to `SNAP_TOL_IN`.
- **`input_was_mm` (metadata-only boolean) carries metric-display intent through save/reload.** The extractor's `inputWasMm` toggle means "show this tool's diameter in mm in the description" even though geometry is stored in inches. It's persisted (`buildMetadataTool`/`mergeFusionAndMetadata`), threaded `extractorToTool` → tool → `toolToExtractor`, and `buildDesc(f, inputWasMm = f.inputWasMm)` reads it by default — so the ProShop/Fusion **export regenerates the name metric-aware, matching the extractor preview** (the export path formerly hardcoded `false` and dropped the `mm` prefix). `extractorToTool` also pre-fills `description` from `buildDesc(f)` so the Add form opens with the previewed name instead of blank (no re-clicking "Suggest").

**Step-by-step UI** (a step in `NormalizeModal`, or a follow-on modal) — for each tool in sequence:

1. Show current Fusion description and PS description side by side
2. Show the suggested new description (PS description, or one generated via `buildDesc()`)
3. User can: Accept suggestion / Edit and accept / Keep Fusion description / Skip
4. "Next →" advances to the next tool; a progress indicator shows X of N
5. At the end, "Apply all renames" writes the confirmed descriptions in one batch

This is, alongside the preset operation-type assignment, one of the few normalization steps requiring per-tool user decisions; the two may share a single pre-flight review modal if the UX allows.

**Priority rule**: PS description wins by default; if the PS description is blank, keep the Fusion description. User confirmation is **always** required. (Implemented in `src/components/DescRenameModal.jsx` — a standalone per-tool rename confirmation modal that uses `buildDesc(toolToExtractor(t))` for suggestions and commits via `saveFullLibrary`. `NormalizeModal` handles the preset operation-type assignment step.)

-----

## Spec-Sheet Extraction onto an EXISTING tool ("Scan spec sheet")

The AI extractor could only ever **create** a tool. But the common real cases are all **updates**: a tool pulled from a manufacturer's Fusion library, a tool duplicated in Fusion and tweaked, or — most of the library — a tool entered years ago with half its manufacturer specs never filled in. **Edit mode → "Scan spec sheet"** uploads a screenshot / PDF / pasted text and compares it against the tool already in the app, one difference at a time.

**⚠️ A create and an update are DIFFERENT WRITE PATHS and must stay that way.** A create writes every field of a valid Fusion tool (`newTool()` → the full add flow). An update must touch **nothing that wasn't individually agreed to** — and must never mint a default preset, an assembly, or anything else a create legitimately produces. That is enforced **structurally**, not by discipline: the whole feature reduces an extraction to a list of `{field, current, proposed}` proposals whose only possible effect is `setData(d => ({...d, [field]: value}))` on the **ToolForm draft**, plus one rebuild of `purchasing`. There is no code path from here to a preset, an assembly, or a Fusion write. Nothing persists until the normal **Save** + revision note.

### The three rules the diff exists to enforce (`src/schema/extractionDiff.js`)

1. **⚠️ SPARSE IN — this is the whole feature.** `extractorToTool` fills *every* key with a default (`material: 'carbide'`, `cutting_direction: 'Right Hand'`, a regenerated description). Diffing a converted extraction against a real tool would therefore report **every field the sheet never mentioned** as a change, most of them proposing to blank real data. So `sanitizeExtraction` (`src/services/extractionService.js`) **omits** rather than defaults, and only keys actually present can become proposals. A model `false` boolean is treated as *absent* too — indistinguishable from "didn't look", and an update must never turn a real capability flag off on that basis.
2. **TYPE-GATED, before the UI.** A field outside the tool type's `appliesToTypes` is dropped in the builder — so it can't be swept up by "Update all" and pushed to Fusion on a type that has no such field. (A `cornerRadius` from an end-mill sheet lands on a *flat* end mill and is discarded; on a bull nose it is kept.)
3. **UNIT-CORRECTED.** ⚠️ The model is instructed to convert everything to **inches** regardless of the source document (`sourceUnits` only records what the source *used*, for metric-aware naming). A millimetres tool would otherwise show every length as an enormous change, so lengths are converted into the record's own unit via `convertLength` before comparison, and the row says it was converted. The float-noise floor (`5e-5`, the app's existing display-precision rule) scales ×25.4 for a mm record.

**⚠️ Two field lists the extraction has to respect, and they are opposite kinds.** `COATING_SEED` and `FLUTE_DESIGN_OPTIONS` both live in **`fieldRegistry.js`** — not `toolFieldLayout.js` — because the extraction service validates against them and the registry is a leaf (it imports only `units.js`); putting them anywhere that reaches `tool-extractor.tsx` would deepen that import cycle.
- **Coating is OPEN and GROWING.** Every manufacturer names its coating differently (`ZPLUS`, `Tuff-Coat`, `nACo`), so a value outside the list is normal and must store verbatim. The field is a **datalist** whose suggestions are the seed UNIONED with every coating already used in the library (`coatingOptions(tools)`, passed in by `ToolForm`), so the list grows itself. ⚠️ It was a closed `<select>` of six generic names, which meant a scanned `ZPLUS` **was extracted and stored but rendered blank**, and was lost the moment the dropdown was touched — indistinguishable from "the scan didn't pull the coating". The prompt says *copy exactly, do not restrict to a list, do not translate a brand name into a generic one*.
- **Flute design is CLOSED, on purpose.** Manufacturers describe one geometry a dozen ways ("variable pitch" / "unequal spacing" / "unequal indexing"), and the shop picks one vocabulary so the field stays searchable. So the prompt carries the list **plus a synonym map**, tells the model to read the product TITLE (where it usually lives) and not just the spec table, and `sanitizeExtraction` matches case/space-insensitively — dropping anything unrecognised rather than inventing a new option.

⚠️ **The thread UNIT is DERIVED from the designation, never taken on trust.** The prompt asks the model for `threadUnit`, but it routinely omits it — and the answer was being dropped anyway (`threadUnit` was missing from `EXTRACTED_KEYS`, from `sanitizeExtraction`, and from `EXTRACTED_TO_FIELD`), while `pitch` passed through verbatim so `"M6x1"` never matched the list. A metric tap therefore arrived with a correct thread size, no unit, the inch list showing, and the thread read as hand-typed custom. `sanitizeExtraction` now runs an extracted `pitch` through **`resolveThreadSize`** — the same seam the ProShop import uses — emitting the canonical designation, the derived `threadUnit`, and `isSTI` when the designation itself carries it. One resolver, so it cannot be forgotten and does not depend on the model answering a second question.

**⚠️ `tool_type` is deliberately NOT proposable.** Accepting it would change the applicable field set out from under every other proposal in the list. A disagreement is surfaced as a **notice** ("the sheet looks like a flat end mill, but this tool is a drill"); changing the type stays the form's own Tool Type picker.

**Never in the proposal set at all:** presets, assemblies, `tool_id`, `location`, `machine_tool_number`, and per-assembly `ooh` (stick-out is per-assembly — a spec sheet has no business setting it). These aren't filtered out, they were never in the extraction's vocabulary. Locked by `extractionDiff.test.js`.

### Change vs. fill, and why fills auto-accept

A **fill** (the field was blank) is applied immediately — but still renders as a visible row with an **Undo**, per "filling in blanks is fine, but it must be visible". A **change** (a real value would be replaced) is *never* applied until explicitly accepted. A boolean arriving `true` over a stored `false` counts as a **change**, not a fill: `false` is a real answer.

**⚠️ Proposals render INLINE, at the field**, not as a separate review list — the current value is already there, so a list would be a second place to read the same numbers and would hide *which box* is about to change. Consequences that are easy to get wrong and are handled:
- A section with proposals **auto-expands** (`Section`'s `forceOpen`) — a collapsed panel must not be able to hide a pending decision.
- A proposal whose field this tool type **doesn't render** (e.g. `product_link`) has no box to sit under, so `ToolForm` routes it into the spec panel rather than dropping it silently. Computed from `getToolFieldSections`, so a future field can't quietly disappear.
- **Discarding puts EVERYTHING back**, including the auto-accepted fills. There is deliberately no "hide but keep": a change left in the draft with its row hidden is exactly the invisible edit this feature exists to prevent.
- Leaving with undecided rows warns and names the count (`handleCancel`).

### Purchasing is a sub-diff, not a field row

`purchasing` is `{manufacturers[], vendors[]}` with FK links, so it can't be a scalar proposal. It gets entity-level row matching, then one write back. Rows are keyed (`mfg:edp`, `vendor:price`, …) and `applyPurchasingRows` **replays only the accepted keys against the purchasing object as it was when the sheet was read** — never against the running draft, or un-ticking a row could not undo it.

- **⚠️ "Different manufacturer" means a different registry ENTITY, not a different string.** The vendor registry's alias system exists because catalogues spell things inconsistently — `GARR` / `GARR Tool`, `Helical` / `Helical Solutions` are ONE entity (`sameEntity` → `entityByName`). Comparing raw strings would fire the warning on nearly every scan, which is the nag loop that makes a warning worthless.
- A genuinely different manufacturer on a tool that already has one is **added, never substituted**, and only after the user ticks an explicit acknowledgement ("I know the manufacturer is different"). The Update/Keep buttons on that row stay disabled until they do. The first manufacturer on a bare tool needs no acknowledgement.
- **URLs**: ⚠️ there is **nothing to decide** where the registry has a pattern — see the rule below. No `mfg:edp_url` row is proposed for a manufacturer with a pattern (and there is **never** a `vendor:num_url` row, since a vendor link has no scraped fallback); the scraped `productLink` is offered **only** for a manufacturer with no pattern, and only into a blank. New rows stamp `registry_id` at creation.
- **⚠️ `approvedBrand` does NOT become a `vendor` field proposal.** It is the same fact as the purchasing manufacturer row, and offering both would be two independent decisions for one answer — accept one, reject the other, and `tool.vendor` disagrees with `purchasing.manufacturers` forever. Purchasing owns the manufacturer; `tool.vendor` **follows** it, and only when blank (adding a *second* maker must not restamp a tool that is still primarily the first one's).

### One extraction implementation, shared

`src/services/extractionService.js` owns the prompt, the API call and the sanitizer. **Both** entry points use it: `tool-extractor.tsx`'s add flow (via `applyExtractionToBlank`, which restores that form's original "clear anything the sheet didn't mention" behaviour) and this update flow. The add path's behaviour is unchanged and test-locked, including the deliberate asymmetry that the add form still owns `ooh` while the update path can't propose it.

**⚠️ The service and `tool-extractor.tsx` import each other**, so anything derived from the extractor's exports (`EXTRACT_RESET` from `BLANK`, the valid-coolant set from `COOLANT_OPTS`) is computed **lazily inside a function**, never at module scope — in an ES-module cycle a top-level `const` in the partially-initialised module is still in the temporal dead zone, and hoisting these back would throw at import time for every consumer of the schema barrel.

### The scanned sheet is kept as evidence (`data_extraction`)

The document a scan read from is the provenance of every value it produced ("where did 38° helix come from?"), so it is attached to the tool under the **`data_extraction`** file category. ⚠️ **Uploaded AFTER the tool save, against the tool the save RETURNED** — `uploadToolAttachment` writes the whole record it is handed, so attaching from the unsaved draft would persist edits the user hasn't committed, and attaching from the pre-edit `tool` prop would silently revert the ones they just made. A failed attach never fails the save: the tool data is already committed and correct, and the action has toasted the reason.

The keep/discard choice sits in the **summary bar**, not the upload modal — it is next to Save, which is when it actually happens. It appears only when there is a real file (a pasted-text scan has no document) and only when Drive is connected (otherwise the bar says so rather than silently dropping the file). Discarding the scan drops the pending file too. A pasted screenshot arrives named `image.png` for every scan, which would make a tool's Files list unreadable, so a generic name is replaced with `spec-sheet-<date>.<ext>`; a real uploaded filename is kept, since it is usually the part number.

### The standalone extractor UI is retired

The old `tool-extractor.tsx` screen — a full second tool form with its own inputs, ProShop/Fusion export buttons and a recent-tools strip — is **gone**. Adding a tool by scan now goes: pick "Scan Tool Label / Drawing" → **`ExtractionInput`** (the same picker the update modal uses) → extraction → **straight into `ToolForm`**, pre-filled, with a banner saying so. One tool form in the app, not two.

- ⚠️ **A new tool still writes every field, and that is a DIFFERENT path from the update.** The add flow merges the sparse result onto `BLANK` via `applyExtractionToBlank` (clearing what the sheet didn't mention) and converts it with `extractorToTool` — the original, test-locked behaviour. It does **not** run the proposal machinery: there is nothing to diff against yet, so every value is simply the starting point and the form is where it gets checked.
- The scanned sheet is attached as `data_extraction` here too — after `addTool` returns, against the tool it returned (the record has no id or Drive folder before that).
- **`tool-extractor.tsx` is now data and logic only** (998 → ~350 lines): the tool-type list, `FIELD_VISIBILITY`, ProShop group letters and columns, coolant values, and the CSV/row builders that the schema barrel re-exports. Its default `App` export, the theme block and every UI helper were deleted; `ToolExtractorTab.jsx` is gone. The filename and `.tsx` extension are kept only because many modules import from that path — renaming it is a mechanical change worth doing on its own.

**Deferred:** the description is not auto-rebuilt when accepted geometry makes it stale — a hint appears next to the field and "Suggest" is one click away.

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
| `unchanged` | Same name, values identical (or differing only below significance — see below) | Shown grayed out; nothing to commit |
| `blocked` | Same name, significantly different values, same assembly context (or no OOH) | Per-preset radio: **"Update master with job values"** (patches the significant changed fields onto the master preset via `presetChanges` — the proven-improvement capture path) or **"Keep master values"** (default) |
| `conflicts` | Same name, significantly different values, **different assembly context** | User asked: "Save as new preset variant" or "Ignore" |
| `newPresets` | No name match in master | User can select to add; always included in commit |

**Significance thresholds (`PRESET_SIGNIFICANCE`, DiffStep.jsx)**: a numeric preset value counts as *changed* only when |job − master| > max(`rel` × magnitude, `abs` floor) — machining-relevant thresholds, not exact equality (10 RPM is noise; 0.0001" of chip load is real). Per-field: RPM 1%/15; surface speed 1%; cutting/plunge/ramp feeds 2%; lead-in/out/transition 5% (followers of `v_f`); chip load (`f_z`/`f_n`) 2% with 0.00005 abs floor; ramp angle 0.25°; **stepdown 10%** (DOC is a loose reference value in Fusion) vs. **stepover 2%** (WOC matters); `abs` floors are inch-unit and scale ×25.4 for a millimeters tool (`len: true`). Sub-threshold diffs are treated as identical — the preset lands in `unchanged` with a `trivial` count, surfaced as "N of these had only insignificant differences (ignored)". Tool-level flat fields use `valuesEqual`, where numbers within 5e-5 are equal (anything closer renders identically at the 4-decimal display rounding — kills Fusion float round-trip noise like "0.5 → 0.5" diff rows).

**Assembly context comparison** (`checkDifferentAssembly`): a preset is considered to have a different assembly context if the incoming OOH differs from every existing assembly linked to that master preset by more than 0.0005" (or if the holder GUID differs). If the incoming tool has no OOH data (`incoming_ooh == null || <= 0`), presets with value differences are always `blocked` (not conflicted) — the update-master option still applies.

**Blocked → update semantics**: the master preset keeps its **guid** (assembly `linked_preset_guids` stay valid) and only the user-approved significant fields are patched (`{ masterPresetGuid, incomingPreset, selectedFields }` per change). `mergeTool` records each update in `merge_history[].presets_changed` and a **revision note is required** whenever `presetChanges` is non-empty (same rule as flat tool-field changes). The three-way stepdown/stepover invariant is safe because every preset passes through `normalizePreset` in `internalToFusionTool` on write.

### Transient fields on imported tools during Phase 2

These fields are set on the incoming tool object during parsing and are used by DiffStep/CommitStep but are **never saved to metadata**:

- `incoming_ooh` — OOH value from the imported tool's `geometry.LB` (JSON) / `tool_bodyLength` (CSV/TSV), taken raw in the tool's own unit. **Not** from `assembly-gauge-length` (which is holder gauge + OOH)
- `incoming_holder_guid` — holder GUID from the imported tool (if present)
- `_incomingHolderDesc` — pre-resolved holder description string (set during import parsing)

### Preset GUID rules during merge

- **New presets** (`newPresets` bucket): keep their incoming GUID — this GUID is used by the assembly record created in CommitStep to link the preset to its assembly. **Collision guard**: a preset that was RENAMED in the job file doesn't name-match, so it lands in `newPresets` while still carrying the **master** preset's guid (it was copied from master). `DiffStep.handleConfirm` mints a fresh guid for any new preset whose guid already exists in master — otherwise the master presets array would hold two entries with the same guid, corrupting `preset_meta` (keyed by guid) and making assembly `linked_preset_guids` ambiguous. The regeneration happens BEFORE `assemblyUpdate` captures the guids, so links stay consistent.
- **Conflict presets resolved as 'create'**: MUST receive a **new** GUID (via `generateId()`), because the incoming preset's GUID equals the master preset's GUID (it was copied from master). The new preset's name is composed with the **standard convention** via `composePresetName()` (`<MaterialCode> <OOH> <HolderDescription> - <Operation>`, e.g. `SS 2.125 NBT30-SK13C-60 - Rough`) using the incoming OOH + holder + parsed operation type — **not** by appending `"(OOH: …)"` to the incoming name. Falls back to the incoming name only if the convention can't be composed.
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
  presetChanges,       // [{ masterPresetGuid, incomingPreset, selectedFields:Set }] —
                       // same-setup presets the user chose to update in place
  newPresetList,       // presetsToAdd from DiffStep
  assemblyUpdate,      // { type: 'create'|'link', assembly: {...} } or null
  programLink          // { operation_id, label } or null — the PROGRAM this sync
                       // came from; linked to the presets this commit touches
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

In `src/schema/combine.js`. Runs **silently** in `loadTools` (after `groupByTrackingId` + `buildLogicalTool`) and in bulk writes (`saveFullLibrary`, `normalizeLibrary`). Folds separate logical tools that share a `tool_id` into **one** logical tool so a tool copied/dumped under a fresh GUID or tracking ID doesn't show up as a separate entry:

- One instance per **distinct** (holder, OOH); identical (holder, OOH) instances collapse to one assembly.
- Presets are unioned by name; the **primary** tool's shared fields win.
- **Never destroys conflicting data** — every raw entry is kept in `_instancesRaw`, so the reconcile-on-open pass can still detect a folded sibling whose shared fields differ. `mergeLogicalTools` also **unions** each folded tool's `_registeredAssemblies` so legit app-known instances aren't later misflagged as strays.

⚠️ **A tool built from a Fusion entry with NO metadata record has NO OPINION on any metadata-only field — a blank default is not data.** `fusionToolToInternal` fills every metadata-only field with a placeholder ("Metadata fields default empty — filled from metadata file"), and Fusion has nowhere to store them, so it *cannot* have an opinion. `buildLogicalTool` marks such a tool **`_noMetadata`** (runtime-only, like `_drift`) and `mergeLogicalTools` drops its metadata-only values from the running entirely — they can neither win a gap-fill nor be flagged as a disagreement. Without this, **adding a ProShop-only tool to Fusion and merging wiped what ProShop had put there**: `purchasing`'s placeholder is an **OBJECT** (`{manufacturers:[],vendors:[]}`) which the old empty-check read as a real value (measured: **54 of the 58** real no-Fusion records lost their whole purchasing block), and `false` is not empty either so a ProShop `tsc_capable: true` came back as No. `isEmpty` now also treats an object whose contents are all empty as empty. Three consequences, all locked by `combineTools.test.js`:
- **`created_at` takes the earliest** in the group. A freshly-built Fusion tool stamps `new Date()`, so merging into it reset the record's real creation date to today.
- **`machine_tool_number` prefers a tool that HAS metadata** (metadata is the source of truth for it — see the field table). A `_noMetadata` tool supplies one only when nothing else in the group has an app-assigned value. It is in `SKIP_KEYS`, so before this the Fusion entry's T# replaced the app's silently and never even flagged.
- **A metadata-only field CAN now be flagged as a conflict.** The old blanket `!isMetadataOnly(key)` exclusion was justified by "absent on the Fusion side" — which is the placeholder case, now handled properly. With placeholders dropped, a difference means two records that both genuinely hold a value: a real disagreement, surfaced rather than silently resolved. (Measured on the real library: **zero** new flags — no two records there share a ProShop number.)

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

## Holder Management System

> **Matching a holder? Read "Holder matching — the four questions" below first.** There are four different "which holder is this" resolvers with different rules; picking the wrong one fails silently.

**The goal, in the shop's words.** There is a cutting-tool library where every tool has a holder, and a holder library that most of those tools were originally built against — but **in Fusion there is no real connection between the two**: a tool carries a frozen copy of the holder's geometry and nothing more. So: (1) match the existing cutting tools to the existing holders **once**, using description + gauge length + whatever else the app can score; (2) from then on, freely change anything about a holder — including replacing one wholesale with a more accurately drawn one — and have it **push to every tool that references it**. The app's holder library becomes the source of truth for holder geometry, and the cutting tools follow it.

**⚠️ Two matching jobs, deliberately different. Do not merge them.**

| | Migration matching | Holder identity |
|---|---|---|
| **When** | ONCE, to get messy data under control | FOREVER after, to keep it there |
| **Matches on** | Description + gauge length + specs | `holder_ref` **AND** the segments |
| **Tolerance** | Generous — the old data is hand-entered | `0.001"`, rounding only |
| **On a wrong answer** | The user confirms, so it's cheap | Silently the wrong holder |
| **Rule** | Score it, rank it, ask | Both agree, or **flag** |
| **Code** | `holderAudit.js`, `holderDuplicates.js` | `holderIdentity.js` |

**The app-owned record** lives in `holder_library.json` (the 6th shared Drive file, `{ version, holders[], parts[] }` — `DEFAULT_HOLDER_LIBRARY`). Schema + Fusion conversion: `src/schema/holderRecord.js` (`newHolderRecord`, `fusionHolderToRecord`, `holderRecordToFusion`, `HOLDER_APP_ONLY_FIELDS` — the strip guard, since Fusion validates strictly). Each record carries a stable app `id`, a human `holder_ref` (`HLD-…`), classification ids (`type_id` / `taper_id` / `collet_family_id` / `collet_size_id` — into `shop_settings.holder_config`), its own `segments[]` + `unit`, purchasing/location/photo/notes, `legacy_ids[]`, and `legacy_fusion_guids[]` (guids adopted in a merge). Pure helpers: `holderGeometry.js` (derived gauge, unit conversion, the nominal-length check), `holderOptions.js` (the UUID-referenced lookups — **seed ids are stable slugs, never per-load UUIDs**), `holderDescription.js` (the healer — preview→commit, and **a description is never rewritten automatically**), `holderBody.js` (body-vs-extension signatures), `holderParts.js` (body / extension as their own records — you buy them separately and assemble at more than one stickout), `holderDuplicates.js` (find + merge), `holderResolve.js` (which holder a tool write uses + the assembly-gauge backstop).

**Linking the existing cutting tools to the controlled holders** (`backfillHolderIds`, `holderResolve.js` — load-time, in memory, persisted on each tool's next save). A tool carries a baked copy of its holder, so the link is re-derived from what it carries, in this order: the assembly's **`holder_id`** if it still resolves → the baked **SEGMENTS** (the same strict rule used at the Fusion boundary, applied only when **exactly one** record has that shape) → the baked **guid**, last. ⚠️ **Shape before guid, and the order is measured, not assumed**: over the shop's real 304-tool library the shape resolves **every** case the guid does (133) **plus 163 more**, with **zero** disagreements and **zero** cases only the guid could answer. So the guid contributes nothing and can only be wrong — and it does go wrong: a record keeps remembering a `fusion_guid` that Fusion has since handed to a **different** holder (observed live — a `-120` record whose guid now belongs to a 145mm test holder). The guid survives only as the last resort for a baked holder with no usable geometry, and for an ambiguous shape (two records, same shape) where it can disambiguate. A tool matching none of the three is left for **Link tools to holders** (below).

**Auto-match always; silent ONLY when certain** (`matchBakedHolder`, `holderResolve.js`). The holder copy Fusion bakes into a tool carries the **same two signals** the holder library does — our `holder_ref` in its **`product-id`** (the field is present on all 232 baked holders in the real export) and the **segments**. Certain = **both agree**; anything less is still linked (nothing is left dangling) but marked **`_linkGuess`** + **`_linkVia`** and listed in the **`confirm`** tier of `buildHolderLinkPlan`, pre-filled with the guess and changeable — so the user always sees what the tool was carrying. The flags are **runtime only** (`buildMetadataTool` copies named fields), so once the user confirms, the stored `holder_id` arrives clean on the next load and the row stops appearing (**a flag the user can clear**). ⚠️ **The one deliberate exception: SHAPE ALONE with no ref baked in counts as certain.** Every tool copied *before* the first holder push is in that state, so treating it as uncertain would put the entire pre-existing library on a confirmation list — the nag wall that makes a flag worthless. Nothing contradicts the match, and shape uniqueness within 0.001" is the same rule the Fusion boundary calls a match; as refs get baked into new tools the check strengthens by itself. ⚠️ **When ref and shape DISAGREE the shape wins** (it is what the tool actually carries) but the link is never certain — one of the two is wrong. Measured over the real export: **212 of 221 tools linked, 3 asked about** (two whose baked `product-id` resolves via `legacy_ids` to a record whose shape disagrees, one guid-only). Locked by `arrivingHolder.test.js`, which includes the nag-wall guard as its own assertion.

**Link tools to holders** (`src/utils/holderLink.js`, `LinkToolsModal.jsx`, `AppContext.linkToolsToHolders`) — the worklist for whatever the silent backfill couldn't settle. Three tiers:
- **exact** — segments match; already linked silently by `backfillHolderIds`, so this tier is normally empty (it only appears when a stored `holder_id` points at a deleted record).
- **near** — ONE dimension out, everything else identical, the difference is under **`NEAR_MAX_MM = 5`**, AND the two descriptions agree. Pre-ticked, with the difference stated in mm. On the real data these are one segment height off by a round number (1.00mm, 2.00mm) — the same holder drawn to a slightly different gauge datum.
- **candidate / none** — a short manual list with suggestions first in the dropdown.

⚠️ **"One dimension out" is NOT rare — it is the shape of a LENGTH FAMILY.** `NBT30-SK13C-60/90/120/150` are the identical holder apart from one body-length segment, so a baked SK13C-120 sits one dimension from **all four** (2mm, 28mm, 30mm, 58mm). Nearness alone is a coin flip between them; the **name** and the **size of the gap** are what pick the right one. ⚠️ And the description check is not optional: a tool baking `…EX OOH1.60` differs from the record `…EXOOH1.75` by one height of 0.150" — which is *exactly* the stickout difference. By the numbers it looks like the 2mm case; it is actually the same parts assembled to a different length, and auto-linking it would give the tool the wrong stickout. `descriptionsAgree` compares taper/collet/length/extension **and the stated OOH**. Locked by `holderLink.test.js` against the real library.

**Committing does TWO things, and both are the point:** it stores the link (`assembly.holder_id`, a metadata field) **and rewrites to Fusion every tool whose baked holder copy disagrees with the record it was just linked to**. ⚠️ Stopping at the pointer would leave Fusion holding the wrong geometry with nothing to show it — the library would look linked and still be wrong. After the pass, no tool in Fusion carries holder data that disagrees with its holder. Tools whose baked copy already matches (the exact tier — most of them) are deliberately **not** rewritten: there is nothing to correct, and rewriting the library to change nothing is a slow way to risk a bad write. The Fusion write goes through **`writeToolsToFusion`** (`libraryOps.js`) — the shared targeted writer that also backs Re-stamp (one download per library, only these tools' entries replaced, everything else byte-for-byte). The dialog previews the count **and each tool's assembly-gauge change** before committing, and the write happens **before** the in-memory update, so a failed write can never leave the app claiming tools are linked.

**"Which tools use this holder" goes through one predicate** — `assemblyUsesHolder` (FK first, guid as fallback, following merges). Used by re-stamp selection, the usage count, and the merge-follows count. Keying any of these on the guid alone silently skips every tool whose baked guid has churned, so a "push this correction to all its tools" action would cover a fraction of them.

**How a corrected holder reaches a tool.** Fusion **absorbs** holder geometry into each cutting tool — one-way, at copy time — so the tool's own write is the ONLY channel. `splitToFusionInstances` rebuilds the holder object on every tool write from `resolveHolderForWrite`, so:
- **Lazily** — any ordinary save of a tool picks up the current holder geometry.
- **Now** — **Re-stamp** on the holder page rewrites every tool using it, with a per-tool old→new assembly-gauge preview (see the gauge backstop in `holderResolve.js`).
- **During linking** — **Link tools to holders** rewrites the tools whose baked copy is out of date as part of the same commit (below). Both routes share `writeToolsToFusion`.
- **A merge needs no tool writes at all**: the survivor adopts the loser's guid into `legacy_fusion_guids`, so every tool that referenced the old holder resolves to the survivor. ⚠️ That fixes the **link**, not the **data** — those tools still carry the old geometry until they're written.

**An archived holder is a reference, not an editable record.** `HolderDetail` opens it **read-only** (autosave would otherwise quietly persist an edit to something nothing can use), and the **Re-stamp preview is not computed for it** — offering "Re-stamp N tools" from a retired holder is exactly what must not happen, and since `resolveHolderForWrite` skips archived records the write wouldn't even carry the geometry the button names. Instead the archived banner names the tools whose stored link still points there and sends them to **Link tools to holders**, which does offer them (an assembly pointing at an archived record is deliberately NOT skipped by `buildHolderLinkPlan`).

**The auto-description is never offered when it knows LESS than the name already there** (`offerAuto`, `HolderDetail`). `composeHolderDescription` builds from the classification fields, so on a holder whose collet family / size / length aren't filled in it collapses to little more than the taper — `"BBT30"` offered as a replacement for `"BBT30-CKB3-79 (For EWN Boring Heads)"`. One click and the real name is gone, and a holder description is load-bearing — it goes verbatim into preset names and `asm_number`s (`holderNameToken()`). The button is hidden when the current description already **starts with** the suggestion.

**Segments can be inserted ANYWHERE, behind an *Edit segments* toggle** (`SegmentTable`, `HolderDetail`). Adding was a prepend — "add at tip" — so the only way to get a segment at the **spindle end** (the step that brings the modelled gauge up to the engraved nominal) was to go and do it in Fusion, which is the round trip this module exists to remove, and which then lands as a `ref-only` conflict. ⚠️ **`insertSegmentAt(segments, visualIndex, segment)` (`holderGeometry.js`) owns the mapping**, because the display is the stored array **reversed** and getting it wrong doesn't throw — it silently puts the segment on the opposite end of the holder. A new visual index `vi` in a list of `count+1` is stored index `count - vi`; inserting above the TOP row appends (the top row is stored LAST), inserting below the BOTTOM row prepends, which is the old add-at-tip behaviour exactly. Locked by `holderGeometry.test.js`. **`seedSegmentAt`** builds the segment it inserts: the **diameters are copied from the face it attaches to** (inserting above a row meets that row's upper end; at the tip, the last row's lower end) so the profile stays continuous instead of jumping to the old 20-unit default — absurd on an inch holder, and it rescales the whole drawing. ⚠️ **The HEIGHT is deliberately NOT copied** — a fixed 2mm (`NEW_SEGMENT_HEIGHT_MM`, converted for an inch holder). Seeding it too made the new row identical to its neighbour, with nothing on screen saying which of the two had just been added.

Two UI rules the toggle exists to keep: ⚠️ **the `+` is absolutely positioned on the row BORDER**, never an insert row of its own — a row per boundary would push the table a third taller the moment edit mode came on, for buttons nobody has pressed; out of flow, switching the mode changes only what is drawn over the table. And ⚠️ **the delete `X` is hidden, not removed** (`.holder-seg-table:not(.editing) .holder-seg-del`) so the column keeps its width and the table doesn't resize on toggle — `visibility: hidden` also takes it out of the tab order. Structure editing is **off by default**: typing a dimension is the everyday job, while one stray click on a delete rewrites the geometry every tool takes its holder from.

**Undo, because autosave makes every edit immediately real** (`HolderDetail`). A segment deleted by a stray click is in the holder library within a second, and the only way back was to go and read the numbers out of Fusion. **Every** mutation of the draft goes through one `apply(updater)` wrapper, so nothing can bypass the stack: it reads the previous value from a **ref it updates synchronously** (render scope would give a stale snapshot when two changes land in one tick, and pushing inside a `setState` updater would double-record under StrictMode) and keeps up to `UNDO_LIMIT` steps. **Undo** (button + Ctrl/Cmd+Z) steps back; **Revert all** returns to the holder as it was when the page opened, and is itself pushed onto the stack so it's undoable too. ⚠️ Ctrl+Z is deliberately **ignored while a text field has focus** — there the browser's own undo is what anyone expects, and the case this exists for (a deleted segment row) is a button click. Undoing marks the draft dirty, so autosave writes the restored state back — the undo is real, not just on screen. **Session-only and per-holder**: the component is keyed by holder id, so opening another holder starts a fresh stack. This is protection against a slip in the last few minutes, not an edit history.

**Editing a holder autosaves.** `HolderDetail` keeps a local draft and writes it ~900ms after the last edit (`AUTOSAVE_MS`), on top of the shared-file layer's own 600ms debounce, so a burst of typing is one Drive write. The header carries the state — **Unsaved…** (amber) → **Saving…** → **Saved** — and `onSave` deliberately does **not** toast, since a toast per pause in typing is constant noise. Leaving with an edit the timer hasn't picked up yet shows an inline **Save & leave / Discard / Stay** bar instead of dropping it; `beforeunload` covers a tab close, and an unmount fires the pending save best-effort. Rare by design (the window is under a second) — it exists because losing fiddly multi-field work to a stray Back click is what makes people stop trusting the app.

**The workflow is stated on the page** (`HolderWorkflowBanner.jsx`) — a small card above the holder list: the one-time setup order (Import → Normalize names → Duplicates → Link tools to holders → Push to Fusion) and the ongoing one (edit here → Re-stamp → Push). It leads with the rule that actually costs something: **change a holder HERE, not in Fusion.** Redraw it in Fusion first and the segments move while our ID stays put, so identity reads `ref-only` and the app stops and asks instead of following the change everywhere; the recovery is Import + merge via Duplicates. Shown by default, dismissed for good (localStorage `holder_workflow_dismissed`), brought back by the ⓘ in the page header. Deliberately **not** a progress tracker — several steps are optional or repeatable, so a checklist that can't be completed would just nag.

**The nominal-length check is collet-family scoped and user-confirmed.** The engraved nominal vs the modelled gauge length holds a known band **for SK collets only** (`NOMINAL_BANDS_MM`) — not for other collet families, and especially not for end-mill holders. So the app makes a best guess and the user does a **one-time confirmation per holder**, which **expires by itself** when any input it depended on changes (`nominal_check.signature`).

-----

### Holder colour — the one picked in the app, nothing derived

⚠️ **A holder's colour is `record.color`.** That is the whole rule. It is chosen in `HolderDetail` and read everywhere through the single seam `holderDisplayColor(holder)` (`src/utils/holderColors.js`): picked colour → auto-assigned from the record's stable `id` → teal `HOLDER_DEFAULT` when there is no record at all (a holder Fusion baked into a tool, which isn't in the app yet).

**Nothing derives it from the description.** It used to — before the app owned a holder library there was no record to hang a colour on, so the colour came from the NAME: a table of six hand-assigned descriptions plus a hash of the text for everything else. Both are deleted. That logic misbehaved in the obvious way: **editing a description re-coloured the holder, live, on every keystroke**, and with 21 of 22 real holders having no picked colour, nearly every holder behaved that way.

The auto-assignment is keyed on **identity**, not on anything editable, so it never moves and needs no migration — a fresh library reads as varied instead of uniformly teal (measured: 22 holders → 12 distinct colours, none teal, zero colour changes from editing a description). It is a starting point only; a picked colour always wins.

⚠️ **Both call sites must go through `holderDisplayColor`.** `ToolDetail`'s assembly row used to read `record?.color` and fall back to its own description hash — re-deriving the chain — which is how the Holders page and the tool pages ended up showing the same holder in two colours. Resolve the record, then hand it to the one function.

**NOT part of this rule: the collet tint.** The colour of the collet substring inside a pill (`SK13` in `NBT30-SK13C-60`) comes from the collet-size option in `shop_settings.holder_config`, resolved through the holder's **`collet_size_id`** — a real FK. The description is only used to find *which characters* to tint (`findColletSpan`), never to choose the colour. That stays.

-----

### Holders and the rest of the app — decided, not overlooked

Three questions came up while auditing the holder system against the app's own patterns. All three are **deliberate answers**, not gaps — don't "fix" them without asking.

**Holders are NOT a ProShop item.** ProShop has no real home for them — they exist there as plain text in a few places, which is a gap in ProShop, not something to mirror. So there is **no ProShop CSV export or import for holders or holder parts**, and `holder_ref` is not a ProShop number. Holder purchasing (`manufacturer` / `part_number` / `vendor` / `purchasing`) lives in the app record and stops there.

**Holder location is deliberately free text, for now.** A holder's `location` is a plain string, NOT the structured Location System that tools use. The shop's holders sit on a shelf and are easy to find, so the value isn't there yet. Doing it properly would need a **separate holder location system** — the existing `location_config.systems[]` is scoped to tools (bins, ProShop export rules, tool-bin collision checks), so it would need a per-system scope flag plus a structured `holder_location` on the record and read-time resolution. That's not a small change, so it is a **TODO**, not a shortcut taken. The accommodation: `holder_location` would sit alongside the free-text `location` exactly as `tool_location` does for tools, so adding it later is additive.

**`holder_ref` is INTERNAL PLUMBING, not a fourth ID system.** The three configurable ID systems (Tool ID / Location / Assembly) are user-facing schemes an operator reads and quotes. `holder_ref` is not one of them and is not configurable: it exists to hold the Fusion link (stamped into `product-id` — see Holder identity). **What identifies a holder to a person is the manufacturer + their part number, on top of the specs already in the description** — often the manufacturer's number *is* the spec number. That is more reliable and one less thing to look up, so the description stays load-bearing and `HolderDetail` shows manufacturer + part number as the identity line with `holder_ref` muted below it. A configurable holder-ID system is **not** to be built speculatively; if it's ever wanted, it's an additive metadata field on a record that already has stable UUIDs.

**Fusion's `product-id` on a holder belongs to the app.** The push overwrites whatever was there — often a vendor SKU. Confirmed acceptable: the old value is preserved in the record's `legacy_ids` (and `part_number` when it parsed as a SKU) and still resolves via `recordForRef`.

-----

## Holder matching — the four questions (QUICK REFERENCE)

**Read this before touching any holder-matching code.** There are FOUR different
"which holder is this" questions in the app. They look alike, they are not
interchangeable, and reaching for the wrong one is silent — you get the wrong
holder, not an error.

**Everything is built from two signals**, and Fusion's holder **`guid` is not
one of them** (Fusion re-issues guids; it is a hint, always last):

| Signal | What it is |
|---|---|
| **REF** | the app's `holder_ref` (`HLD-XXXXXX`) stamped into Fusion's `product-id`; also matches a value in the record's `legacy_ids` |
| **SHAPE** | the segments, compared within `SEGMENT_MATCH_TOL_IN` = **0.001″** (rounding only, unit-aware — `segmentsMatch`) |

| # | Question | Function | Order | On a wrong answer |
|---|---|---|---|---|
| **1** | Which holder is this tool **carrying**? | `matchBakedHolder` → `backfillHolderIds` (`holderResolve.js`) | REF+SHAPE → SHAPE → REF → guid | links anyway, but **marks** the guess |
| **2** | Which holder's **geometry does this write use**? | `resolveHolderForWrite` (`holderResolve.js`) | **`holder_id` FK** → guid (follows merges) → Fusion entry | writes wrong geometry to Fusion |
| **3** | Which record is this **Fusion holder-library entry**? | `matchFusionHolder` (`holderIdentity.js`) | REF+SHAPE only | overwrites the wrong holder |
| **4** | Which holder should this **unlinked tool** use? | `proposeHolderLink` (`holderLink.js`) | shape, then near+name | the user is asked, so it's cheap |

⚠️ **Q1 reads SHAPE first; Q2 reads the FK first.** That is not an
inconsistency — Q1 is *establishing* a link from scratch (the FK doesn't exist
yet, and a baked guid may be stale), Q2 is *honouring* one you already made.

**Q1 — what a tool baked.** Certain only when REF and SHAPE agree. The one
exception: **SHAPE alone counts as certain when the baked copy carries no ref
at all** — every tool copied before the first push is in that state, and
treating them as uncertain would put the whole library on a confirmation list.
When a ref exists and disagrees with the shape, the **shape wins** (it is what
the tool is actually carrying) but the link is never certain. A guess still
links — nothing is left dangling — and is flagged `_linkGuess` / `_linkVia`
(runtime only), surfaced in the **confirm** tier of *Link tools to holders*, and
stops appearing once confirmed. Two filters run BEFORE uniqueness is judged:
archived records are excluded, and **a record that has never been in Fusion
cannot be what a tool baked** (no `fusion_guid`, no `last_pushed`) — that is
what stops a tap-collet twin making every tool on the original uncertain.

**Q2 — what geometry a write carries.** Archived records are not a geometry
source, and a record with **no segments** is not either (it would blank out the
holder the tool already has). Everything else falls through to the Fusion entry,
which is why a holder the app hasn't imported yet doesn't vanish on save.

**Q3 — the Fusion boundary.** The strictest. Only `exact` (REF+SHAPE on one
record) is written, plus the `geometry-only` bootstrap into a **blank**
`product-id`. `ambiguous` / `conflict` / `ref-only` / `geometry-only` /
`fusion-copy` / `duplicate-entry` are flagged and the entry is left
**byte-for-byte alone** — a half-match is the shape of a human edit, and
overwriting it destroys the only evidence of what changed.

**Q4 — the loose one, and the only one a person confirms.** "One dimension out"
is the normal shape of a LENGTH FAMILY (`-60/-90/-120/-150` differ by one body
segment), so nearness alone is a coin flip; the **description must agree** and
the gap must be under `NEAR_MAX_MM` = 5.

**Display is a fifth thing and matches nothing.** `HolderTag` →
`holderForDisplay`: `holder_id` → guid → synthesize a stand-in from the
description. It never resolves by shape; it only decides what to draw.

⚠️ **`holderTokensMatch` is NOT part of any of this.** It is a tolerance for
stored TEXT (`30-SK13-60` ≡ `NBT30-SK13C-60`, the retired short spelling), used
in exactly three places — `presetMatchesAssembly`, `shouldRetireAsmNumber` /
`updateAssembly`, and the `_asmNumbersFixed` **flag** in `backfillAsmNumbers`.
It never picks a holder.

**Why this is as complicated as it is** (so the next person doesn't try to
collapse it): Fusion **absorbs** a copy of the holder into every cutting tool
and **re-issues holder guids**, so the app has to recognise the same physical
holder from a frozen copy with an unstable id — from four different directions,
each with a different cost when it's wrong.

## Holder identity — Fusion's holder GUID is NOT stable (CRITICAL)

**Fusion's holder `guid` does not match a holder to itself over time.** It serves some purpose inside Fusion, but it churns for reasons that aren't ours to model. So the app never treats it as identity. This is why the app owns its own holder library and its own IDs.

**The durable Fusion↔app link is TWO signals, and BOTH must agree** (`src/schema/holderIdentity.js`):

1. **`holder_ref`** — the app's own id, stamped into Fusion's free-text **`product-id`** field on the holder. The identity *we* control.
2. **The segments** — matched shape-for-shape within **`SEGMENT_MATCH_TOL_IN = 0.001"`** (rounding only; unit-agnostic, count must match too).

Neither field is managed by Fusion and either can be broken by an ordinary human action — someone duplicates a holder in Fusion and edits its segments without touching the product-id (**`ref-only`**), or rebuilds one and loses the ref (**`geometry-only`**). Either signal alone would silently link the wrong holder, so `matchFusionHolder` returns **`exact`** only when both point at one record; `conflict` / `ambiguous` / `ref-only` / `geometry-only` are **flagged for a person**, never acted on. `auditFusionHolders` sweeps the library into matched / flagged / unknown / unpushed.

**This is NOT the migration matcher.** Matching the shop's messy legacy library to the controlled one is a different job with different rules — description + gauge length, a generous tolerance, user-confirmed (`holderAudit.js`, `holderDuplicates.js`). That runs **once**, to get the data under control. Holder identity runs **forever after**, to keep it there, and is deliberately strict. Don't merge the two.

**Pushing OUT is what settles a library** (`holderPushPlan` / `applyHolderPushPlan`, driven by `AppContext.pushHoldersToFusion` and the **Push to Fusion** preview on the Holders page). Until each record's `holder_ref` reaches Fusion's `product-id`, every holder reads `geometry-only` and the link is one signal short. The plan rewrites a Fusion entry ONLY when it can identify it: `exact` → update; `geometry-only` with exactly ONE matching record **and a blank `product-id`** → **adopt** (nothing is overwritten — this is the bootstrap that lets the very first push land). Everything else is left **byte-for-byte alone** and reported: a half-match is the shape of a human edit, and overwriting it destroys the only evidence of what changed. A record no entry matched is appended as a new holder. Non-holder entries in the file are never touched. The push writes the holder library file only — **no cutting tool changes** (a tool gets corrected geometry from its own next write, or from **Re-stamp**). Idempotent: a second push has nothing to create — and an entry Fusion already agrees with is **not** rewritten (`u.stale` on each planned update; `applyHolderPushPlan` is keyed by **index**, so the plan and the write must be handed the same list). **`holderPushDiff(entry, next)`** says WHAT a push would change, field by field, in readable terms — so the dialog names each holder and its changes instead of showing a bare count. ⚠️ Numbers are compared with a **tolerance**, not string equality: a value that survives a JSON round-trip returns as `54.998999999999995` instead of `54.999`, and comparing text called those holders stale — inflating the count and making "Fusion is holding older values" untrue for them. `expressions.*` are excluded from the diff (Fusion re-derives them from their native field, so a rename would be reported twice), and a whitespace-only change is reported as *"extra spaces removed"* rather than an invisible before/after. **`pushChangeGroup(diff)`** files each holder under its MOST significant change (`geometry` > `text` > `id`), so the dialog groups twenty holders into a few collapsible sections instead of twenty decisions — geometry open by default because it's the one worth reading, ID-only shut because it isn't. ⚠️ **`id` means a pure `product-id` stamp and NOTHING else** — anything unrecognized falls to **`other`** (open by default), because `id` was a catch-all and its header says "nothing but the app's ID", which the dialog then repeated over a change that was not that at all. A group whose header can lie about its rows hides exactly the bug it should surface. **`holdersOutOfSync(fusionEntries, records, holderRecordToFusion)`** counts records Fusion doesn't yet agree with — never pushed **or pushed and since edited here** — and badges the **Push to Fusion** button. ⚠️ It cannot be "unmatched records": a renamed holder still matches on identity (the segments didn't move) while Fusion holds the old name, so counting matches alone let app-only edits sit unpushed forever. App-only fields (`notes`, `location`, classification ids) never count — Fusion has nowhere to put them. ⚠️ The `product-id` field is the app's from then on — a vendor SKU that was there is preserved in the record's `legacy_ids`/`part_number`, and still resolves via `recordForRef`.

**⚠️ `product-id` is a PAIRED field — and that is what the whole link hangs on.** Fusion re-derives every native holder field from its expression on load (the same rule as tools), and the real library is 20/20 consistent about which pairs exist: `tool_description` always; **`tool_productId` / `tool_vendor` / `tool_productLink` exactly when the native value is non-empty** (quoted, absent otherwise); `tool_unit` on only 2 of 20 (the inch holders) so its presence is Fusion's call. `holderRecordToFusion` rewrote `product-id` to the app's `holder_ref` but carried `expressions` forward from the existing entry untouched — so on the **4 real holders that carry `tool_productId`** (values like `'min OOH'` and a vendor SKU) Fusion threw the app's ID away on the next load. Those holders read `geometry-only` forever and came back as "to write" on **every** push. The writer now regenerates `tool_productId` / `tool_productLink` / `tool_vendor` from what it just wrote (**deleting**, never `''`, when the value is blank), and **syncs but never adds** `tool_unit`. Locked by `holderRecord.test.js` — including a sweep asserting no native/expression disagreement on any real holder.

**The first push runs itself, ON IMPORT, and it is SCOPED.** Importing used to leave every record one signal short of linked — the app knew the holder, Fusion didn't carry its ID — so the whole library sat in a limbo the user had to know to press a button to leave. `HoldersPage.onImport` now calls `pushHoldersToFusion({ recordIds, silent: true })` with **only the ids that import just created** (`importHoldersFromFusion` returns `addedIds`). ⚠️ **The scope is what makes it safe**: each of those records came *from* a Fusion entry a moment earlier, so the plan can only **adopt** — stamp our ID onto an entry whose exact shape we just read — with **zero creates, zero deletes, and no geometry moving**. Records already in the library are outside the scope: their entries match nothing in scope, so they're skipped rather than flagged/created/deleted, and an unrelated unpushed edit is never pushed on the user's behalf. Belt and braces: a `dryRun` first, and if it reports **any** create or delete the auto-push stands down and hands back to the button. A failure never fails the import — it's reported in the same toast. Locked by `holderIdentity.test.js` (`describe('a push scoped to freshly imported records')`). ⚠️ This is also why **`saveHolderLibrary` passes an `onSaved` hook that updates `holderLibraryRef` synchronously**: refs are assigned during render, so an action that saves and then immediately reads the ref (this one) would otherwise read the *previous* library and silently drop the records it just wrote — the same reason `loadHolders` takes an explicit list.

⚠️ **A TAP-COLLET TWIN IS A DELIBERATE SAME-SHAPE PAIR — the app has to hold two records with identical geometry, forever.** The shop keeps a second record of the same holder body with a **tap collet** fitted (`is_tap_collet`): the segments are identical and only the description differs, because the description is the **only** thing that reaches the operator through Fusion and ProShop. That is the second real use of **Duplicate** (the first — "duplicate, then change the extension's stickout" — ends with different geometry and needs nothing special). Every "these must be the same holder" rule in the module would otherwise conclude the wrong thing, so three were narrowed; all locked by `holderTapTwin.test.js`:
- **Duplicate detection**: `is_tap_collet` is a **`DISQUALIFYING`** field. A fitted collet is the same class of difference as a collet size, so the pair is never offered as a merge — without it the twin scored a full `duplicate` and was offered on every visit, forever, and accepting would have destroyed one of two records the shop created on purpose.
- **`matchFusionHolder` / `matchBakedHolder`**: the **ref settles a shared shape**. Requiring the shape to be UNIQUE would have made every tool on the original uncertain the moment the twin was created.
- ⚠️ **A record that has never been in Fusion cannot be what a tool BAKED** (`matchBakedHolder`). A tool's baked holder copy came out of Fusion, so a record with no `fusion_guid` and no `last_pushed` — a twin just created here — is not a candidate however well its shape matches. Candidates are narrowed to the ones that have actually been in Fusion **before** uniqueness is judged; without it, creating the twin dropped every tool on the original into the "needs a look" tier for a record none of them could possibly have come from.

**Deferred, deliberately:** specifying the **collet itself per assembly**, which is the more honest model of what a tap-collet twin represents (one holder, two collets). Until then the twin is two holder records — which is what Fusion and ProShop can both carry.

**⚠️ `ref-only` is BOTH "we edited here" and "Fusion moved" — `last_pushed` is the only thing that tells them apart.** Redrawing a holder in the app (the primary ongoing workflow, and what the workflow banner instructs) makes the segments disagree while our ref stays put, so the entry reads **`ref-only`** — the same status a genuine Fusion-side edit produces. Reading it as the latter meant the push **refused to write the user's own correction**, flagged it as *"edited in Fusion"*, and left `holdersOutOfSync` at **0** — so the holder library silently went stale and stayed stale, which is the one state this whole system exists to prevent. The record therefore carries **`last_pushed: { segments, unit, at }`**, a copy of the geometry as pushed, stamped in `pushHoldersToFusion` after each successful write. `matchesLastPush(entry, record)` compares Fusion's shape against it with the same `segmentsMatch` tolerance: **Fusion still holds what we last pushed → nothing moved on its side → write our change**; **Fusion differs from what we last pushed → Fusion moved → flag**. A record with no `last_pushed` (never pushed) keeps the old strict behaviour. This also makes Fusion-drift detection actually work — before this the app could not tell either way. Locked by `holderIdentity.test.js` (`describe('an app-side redraw pushes out')`).

**Duplicating a holder** (`duplicateHolderRecord`, `holderRecord.js` → `AppContext.duplicateHolder` → the **Duplicate** button on `HolderDetail`). "Another one like this, a bit different" (a `-120` becoming a `-150`) previously meant copying it in **Fusion**, where the guid comes back unpredictable and the copy arrives wearing the original's `product-id` — landing as a `fusion-copy` flag. Doing it here gives the copy our ID from the start and it pushes as a plain new holder. It shares `freshHolderIdentity` with **Restore**: new `id` + `holder_ref`, and **every** id-shaped field cleared (`fusion_guid`, `legacy_fusion_guids`, `legacy_ids`, `last_pushed`, `nominal_check`). ⚠️ **No tool follows the copy** — a tool resolves a holder through `assembly.holder_id` or the baked Fusion guid, and both of the original's stay on the original, so "starts with zero assemblies" falls out of the new identity rather than being a separate step. The **description** gets ` (copy)` (two holders must never share one — it goes verbatim into preset names and `asm_number`s) and the **photo/attachments are dropped**, since sharing a Drive file id between two live records means deleting it from either breaks the other. Everything the copy is *for* rides along: geometry, classification, manufacturer, purchasing, location, notes. ⚠️ It copies the **draft** (`h`), not the stored record — the page autosaves, so the stored copy can be seconds behind.

⚠️ **The REF settles a shared shape — `matchFusionHolder` checks it BEFORE calling anything ambiguous.** A duplicate starts as the same geometry, so the original's Fusion entry suddenly matched two records and read as `ambiguous` — which claimed both records and made a push straight after a duplicate write **neither**. Both signals agreeing on one record IS `exact`; a sibling that happens to share the shape doesn't contradict it, and with identical geometry there is nothing to choose between them anyway. Ambiguity now means only what it says — *we cannot tell WHICH record* — i.e. the `geometry-only` bootstrap, where a wrong guess would adopt the wrong holder. Locked by `holderDuplicateRecord.test.js`.

**The archive — nothing is ever hard-deleted.** A merged-away or removed holder keeps its geometry as a reference (`archived` / `archived_at` / `archived_reason` `'merged' | 'removed'` / `merged_into`). `applyHolderMerge` **archives** the loser instead of dropping it; `deleteHolderRecord` archives too (the action is "Retire", not "Delete"). ⚠️ **`retiredHolderFor(entry, records)` is THE one rule for "this Fusion entry belongs to a holder we retired"**, shared by the push (which removes it) and the import (which must NOT bring it back). Splitting it produced exactly the bug it prevents: archived records are invisible to matching, so the importer read a retired holder's entry as one it had never seen and **re-created it** the moment you clicked Import before pushing. ⚠️ **An archived record is invisible to EVERY matcher** — enforced at the two primitives every match runs through (`recordForRef` / `recordsForGeometry`), plus `holderForGuid`, `resolveHolderForWrite`, `backfillHolderIds`, `proposeHolderLink`, and `findHolderDuplicates` — because putting a tool back on a retired holder silently undoes the decision the archive exists to record. `holderForGuid` skipping archived matters specifically: a merge moves the loser's guid onto the survivor, but the archived loser still has that guid in its own `fusion_guid` and would otherwise match first. **Restore is a COPY** (`restoreArchivedHolder`): new `id`, new `holder_ref`, `fusion_guid`/`last_pushed`/`legacy_*`/`nominal_check` cleared, so it pushes as a brand-new holder. Reviving the old identity would re-attach every tool still carrying its guid to the geometry the archive was retiring. The Holders page hides archived records by default behind a toggle **below** the list; each row reads **"Not in Fusion"** with why + when, and offers **Restore as new**.

**Retiring a holder that is IN USE asks where its tools go** (`RetireHolderModal.jsx`, opened from `HoldersPage.onDelete` — it replaced a `window.confirm` that only *warned*). A retired record is invisible to `resolveHolderForWrite`, so every tool left pointing at one **silently reverts to Fusion's geometry on its next ordinary save** — one tool at a time, with nothing on screen to say so. Three cases: (1) the tool library is **not normalized** → **blocked**, because "which tools use this holder" is read off assemblies that don't exist yet, so the count reads **0** and the screen would say "nothing uses this" about a holder half the shop runs — an un-knowable answer is indistinguishable from a safe one here; (2) **0 tools** → straight confirm; (3) **N tools** → a **replacement is required** — the main job being *"replace this holder with a better-drawn one"*: `assembliesUsing(record, tools)` (same `assemblyUsesHolder` predicate as everywhere else — FK first, guid fallback, follows merges) builds links for every affected assembly, previewed through `linkToolsToHolders(links, {dryRun})`, then commits **move first, archive second** (a failed re-link must never leave tools stranded on an archived record). The replacement needs **no relation** to the retired record — different segments, a gauge several mm apart, unrelated Fusion guids; nothing in this flow reads a guid. ⚠️ The preview shows each tool's **assembly gauge before → after** (the dry run's `gaugeChecks`, the same backstop re-stamp uses), NOT just a count: swapping to a holder drawn 8mm differently moves every one of those tools' gauge by 8mm — a real machining consequence — and a move over 10mm is flagged as implausible. ⚠️ **Move is not Merge** and both are offered: *move* = these tools now run a **different** holder, so the retired record keeps its own identity and its old ref does NOT resolve to the replacement; *merge* = the two records were the **same** holder, so the survivor absorbs the ref + Fusion guids and **no tool is rewritten** — the modal links to Duplicates rather than duplicating that flow. Locked by `retireHolder.test.js`, which includes the pre-normalize case as its own assertion.

**Retiring a holder REMOVES it from Fusion** (`holderPushPlan.deletes` → `applyHolderPushPlan` drops those indices; named + tick-gated in `PushHoldersModal`, and counted by `holdersOutOfSync`). Two ways an entry is identified for removal, and the distinction is load-bearing:
- **By a retired app ref** — the entry's `product-id` is an archived record's own `holder_ref`, or a ref an **active** record absorbed into `legacy_ids` by a merge. ⚠️ **ONLY ever on the `HLD-XXXXXX` shape** (`HOLDER_REF_RE`): `legacy_ids` also holds the raw `product-id` the entry came in with at import — a vendor SKU (`BT30-APU13D`) or prose (`min OOH`) — and that value belongs to the **live** holder, so deleting on it would delete the holder itself.
- **By shape, when the holder was retired BEFORE its first push** (`archivedByShape`). Its Fusion entry carries no ref of ours, so the rule above can't see it and it sat orphaned in Fusion while the app showed it retired. Identified with the same certainty required to write: the entry matches **no live record** and **exactly one** archived record has its shape. Live records are always tried first, so a merge survivor sharing the loser's shape is never mistaken for the thing being deleted; two archived records of one shape is ambiguous and left alone.

⚠️ Because deletes shift every later index, `pushHoldersToFusion` reads each written entry back **by `holder_ref`**, never by the plan's index into the pre-write list.

**⚠️ `toolHolderIsStale` asks ONE question — is the GEOMETRY out of date — with the SAME rule identity uses** (`segmentsMatch`: unit-aware, 0.001" rounding tolerance). It previously compared `toFixed(4)` strings (no tolerance, no unit conversion) *and* treated a changed baked guid as staleness. Measured end-to-end over the real 226-tool reference library that reported **190 of 212** linked tools as carrying an older copy — while the identity matcher said **187 of them were the same holder**, and Fusion re-issues holder guids constantly (the premise of the whole module). The true answer is **3**. A flag that fires on 90% of the library is wallpaper and the number it showed was untrue. Two comparison rules for one question is the defect. A dangling baked guid is still corrected by the tool's next ordinary write; it just isn't reported as older geometry. Locked by `holderResolve.test.js` (`describe('staleHolderTools over the real reference library')`), which asserts the sweep can never contradict the identity matcher.

**⚠️ Duplicate detection DISQUALIFIES on physical identity — it doesn't just downgrade** (`DISQUALIFYING`, `holderDuplicates.js`). `compareHolders` treated every classification conflict as a merely weaker `'possible'`, so **SK13 vs SK20 was offered as a merge candidate** — same gauge, same taper/type/length/extension, descriptions 67% alike, and a quiet "⚠ Collet differs". A collet size is a **bore**: those cannot be one physical holder, and offering the merge is offering to destroy one of two real holders. Disagreement on **taper** (after `taperBase` folds NBT30/BBT30 → BT30, so a survivor is BT30 vs BT40), **type**, **collet family**, **collet size**, **`is_tap_collet`**, or **extension collet** now returns `null` — the pair never reaches the list. What stays `'possible'` is a genuine LABEL discrepancy on what could still be one object: an engraved nominal that disagrees while the gauge matches, or one record not yet marked as having an extension. Collet **family** was not previously compared at all. Locked by `holderDuplicates.test.js` (the old test asserted the opposite behaviour).

**⚠️ A tool write MUST refresh `_instancesRaw` to what it just wrote** (`writeToolsToFusion`, `libraryOps.js`). The stale-geometry flag reads each tool's baked holder out of `_instancesRaw`; carrying the pre-write copy forward meant **Re-stamp corrected Fusion and the app immediately re-read the old geometry and reported the same tools as stale** — re-stamp again, same answer, no way out short of reloading the page. `splitToFusionInstances`'s `fusionInstances` IS the new raw entry set. `writeToolsToFusion` also **returns** the updated tools so `linkToolsToHolders`, which dispatches its own `SET_TOOLS` afterwards from pre-write copies, can merge them instead of overwriting them. Locked by `holderResolve.test.js` (`describe('re-stamping clears the stale flag')`) — the checklist question "can the user make this flag go away?" applied to its own detector.

**Tools carrying older holder geometry are surfaced** (`staleHolderTools`, `holderResolve.js` — wraps the previously-unused `toolHolderIsStale`). A corrected holder only reaches an existing tool when that tool is written, which is by design but **must not be silent**: `buildHolderLinkPlan` skips any assembly that's already linked, and a tool arriving from Fusion on a **merged-away guid is auto-linked to the survivor** — correctly pointed, wrongly shaped, and nothing anywhere said so. Surfaced as an amber banner on the Holders page (library-wide) and in each holder's Re-stamp banner, which now leads with *how many of its tools are stale* rather than how many use it. The fix is the existing Re-stamp write.

**⚠️ ONE record → ONE Fusion entry.** Two entries can legitimately resolve to the same record — most often right after **merging duplicates in the app**, since the merge retires the loser's ref into `legacy_ids` and both Fusion copies still have the merged shape. `holderPushPlan` writes the **first** and flags the rest as **`duplicate-entry`**; stamping one app ID onto two holders would make them indistinguishable forever, and deleting a holder out of Fusion is not the app's call. Covers the `adopt` path too (where the match is `geometry-only` and `m.record` is deliberately null).

**Creates are NAMED, not counted** (`createRows` in the push summary → the "Added to Fusion" group). A create appends a new holder, and the one way to get an accidental duplicate is a record whose **geometry was edited in the app before its first push**: its Fusion entry then matches neither the shape nor our id, so it reads as a holder we've never seen and a second copy is added. "20 holders not in Fusion at all" is exactly where that hides.

**⚠️ A push NEVER rewrites an existing Fusion entry's `guid`** (`holderRecordToFusion`: `guid: existing?.guid || record.fusion_guid || record.id`). Identity deliberately never reads the guid, so a record can legitimately match an entry whose guid differs from the `fusion_guid` it happens to remember — preferring the record's copy changed the holder's identity in Fusion for no reason and orphaned the guid every tool had baked in. It also **never settled**: the push wrote the record's guid, then `pushHoldersToFusion` stamped `fusion_guid` back from the **pre-write** entry, so the next push wanted to swap them again — one holder ping-ponging between two guids forever, and the page never showing zero to write. Two halves of the same rule: the existing entry's guid wins on write, **and** `fusion_guid` is stamped from the entry that was actually **written** (read back out of the new list), never off the entry that was replaced. A record with no entry yet still gets a **deterministic** guid (`fusion_guid`, else the record's own `id`) — never `generateId()`, which would mint a new one on every preview. Locked by `holderIdentity.test.js` (`describe('a push settles')`, incl. a three-round idempotence run over the real library).

**⚠️ THE OTHER HALF OF `ref-only` — a Fusion-side edit can now be ACCEPTED.** When Fusion is *not* holding what we last pushed, the rule above flags it and refuses to write — correctly, because the app cannot know which shape is right. But there was **nothing on the other side of that flag**: the import skips anything that isn't `none`, the push dialog's advice was "sort them out on the holder page first", and the holder page offered nothing to sort them out with. So a holder edited in Fusion could **never come back**, the two libraries stayed permanently different, and — because `holdersOutOfSync` counts only what a **push** would fix — the badge sat at 0 and **nothing on any screen said so**. There are exactly two answers, both the user's call, and both are **plain record edits** (`holderIdentity.js`):
- **`adoptFusionHolderGeometry(record, entry)`** — Fusion is right. ⚠️ **Geometry ONLY**: the app owns the description/classification/vendor ("edit here, not in Fusion"), so adopting a shape must not drag a Fusion-side rename in with it — the banner says so rather than leaving it to be noticed. Segments go through **`fusionHolderSegments`**, the same conversion the import uses, because **`above_gauge` is app-only and DERIVED from the gauge expression** — copying the raw segments loses which sit inside the spindle and the gauge length comes out wrong. Needs no Fusion write at all: the two then agree.
- **`keepAppHolderGeometry(record, entry)`** — we are right. Nothing about the holder changes; the only thing written is **`last_pushed` = the entry's current shape**, i.e. "we have seen what Fusion holds". That is precisely what `holderPushPlan`'s `ref-only` branch tests, so the next push overwrites Fusion instead of skipping it again. (Hence `last_pushed` is the **acknowledged** shape, not literally "what we pushed" — a push is just the usual way that agreement gets established.)

**`fusionHolderConflicts(fusionEntries, records)`** is the worklist, derived from `holderPushPlan`'s own `flagged` bucket so what it offers to resolve is exactly what the push refuses to write. Deliberately **NARROW — `ref-only` only**: that is the one status where both sides claim to be the same holder and the only open question is which shape is right. `conflict` / `ambiguous` / `geometry-only` / `fusion-copy` each have more than two possible answers and stay flagged. Each row carries a **`direction`**: `fusion` when `last_pushed` proves Fusion moved, **`unknown`** when there is no `last_pushed` — ⚠️ never blame Fusion for what may be the user's own edit; with no record of what Fusion was last given, which side moved genuinely cannot be told, and saying otherwise sends someone looking for a change nobody made.

⚠️ **The banner is gated LOCALLY once answered.** `fusionConflict` is computed by the parent from the STORED record while the resolution only touches the page's draft, so between the click and the autosave landing (up to ~1.5s) it sat there with both buttons live, reading as though nothing had happened. `HolderDetail` keys a `resolvedEntry` off the entry, and the resolver reports to the user **only when the draft actually changed** — both resolvers return the same reference on a no-op, so a second click on a stale banner used to toast success over nothing.

⚠️ **The count is its OWN banner, never folded into `holdersOutOfSync`.** That number is "what would a push fix"; a flagged entry is exactly what a push will *not* fix, so adding it would make the Push button's badge promise work it won't do. Surfaced as a **red** banner (the amber ones are "press the button when you get a minute"; this is two libraries holding different geometry until a person decides) on the Holders page with a chip per holder, and on the holder's own page as the two buttons. ⚠️ **The edit belongs to `HolderDetail`'s DRAFT**, applied through its `apply()` — resolving from the parent's record would write a copy that predates whatever the user typed in the last second, and going through `apply` also makes accepting a Fusion shape **undoable** like any other segment edit. Locked by `holderFusionConflict.test.js` + `holderFusionConflictUi.test.jsx`.

**Consequences elsewhere:**
- `resolveHolderForWrite` (`holderResolve.js`) resolves **`holder_id` FIRST**. `holder_guid` is a hint — the fallback for an assembly that predates the FK, and for a holder not yet imported. A guid pointing somewhere else is noise, not an instruction.
- `importHoldersFromFusion` decides "already known" with `matchFusionHolder`, **not** the guid. Skipping on the guid would re-import the same physical holder as a fresh duplicate every time Fusion re-issued it.
- Matching on `holder_ref` also searches `legacy_ids`, which holds whatever was in Fusion's `product-id` at import (often a vendor SKU) — useful on the first pass, and still fail-safe because the segments must agree too.

-----

## If Fusion has a place for it, Fusion must have it (CRITICAL)

**The test: if this app disappeared tomorrow, would the work survive?**

Anything the shop does in this app that Fusion has a native field for **must be written to Fusion**. Not "eventually", not "when the user remembers to press a button" — kept in sync, as a property of the feature. If the answer to the test above is "no, it would be lost, even though Fusion has a field for it", that is a **bug**, not a design choice.

This is not about Fusion being important. It's about not building a trap: the shop spends weeks refining data in a web app, and every bit of it is stranded in a JSON file on someone's Drive while the system that actually cuts metal still holds the old values.

**The rule, in two halves:**

| | |
|---|---|
| **Fusion HAS a field for it** | The app **must** write it there. Metadata may own the value and win on read, but Fusion must be **mirrored**, always. |
| **Fusion has NO field for it** | Metadata-only, and that's correct. Never invent a Fusion field — Fusion validates strictly (see "No extra fields in Fusion JSON"). |

**Mirrored today** (each of these has a Fusion home and is written on every save): `description`, `tool_id` → `product-id`, `machine_tool_number` → `post-process.number`, `location` → `expressions.tool_vendor`, all geometry, all presets, per-assembly OOH → `geometry.LB`, and the **holder object baked into each tool** (rebuilt from the app record on every tool write — see Holder Management System).

**Metadata-only because Fusion has nowhere to put them** (correct, not a gap): `holder_id` and every other FK, `min_ooh`, `preferred_machine_id`, `tap_sub_type`, `point_type`, `tip_to_first_thread`, `notes`, `tags`, `purchasing`, the structured `tool_location`, `legacy_*` arrays, `preset_meta` (`operation_type`, `machine_id`, `job_ids`, `material_preset_id`, …), assemblies, and every `_runtime` flag.

**⚠️ The failure mode is always the same shape, and it has happened more than once:** a feature is built as "metadata-only" because the *link* it stores is metadata-only — and the **geometry, name, or value that Fusion does hold** is quietly left behind. Storing a pointer is not the job; making Fusion right is. Two live examples, both fixed:
- **Linking tools to holders** stored `holder_id` and stopped. The FK is genuinely metadata-only — but the *holder geometry each tool carries* is Fusion-native, and half the library was carrying wrong geometry. Linking now rewrites those tools to Fusion in the same commit.
- **Holder records** (`holder_library.json`) own descriptions, segments, vendor and `product-id` — **all Fusion-native**. Refining them in the app and never pushing would strand the whole cleanup effort. Hence **Push to Fusion**, and hence the Holders page badges how many records Fusion does not yet agree with.

**When adding any feature, answer this before writing code:** *which of the values I am touching does Fusion have a field for, and where does my code write them back?* If the answer is "it doesn't", either write them or say plainly that you are leaving Fusion stale and why.

**Batching is fine; skipping is not.** A bulk action may write metadata in one pass and Fusion in one targeted pass rather than a round-trip per record — that's an efficiency choice, not an exemption. What is never acceptable is finishing an action with Fusion holding values the app knows are wrong and no visible sign of it.

**Two targeted writers — pick by SCOPE, not by convenience:**

| Writer | Scope | Use when |
|---|---|---|
| `writeToolsToFusion` | **TOOL** — rebuilds each entry from the app's model (`splitToFusionInstances`) | the whole entry is the point (re-stamping baked holder geometry) |
| `pushFieldToFusion` | **FIELD** — patches one native+expression pair in place, every other byte untouched | "Fusion's copy of this one value is stale" |

⚠️ Reaching for the tool-scoped writer to correct a single field rewrites geometry, presets and every expression across every tool it touches, silently applying any other app↔Fusion drift on the way. When a bulk metadata write leaves one Fusion field behind, the fix is a **`FUSION_FIELD_PATCHERS` entry + a preview→commit action**, not a bespoke push and not a full rebuild. See **Pushing ONE field to Fusion** under the Location System for the contract.

-----

## Relational integrity — every link is an ID (CRITICAL)

This app is a **relational database wearing JSON files**, and it is meant to migrate to SQLite with a schema translation, not a rewrite. So every relationship between two records must be a **stored, stable ID** — the thing a SQL foreign key would be.

**Two rules, and you need BOTH. Applying only the first produces exactly the bug this section exists to prevent.**

| | Rule | Applies to |
|---|---|---|
| 1 | **Derive, don't store** — store the id; compose the display value at read time | **Display values** (a name, a label, a composed string) |
| 2 | **Store the link, never re-derive it** — a relationship is a stored id, never recovered by parsing a formatted string | **Relationships** (which record points at which) |

Rule 2 is the one that was missing, and its absence let `presetMatchesAssembly` become the *de facto* preset↔assembly link by parsing the OOH and holder short-name out of a preset's **display name** — so renaming/re-spec'ing silently severed a relationship, and no SQL schema could express it. A formatted string is a **transport format**, never a join key.

**Corollary — the Fusion boundary is the one legitimate use of a name as a carrier.** Fusion has nowhere to store our FKs, so encoding a link in a preset name is the correct way to survive the round-trip. That name is an **import seed and a recovery hint** — it is *not* the in-app link. Parse it once on import to populate the FK, then read the FK forever after.

### Relationship inventory — audit against THIS

Every entity link in the app. When you add a relationship, add a row. When you touch one, verify the key is still an id.

| From → To | Key | Stored in | Status |
|---|---|---|---|
| assembly → Fusion entry | `instance_guid` | metadata | ✅ |
| **assembly → holder record** | **`holder_id`** | metadata → `holder_library.holders[]` | ✅ the authoritative link |
| assembly → holder (Fusion mirror) | `holder_guid` (+ cached `holder_description`) | metadata | ✅ what Fusion absorbed — a HINT for an assembly with no FK yet, never an authority |
| tool → selected holder (legacy) | `selected_holder_guid` | metadata | ⚠️ pre-assemblies; a Fusion guid, so a hint and never an identity |
| **holder → Fusion holder entry** | **`holder_ref` (stamped in Fusion `product-id`) + a segment match** | `holder_library.json` ↔ Fusion | ✅ both required — see Holder identity |
| holder → what Fusion was last given | `last_pushed { segments, unit }` | `holder_library.json` | ✅ the only thing separating an app-side redraw from a Fusion-side edit |
| archived holder → its survivor | `merged_into` | `holder_library.json` | ✅ dangling tolerated; archived records match nothing |
| holder → Fusion guid (hint only) | `fusion_guid` (+ `legacy_fusion_guids[]` merge aliases) | `holder_library.json` | ⚠️ Fusion re-issues these; never an identity |
| holder → body part / extension part | `body_part_id` / `extension_part_id` | `holder_library.json` → `parts[]` | ✅ part delete UNLINKs both slots |
| holder → type / taper / collet family / collet size | `type_id` / `taper_id` / `collet_family_id` / `collet_size_id` | `holder_library.json` → `shop_settings.holder_config` | ✅ seed ids are stable slugs, never per-load UUIDs |
| collet size → collet family | `family_id` | `shop_settings.holder_config` | ✅ |
| **preset → assembly** | **`preset_meta[guid].assembly_id`** | metadata | ✅ the authoritative link (many presets → one assembly) |
| assembly → presets (reverse index) | `linked_preset_guids[]` | metadata | ✅ derived from the FK on every write |
| preset → CAM preset | `preset_meta[guid].material_preset_id` | metadata | ✅ |
| preset → machine | `preset_meta[guid].machine_id` | metadata | ✅ |
| **preset → operation** | `preset_meta[guid].operation_ids[]` | metadata → `parts.operations[]` | ✅ the program a preset was proven on |
| tool → program | — | **derived** from `program_details` rows' `tool_ref` | ✅ never stored — see The Parts module |
| **tool → its replacement** | `replaced_by` | metadata | ✅ the replacement's tracking id; DIRECTIONAL, so deliberately not part of the symmetric `linked_tools` |
| **tool ↔ tool** (tap/drill, reamer/drill) | `linked_tools[]` | metadata | ✅ symmetric — stored BOTH sides, one write; `symmetrizeToolLinks` heals a half-link at load |
| tool → preferred machine | `preferred_machine_id` | metadata | ✅ |
| tool → location | `location.{system_id,zone_id,station_id,drawer_id}` | metadata → `shop_settings.location_config` | ✅ |
| tool → bin size | `bin_size_id` | metadata → `location_config.bin_sizes[]` | ✅ |
| tool → speed/feed ref | `speed_feed_refs[].preset_id` | metadata → `materials.presets[]` | ✅ |
| tool → components (insert) | `pairing.holder_component_id` / `insert_component_id` | metadata → `tool_components.json` | ✅ |
| purchasing mfg/vendor → registry | `registry_id` | metadata → `vendor_registry.entities[]` | ✅ |
| purchasing vendor → its mfg | `manufacturer_id` (per-tool row id) | metadata | ✅ cascades on mfg delete |
| CAM preset → group | `presets[].group_id` | `materials.json` | ✅ group delete RESTRICTed |
| alloy → CAM preset | `materials[].preset_id` | `materials.json` | ✅ preset delete SET NULLs it |
| alloy → group | `materials[].group_id` | `materials.json` | ✅ |
| routing → part | `routings[].part_id` | `parts.json` | ✅ |
| operation → routing | `operations[].routing_id` | `parts.json` | ✅ cascade delete. ⚠️ 1:N today; the domain is M:N — **deferred**, see "Sharing an operation across routings". Maps 1:1 to a routing-step join when it lands |
| part / fixture op → alloy | `material_id` | `parts.json` → `materials.materials[]` | ✅ a non-fixture op derives from its part |
| operation → machine | `machine_id` (+ cached `machine_label`) | `parts.json` → `shop_settings.machines[]` | ✅ |
| shop → default machine | `default_machine_id` | `shop_settings.json` | ✅ |

**⚠️ This is enforced, not remembered.** `src/schema/relationalIntegrity.test.js` builds a metadata record whose human identifiers are distinctive sentinels and walks EVERY value in it. Three guards, and the third is the one that matters most: (1) no link holds the ProShop number / description / location / machine number; (2) no link value has the shape of a ProShop number; (3) **every link-shaped key** (`*_id`, `*_ids`, `*_guid`, `*_guids`, `linked_*`) must be registered in `LINK_SHAPED_KEYS` — so a link-shaped field **that does not exist yet** fails the suite the moment it is added, forcing a look at what it stores. Verified by deliberately introducing the mistake (`linked_fixture_id: tool.tool_id`): all four assertions fire. It has already earned it — the coverage guard is how `selected_holder_guid` was found missing from the inventory below.

**A request phrased in human terms is still a request for an id.** "Link them by the ProShop number" means *look the tool up* by its ProShop number — the picker's job — and *store its tracking id*. There is no version of a linking feature where a mutable display value is the key, and no trade-off to weigh per feature.

**Dangling ids are tolerated everywhere** (the referenced record may be deleted) — resolvers return null and callers fall back to a stored label. That's deliberate: it's soft-delete tolerance, not a broken link.

Locked by `src/schema/relationalIntegrity.test.js` — seed-data FK integrity plus a metadata round-trip that fails if any FK field stops being persisted.

-----

## Self-healing — the app continuously re-establishes correctness (CRITICAL philosophy)

**Why this exists.** This app introduces standardization (tracking IDs, the naming convention, the Materials/vendor/machine libraries, the location + ID systems) to data that never had any — the shop's Fusion library and ProShop export were maintained by hand, so **the data coming in is dirty**. Worse, it does not stay clean: **Fusion remains an editable second source of truth**, so every sync can re-introduce drift, duplicates, renamed-away links and hand-edited values. A one-time migration therefore does NOT hold. Correctness has to be **re-derived on every load**, not assumed — the app is the thing that keeps the library true, continuously.

This is the other half of **Informed, not blocked** (next section). Together:

| Situation | Response |
|---|---|
| The right answer is **unambiguous** | **Repair it silently** — no prompt, no ceremony |
| The right answer is **a judgement call** | **Surface it, never guess** — the user decides, per record |

**Repair silently (already built, run at load):** `combineToolsByToolId` (fold duplicate tool records), `mergePresetLists` (collapse duplicate presets by operation+values), `derivePairings` (detect insert tools from a combined product-id), `overlayPresets` (infer a blank material from the preset name), `materializeUnlinkedTools`, the FK backfills — `backfillMaterialPresetIds` / `backfillPurchasingRegistryIds` / `backfillPreferredMachineIds` / `backfillAsmNumbers` — the derive-from-id resolvers (`syncPresetMaterialName`, `syncPurchasingFromRegistry`, `syncPreferredMachine`), `isAutoPresetName`'s open-time preset-name refresh, `resolveLocationString`, and the Fusion round-trip invariants in `normalizePreset` / `buildHolderObject`.

**Surface, don't guess (already built):** `ConflictBanner` (import/combine disagreements), `DriftBanner` (live Fusion edits), `MergeSiblingBanner` (same ProShop # on two records), `ReconcileModal` (entries dumped straight into Fusion), the duplicate-preset cleanup banner, `MaterialLinkBanner` (material links that can't self-heal), `_productIdConflict` (stale tracking ID), and the ProShop import's flagged field conflicts.

### Rules for any NEW feature

1. **Assume the stored data is wrong.** Ask "what happens when this field is missing, stale, duplicated, or was edited in Fusion?" — that's the normal case here, not the edge case.
2. **Derive, don't store.** Store a stable id; compose the display value at read time (see the CAM-preset / vendor-registry / machine FKs). A stored copy of someone else's mutable value *will* go stale.
3. **Repair in memory at load; persist lazily on the record's next save.** Never turn a load into a bulk write — that's slow, it fights concurrent editors, and it rewrites records the user never touched.
4. **Detect structurally, not by equality.** Comparing a stored value to a freshly-computed one cannot tell *"the user customized this"* from *"this is ours and went stale"* — the `isAutoPresetName` lesson. Check the shape/provenance instead.
5. **Every repair must be idempotent and self-clearing.** Running it twice changes nothing, and the action that fixes a flag must make the detector stop firing. A detector that re-fires after the user fixed it is a nag loop — the main way this philosophy turns hostile.
6. **Never auto-resolve a real disagreement,** and never offer a bulk "fix everything" for ambiguous cases (see the cost note below).

### On noise (deliberate trade-offs)

- **Silent repairs are free to re-run.** They're pure in-memory passes over an already-loaded library — no IO, no writes — so running them on every load costs nothing and guarantees the app is never showing stale derived data.
- **Prompts persist until handled, per record, by design.** If 200 tools are wrong, the flag shows on 200 tools until each is dealt with. That is accepted: a bulk "approve all" on ambiguous data would just launder the bad data into the standard at scale — the user would click yes 200 times without reading. Per-record review is the point.
- **The failure mode to watch for** is a flag that cannot be cleared (no persist path, or detection that doesn't account for the fix). Before shipping a new flag, confirm the fix action actually makes it go away.

-----

## Informed, not blocked — the conflict workflow (CRITICAL philosophy)

The shop's real Fusion + ProShop data is a **mess** — the entire point of this app is to clean it into one true source of truth. So the load/import/normalize path must **NEVER block the user on a data disagreement**. It merges what it can, **flags** what it can't, and lets the user **keep working** — they resolve each flag later, on the tool page, when they actually go to use that tool. "Informed, not blocked." When touching any merge/normalize/reconcile code, preserve this: surface differences, never halt.

**How a difference is classified** (see the per-field merge policy in `combine.js` `mergeLogicalTools` + `reconcile.js` `sharedSignature`):
- **holder / OOH differ** → a new **assembly** (per-instance, expected — never a conflict).
- **Loosely-controlled fields resolve by rule, never flag**: `description` (keep primary; capitalization/whitespace ignored everywhere via `valuesEqual`), `overall_length` (biggest wins), `shoulder_length` (smallest wins; ProShop MIN OOH locks it later). `splitToFusionInstances` clamps `shoulder_length` down to each instance's OOH so a long stick-out never errors.
- **Metadata/ProShop-only fields are excluded from the Fusion-import conflict scan** (`isMetadataOnly`): `custom_grind`, `min_ooh`, `vendor`, `coating`, tags, etc. — Fusion has no data for them, so they can't be a Fusion-import conflict.
- **Presets merge** (`mergePresetLists`, `src/utils/presetMerge.js`): a **duplicate collapses by OPERATION + VALUES, not by name** — an incoming preset drops when an already-kept preset has the **same operation** (rough/finish/…, from `operation_type` or parsed from the name) **and** speed/feed values equal within tolerance. This is deliberate: presets are named per assembly (`… OOH2.25 - Rough` vs `… OOH3.0 - Rough`), so keying the dedup on the name made every assembly instance look distinct and piled up one copy of each preset per assembly — the collapse must be value-based. A preset whose values genuinely differ, **or whose operation differs (Rough vs Finish even at identical values)**, is kept; if its name then collides with a kept preset it's indexed up (`Rough`, `Rough 2`, `Rough 3`). Uses the same `PRESET_SIGNIFICANCE` tolerance as the Sync-Job diff. **Duplicate-cleanup banner:** the collapse happens in-memory on every load, but the Fusion library file keeps the old duplicates until the tool is next saved (lazy re-sync). `buildLogicalTool` sets a runtime **`_duplicatePresets`** count (distinct raw preset **names** across instances − collapsed count → only real different-name value-collapses, never the normal shared-set copies; `combine.js` carries it through the cross-tracking-id fold, adding cross-tool collapses). `ToolDetail` shows a non-blocking blue banner ("N duplicate presets merged — Clean up library") for linked tools with the flag; **Clean up** just calls `saveTool(tool)` to persist the already-deduped set, and the flag clears on the rebuild. Runtime-only (like `_drift` / `_productIdConflict`), never persisted.
- **Any other genuinely-shared Fusion-native value that differs → a FLAGGED conflict** (e.g. flute length 0.7 vs 0.75, diameter, flute count). The tool still comes in fully merged (primary/ProShop value wins); the disagreement is recorded, not blocked.
- **Stale tracking ID** (`buildLogicalTool` `_productIdConflict`): instances share a tracking ID but carry **different product IDs** → someone copied the tool in Fusion, re-numbered it, and left the app's tracking ID in the comment. Flagged as a `product_id` conflict.

**The conflict record** (`src/utils/toolConflicts.js`, persisted in `tool_metadata.json` under `conflicts[]`):
- Shapes: `{ id, type:'field', field, values:[kept, other], detected_at }` and `{ id, type:'product_id', values:[…ids], detected_at }`.
- `mergeToolConflicts(existing, { combineConflicts, productIdConflict })` folds freshly-detected runtime conflicts (`tool._combineConflicts` / `tool._productIdConflict`) into the persisted set, **deduped** (field conflicts by field name; product-id singular). Called in `buildMetadataTool`, so every save persists them.
- `displayConflicts(tool)` unions persisted + not-yet-saved runtime conflicts (for the freshly-combined tool at load, before its next save writes them through). `conflictCount(tool)` backs the card badge.
- **A conflict is NEVER auto-cleared.** A later ProShop import may overwrite the value, but the badge stays until the user explicitly clears it on the tool page. Because `splitToFusionInstances` unifies the shared value across instances on the first save, the record becomes pure *memory* of the disagreement — clearing it is a safe metadata-only action and it won't be re-detected.

**`normalizeLibrary` does NOT hold conflict tools back** (it used to — that left the library "needs normalize" until a reload). Every combined tool is written normally, carrying its `_combineConflicts`; `buildMetadataTool` persists them. So normalization always completes and the banner clears.

**Surfacing (three places):**
- **Library cards** (`ToolCard`): an orange `⚠ N` badge when `conflictCount(tool) > 0`.
- **Main page** (`App.jsx` `CombineConflictBanner`): a **dismissible** "N tools have unresolved differences" nudge — dismiss for the session so setup isn't interrupted.
- **Tool page** (`ConflictBanner.jsx`): per-conflict resolution — a field conflict offers **Keep <current>** (clear only) or **Use <other>** (writes the picked value via `resolveToolConflict` → full round-trip); a product-id conflict is informational + **Mark reviewed** (metadata-only clear). Distinct from `DriftBanner` (live Fusion-edit drift, D3) — conflicts are persisted import-time disagreements.

**Action**: `AppContext.resolveToolConflict(toolId, conflictId, chosenValue?)` (`toolActions.js`) — with a differing `chosenValue` it writes the field (full write, rewriting every instance to it); otherwise it clears the flag metadata-only.

-----

## UI Layout — ToolDetail

The ToolDetail view uses a three-zone layout:

1. **Frozen left sidebar** (`.tool-action-sidebar`): action buttons that don't scroll
   - Edit, Duplicate, Sync Job, Copy JSON, Download JSON, ProShop CSV (export), Import PS (single-tool ProShop import — see ProShop Integration), Delete
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
| Holder | `<HolderTag>` → `.holder-scoop-pill` | Pill with colored end caps | **The one holder treatment, everywhere.** Caps + border take the colour **picked for the holder in the app** (`record.color`), auto-assigned from the record's stable id when nobody has picked one, teal when there is no record at all. The whole chain is `holderDisplayColor(holder)` (`src/utils/holderColors.js`), called from ONE place in `HolderPill` — splitting it is what made the Holders page and the tool pages show the same holder in two colours. ⚠️ **Nothing derives the colour from the description** (see Holder colour below). The collet substring (`SK13` in `NBT30-SK13C-60`) is tinted separately from its collet-size option via `collet_size_id` — the background is never filled, so the two colours can't clash. The old flat `.holder-pill` is retired |
| Machine Tool # | `.machine-num-badge` | Slightly rounded rect (r=5px) | Green — `#4ade80`, mono |
| Location/Cabinet | `.location-tag` | Rounded rect (r=7px) | Indigo — `#818cf8`, mono |
| Preset Name | `.preset-tag` | Pill | Colored by **material's ISO group** via `--badge-color` (host sets it from `presetMaterialColor`); default `--iso-p` (steel) |
| Program # | `.program-num-badge` | Slightly rounded rect (r=7px, 40% larger than the base data-field scale) | Amber mono on dark plate (`--bg`) — CNC-screen look. Shown in its primary `O####` form via `formatProgramNumber`. Used on `/parts` (grouped rows, table, add-modal session list). ⚠️ Rendered ONLY through `ProgramNumBadge` (`partsUi.jsx`), which handles the no-program case — a step with none is normal, and a raw span renders an empty badge that reads as a missing value |
| Customer | `.customer-badge` | Pill | Colored per **customer name** via `--badge-color` (host sets it from `customerColor` hash palette); gray default for "No customer" |
| Operation (OP #) | `.op-pill` | Pill, solid fill | Colored per **operation number** via `--badge-color` (host sets it from `opColor`, `src/utils/opColors.js`); white mono text. Rendered ONLY through `OpPill.jsx`, which returns nothing for a step with no op number — a blank pill reads as an op whose number failed to load, and some steps legitimately have none |
| Machine (model name) | `.machine-pill` | Pill | Colored per **machine** via `--badge-color` (host sets it from `machineColor`/`machineColorFor`, `src/utils/machineColors.js`); default blue. Rendered by the shared `MachinePill.jsx` — see Machine Configuration |

All these classes are defined in `src/index.css` in the "Data-field visual tokens" block.

**OP colours — a pure function of the number, so the cue survives the page change.** `opColor(op)` (`src/utils/opColors.js`) fixes a colour for each op the shop actually runs (49 teal / 50 blue / 60 green / 70 amber / 80 violet — 50 and 60 match the reference the shop drew) and indexes anything else into a 12-entry palette that never reuses a fixed colour, so an unusual op can't impersonate a common one. ⚠️ **Derived from the op number ALONE, never from list position** — the whole value is that OP50 is the same colour on the parts list, the part page, a tool list and Where-Used, and a per-screen index would make it mean nothing. ⚠️ **Distinct HUES, not shades**: two greens a step apart read as the same thing at badge size. ⚠️ **A round op number is divided by ten before indexing** — ops are numbered in tens, so indexing the raw value collapsed them (OP10 and OP90 came out identical); a non-round number (OP55) keeps its full value so two ops inside one decade still separate. A suffixed variant (`OP50R`) is its own step and gets its own colour rather than inheriting its parent's. Locked by `opColors.test.js` + a cross-page render assertion in `partsPages.test.jsx`.

**`--badge-color` pattern (preset)**: this badge is no longer a single flat color. (Holders left this pattern entirely — see `<HolderTag>` above.) The class carries a default `--badge-color` and derives its fill/border/text from it (`color-mix`); each host sets `--badge-color` per instance via an inline style (`style={{ '--badge-color': color }}`). (Holder colour is no longer part of this pattern at all — see `<HolderTag>` above.) For presets the colour comes from `presetMaterialColor(query, materials)` (the material's ISO-group color). Pass `undefined` when there's no color so the CSS default applies. This replaced the old approach where `holderColor` returned a `{bg,border,text}` object overriding all three inline and `.preset-tag` was a flat emerald token.

**`.dia` glyph utility**: the orange diameter symbol. Wrap the `⌀` in `<span className="dia">⌀</span>` everywhere a diameter renders inline (`ToolCard` meta badge, `QueuePanel`, `MatchStep`); the number/units stay neutral. `.dia { color: var(--orange); font-weight: 600 }`.

**Current usages:**
- `.description-badge` — `ToolCard` (grid + list), `ToolDetail` sticky header
- `.tool-id-pill` — `ToolCard`, `ToolDetail` sticky header, `AssemblyCard` operator tag (as `.tag-proshot-oval` — physical tag format exception)
- `<HolderTag>` — `AssemblyCard`, `AssemblyForm`, `HolderPicker`, `PresetPanel` (single-assembly preset card), `ToolDetail` (assembly groups, pending assembly, export picker). `<HolderPill>` (the pure form, no context) is used by the Holders page, which already holds the record
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
- `attachments[]` — array of `{ file_id, filename, type, uploaded_at }`. `type` is one of `photo | spec_sheet | data_extraction | speeds_feeds | model_3d | fusion_file | other` (the display order + group headings live in `TYPE_ORDER`/`TYPE_LABELS`, `FilesSection.jsx`; the picker list in `AttachmentUploadModal.jsx` — keep the two in step). Displayed in the collapsible "Files & Attachments" panel in ToolDetail. **`data_extraction`** is the screenshot/PDF a "Scan spec sheet" run read its values from — see that section; it is also manually selectable for a sheet uploaded by hand.

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

`normalizePreset(p, tscCapable, toolType)` in `src/schema/fusionConvert.js` is the single point that conditions preset fields by tool type — pass `toolType` whenever calling it.

### Spot drill preset carve-out

Confirmed from a real Fusion-exported spot drill: its presets are shaped like a **milling preset for feeds** (`v_f`, `f_z`, `v_f_leadIn`, `v_f_leadOut`, `v_f_ramp`, `v_f_transition`) **plus drill-specific** `v_f_plunge`, `v_f_retract`, `use-feed-per-revolution: false` — but **without** `f_n`, `n_ramp`, `ramp-angle`, `use-stepdown`/`use-stepover`/`stepdown`/`stepover`. Spot drill is the **only** exception to the Hole-making row above; it still has `opType` forced to `null` (it stays in `HOLE_MAKING_TYPES` for **naming** purposes — `composePresetName`, the "ASSEMBLY" section label, and hiding the Operation dropdown / Ramp spindle speed field).

This is implemented with an `isSpotDrill` flag (`toolType === 'spot drill'`), kept distinct from `isDrillFamily`/`isHoleMaking`/`isMilling` in three places:

1. **`normalizePreset`** (`src/schema/fusionConvert.js`) — `isSpotDrill` is excluded from `isDrillFamily`/`isHoleMaking`/`isMilling`. It gets its own output branch writing the full field list above; `f_n` is deleted (not emitted), and the stepdown/stepover/ramp-angle/n_ramp deletions that apply to hole-making tools also apply to spot drill.
2. **`internalToFusionTool`** (`src/schema/fusionConvert.js`) — `isSpotDrillTool` makes the flat-field sync gate `!isHoleMakingTool || isSpotDrillTool` (so `cutting_feedrate`/`feed_per_tooth`/`ramp_feedrate`/`lead_in_feedrate`/`lead_out_feedrate` sync for spot drill same as milling), and the expression-regeneration gates for `tool_feedCutting`/`tool_feedPerTooth`/`tool_feedRamp`/`tool_feedTransition` include `isSpotDrillTool`. `isDrillFamilyTool` (`isHoleMakingTool && !isTapTool`) **stays true** for spot drill, so the 3 drill-specific expression companions (`tool_feedRetract`, `tool_feedPerRevolution`, `tool_feedRetractPerRevolution`) and `tool_feedPlunge` are written exactly as for other drill-family tools.
3. **`PresetPanel.jsx`** — `CollapsedCard` and `EditCard` each compute `isSpotDrill = toolType === 'spot drill'`, exclude it from `isDrillFamily` (so the generic drill-family FEEDRATES section — which would show Feed/Rev — doesn't render), but include it in `isHoleMaking` (so naming/ASSEMBLY/Operation/Ramp-spindle-speed behave like other hole-making tools). It gets its own FEEDRATES section (Cutting, Feed/tooth, Lead-in, Lead-out, Transition, Ramp feedrate, Plunge, Retract). The `EditCard`'s initial `fx` (formula-link state) overrides `v_f_plunge` to `'manual'` for spot drill — `DEFAULT_FX`'s `v_f_plunge: 'formula'` derives it from `f_n`, which doesn't exist for spot drill and would zero out the loaded plunge feed on mount.

The same `HOLE_MAKING_TYPES` guard is applied in **three places**; keep them in sync if the set changes:

### Preset naming for hole-making tools

`composePresetName` is called with `opType: null` for hole-making tools — the name omits the ` - Rough`/` - Finish` suffix. Any legacy preset names with a ` - Rough` suffix on a hole-making tool are **stripped during `normalizeLibrary`** (the `opType` is forced to `null` and the name recomposed without it).

The same `HOLE_MAKING_TYPES` guard is applied in **three places**; keep them in sync if the set changes:
1. `normalizePreset` in `src/schema/fusionConvert.js`
2. `normalizeLibrary` in `src/context/libraryOps.js`
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

**The trap:** a field defaulting to `'formula'` is recomputed from its source on open — so if that source isn't shown/used for the tool type (and is therefore 0), opening the preset **silently zeroes a real value**. `DEFAULT_FX` is the milling convention; other tool types need per-type overrides in `initialFx` (which the draft init must also use — not raw `DEFAULT_FX`).

⚠️ **THE GENERAL RULE — a formula with no input does not produce an answer, it produces ZERO.** The per-type overrides below were each added after a specific tool type was found zeroing a value; the rule that covers all of them is applied LAST in `initialPresetFx` and wins over every override: **a derived value whose SOURCE is missing opens `'manual'` and keeps what it has.** The pair comment in `presetFx.js` used to reason that a Fusion-consistent preset has both sides of a locked pair already equal, making the recompute a no-op — false whenever Fusion stored only ONE side, which is routine (a drill carries `v_f_plunge` and no `f_n` at all). Applies to all three pairs (`v_f_plunge`/`f_n`, `v_f`/`f_z`, `v_c`/`n`), and the **same guard is on the RPM cascade in `handleNumChange`** — without it, changing the spindle speed re-derived plunge from the absent `f_n` and the zeroing came straight back. Measured on the real library: **102 presets** had a real value destroyed on open, now **0**, with the 34 rows that change by more than display rounding byte-identical before and after. Locked by `presetFx.test.js` using the real D-258 numbers.

Current per-type overrides:

- **Milling & spot drill** — plunge has no feed-per-rev (`f_n`) field, so `v_f_plunge:'manual'` (source of truth) + `f_n:'formula'` (derived). Without this, plunge was recomputed from the absent `f_n` (=0) on open **and** on every spindle-speed change, zeroing a proven plunge feed.
- **Turning/boring** — no feed-per-tooth (`f_z`), so `v_f:'manual'` + `v_f_plunge:'manual'`; the `n`/`v_c` cutting- and plunge-feed cascades in `handleNumChange` are skipped (`&& !isTurning`). Otherwise `v_f` was zeroed from `f_z`(=0) on open and on speed changes.
- **Retract feedrate** (`v_f_retract`, drill family + spot drill) — **defaults to the plunge feedrate and follows it** as plunge changes (mirrors Fusion's native `tool_feedRetract = tool_feedPlunge`), a one-directional follower like lead-in/out. A stored retract that already **differs** from plunge is treated as an override → `'manual'` on open so it's preserved; typing in the field overrides it. `setPlunge` cascades retract for the milling/spot-drill plunge fields (which use a plain setter, not `handleNumChange`). Added to `FORMULAS` + `FIELD_PRECISION` (`speedsAndFeedsCalc.js`). Not shown on other tool types (`v_f_retract:'manual'` there).

When adding a feed field or tool type, ask: *does this field's formula source exist for this tool type?* If not, default it `'manual'` in `initialFx` and skip its `n`/`v_c` cascade. These are **UI-only** functions — the round-trip audit doesn't exercise them, so `normalizePreset`/`internalToFusionTool` remain the authority on what's actually written per type.

**The fx logic is extracted to `src/utils/presetFx.js`** (`DEFAULT_FX`, `initialPresetFx(preset, {isMilling,isSpotDrill,isTurning,isDrillFamily})`, `computeFormulaDraft(draft, fx, diameter, numberOfFlutes, metric)`) so the "opening a preset never clobbers an independent stored value" invariant is **test-locked** (`presetFx.test.js`) — every field `initialPresetFx` marks `'manual'` (a follower whose stored value differs from its source) is returned by `computeFormulaDraft` byte-for-byte, incl. a value edited in Fusion then re-opened here.

**Surface speed ↔ RPM is unit-dependent (inch↔mm safety).** `rpmToSFM(rpm, dia, metric)` / `sfmToRPM(sfm, dia, metric)` (`speedsAndFeedsCalc.js`) divide by **12** (inch, ft/min) or **1000** (mm, m/min) — the `v_c↔n` link is the **only** speed/feed relationship that depends on the tool's unit (feed conversions `v_f = f_z·n·flutes` and plunge `= f_n·n` are unit-independent). `EditCard` passes `isMetricTool = (lenUnit === 'mm')` to `computeFormulaDraft` and both `handleNumChange` call sites; `LinkedSlider` swaps the `/12`→`/1000` in the `v_c`/`n` tooltip formula for a metric tool. Omitting the flag makes a mm tool's surface speed off by ~83×. (`SpeedFeedSection.deriveRPM` has its own equivalent unit switch.)

### Unified Preset Editor (`PresetPanel` `EditCard`) — full-width slider UI

The preset editor is a **full-width overlay** (breakout from the ToolDetail column) built from `Section` cards, with sliders in place of bare number inputs. Supporting modules (all pure/testable, mirroring the schema-module pattern): `src/utils/presetFx.js` (fx logic above), `src/schema/camStrategies.js` (toolpath strategy vocabulary), `src/utils/boreCompensation.jsx` (small-bore factor + icon), plus the components `src/components/LinkedSlider.jsx` and the in-file `FactorSlider` / `MRRIndicator` / `SmallBoreSection`.

- **`LinkedSlider`** — the speed/feed input. A slider + numeric box over the **existing `fx` cascade** (it renders `fxState` and calls `onChange`; the math stays in `computeFormulaDraft`/`handleNumChange`). **Soft-max ceiling**: the range grows to fit any value pushed past the default and shrinks back when it fits again (a default, not a hard limit). Ranges are unit-aware — `SLIDER_RANGES` (inch) vs `METRIC_RANGES` (mm), picked by the `metric` prop; feed-per-tooth (`f_z`) defaults to a **0.012 in / 0.3 mm** ceiling. RPM sliders take a `max` override wired to the **linked machine's `max_rpm`** (else the shop default machine's) so the ceiling is real, not a guessed huge number. The **drill-family plunge** slider takes the same override from `drillPlungeMax(metric)` (**40 in/min / 1000 mm/min**): plunge otherwise shares the milling cutting-feed ceiling of 225, which put every drill in the leftmost 3% of the track — measured across the shop's library, drill plunge runs 2–40 in/min (median 6.4) and never exceeds 40, while milling plunge has a median of 50 with 284 of 468 presets above 40, so this is **per-type, not a new global default**. Locked by `drillPlungeRange.test.js`, which reads the real library and asserts 40 would be WRONG for milling. **Re-link control** (`onRelink`/`relinkLabel`): one-directional followers (lead-in/out, transition, ramp RPM) keep the `fx` badge visible even when unlinked — greyed when the value differs from its source; clicking re-links (snaps to source, back to `'formula'`), with a tooltip. Only these followers + ramp RPM get it — bidirectional pairs don't.
- **`FactorSlider`** — stepdown/stepover entered **as a % of a reference dimension** (stepdown % of diameter/LOC, stepover % of diameter) alongside the absolute value; both stay in sync. The stored Fusion value is still the absolute `stepdown`/`stepover` in the tool's unit — the % is a UI convenience.
- **`MRRIndicator`** (results rail) — Material Removal Rate = stepover × stepdown × cutting-feed, all in the tool's unit → `${lenUnit}³/min`. Lives in a **distinct results sidebar** to the right of the builder (periodic-table-style badge; the builder is ~10-15% narrower to make room), reserved for future physics results. Drops below the builder (no box) on narrow screens.
- **Small Bore** (`SmallBoreSection`, inside Feedrates) — a metadata-only bore-compensation helper: enter the actual bore diameter + base feed-per-tooth, it derives a reduced `f_z` via `boreCompensation` (a unitless factor). Small Bore is modeled as **finish + a bore/contour strategy**; the compensation values live in `preset_meta` (`small_bore`, `small_bore_diameter`, `f_z_base`), never folded into the preset name.

### Strategy section — new-format Fusion presets (`camStrategies.js`)

Fusion's newer preset format carries a **`strategies` object** (`{ roughing:[], finishing:[] }` of internal strategy IDs) instead of encoding the operation in the name. `PresetPanel` supports both:

- **Format detection**: `isNewFormatPreset(preset)` (has a `strategies` object). Old presets keep operation in the name + `operation_type` metadata, unchanged. A **Convert** action flips old → new. **New format is the default for all newly-created presets** — blank, ref-seeded, and copied.
- **One bucket per preset**: per the shop, a preset is **either** roughing **or** finishing, never both (`readStrategyBucket` returns the single populated bucket; a Rough/Finish toggle switches). A **dual-bucket** preset that came from Fusion (its picker is a matrix) is **preserved, not silently collapsed** — `writeBucketStrategies(bucket, ids, current, dualBucket)` keeps the other bucket's IDs, and an amber warning surfaces it. Unknown strategy IDs round-trip untouched.
- **Verified IDs only**: every ID in `STRATEGIES` is checked against real Fusion exports (`FUSION TOOL Library REF/NewPresetREF/`) — the 46-ID "ALL MILLING STRATEGIES" reference + the chamfer-tool reference — locked by `camStrategies.test.js`. **No guessed IDs.** Several names map to non-obvious IDs (`Trace`=`path3d`, `Wall`=`inclined_walls`, `Corner`=`rest_finishing`, the Rotary/ModuleWorks multi-axis set) — don't "correct" a name to its ID. `chamfer2d`/`engrave` are chamfer-mill-only (`chamferOnly`); the "Other" group is Fusion's internal/utility tail (hidden from the quick picker but round-tripped).
- **Provenance-aware selection (warn, never wipe)**: the picker tracks `selected` (all chosen IDs) **plus `individualIds`** (the subset chosen individually in the "all strategies" popout, a pinned single, or an **off-group** Fusion pick). A **plain quick-group click switches groups** — replaces the previous group's members but **keeps** the individual IDs (`next = new Set(individualIds)` + the new group's members). **Shift-click combines** groups additively. This protects a user's intentional off-group picks from being wiped by a later group click; changing Rough/Finish/Small-Bore **warns, doesn't block**. **`individualIds` is seeded via `individualStrategyIds(ids)` (`camStrategies.js`), NOT the raw loaded set** — strategies that make up a recognizable quick group are treated as **group-derived** (excluded from `individualIds`), so a **copied preset** whose strategies form a group stays group-switchable (click another group to switch, click the active group to clear); only genuinely off-group picks are sticky. Same rule seeds the dual-bucket `changeBucket`. (Before this, a copy marked every loaded strategy individual, so groups couldn't be switched/cleared without emptying the "all strategies" list by hand.) Strategies are **milling-only** (turning/hole-making have their own vocabularies, out of scope).

### Copy preset as Fusion JSON (`fusionExport.js`)

`copyPresetToClipboard` / `presetToFusionClipboardObject` / `presetToFusionClipboardJson` emit a **single preset** in Fusion's exact right-click-copy clipboard shape (`{ presets:[one], toolType, unit }`), routed through `internalToFusionTool` so every round-trip invariant (expression sync, strategies, app-only field stripping) holds, with keys sorted alphabetically (`sortKeysDeep`) to match Fusion byte-for-byte. Locked by a test against the user's real clipboard sample.

**⚠️ Fusion's in-app "Paste" will NOT accept this copy — and that can't be fixed from a web page.** The JSON content is correct (byte-for-byte), but Fusion (a Qt app) gates its Paste on a **custom clipboard format** it stamps only on its own copy operation, *not* on the text content. Proof: copying a preset out of Fusion, laundering the text through a plain-text editor (VSCode), and copying it back makes Fusion refuse its **own** text once the format tag is gone. A browser can only write the safelisted clipboard MIME types (`text/plain`/`text/html`/`image/png`); Chromium "web custom formats" get a mangled wrapper name native apps don't recognize. Replicating Fusion's stamp would require something **outside** the browser (a helper app, or an extension with native messaging) — out of scope. So the button is labelled **"Copy JSON"** (useful for files/diffs/sharing), not "paste into Fusion." **Real routes to get a new preset onto a tool already in a job** (a job tool with connected toolpaths does **not** sync back to the cloud library): Fusion's library import, or a third-party "replace tool from library" add-in. The limitation + proof is also documented at the `copyForFusion` handler in `PresetPanel.jsx`.

### Tap & thread mill metadata fields

All metadata-only (never written to Fusion) — added to `tool_metadata.json` via `buildMetadataTool` / `mergeFusionAndMetadata`:

- **`tap_sub_type`** (`'cut' | 'form'`, **no default** — stored as `''` when unset) — 2-way chip on the tap page. The view renders "—" when empty; the edit toggle has no pre-selected state. **Never default to `'cut'`** — a form tap imported before this field was set would be mis-labelled. An independent **`is_sti`** boolean (STI/Helicoil thread-insert tap) sits alongside it — a tap can be both an STI tap and a cut or form tap, so this is no longer a 3-way cut/form/sti group. Boolean metadata fields like `is_sti` (and `tsc_capable`) automatically get correct Yes/No facet options — `searchEngine.js`'s boolean-facet handling is generalized to any `type: 'boolean'` registry field, not hardcoded.
- **`point_type`** (`appliesToTypes: ['tap']`) — dropdown: Bottoming / Modified Bottoming / Plug / Taper / Spiral Point / Spiral Flute. **Tap-only** (previously also shown for drill/center drill/spot drill/counter sink — narrowed to taps only).
- **`tip_to_first_thread`** — the Z distance from the tap's tip to where the first full thread starts (chamfer length). `canonicalUnit: 'native'` like other lengths — stored in the tool's own unit, no conversion needed within a tool. ProShop column: `Tip to 1st Full Thread` (export id `tipTo1stFullThread`) — see ProShop Field Priority Rules.
- **Thread mill capability fields** (`appliesToTypes: ['thread mill']`): `tpi_min` / `tpi_max` — the TPI range the mill can cut, distinct from `pitch` (the specific thread designation it's set up for) — and `thread_profile_angle` (degrees).

⚠️ **`thread_pitch` is DERIVED, so it is deliberately NOT in `DRIFT_FIELDS`.** Drift means "someone edited this in Fusion", and a value the app recomputes from the designation on every load cannot be meaningfully edited there. Leaving it in produced a difference that was only ever the derivation not having reached Fusion yet: any metadata-only write (the record backfill, a location import, a preset relink) stores the derived pitch while Fusion still has no `geometry.TP`, so **every tap in the library reported that Fusion had changed it** — and it could not be cleared, because "Keep Fusion" adopts the empty value and the next load derives it straight back. Same shape as the cobalt/hss case in `driftEqual`. Fusion still wins on read for a tool whose designation derives nothing (`mergeFusionAndMetadata`'s `fusionInternal ?? meta`), which is the only case where a Fusion-side pitch is real information. Locked by `threadPitch.test.js`.

### ProShop Thread column parsing (`resolveThreadSize` / `threadKey`)

ProShop exports thread designations without UN-series suffixes and encodes STI/Helicoil as an inline token. The app normalizes both sides so they match:

- **`threadKey(s)`** (`src/schema/threads.js`) — strips `unc`/`unf`/`unef`/`uns`/`un` and whitespace/`#` to produce a comparison key. Used on both sides of any thread match (ProShop import and any future lookup).
- ⚠️ **A METRIC designation is matched by `metricThreadKey`, NOT `threadKey`.** `threadKey` was built for inch: it keeps the separator and the trailing decimal zeros, so `"M6x1"`, `"M6-1.0"`, `"M6X1.00"` and `"M3 x .5"` never matched the list's `"M6 x 1.0"` / `"M3 x 0.5"`. `metricThreadKey` reduces a designation to `m6x1` — diameter, `x`, pitch, trailing decimal zeros trimmed — so every spelling collapses onto one key. ⚠️ A designation with **no pitch** (`"M6 Tap"`) means ISO metric **COARSE** — that is what the omission conveys, not "unknown" — and `METRIC_THREAD_SIZES` is ordered coarse-first per diameter, so the first entry with that diameter is it. The trailing `x` in the prefix match is what keeps `M1` from matching `M12`. All four metric taps in the shop's real ProShop export were previously unmatched.
- ⚠️ **`resolveThreadSize` returns `thread_unit`; the tool field is `tap_thread_unit`.** `psRowToTool` spread the result raw, so a NEW tool from a ProShop metric tap row got the right designation with **no unit** (plus a stray `thread_unit` key that is not a field) — which shows the INCH size list and reads as a hand-typed custom thread. The fill-gap path in `matchProShopToTools` already mapped it correctly; the two must not drift.
- ⚠️ **`threadUnitOf(tool)` is the ONE answer to "which thread list does this tool use?"** — the stored `tap_thread_unit` when set, else **derived from the designation**. A record can legitimately carry a metric `pitch` with no unit (an import that only filled the pitch, a hand-entered tool, anything from before the unit was wired), and defaulting those to inch is what made a correctly-read `M6 x 1.0` fall through to "custom". `ToolFields` uses it for **both** the size list and the Inch/Metric toggle — using it for one and the raw field for the other makes them disagree on screen. Read-time derivation, never a write; an explicit stored value always wins.
- **`resolveThreadSize(raw)`** (`src/schema/threads.js`) — parses a raw ProShop Thread value:
  - Detects and strips `STI` / `Helicoil` tokens → sets `is_sti: true`
  - Detects metric threads (`M<n>` prefix) → sets `thread_unit: 'metric'`
  - Normalizes via `threadKey` and matches against `INCH_THREAD_SIZES` / `METRIC_THREAD_SIZES` to find the canonical list entry (restoring the UNF/UNC suffix we store)
  - Returns `{ pitch, is_sti, thread_unit }` — spread directly onto the tool object
  - Called with `r['Thread'] || r['Pitch'] || ''` (ProShop uses the `Thread` column; some exports use `Pitch`)
- **`flute_design`** (`fieldRegistry.js`) — `appliesToTypes` excludes `tap` (`NO_TAP` constant). Taps don't have a flute design field.
  ⚠️ **`None` is an ANSWER; blank is not.** `blank` = nobody has looked at this tool yet (the default, and what every new or imported tool has); `None` = somebody DID look and the flutes are plain. That turns "we don't know" into a shrinking worklist rather than an ambiguity that never resolves, so the two must never be collapsed in either direction. Nothing may auto-fill `None`: the extraction prompt states it explicitly — return `None` ONLY when a page says the flutes are standard / uniform / equally spaced, and EMPTY when the page is silent, because asserting it from silence destroys the distinction. (Adding `None` to the closed list without that instruction would have had the model return it for every sheet that doesn't discuss flute geometry.) The search facet needed no change — it lists stored values and already skips blanks, so `None` becomes a filter chip and unchecked tools stay out of it. Locked by `extractionDiff.test.js`.
- **`tap_thread_unit`** controls which thread-size list the UI shows (inch or metric). It is **independent of the tool's overall Fusion unit** — the tool's geometry stays in whatever unit it was created in; this field only determines which thread-designation dropdown appears (`INCH_THREAD_SIZES` vs. `METRIC_THREAD_SIZES`). **It must be present in `THREAD_FIELDS`** (`src/schema/toolFieldLayout.js`) — `ThreadBlock` in `ToolFields.jsx` gates the Inch/Metric toggle on `has('tap_thread_unit')`, where `has` checks that list. If it gets dropped from `THREAD_FIELDS` the toggle silently disappears and the metric thread list becomes inaccessible.

-----

## Data Migration / Backwards Compatibility

**Do not write backwards-compatibility code.** The tool library data has not been fully migrated to this app yet, so there is no live data to protect. When a field changes shape or a new field is added, update the code for the new shape only — do not add migration shims, `|| ''` fallbacks for renamed fields, or dual-read logic for old vs. new formats. If existing stored data needs updating, that will be handled as a deliberate one-off migration step, not silently in the app code.

**But ALWAYS notify me when a change is backwards-INCOMPATIBLE with data already on Drive.** I've started entering real data (it's incomplete, so re-entering it is cheap — I'd rather start over than carry migration cruft). So the rule is "don't write compat code," NOT "don't tell me." Before I approve any change that would make existing stored data (`tool_metadata.json`, `shop_settings.json`, `materials.json`, `vendor_registry.json`, `parts.json`, `tool_components.json`, or the Fusion library JSON) fail to load, silently lose values, or render wrong under the new code, **flag it explicitly**: say plainly that it's backwards-incompatible, name which file(s)/field(s) are affected and what breaks, and note whether the fix is "wipe and re-enter" or "a one-off migration." A change is backwards-incompatible when: a field is renamed or removed, a field's type/shape changes (scalar→object, string→array, units, id format), a stored enum/string value's meaning changes, a required field is added with no sensible default for old records, or a default seed replaces (not merges with) an existing file. Adding a brand-new optional field that defaults cleanly is compatible — no flag needed. When in doubt, flag it. Put the notice in your chat reply (and the PR/commit body if there is one); a one-line "⚠️ Backwards-incompatible: …" is enough. Never assume "start over is fine" and skip the notice — that's my call to make, and I can only make it if you tell me.

-----

## Code Standards

- **Pretty-print all JSON written to Google Drive.** Every JSON file persisted to Drive (`tool_metadata.json`, and any future Drive JSON) must be serialized with `JSON.stringify(data, null, 2)` — never compact/single-line. These files need to be human-readable for debugging directly in Drive. All metadata writes route through `driveCreate` / `driveUpdate` in `src/services/driveService.js`, which already do this; keep it that way and apply the same to any new Drive-file write. (This applies to **file content** only — Drive API request bodies like upload metadata or folder-create payloads can stay compact.)

- **Never hardcode field paths outside `fieldRegistry.js`.** New code must reference a field's Fusion path / ProShop column / type / applicability through `FIELD_REGISTRY` (and its helpers) — do not introduce new hardcoded `geometry.*` / `expressions.*` / ProShop-column literals elsewhere. The registry is the single source of truth for field metadata. **Known existing exceptions** (the Fusion converter in `fusionConvert.js`, the ProShop export in `tool-extractor.tsx`/`proShopExport.js`, and `FIELD_VISIBILITY`) predate this rule and are tracked in `docs/SCHEMA_AUDIT.md` (FR1–FR4) for a deliberate, audit-guarded refactor — don't add to them.

- **Never substitute default values for missing fields in descriptions.** `buildDesc` (`src/utils/toolNaming.js`) and any description/name generator must **omit** an absent field, not invent a value — e.g. a tool with no material set must not print `CARB` (don't fall back to `"carbide"`); a missing angle/corner-radius/LOC is left out, not zero-filled. A blank field means "unknown," and the description must not claim otherwise. This holds for **preset** names too: a preset whose material resolves to nothing contributes no material token (there is no `GEN` placeholder any more).

- **`materials.json`, `vendor_registry.json`, `shop_settings.json`** live in the same Drive root as `tool_metadata.json` and are loaded at startup (in parallel, created from their defaults if missing). See **Shared Drive Files** below.

- **ISO material group IDs (P, M, K, N, S, H)** are the canonical material identifiers used in preset color coding (`materials.json`).

- **`vendor_registry.json` uses a single unified entity list** — `is_manufacturer` and `is_vendor` flags determine an entity's role, not separate manufacturer/vendor arrays.

- **Design new data structures with a future SQLite migration in mind.** The app currently stores data in Fusion JSON + Google Drive JSON files, but the data model is intentionally relational. When adding new entities or relationships: use **stable UUIDs** (not positional indexes or derived keys), prefer **normalized shapes** (foreign-key references rather than embedded copies), and keep IDs that a relational table would naturally separate from IDs it would join on. You don't need to over-engineer for SQL — just don't make choices that would require years of untangling to move to a database later. The existing patterns (tracking IDs, assembly UUIDs, `purchasing.manufacturers[]/vendors[]`, location system `zone/station/drawer/bin` UUIDs) are the model to follow. See **TODO / Future Work → SQLite migration** for more context.

-----

## Key Constraints

- **Tool IDs are permanent** — they are the Fusion `guid`, link the two JSON files, and are referenced in merge history. Never reassign them.
- **APS token in memory only** — `window._apsToken`, never localStorage. The refresh token is stored in `sessionStorage` (`aps_refresh_token`) so the session survives page refreshes within the same browser tab.
- **Always re-download before write** — call `downloadFusionList()` immediately before any `uploadFusionList()`.
- **If Fusion has a place for it, Fusion must have it** — every value with a Fusion-native field is mirrored there, always. Metadata may own it and win on read, but the app must never be the only place a Fusion-storable value lives. See the section of that name.
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
- **Orphaned metadata is harmless but permanent** — when a tool is deleted directly from Fusion 360 (outside the app), its `tool_metadata.json` entry persists indefinitely; no prune/cleanup pass exists anywhere. Only `deleteTool` (via the app UI) removes the metadata record. This is safe because `generateTrackingId` (`FTL-` + random 6-hex-digit, ~16.7M values) and `generateId` (random UUID) have effectively zero collision probability — a brand-new tool will never accidentally inherit an old deleted tool's stale metadata. Orphaned entries accumulate silently but cause no functional harm. **Bulk saves must never prune as a side effect** — all metadata writes route through the **`src/services/toolStore.js` repository seam** (`loadAll` / `upsertMany` / `upsertOne` / `deleteById`), never `driveService.*Metadata` directly. `upsertMany` **merges by `id`** into the existing file rather than replacing it with only the records it was handed, so a bulk save can't delete every record not in that set — no-Fusion tools (metadata is their **only** store), conflict tools held back for review, and the dormant orphan metadata the no-Fusion orphan-ghost guard (`isUnlinkedMeta`) relies on persisting. Deletion is exclusively `deleteTool`'s job (`deleteById`). The seam is also the single swap point for the planned SQLite backend.
- **Missing/trashed metadata file is surfaced, not silent** — a deleted metadata file 404s, and a **trashed** file still reads and writes through the Drive API, so the app would otherwise keep saving notes/tags/photos into a file sitting in the trash (and a 404 looks identical to "no metadata"). `getMetadataFileHealth()` (`driveService.js`) checks the linked file's `trashed` flag + existence on every `loadTools`; the result drives `state.metadataFileWarning` (`null | 'missing' | 'trashed'`) and a red `MetadataFileBanner` (`App.jsx`) pointing the user to Settings to relink/recreate. The check is best-effort (an inconclusive error reports healthy — never a false alarm), and **moving** a file within Drive keeps its ID, so it still loads and correctly raises no warning. **Tool file attachments live under the metadata file's parent** (`tool_files/{trackingId}/` via `ensureToolFolder`/`getMetaParentFolderId`), so if the metadata file is deleted/recreated elsewhere, previously-imported photos stay in the old parent's `tool_files` folder — re-running the import re-copies + relinks them against the current file.

-----

## TODO / Future Work

- **✅ First-class holder library (built).** See **Holder Management System** + **Holder identity** above. The app owns `holder_library.json`; identity is `holder_ref` + a segment match (never Fusion's guid); assemblies carry a real `holder_id` FK; **Link tools to holders** matches every tool's baked copy and corrects Fusion in the same commit; **Push to Fusion** settles the holder library itself.

- **⚠️ TODO — what Fusion does when you DUPLICATE a holder (needs a real sample).** Duplicating a holder in Fusion copies everything user-visible — **including `product-id`, which is where the app's `holder_ref` lives**. So a copy arrives wearing the original's ID, and once it's edited (the usual reason to duplicate one) its shape differs too. Fusion's handling of the **guid** is unknown and must not be relied on either way. **Detection is built** (`isFusionSideCopy`, `holderIdentity.js`): if some OTHER entry in the same library matches that record on **both** signals, the record is already accounted for and this entry cannot be it — so it's a copy, not the known holder having moved. Order-independent, and a genuine single-entry Fusion edit still reads `ref-only`. The push flags it as **`fusion-copy`** with an accurate reason and writes nothing to it. **What is NOT decided** is the resolution, because it depends on facts not yet observed:
  - Does Fusion copy `product-id` verbatim, blank it, or suffix it? Does it mint a new guid, reuse one, or leave it empty?
  - Should the copy be **importable as a new record**? `importHoldersFromFusion` currently skips anything that isn't `none`, so today there is no route — the user is told it's a copy and left to fix it in Fusion.
  - If imported, the entry then carries the OLD ref with the NEW record's shape → reads `conflict` and stays flagged forever unless the push is allowed to **re-stamp its `product-id`** to the new record's ref. That is provably safe (its shape matches exactly one record, its ref belongs to a record matched elsewhere) but is a third interacting rule and should not be designed blind.
  - The `duplicate-entry` path already covers "duplicated but NOT edited" (both entries `exact` → first written, rest flagged), and the `adopt` path covers "product-id cleared and not edited".
  **To investigate:** a holder library exported after duplicating one holder in Fusion, editing the copy, and duplicating another without editing. Compare `product-id`, `guid`, `reference_guid` and `last_modified` on all four entries.

- **⚠️ TODO — turning tools hold differently, and are EXCLUDED from holder linking for now.** A `turning general` entry carries **no holder object at all** in Fusion (verified across the reference library: zero segments, no description), so `proposeHolderLink` can only ever answer *"nothing to match on"* — every lathe tool would sit permanently in "need a look", a worklist row that cannot be cleared. `HOLDER_LINK_SKIP_TYPES` (`src/utils/holderLink.js`) therefore skips them; `buildHolderLinkPlan` returns them as **`skipped`** so `LinkToolsModal` **says** they were left out rather than silently showing a smaller number, and the `holdersLinked` setup warning excludes them so it can still reach zero. **`boring head` is deliberately NOT excluded** — despite being grouped with turning for *preset* purposes, it mounts in an ordinary taper holder and its Fusion entry carries a full 11-segment holder. **What's actually wanted** (the reason this is a TODO and not a permanent carve-out): a lathe assembly has a **machine-side tapered holder** the shop wants to record, and **neither Fusion nor ProShop can represent it** — so the app is the only place it can live. That means turning needs its own holder story rather than a share of the milling one: likely a holder record whose "segments" describe the turret/taper interface, an assembly link that doesn't depend on a baked Fusion copy (there is none to read), and no push path (Fusion has nowhere to put it). Locked by `holderLink.test.js` against the real export so the exclusion can't quietly drift into an assumption.

- **Holder locations → the Location System (deferred, deliberately).** A holder's `location` is free text today; the shop's holders are on a shelf and easy to find, so this is a want-not-need (see **Holders and the rest of the app — decided, not overlooked**). Doing it properly means a **separate holder location system**: the existing `location_config.systems[]` is tool-scoped (bins, ProShop export rules, tool-bin collision checks), so it needs a per-system scope flag, a structured `holder_location` on the record (sitting alongside the free-text `location` exactly as `tool_location` does for tools), read-time resolution, and the picker taught to count holder bins. Additive when it happens — nothing today blocks it. **Also still deferred:** machine-taper filtering for assemblies, swapping `HolderPill` in at every existing call site, fully deriving a holder's segments from its parts rather than storing both, and a configurable holder-ID system (explicitly NOT to be built speculatively — see the same section).


- **Retire `selected_holder_guid` in favour of a `holder_id` FK (low priority — currently DORMANT).** The pre-assemblies way of saying "this tool uses this holder": a **Fusion holder guid** on the tool record. Now used only as a **fallback for a tool with no assembly yet** — it seeds the new assembly's holder (`logicalTools.js` `splitToFusionInstances`, `toolActions.js`, `libraryOps.js`) and picks the holder for an export when no assembly is selected (`fusionExport.js`). Once a tool has an assembly, the assembly's own holder wins and this field is never read.
  ⚠️ **The problem is what it stores.** A Fusion holder guid is not an identity — Fusion re-issues them, which is the premise of the entire Holder Management System (see **Holder identity**). So a stored value can silently come to point at a *different* holder, exactly the failure already observed on `NBT30-SK13C-120`. The modern equivalent is the assembly's **`holder_id`** (a stable app-owned id, resolved FK-first by `resolveHolderForWrite`).
  **Not urgent, and measured:** **0 of 268** records in the real library carry one, so nothing is wrong today and there is nothing to migrate. The fix when it's worth doing: add a `selected_holder_id` alongside it, resolve it FK-first (mirroring `resolveHolderForWrite`), backfill from the guid at load via `matchFusionHolder`, and drop the guid to a hint. Surfaced by the `LINK_SHAPED_KEYS` coverage guard in `relationalIntegrity.test.js` — it was a live relationship missing from the inventory table entirely, which is precisely what that guard exists to catch.

- **Populate `preset.assembly_id` — DEFERRED, and NOT with the current logic (owner's call).** The FK exists and is the right shape; it is mostly just unpopulated. Measured on the real library: **55 of 335** presets carry a stored `preset_meta.assembly_id`, the load-time `backfillPresetAssemblyLinks` name-match seeds **18 more (73)**, and **262 remain unlinked** and resolve by parsing the holder token + OOH out of the preset name at read time. Split by difficulty: **166** sit on tools with exactly ONE assembly (no decision to make — one candidate) and **96** sit on the 58 tools with 2+ assemblies. Of those 96, **zero** can be disambiguated by the OOH in their name, so their names genuinely do not say which assembly they belong to.
  ⚠️ **Do NOT mass-backfill from the name match, including the "easy" 166.** The owner has a **more accurate linking method in mind** (not yet specified here — ask, don't infer) and does not trust the current name-based logic enough to bake its answers into stored FKs. Writing them down now would convert a soft read-time guess into a hard stored link and quietly launder a guess into the standard — the exact failure the **Relational integrity** rules exist to prevent. The value of this work arrives **later, with real job data**, which will say which assembly a preset was actually proven on; there is little value in reconstructing it from old, half-conventional names.
  **Consequences to be aware of while it stays deferred**: `assembly.linked_preset_guids` is recomputed from the FK on every write, so it holds only **24 entries across 303 assemblies** — anything reading the reverse index directly (rather than resolving through the FK) sees almost nothing. And `updateAssembly` re-derives preset names for presets it believes are linked, so on a **multi-assembly** tool a name-matched preset can still silently orphan when its OOH or holder is edited. Neither is currently causing visible harm; both get better on their own as tools are saved.

- **Suggest adding a manufacturer/vendor to the registry (NOT built — parked, nice-to-have).** A scanned sheet naming a maker the registry doesn't know currently just stores free text: it gets no `registry_id`, no URL pattern, and no alias resolution, so it can never be mass-updated. `buildPurchasingProposals` already returns **`newManufacturer`** (the unmatched name) and `ExtractUpdateModal` already passes it through — nothing consumes it. What's missing: a **fuzzy near-match** suggester ("did you mean *Helical Solutions*?" — `entityByName` matches canonical names and aliases exactly, nothing looser), and a small UI offering the two genuinely different answers — **add as an alias** of an existing entity (the `GARR` / `GARR Tool` case, which is most of them) vs. **create a new entity**. Both write `vendor_registry.json`, a path `ToolForm` now has (`savePatternRows`). ⚠️ The alias-vs-entity choice is the whole design question and must stay the user's: getting it wrong either merges two real manufacturers or splits one into two, and an entity created by mistake is then a permanent second spelling. Deliberately deferred with the URL-pattern learning shipped first — that half is deterministic and self-verifying, this half is a judgement call.

- **Self-healing audit (not yet done).** The **Self-healing** philosophy section above was written *after* most of the mechanisms it describes, so it documents the pattern rather than verifying it holds everywhere. Worth one deliberate pass: (1) **coverage** — every derived/linked value that could go stale actually has a repair or a flag (candidates not yet reviewed: `material_suitability` free text, `tags`, `coating`/`pitch` fill-gap fields, holder library links, `speed_feed_refs.preset_id` dangling ids, `preset_meta.operation_ids` dangling after an operation delete); (2) **no nag loops** — for each existing flag, confirm the fix action clears the detector (walk `ConflictBanner`, `DriftBanner`, `MergeSiblingBanner`, the duplicate-preset banner, `MaterialLinkBanner`, `_productIdConflict`); (3) **load cost** — the silent repairs are all in-memory, but they're now a stack of full-library passes (`combineToolsByToolId` → `derivePairings` → 4 × backfill…), so confirm they're still cheap at real library size and consider folding them into one walk; (4) **noise calibration** — how many tools actually surface a flag against the real library, and whether any flag fires so broadly it becomes wallpaper (`MaterialLinkBanner` on legacy `"AL FIN"` strings is the likely candidate).

- **Reach & undercut, Phase 2 — the segments themselves.** Phase 1 shipped the metadata fields + the load-time derivation (see **Reach & undercut**); `shaft.segments[]` already round-trips untouched, so everything below is additive. Open items, roughly in order of value:
  - **Two tools whose instances DISAGREE on the shaft profile** — `.062 BULL .01R .093 LOC 3 FL` (one instance has the .657 neck, the other does not) and `A-37 7/64 Endmill .327LOC 4 Flute` (.1 vs .15). Instances differ only by holder and OOH, so these are Fusion-side drift. The app deliberately does NOT resolve them on its own (see the save rule above); opening either tool's profile and saving once picks the right answer deliberately.
  - **Segment editing UI refinement** — the table works; inserting a segment at a chosen position (rather than appending), and the drag/hover polish the holder module's `SegmentTable` has, are still to come.
  - **A tool that recorded its reach in `shoulder_length`** — the shop's pre-field convention, which this replaces. Only one is at risk: `1mm (.039") Ball 3FL EM .059LOC 7x Reach` (SL .2805, MIN OOH .41), since `normalizeLibrary` sets `shoulder_length = min_ooh` only where a MIN OOH exists. Type its reach in before the next normalize; no rescue code — the field is the replacement.
  - **Extracting reach from a spec sheet.** Manufacturers publish it; the proposal machinery (`extractionDiff.js`) would carry it with no new plumbing beyond the prompt and `EXTRACTED_KEYS`.
  - **"12x Reach" as a multiple of diameter.** Two real descriptions use it (`.02 BALL 3FL .03LOC 12x Reach` = 12.5×). Not built — the absolute value is what the field stores, and a multiple is a display choice, not a second number.

- **Slot/key cutter (slitting saw) — verify corner-radius output to Fusion + terminology.** Two related open items from the key-cutter work: **(1)** `corner_radius` (`geometry.RE`) now *applies* to `slot/key cutter` (field registry `appliesToTypes`, extractor `FIELD_VISIBILITY` cornerRadius row, and the search facet), but we have **not confirmed how Fusion actually wants a slitting-saw/key-cutter corner radius written** — real Fusion exports for this type carry a distinct `tool_kerfWidth` field (see the FUSION_HDR reference list), and it's unclear whether the radius belongs in `RE`, in a kerf-specific field, or both. **The user will provide a real Fusion export example later** — audit `internalToFusionTool` for this type against it before trusting the `RE` write (mirror the chamfer-mill / tapered-mill per-type geometry-field audits). **(2)** "Slitting saw" is the shop's other word for this tool class — today it's folded into the single `slot/key cutter` type (UI labels flute length as "Flute Length (Kerf)" and shoulder length derives from flute length in `normalizeLibrary`). Revisit whether **slitting saw should be its own distinct `tool_type`** (own icon/filing/kerf semantics) rather than an alias — a bigger change to `TOOL_TYPES`, icons, `AUTO_GROUP`/ProShop mapping, and `FIELD_VISIBILITY`. Both deferred until the example arrives.

- **✅ Field-scoped Fusion push (built).** See **Pushing ONE field to Fusion** under the Location System. `pushFieldToFusion` + `FUSION_FIELD_PATCHERS` (`libraryOps.js`) patch a single native+expression pair in place; location is the first caller. Add a patcher entry rather than a bespoke push for the next field.

- **Components vs tools — the remaining holes (audited, deliberately not yet closed).** Per the rule at the head of **Insert-Style Tools**, a component is a tool everywhere except Fusion and ProShop. The **location** side is now fully pooled (picker, issues panel, normalize, ProShop location import, gap/duplicate/outlier detection, `nextBin`). **Search is done** — `componentTextIndex(tools, components)` folds each component's `tool_id`/description/designation/location/notes into the searchable text of the insert tool that pairs it, so typing `G-223` surfaces that face mill; `matchedComponent` tells the card to show `part G-223` so the hit doesn't look unrelated (mirrors `matchedLegacyId`). A component is deliberately NOT its own result — it has no page, so a standalone card would lead nowhere. ⚠️ Corollary: a component **not yet linked to a pairing** is still unfindable; it has no tool to surface through. ⚠️ **Before extending the Tool ID system to components, settle the MODEL first — the numbering follows from it, not the other way round.** How many real things is an insert tool? For a **face mill / turning tool** the answer is clearly two (a body and an insert, each its own ProShop row); the "tool" is just those two used together, so it needs no number of its own and its Fusion id is the pair. An **insert end mill** may not be the same shape: its cutting half is deliberately filed in ProShop as an ordinary end mill (`A-123`) so search finds it, which reads as *the tool itself*, with the arbor (`I-124`) as a component it mounts on — i.e. a tool + a component, not two components. The app currently models both cases the same way (a pairing of two components, the pairing having no id of its own). That may be wrong for the second case, and deciding it while looking at real tools is worth more than deciding it in the abstract. Deferred deliberately — the shop is not renumbering soon.

One known gap remains: **the Tool ID actions** — `assignToolIds` / `renumberAllToolIds` / `duplicateIdClusters` walk tools only, so components keep their ProShop numbers when the shop switches ID scheme, and a `tool_id` collision **between** a tool and a component is not detected. Closing (2) needs a decision first: a component's `tool_id` IS its ProShop number, so re-numbering it is a real-world change to purchasing data, not just an app relabel — confirm the shop wants that before building it. It follows the same fix shape as the location work: take `records`, write the components file alongside the metadata file.

- **Location System ↔ Tool ID — refine the seam (working, but rough).** The current split is: the Location System *finds + assigns location data only* (never writes `tool_id`), and the Tool ID System's explicit **Assign IDs / Re-number** actions are the only thing that generates IDs (deriving from the structured `tool_location` when in `location` mode). This is wired and documented (see "Location ≠ ID" under Tool ID System) and the separation is surfaced via banners/tooltips — but it's **confusing and lacks refinement**, and the Location System is **unfinished**. Known rough edges to revisit: (1) a location-system **bin-renumber** action (the system's own future "renumber" ability — assign/reassign bin numbers in bulk, distinct from Tool ID renumber); (2) in `location` mode, after assigning/normalizing a location the tool's `tool_id` is **stale until the user manually re-numbers** — there's no prompt or "IDs out of date" indicator nudging them to do it, so the two-step flow is easy to miss; (3) the metadata-only normalization write leaves Fusion out of sync until each tool's next individual save — the **vendor/location** half is now handled (`pushFieldToFusion` + the **Fusion sync** block in `LocationIssuesPanel`, and the writes say so explicitly), but **`product-id` is still lazy and still unmentioned to the user**; closing it should be a second `FUSION_FIELD_PATCHERS` entry (`product-id` ↔ `expressions.tool_productId` is the same native+expression pair shape as location), not a bespoke push; (4) the whole flow (configure system → assign/normalize locations → go elsewhere to generate IDs) could likely be made a single guided path. Not yet tested end-to-end against real data. Revisit holistically rather than patching piecemeal — the goal is one clear, refined Location→ID workflow, not more notes bolted on.

- **Speeds & Feeds Reference — link to stepdown/stepover as a %.** Each tool carries `speed_feed_refs[]` (metadata-only: `{ preset_id → materials.presets, operation_type (rough/finish/… or null), sfm, chip_load }`) — a per-CAM-preset + per-operation SFM + chip-load starting-point table, edited in `SpeedFeedSection.jsx` (a panel in ToolDetail's left column, same save pattern as `PurchasingSection`). The material cell opens the shared **`CamPresetPicker`** modal (search "6061"/"1018" → its CAM preset), the operation is an `OP_TYPES` dropdown, and the Save button shows a `.spinner` while the `writeLogicalTool` round-trip is in flight (it's a local `saving` state, not the global `isSaving`). The section shows derived RPM + feed per row using the tool's own diameter + flute count (`deriveRPM`, generic over the tool's unit; feed via chip_load × rpm × flutes). **Next step (deferred):** express stepdown/stepover as a % (e.g. of diameter) and connect them so the reference drives full proven preset values rather than just SFM/chip-load — the user explicitly scoped this for later. These values are a manual starting point today; a future path could also pull from existing Fusion presets.

- **Scan a manufacturer speeds & feeds chart into `speed_feed_refs[]` (planned).** The same scrape → propose → accept → keep-the-source workflow as **Spec-Sheet Extraction onto an EXISTING tool**, pointed at the speeds & feeds reference instead of the tool's own fields. Metadata-only (`speed_feed_refs[]`), so it never touches Fusion, a preset, or a preset's values — this fills the **recommendation** table the user works from, not a preset. Three things make it harder than it looks, and each has an existing answer worth reusing rather than re-inventing:
  - **Which row is THIS tool's?** Manufacturers publish one chart for a whole series (every diameter, every LOC). Picking the row for this tool's diameter/flute count is the genuinely new problem and is a prompt/vision job, not a code one. It must be **shown, not assumed** — the proposal should say which row it read.
  - **Manufacturer material → our CAM preset.** ⚠️ Do NOT ask the model to guess our CAM preset names. The app already resolves a foreign material string through a tested cascade — `camPresetIdFromGrade` → `findMaterialInLibrary` → `suggestCamPresetName`, with `CamPresetPicker` for the user-confirmed remainder (see **Material comes from the Materials library**). Have the model return the manufacturer's own material designation verbatim and run it through that, so an unmatched material is **surfaced, not guessed** — the same rule `MaterialLinkBanner` already follows.
  - **Units.** A chart may be SFM/IPT or m/min/mm-per-tooth. ⚠️ Surface speed is the ONE unit-dependent relation (`rpmToSFM`/`sfmToRPM` divide by 12 vs 1000) — omit the flag and a metric chart is off by ~83×. Chip load is a length in the tool's own unit.
  
  **On reuse — deliberately NOT generalized yet.** The tempting piece (`buildFieldProposals`) is the one that won't fit: a speeds & feeds reference is an ARRAY of rows keyed by (CAM preset × operation), so its diff is row-shaped and closer to `buildPurchasingProposals` (match / add / update by key) than to the scalar field diff. What is likely to be worth extracting **when the second case exists, not before**: (1) `runExtraction` taking a prompt + response shape rather than owning one, and (2) the proposal UI — `ProposalStrip`, the pending/accepted/rejected statuses, the summary bar, and the discard-restores-everything rule — which is currently welded to `ToolFields`/`ToolForm`. (3) The `data_extraction` attach-after-save hook transfers as-is. Two use cases is the point at which the seam is knowable; guessing it from one would likely put it in the wrong place.

- **Local mode, phase 2 — full edit with manual re-export.** Today's local browse mode (see above) is read-only. A bigger follow-up: allow editing/saving everything in-memory while in local mode (tools, presets, assemblies, metadata), plus a "Download updated library" button that produces a new `fusion_tool_library.json` (and `tool_metadata.json` if applicable) for the user to manually re-upload to Autodesk/Drive themselves. **This is a big ask** — `writeLogicalTool`, `saveFullLibrary`, `renumberLibrary`, `deleteTool`, `addTool`, `normalizeLibrary`, and the whole Phase 2 merge flow all currently assume `uploadFusionList`/`downloadFusionList` hit APS; each would need a local-mode branch that mutates `toolsRef`/state in place and marks the library "dirty" instead of calling APS, plus export/download plumbing for the edited JSON. Confirm scope before starting.

- **Universal Change Log / Audit Trail (future — big feature, owner-requested).** Capture every change + event (fields changed old→new, adds, deletes, who, when) across all pages, viewable both in-context (per tool / per settings page / per vendor / etc.) and as one category-filterable global feed in Settings. Fusion-pushed changes log actor `"Fusion"`. Partially exists today (`merge_history` is tool + merge only) and is **not fully working** as a general log. **Capture point is the repository seam** (`toolStore` for metadata, `saveSharedFile` for shared files — both now central) + the `updated_by`/drift machinery. Sequence with/after SQLite (append-only `audit_log` table); building it on whole-file JSON would rewrite a growing log on every edit and lose concurrent entries. Full design notes + open questions in **`docs/DECOUPLING_FOLLOWUP_FINDINGS.md`** (Future feature section). Also noted there: a set of currently-silent behaviors (load-time auto-combine, backfills, drift adoption) worth surfacing to the user as toasts — the in-the-moment complement to the durable log.

- **Multi-device concurrent-edit guard (future, decided: block-on-conflict).** Stamp the metadata file's Drive `modifiedTime` at load; on save, if it changed, **block the write and tell the user why** ("Someone else saved since you loaded — reload, then retry") rather than clobbering. Implement in the `toolStore` seam. See `docs/DECOUPLING_FOLLOWUP_FINDINGS.md` suggestion #4.

- **SQLite migration (future).** The current storage layer (Fusion JSON in APS + `tool_metadata.json` on Drive) works for the shop's scale, but several data structures were deliberately designed with a future SQLite backend in mind: stable UUIDs at every entity level (`tracking_id` FTL-XXXXXX, assembly `assembly_id`, vendor/material/machine `id`s, location system `zone.id`/`station.id`/`drawer.id`/`bin.id`), normalized relational shapes (`purchasing.manufacturers[]` / `purchasing.vendors[]`, `assemblies[]` with a foreign-key `instance_guid`, `preset_meta` keyed by GUID, `speed_feed_refs` with a `preset_id` FK), and parent-id chains in the location hierarchy. The **Relational integrity** section above is the standing audit surface — keep its inventory current, and when adding new data structures: prefer stable UUIDs over positional indexes, avoid denormalized blobs when a normalized join table would be cleaner, and don't collapse IDs that a relational row would naturally separate. The goal is that a future migration produces clean tables, not a years-long untangling.

- **✅ "No Fusion Link" tools no longer need a Fusion entry (built — Fusion-decoupling Phase A/B).** `no_fusion_link: true` is now a real state, not just a reminder flag: a marked tool is built from metadata alone (`buildUnlinkedTool` / `materializeUnlinkedTools`, `src/schema/logicalTools.js`), `writeLogicalTool` early-branches to a **metadata-only write** (no Fusion round-trip, `library_id` null), and `saveFullLibrary` **partitions** no-Fusion tools out of the Fusion write — so a ProShop unmatched row no longer mints a placeholder Fusion entry. Tools can also be promoted into Fusion (`promoteToolToFusion`) or detached from it (`detachToolFromFusion`), and the whole Fusion integration can be turned off after setup (`integrations.fusion.enabled`). Drift between the app record and a live Fusion entry is always surfaced (never silently overwritten) at both load time (`DriftBanner` / `detectFusionDrift`) and write time (the 3-way merges' `conflicts` accumulator → warning toast + `_drift`). The complete-record schema + ownership taxonomy + design decisions (D1/D2/D3) live in **`docs/PHASE_A_TOOL_RECORD_SCHEMA.md`**; the audit that scoped it is **`docs/FUSION_DECOUPLING_AUDIT.md`**. **Mode-2 load (B6) is also built:** `loadTools` is two-stage — **stage 1 paints the whole library from the app's own complete metadata records immediately** (`isCompleteRecord` → `buildUnlinkedTool` → `LOAD_PROVISIONAL`), then the unchanged Fusion build confirms and replaces it (`LOAD_SUCCESS`, which alone sets `fusionReady`). Until `fusionReady`, `writeLogicalTool` (linked path), `saveFullLibrary`, and reconcile-on-open refuse with a "still syncing" message — provisional tools have no `_instancesRaw` merge base, so linked writes must never run against them (demo/local/fusion-disabled set the flag true; their own guards message correctly). A **one-time backfill** after stage 2 (`recordsNeedingBackfill` → `toolStore.upsertMany`) completes any missing/overlay-shaped records — keyed off BUILT tools so orphan metadata stays dormant. Fidelity is locked by `src/schema/completeRecord.test.js` (Fusion build → `buildMetadataTool` → `buildUnlinkedTool` reproduces scalars/presets/assemblies/flat mirror). **Still deferred:** the never-connect-Autodesk onboarding gate (B4b-2 — the `App.jsx` AppShell library-requirement relaxation) and the SQLite storage swap.

- **Insert-tool ProShop import → don't create a Fusion-only placeholder for a component number.** When the insert-tool ProShop wiring lands (Step 2b — route a ProShop row whose `Tool #` matches one side of a combined `holder/insert` product-id to a **component** record instead of a tool), a component row must NOT fall through to `psRowToTool` and mint a standalone placeholder tool in the Fusion library (a holder-only / insert-only entry Fusion should never have — the whole reason components are a separate metadata-only store). Short-term 2b handles this by intercepting component-number rows before the placeholder path. The "logical record with zero Fusion instances" support this depended on is now **built** (see the no-Fusion-link bullet above — `no_fusion_link` + `saveFullLibrary` partitioning), so the general placeholder-minting concern is resolved; keep the Step-2b intercept tight regardless so no component row leaks into `saveFullLibrary`.
