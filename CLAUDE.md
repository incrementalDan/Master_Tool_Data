# Fusion Tool Library Manager

## Project Overview

A web application for managing a CNC cutting tool library. It replaces a fragmented, manual workflow where tools are pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The Fusion tool library JSON lives in Autodesk cloud (BIM 360 / ACC) and is accessed via the Autodesk Platform Services (APS) Data Management API. Tool metadata that Fusion doesn't support (notes, tags, ProShop ID, preferred machine, assemblies, etc.) is stored in a separate `tool_metadata.json` on Google Drive. The app acts as the single source of truth across both files.

This module is also the foundation of a future in-house ERP system. ProShop will continue to be used for inventory and purchasing in the interim, so ProShop import/export must always be maintained.

-----

## Logical Tools & Instances (multi-instance model)

A **logical tool** maps to **N Fusion library entries ("instances")** — one instance per **assembly** (holder + OOH). Every instance is a real Fusion tool entry; all instances of a logical tool are identical **except** their holder and OOH (`geometry.LB`). This keeps proven setup knowledge (which holder/stick-out a preset was proven on) living natively in the Fusion library, not just in app metadata.

- **Family key**: an app-generated **tracking ID** (`FTL-XXXXXX`) written into Fusion's native comment (`post-process.comment`, mirrored in `expressions.tool_comment`). All instances of one logical tool share it. The library is grouped strictly by tracking ID on load (`groupByTrackingId`). `familySignature` (proshot_id + tool_type + diameter ±0.0001) is used only to validate a group and to match incoming job tools — never to merge two different guids.
- **Shared vs per-instance**: editing any shared field (description, geometry except LB, vendor, proshot_id, presets, tags, notes, machine number, …) propagates to **all** instances. Only **holder** and **OOH** are per-instance.
- **Machine tool number** is shared across all instances of a logical tool.
- **Presets** are a single shared set replicated identically onto every instance. Each preset's name encodes its assembly + operation (see below), so opening any instance in Fusion shows the full proven-preset set.
- **In-memory shape**: `id` (= `tracking_id`), `tracking_id`, `assemblies[]` (`{ assembly_id, instance_guid, holder_guid, holder_description, ooh, notes, source }`), shared `presets[]` (each with `operation_type`), `machine_tool_number`, and `_instancesRaw[]` (raw Fusion entries).
- **Write path**: `AppContext.writeLogicalTool()` reconciles in one library write — re-download, drop every entry whose tracking ID matches, append the freshly split instance set (`splitToFusionInstances`). It backs `saveTool`/`addTool`/`mergeTool`, the assembly CRUD (`addAssembly`/`updateAssembly`/`deleteAssembly` = create/edit/remove an instance), and `applyReconcile` (adopt/drop strays found on open — see Sync & Merge Workflows). `deleteTool` removes all instances; a tool must keep ≥1 assembly. `renumberLibrary` assigns one number per logical tool.
- **Transition**: `normalizeLibrary()` (one-time, surfaced via the `needsNormalize` banner) assigns tracking IDs to pre-migration tools, fans each out into instances per its existing metadata assemblies, and renames presets to the convention. Back up library + metadata first.

### Preset naming convention

`<MaterialCode> <OOH> <HolderShort> - <Operation>` — e.g. `SS 2.125 30-SK13-60 - Rough`. The name is the **durable source of truth** for the preset's assembly + operation. Helpers in `src/utils/presetNaming.js`: `composePresetName`, `parsePresetName`, `presetMatchesAssembly` (links a preset to an assembly by parsed holder short name + OOH within 0.0005"), `OP_TYPES`/`opTypeWord`/`matchOpType`. Holder short names (strip `NBT`, drop the `C` after `SK<n>`, + override map) come from `src/utils/holderNaming.js`. `operation_type` is stored on the in-memory preset and cached in metadata (`preset_meta`), but is **never written into the Fusion JSON** (Fusion validates strictly) — it lives in the name. On import, operation_type is parsed from the name; the name wins on conflict.

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

### Preset formula expressions — do not regenerate

