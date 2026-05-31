# Fusion Tool Library Manager

## Project Overview

A web application for managing a CNC cutting tool library. It replaces a fragmented, manual workflow where tools are pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The Fusion tool library JSON lives in Autodesk cloud (BIM 360 / ACC) and is accessed via the Autodesk Platform Services (APS) Data Management API. Tool metadata that Fusion doesn't support (notes, tags, ProShop ID, preferred machine, etc.) is stored in a separate `tool_metadata.json` on Google Drive. The app acts as the single source of truth across both files.

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
└── fusion_tool_library.json     ← Fusion 360 reads this; app reads/writes via APS Data Management API

Google Drive (shared team folder)
└── tool_metadata.json           ← Extra fields Fusion doesn't support (optional, can be skipped)

Web App (GitHub Pages, client-side only)
├── APS PKCE OAuth login (required — gates all library access)
├── Google OAuth login (optional — only needed for metadata)
├── Loads both files into memory on login
├── All search/filter runs in memory — no API calls during search
├── Writes changes back to their respective services on save
└── Phase 2: Queue-based compare/merge for syncing job edits to master ✅
```

The full tool list (~250 tools) is loaded once on login. All search and filtering is client-side and instant.

-----

## Tech Stack

- **Frontend**: React + Vite (hosted on GitHub Pages — use HashRouter, not BrowserRouter)
- **Fusion library storage**: Autodesk Platform Services (APS) Data Management API
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

## Token & Storage Security Rules

**These are non-negotiable — do not change without understanding the implications:**

- APS token lives in `window._apsToken` (memory only). Never write it to localStorage, sessionStorage, or cookies.
- The `aps_code_verifier` and `aps_nonce` use sessionStorage only during the OAuth redirect — they are deleted immediately after the callback is processed.
- The library location (`{ hubId, projectId, folderId, itemId, fileName }`) is safe to store in localStorage (`aps_library_location`) — it is not sensitive.
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
  "updated_at": "ISO timestamp"
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

-----

## Source Layout

```
src/
  App.jsx                         # Root: auth gates, routing, topbar, ToastStack
  main.jsx
  index.css                       # All styles — single file, CSS custom properties, dark theme

  context/
    AppContext.jsx                 # Global state + all async actions (saveTool, mergeTool, etc.)

  schema/
    toolSchema.js                 # Tool types, field labels, fusionToolToInternal,
                                  # internalToFusionTool, splitToFusionAndMetadata,
                                  # mergeFusionAndMetadata, validateTool, generateId

  services/
    apsService.js                 # APS PKCE OAuth + Data Management API read/write
    driveService.js               # Google Drive API (metadata only)
    searchEngine.js               # In-memory faceted search + filter logic
    duplicateDetector.js          # Weighted similarity scoring for Phase 2 matching
    mergeQueue.js                 # Phase 2 queue state: parseIncoming, buildQueue

  utils/
    fusionExport.js               # exportSingleTool, exportFullLibrary,
                                  # copyToolToClipboard, copyToolsToClipboard
    proShopExport.js              # ProShop CSV export (always maintain this)

  components/
    LandingPage.jsx               # Search + facets + sort + grid/list toggle
    ToolDetail.jsx                # Detail view + edit trigger + merge history
    ToolForm.jsx                  # Edit form with sticky action bar + dirty guard
    ToolCard.jsx                  # Grid and list card variants with hover actions
    ToolTypeGrid.jsx              # Tool type selector tiles
    FacetFilters.jsx              # Cascading facet filter UI
    AddToolFlow.jsx               # New tool flow (extractor or manual)
    ImportFlow.jsx                # Bulk Fusion JSON / ProShop CSV import
    Toast.jsx                     # Fixed bottom-right toast stack

    icons/
      ToolTypeIcon.jsx            # 26 hand-crafted SVG tool silhouettes

    MergeFlow/                    # Phase 2: sync job values to master
      index.jsx                   # Queue orchestration, live APS fetch, step routing
      ImportStep.jsx              # Clipboard paste (Ctrl+V) + file upload
      MatchStep.jsx               # Match confirmation (fuzzy matches only)
      DiffStep.jsx                # Side-by-side diff with per-field checkboxes
      CommitStep.jsx              # Revision note + "Commit & Next / Finish"
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

-----

## Key Constraints

- **Tool IDs are permanent** — they are the Fusion `guid`, link the two JSON files, and are referenced in merge history. Never reassign them.
- **APS token in memory only** — `window._apsToken`, never localStorage. The refresh token is stored in `sessionStorage` (`aps_refresh_token`) so the session survives page refreshes within the same browser tab.
- **Always re-download before write** — call `downloadFusionList()` immediately before any `uploadFusionList()`.
- **No extra fields in Fusion JSON** — Fusion validates strictly. Only Fusion-native fields go in the library file; everything else goes in `tool_metadata.json`.
- **`proshot_id` is the primary match key** — it is Fusion's `product-id` field (the ProShop-assigned number). Do not confuse with `product_id` (manufacturer EDP number, metadata-only).
- **GitHub Pages = HashRouter** — never switch to BrowserRouter.
- **ProShop export is permanent** — never remove `proShopExport.js` or the export buttons.
- **Speeds & feeds display**: round to 4 decimal places for display using `round4()` — values are stored at full precision.
- **Deploy after every change** — run `npm run deploy` after each set of committed changes so the live GitHub Pages site (`gh-pages` branch) stays in sync with the development branch. Do this automatically without being asked.
