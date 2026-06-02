# Fusion Tool Library Manager

## Project Overview

A web application for managing a CNC cutting tool library. It replaces a fragmented, manual workflow where tools are pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The Fusion tool library JSON lives in Autodesk cloud (BIM 360 / ACC) and is accessed via the Autodesk Platform Services (APS) Data Management API. Tool metadata that Fusion doesn't support (notes, tags, ProShop ID, preferred machine, assemblies, etc.) is stored in a separate `tool_metadata.json` on Google Drive. The app acts as the single source of truth across both files.

This module is also the foundation of a future in-house ERP system. ProShop will continue to be used for inventory and purchasing in the interim, so ProShop import/export must always be maintained.

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
| `vendor`         | — (metadata only)       | `Manufacturer`    |                                        |
| `product_id`     | — (metadata only)       | `Part Number`     | Manufacturer EDP number                |
| `proshot_id`     | `product-id`            | ProShop ID        | **Primary match key for Phase 2**      |

**Important**: `proshot_id` (our field) = Fusion's `product-id` field (shown as "Vendor Number" in Fusion UI). This is the ProShop-assigned ID and is the primary key for Phase 2 tool matching. It is stored in both the Fusion JSON and in metadata.

**Assembly export**: When exporting a tool with an assembly selected, `assembly-gauge-length` is written as a root-level field in the Fusion JSON. This is Fusion's field for the gauge/stick-out length from the holder. OOH is always stored internally in inches; the export converts to mm for metric tools.

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

## Holder Library & Assemblies

An **Assembly** records a specific tool + holder + OOH (Out of Holder length) combination that has been proven in a job. Assemblies are stored per-tool in `tool_metadata.json` under `assemblies[]`.

### OOH (Out of Holder)
- OOH = how much of the tool sticks out of the holder during cutting (aka gauge length / stick-out / "Length below Holder")
- **Always stored in inches internally**, regardless of the tool's unit
- **Source field**: `geometry.LB` (Body Length) in Fusion JSON — this is "Length below Holder" in the Fusion UI, and `tool_bodyLength` in the Fusion CSV export. Do NOT use `assembly-gauge-length` as the source; that field is what we WRITE on export, not the geometric source of truth.
- Unit conversion: if the tool's unit is `millimeters`, divide `geometry.LB` by 25.4 when reading; multiply OOH × 25.4 when writing back to `assembly-gauge-length` for metric tools

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

## Phase 2 — Compare & Merge ✅ Implemented

When a programmer proves better speeds/feeds in a job, they can sync those values back to master:

1. Copy tool(s) from Fusion 360 (Ctrl+V copies to clipboard as JSON)
2. Go to "Sync Job" in the app → paste (Ctrl+V anywhere on the import screen)
3. App builds a batch queue — auto-matches each tool by priority:
   - **`proshot_id` exact match** — primary (Fusion's `product-id` field)
   - **GUID exact match** — secondary
   - **Geometry fuzzy match** — fallback, requires user confirmation
   - **No match** → route to "Add to Library" flow
4. For each matched tool: side-by-side diff → select which fields to commit → enter revision note
5. Live re-fetch from APS before each diff (60-second cache) — detects if a teammate updated master during the session
6. Summary screen shows results; "Copy All Committed Tools to Clipboard" pastes back into Fusion

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

- `incoming_ooh` — OOH value from the imported Fusion JSON's `assembly-gauge-length` field (converted to inches)
- `incoming_holder_guid` — holder GUID from the imported tool (if present)
- `_incomingHolderDesc` — pre-resolved holder description string (set during import parsing)

### Preset GUID rules during merge

- **New presets** (`newPresets` bucket): keep their incoming GUID — this GUID is used by the assembly record created in CommitStep to link the preset to its assembly
- **Conflict presets resolved as 'create'**: MUST receive a **new** GUID (via `generateId()`), because the incoming preset's GUID equals the master preset's GUID (it was copied from master). The new preset gets OOH appended to its name: `"Preset Name (OOH: X.XXX")`
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

## Key Constraints

- **Tool IDs are permanent** — they are the Fusion `guid`, link the two JSON files, and are referenced in merge history. Never reassign them.
- **APS token in memory only** — `window._apsToken`, never localStorage. The refresh token is stored in `sessionStorage` (`aps_refresh_token`) so the session survives page refreshes within the same browser tab.
- **Always re-download before write** — call `downloadFusionList()` immediately before any `uploadFusionList()`.
- **No extra fields in Fusion JSON** — Fusion validates strictly. Only Fusion-native fields go in the library file; everything else goes in `tool_metadata.json`. Exception: `assembly-gauge-length` is a Fusion-native root-level field for OOH, safe to write.
- **`proshot_id` is the primary match key** — it is Fusion's `product-id` field (the ProShop-assigned number). Do not confuse with `product_id` (manufacturer EDP number, metadata-only).
- **OOH is always stored in inches** — convert from mm on import, convert back to mm on export for metric tools.
- **Preset GUIDs are stable through the merge flow** — `presetsToAdd` GUIDs must not be regenerated after DiffStep. The assembly record in CommitStep uses them.
- **Conflict presets must get a new GUID** — when a conflict preset is resolved as 'create', the incoming preset's GUID matches the master, so `generateId()` must produce a fresh one.
- **GitHub Pages = HashRouter** — never switch to BrowserRouter.
- **ProShop export is permanent** — never remove `proShopExport.js` or the export buttons.
- **Speeds & feeds display**: round to 4 decimal places for display using `round4()` — values are stored at full precision.
- **Deployment is automated via GitHub Actions** — do NOT run `npm run deploy` from agent/cloud/CI sessions. See the Deployment section above.
- **Google Drive scope must be `drive`** — do not downgrade back to `drive.file`; it breaks shared drive browsing.