Fusion's default presets store `tool_feedPlunge`, `tool_feedRamp`, and `tool_feedTransition` as **formula expressions** that reference other fields (e.g. `"tool_feedCutting/3"`, `"tool_feedPlunge"`, `"tool_feedCutting"`). If you overwrite them with literal numeric strings you break the dynamic links, and the values change every round-trip.

**Rule**: `internalToFusionTool` only regenerates `tool_spindleSpeed`, `tool_surfaceSpeed`, `tool_feedCutting`, and `tool_feedPerTooth`. It explicitly does **not** regenerate `tool_feedPlunge`, `tool_feedRamp`, or `tool_feedTransition` — those are preserved from `origExprs` (the raw Fusion preset's original expressions block). Do not add them back.

### Valid Fusion coolant values

The only values Fusion accepts for `tool-coolant` are: `"flood"`, `"tool"` (TSC / through-spindle), `"disabled"`, `"air"`, `"flood tool"` (flood + TSC combined). **Not** `"through tool"`, **not** `"flood and through tool"`.

- Default for TSC-capable tools (`tsc_capable: true`): `"tool"`
- Default for non-TSC tools: `"flood"`
- `normalizePreset` remaps any stored `"flood and through tool"` → `"flood tool"` on every write

### Geometry field minimalism

Only write geometry fields that the tool actually uses. `internalToFusionTool` writes the core set (`CSP`, `DC`, `HAND`, `LCF`, `NOF`, `OAL`, `SFDM`, `shoulder-diameter`, `shoulder-length`) unconditionally, and writes `RE`, `TA`, `tip-diameter` **only when non-zero** (or when the original Fusion entry already had a non-zero value — to support clearing). The fields `NT`, `TP`, `thread-profile-angle`, `tip-length`, `tip-offset` are **never written explicitly** — they are preserved from `...existing` if the original Fusion entry had them, and are absent for tools that never had them. Injecting these as constant defaults adds unexpected fields that differ between tools and bloat the diff.

### Holder gaugeLength — always from the library

`buildHolderObject(holderEntry)` in `splitToFusionInstances` is always called with the live holder library entry — **never preserve `gaugeLength` from the existing Fusion tool's `raw.holder`**. Preserving from a previous write perpetuates stale values from older bad writes.

**Gauge length is expression-derived, not just trusted.** Fusion's `expressions.tool_holderGaugeLength` sums the heights of the segments **below the gauge line**; segments absent from it are "above the gauge line" (inside the spindle) and excluded. `sumGaugeSegments` parses that expression and sums the named segment heights — mapping each Fusion segment number to its JSON array index via `jsonIndex = S − fusionNumber` (the `segments` array is stored bottom-first, the opposite of Fusion's top-down numbering). `buildHolderObject` **prefers this computed sum** (in the holder's native unit) over the stored `gaugeLength`, which corrects stale/wrong stored values left by older writes; it **falls back** to the stored value only when there's no usable expression (e.g. embedded holders that lack one). `computeGaugeLength(holder)` returns the same value in inches; `buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount = 1)` builds the expression — **never hardcode an above-gauge-line count other than 1** without parsing the existing expression. As a final guard, `buildHolderObject` clamps the result down to the exact section sum to avoid a "Gauge length exceeds total section height" floating-point error.

`geometry.assemblyGaugeLength` (a Fusion-native field **nested in `geometry`**, not root-level; = holder gauge length + OOH, in the tool's unit) is always **explicitly recomputed** in `splitToFusionInstances` from the freshly-built holder's `gaugeLength` + the assembly's `ooh` — never carried forward from `...existing`.

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
└── tool_metadata.json           ← Extra fields Fusion doesn't support (optional, can be skipped)

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

## Tech Stack

- **Frontend**: React + Vite (hosted on GitHub Pages — use HashRouter, not BrowserRouter)
- **Fusion library storage**: Autodesk Platform Services (APS) Data Management API
- **Holder library storage**: APS Data Management API (read-only — same mechanism as tool library)
- **Metadata storage**: Google Drive API v3 (single file, optional)
- **Auth**: Two separate flows:
  - APS PKCE OAuth (`Single Page App` type — no client secret) — required
  - Google OAuth implicit flow via `@react-oauth/google` — optional
- **Icons**: `lucide-react` for UI icons; custom SVG silhouettes for 26 tool types in `ToolTypeIcon.jsx`
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

**Taps**: `tap form`, `tap cut`

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
  "product_id": "manufacturer EDP/part number (metadata)",
  "proshot_id": "ProShop ID = Fusion's product-id field (metadata + Fusion)",
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
| `number_of_flutes`| `geometry.NOF`         | `# Flutes`        |                                        |
| `spindle_speed`  | `start-values.presets[0].n` | `RPM`        |                                        |
| `cutting_feedrate`| `start-values.presets[0].v_f` | `Feed Rate` |                                       |
| `vendor`         | — (metadata only)       | `Manufacturer`    | Manufacturer name — **never** written to Fusion |
| `location`       | `expressions.tool_vendor` | (cabinet location) | Fusion's **"Vendor"** UI field is repurposed as the cabinet location (e.g. "LC-8") |
| `shoulder_length`| `geometry['shoulder-length']` | —          | Hyphenated key (not `LSCH`); normalization sets it = MIN OOH |
| `tip_angle`      | `geometry.SIG`          | `tipAngle`        | Drill/spot/chamfer point (included) angle — **Fusion-native** (read+write both JSON and TSV paths) for `drill`, `center drill`, `spot drill`, `counter sink`, `chamfer mill`. Fusion wins; metadata is a transition fallback |
| `min_ooh`        | — (metadata only)       | `MIN OOH` (`lengthBelowShankDiameter`) | Minimum stick-out floor — see the three-length-concepts table + ProShop Field Priority Rules |
| `product_id`     | — (metadata only)       | `Part Number`     | Manufacturer EDP number                |
| `proshot_id`     | `product-id`            | ProShop ID        | **Primary match key for Phase 2**      |

**Important**: `proshot_id` (our field) = Fusion's `product-id` field (shown as "Vendor Number" in Fusion UI). This is the ProShop-assigned ID and is the primary key for Phase 2 tool matching. It is stored in both the Fusion JSON and in metadata.

**Assembly export**: When exporting a tool with an assembly selected, the assembly gauge length is written as `geometry.assemblyGaugeLength` (Fusion-native, nested in `geometry` — **not** a root-level `assembly-gauge-length`). Its value is **holder gauge length + OOH**, in the tool's unit. OOH is always stored internally in inches; the export converts to the tool's native unit (×25.4 for metric tools) before adding it to the holder gauge length.

### Metadata Schema (`tool_metadata.json`)

Stored in a single file on Google Drive. The file contains an array of metadata objects — one per tool. The `id` field matches the tool's `guid` in the Fusion library.

```json
{
  "id": "matches tool guid in Fusion library",
  "vendor": "",
  "product_id": "",
  "proshot_id": "",
  "coating": "",
  "notes": "",
  "last_used_job": "",
  "preferred_machine": "",
  "material_suitability": [],
  "tags": [],
  "updated_by": "",
  "revision_notes": "",
  "selected_holder_guid": "guid from the holder library",
  "assemblies": [
    {
      "assembly_id": "generated UUID (via generateAssemblyId / generateId)",
      "holder_guid": "guid from the holder library",
      "holder_description": "cached holder description at creation time",
      "ooh": 2.125,
      "linked_preset_guids": ["preset-guid-1", "preset-guid-2"],
      "notes": "",
      "created_at": "ISO timestamp",
      "source": "merge | manual"
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

`holders` and `holderLibraryLocation` are available via `useApp()`. The holder library location is stored in localStorage (`aps_holder_library_location`). If not configured, the Holder section in ToolDetail shows a "set up in Settings" prompt.

-----

## Units (inches / millimeters)

**Ultimate goal (not yet built — design every new feature with it in mind):** every **tool** and **holder** carries its **own unit** (`inches` or `millimeters`) that the user can change per-record, on top of a **global native/default unit** set in Settings. The app must work cleanly for an **inch-default shop** (like ours) *and* an **mm-default shop**, and switching the global default later must be easy. Build new code so a tool's unit is always read from the record (never assume inches), conversions are centralized, and display formats off the active unit — so the eventual global-default toggle is a small change, not a rewrite.

**Current state (works today, inch-default):**
- Global native unit is **inches**. There is **no** Settings toggle yet, and per-record unit editing is not exposed in the UI — but each tool already has a `unit` field (`inches` | `millimeters`) read from Fusion, and the model supports mixed libraries.
- **Fusion uses both interchangeably.** A tool's `unit` comes from its Fusion entry.
- **ProShop import defaults to inches** (the eventual import flow should let the user pick the ProShop file's unit and convert). MIN OOH is imported from ProShop with no conversion → it is **inches**.

**Canonical internal units (today — the part that's easy to trip on):**
- **OOH** (per-assembly stick-out) and **`min_ooh`** are **always stored in inches**, regardless of the tool's unit. These are the two "stick-out" concepts and share a canonical unit so they compare directly.
- **All other length geometry** (`diameter`/DC, `flute_length`/LCF, `overall_length`/OAL, `shoulder_length`/`shoulder-length`) is stored in the tool's **native unit** (mm for a metric tool) — read raw from / written raw to Fusion (`fusionToolToInternal` / `internalToFusionTool`). Only `geometry.LB` (OOH) is converted (÷25.4 on read, ×25.4 on write) in `readOohFromFusion` / `splitToFusionInstances`.

**The field registry encodes which is which.** Every `unit: 'length'` field in `src/schema/fieldRegistry.js` carries a `canonicalUnit` annotation — `'inches'` for `ooh`/`min_ooh`, `'native'` for all other lengths — so conversion can be driven from the registry rather than hand-coded. Add it to any new length field. (The future per-record/global-unit work will consume this flag to centralize conversions.)

**Therefore, whenever inches-canonical `min_ooh`/OOH meets a native-unit length, convert.** Helper: `inchesToNative(value, unit)` / native is `value × 25.4` for `millimeters`. Current crossing points (all handled):
- `normalizeLibrary`: `shoulder_length` (native) is set from `min_ooh` (inches) → convert for metric. The per-assembly OOH floor compares inches-to-inches → no conversion.
- `validateGeometry`: the ordering chain is checked in native units, so `min_ooh` (inches) is converted to native before comparing against `shoulder_length`/`overall_length`.
- `AssemblyForm`: compares per-assembly `ooh` (inches) to `min_ooh` (inches) → no conversion.

> When you touch any length, ask "is this value inches-canonical (OOH/min_ooh) or native (everything else)?" and convert at the boundary. This is the seam the future per-record/global-unit work will formalize.

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

- **MIN OOH source of truth**: pulled from **ProShop** (`lengthBelowShankDiameter` column) during import (`ImportFlow.psRowToTool` / `matchProShopToTools` — ProShop is authoritative, always overwrites). It is the initial source of truth through the full first-import + normalization workflow. It is **never written to a Fusion field** (Fusion has no native "minimum" field) — it reaches Fusion only indirectly, as the shoulder length (which normalization sets equal to it).
- **Normalization rule** (implemented in `normalizeLibrary`): when a tool has a `min_ooh`, set `shoulder_length = min_ooh` and **floor** every assembly's OOH at `min_ooh` (raise any instance below the floor up to it). Lengths can be adjusted manually afterward; that's expected to be rare.

### OOH (Out of Holder) — per-assembly stick-out
- OOH = how much of the tool sticks out of the holder during cutting (aka gauge length / stick-out / "Length below Holder")
- **Always stored in inches internally**, regardless of the tool's unit
- **Source field**: `geometry.LB` (Body Length) in Fusion JSON — this is "Length below Holder" in the Fusion UI, and `tool_bodyLength` in the Fusion CSV export. Each instance carries its own `geometry.LB`. Do NOT use `geometry.assemblyGaugeLength` as the source; that field is holder gauge length + OOH (what we WRITE on export), not the per-instance OOH source of truth.
- Unit conversion: if the tool's unit is `millimeters`, divide `geometry.LB` by 25.4 when reading. On write, per-instance OOH is multiplied ×25.4 (for metric tools) into `geometry.LB`/`tool_bodyLength`, and `geometry.assemblyGaugeLength` is recomputed as holder gauge length + OOH in the tool's unit.
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
  main.jsx
  index.css                       # All styles — single file, CSS custom properties, dark theme

  context/
    AppContext.jsx                 # Global state + all async actions (saveTool, mergeTool, etc.)
                                  # Exposes: tools, holders, holderLibraryLocation, isSaving,
                                  #          user, notify, mergeTool, saveTool, deleteTool, etc.

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

  components/
    LandingPage.jsx               # Search + facets + sort + grid/list toggle
    ToolDetail.jsx                # Detail view with frozen left action sidebar + sticky header
                                  # Sections: Identity (incl. machine tool#), Geometry, Holder,
                                  #           Assemblies, Presets, Setup, History, Merge History
                                  # Right sidebar: Notes & Tags only
    ToolForm.jsx                  # Edit form with sticky action bar + dirty guard
    ToolCard.jsx                  # Grid and list card variants with hover actions
                                  # Uses data-field tokens: .description-badge, .proshot-pill,
                                  # .holder-pill, .machine-num-badge, .location-tag
    ToolTypeGrid.jsx              # Tool type selector tiles (icons size 36)
    FacetFilters.jsx              # Cascading facet filter UI
    AddToolFlow.jsx               # New tool flow (extractor or manual)
    ImportFlow.jsx                # Bulk Fusion JSON / ProShop CSV import
    MetadataConnect.jsx           # Google Drive connect flow + shared-drive-aware folder picker
    HolderPicker.jsx              # Modal for selecting a holder from the holder library
    ReconcileModal.jsx            # Reconcile-on-open prompt: delete duplicates, add/delete
                                  # new assemblies, review conflicts (→ Sync Job diff)
    AssemblyCard.jsx              # Read-only assembly display (holder, OOH, linked presets)
                                  # with inline edit/delete
    AssemblyForm.jsx              # Form for creating/editing assemblies
                                  # Fields: holder (HolderPicker), OOH, linked presets, notes
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

Filters: tool type (tile grid) → diameter → flutes → flute length → overall length → material → coating → vendor → preferred machine → material suitability → tags.

Sort options: recently updated, diameter ↑/↓, vendor A–Z, description A–Z. View modes: grid, list. Both persist in localStorage.

-----

## ProShop Integration

ProShop manages inventory and purchasing. This app owns tool specifications. Relationship:

- **Export single tool**: ProShop-compatible CSV row (always maintain this)
- **Export full library**: Complete ProShop CSV for bulk re-import
- **Import**: One-time Fusion JSON or ProShop CSV import to populate initial library

ProShop export must never be removed even as the app evolves toward a future ERP.

-----

## ProShop Field Priority Rules

These rules apply during the **initial ProShop CSV merge** and on any **subsequent ProShop sync**. "PS wins" = use the ProShop value, overwriting the Fusion value. "Flag" = surface to the user for a manual decision; do **not** auto-resolve.

| Field | Rule | Notes |
|---|---|---|
| Tool description | PS wins | Always via the per-tool rename confirmation UI — see Description Rename Workflow |
| `vendor` (manufacturer) | PS wins | Manufacturer name; metadata-only, **never** written to Fusion |
| `location` (cabinet) | From PS + Fusion's "Vendor" field | Fusion's "Vendor" UI field (`expressions.tool_vendor`) holds the cabinet location → internal `location` |
| `min_ooh` (MIN OOH floor) | PS wins | From `lengthBelowShankDiameter`; metadata-only, always overwrites |
| `geometry['shoulder-length']` (shoulder length) | Set to MIN OOH at normalization | See MIN OOH rule below |
| per-assembly `ooh` → `geometry.LB` | Floored at MIN OOH | See MIN OOH rule below |
| `tsc_capable` (through-spindle coolant) | PS wins | Boolean capability flag (not a text field) |
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

-----

## Description Rename Workflow (normalization step)

During initial normalization, tool descriptions are rationalized. The ProShop description takes priority, but each tool passes through a per-tool confirmation UI — descriptions are **never** silently renamed.

**Reuse the existing generator** — `buildDesc()` in `tool-extractor.tsx` composes a standardized description from a tool's structured fields (e.g. `0.5 4FL EM 1.000LOC`, `#80 135DEG CARB DRILL`). It is a **generator** (specs → description), not rename/diff detection — use it to produce the *suggested* new description; check that file before writing any new naming logic.

**Step-by-step UI** (a step in `NormalizeModal`, or a follow-on modal) — for each tool in sequence:

1. Show current Fusion description and PS description side by side
2. Show the suggested new description (PS description, or one generated via `buildDesc()`)
3. User can: Accept suggestion / Edit and accept / Keep Fusion description / Skip
4. "Next →" advances to the next tool; a progress indicator shows X of N
5. At the end, "Apply all renames" writes the confirmed descriptions in one batch

This is, alongside the preset operation-type assignment, one of the few normalization steps requiring per-tool user decisions; the two may share a single pre-flight review modal if the UX allows.

**Priority rule**: PS description wins by default; if the PS description is blank, keep the Fusion description. User confirmation is **always** required. (Not yet implemented — the current `NormalizeModal` only handles preset operation-type assignment.)

-----

## Phase 2 — Compare & Merge ✅ Implemented

When a programmer proves better speeds/feeds in a job, they can sync those values back to master:

1. Copy tool(s) from Fusion 360 — Fusion's right-click copy puts tool data on the clipboard as **TSV** (tab-separated, a CSV-family format), not JSON
2. Go to "Sync Job" in the app → paste (Ctrl+V anywhere on the import screen)
3. App builds a batch queue — auto-matches each tool by priority:
   - **`proshot_id` exact match** — primary (Fusion's `product-id` field)
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

- `incoming_ooh` — OOH value from the imported tool's `geometry.LB` (JSON) / `tool_bodyLength` (CSV/TSV), converted to inches. **Not** from `assembly-gauge-length` (which is holder gauge + OOH)
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
| **Load-time auto-combine** | Every load + bulk write | Whole library, by ProShop # | Never silently overwrites — strays preserved in `_instancesRaw` | `combineToolsByProshopId` |
| **Reconcile on open** | Opening a tool (ToolDetail) | One logical tool vs. live Fusion library | Surfaced — hands off to Sync Job diff | `reconcileTool` / `applyReconcile` |
| **Sync Job (Phase 2)** | User pastes job tools | Batch queue of incoming tools | User picks per-field/per-preset | `MergeFlow` / `mergeTool` |

All three ultimately persist through `writeLogicalTool()` (re-download → drop everything this tool owns → append fresh split instances).

### 1. Load-time auto-combine (`combineToolsByProshopId`)

In `src/schema/toolSchema.js`. Runs **silently** in `loadTools` (after `groupByTrackingId` + `buildLogicalTool`) and in bulk writes (`saveFullLibrary`, `normalizeLibrary`). Folds separate logical tools that share a `proshot_id` into **one** logical tool so a tool copied/dumped under a fresh GUID or tracking ID doesn't show up as a separate entry:

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
   - ProShop ID in an amber pill (`.proshot-pill`)

3. **Scrollable main content** (`.tool-detail-main`): two-column layout
   - Left column: Identity (includes machine tool # T/H/D), Geometry, Holder, Assemblies, Presets, Setup, History, Merge History
   - Right sidebar: Notes & Tags only

Machine tool number is shown inside the Identity section (not as a standalone block). History and Merge History are at the bottom of the left column.

### Data-field visual token system

**Universal rule**: every named data type has exactly one CSS token class. Use it everywhere that type appears as a **standalone chip or badge** (cards, sticky headers, inline lists). In a label:value detail grid the plain value is correct; the class is for when the data appears without a label next to it.

**When changing any token's style, update ALL usages across the codebase** — not just the CSS definition.

| Data Type | Class | Shape | Color |
|---|---|---|---|
| Tool Description | `.description-badge` | Rounded rect (r=7px) | Violet — `rgba(124,58,237,…)` |
| ProShop ID | `.proshot-pill` | Pill | Amber — `#f59e0b` |
| Holder | `.holder-pill` | Pill | Teal default — `#2dd4bf`; AssemblyCard overrides per-holder via inline style |
| Machine Tool # | `.machine-num-badge` | Slightly rounded rect (r=5px) | Green — `#4ade80`, monospace |
| Location/Cabinet | `.location-tag` | Rounded rect (r=7px) | Indigo — `#818cf8`, monospace |
| Preset Name | `.preset-tag` | Pill | Emerald — `#34d399` |

All six classes are defined in `src/index.css` in the "Data-field visual tokens" block.

**Current usages:**
- `.description-badge` — `ToolCard` (grid + list), `ToolDetail` sticky header
- `.proshot-pill` — `ToolCard`, `ToolDetail` sticky header, `AssemblyCard` operator tag (as `.tag-proshot-oval` — physical tag format exception)
- `.holder-pill` — `ToolCard` badge, `ToolDetail` HolderSection, `ToolDetail` export picker
- `.machine-num-badge` — `ToolCard` badge, `ToolDetail` Identity section (T/H/D)
- `.location-tag` — `ToolCard` badge (when location is set)
- `.preset-tag` — `AssemblyCard` linked presets list, `DiffStep` new-preset rows, `CommitStep` new-preset rows

**Exception**: `AssemblyCard` uses its own `.operator-tag` / `.tag-box` / `.tag-proshot-oval` layout to match the physical shop tag format. That internal layout is intentional and is not subject to this rule.

-----

## Google Drive — Shared Drive Support

The Google Drive metadata folder picker supports shared drives (team drives). Key requirements:

- **OAuth scope**: `https://www.googleapis.com/auth/drive` — NOT `drive.file`. The `drive.file` scope blocks `drives.list` and prevents browsing shared drive contents. Using `drive` is required for any app that needs to browse or create files in shared drives.
- **API calls**: All Drive API calls (`files.get`, `files.list`, `files.create`, `files.update`) must include `supportsAllDrives=true`. Folder listings also need `includeItemsFromAllDrives=true`.
- The folder picker in `MetadataConnect.jsx` shows a "Shared Drives" section above "My Drive" when shared drives are available. Clicking a shared drive navigates into it; the section header updates to show the drive name.

-----

## Data Migration / Backwards Compatibility

**Do not write backwards-compatibility code.** The tool library data has not been fully migrated to this app yet, so there is no live data to protect. When a field changes shape or a new field is added, update the code for the new shape only — do not add migration shims, `|| ''` fallbacks for renamed fields, or dual-read logic for old vs. new formats. If existing stored data needs updating, that will be handled as a deliberate one-off migration step, not silently in the app code.

-----

## Key Constraints

- **Tool IDs are permanent** — they are the Fusion `guid`, link the two JSON files, and are referenced in merge history. Never reassign them.
- **APS token in memory only** — `window._apsToken`, never localStorage. The refresh token is stored in `sessionStorage` (`aps_refresh_token`) so the session survives page refreshes within the same browser tab.
- **Always re-download before write** — call `downloadFusionList()` immediately before any `uploadFusionList()`.
- **No extra fields in Fusion JSON** — Fusion validates strictly. Only Fusion-native fields go in the library file; everything else goes in `tool_metadata.json`. Exception: `geometry.assemblyGaugeLength` is a Fusion-native field (nested in `geometry`; = holder gauge length + OOH, not OOH alone), safe to write.
- **`proshot_id` is the primary match key** — it is Fusion's `product-id` field (the ProShop-assigned number). Do not confuse with `product_id` (manufacturer EDP number, metadata-only).
- **OOH is always stored in inches** — convert from mm on import, convert back to mm on export for metric tools.
- **Preset GUIDs are stable through the merge flow** — `presetsToAdd` GUIDs must not be regenerated after DiffStep. The assembly record in CommitStep uses them.
- **Conflict presets must get a new GUID** — when a conflict preset is resolved as 'create', the incoming preset's GUID matches the master, so `generateId()` must produce a fresh one.
- **GitHub Pages = HashRouter** — never switch to BrowserRouter.
- **ProShop export is permanent** — never remove `proShopExport.js` or the export buttons.
- **Speeds & feeds display**: round to 4 decimal places for display using `round4()` — values are stored at full precision.
- **Deployment is automated via GitHub Actions** — do NOT run `npm run deploy` from agent/cloud/CI sessions. See the Deployment section above.
- **Google Drive scope must be `drive`** — do not downgrade back to `drive.file`; it breaks shared drive browsing.
