# Fusion Tool Library Manager

## Project Overview

A web application for managing a CNC cutting tool library. It replaces a fragmented, manual workflow where tools are pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The app reads and writes directly to JSON files stored on Google Drive, which Fusion 360 can also read. A separate metadata JSON on the same Drive stores additional fields beyond what Fusion supports. The app acts as the single source of truth, keeping everything in sync across the team.

This module is also the foundation of a future in-house ERP system. ProShop will continue to be used for inventory and purchasing in the interim, so ProShop import/export must always be maintained.

-----

## The Problem Being Solved

Current workflow:

1. Open master tool library in Fusion 360 (stored on cloud)
1. Copy a tool into a job file
1. Edit speeds, feeds, and other details for that job
1. Forget (or avoid) syncing changes back to master
1. Result: outdated master, lost edits, duplicates everywhere

This app fixes that by being the authoritative place to manage tools, with a proper merge/compare workflow for committing changes back to the master.

-----

## Security Model

The app is hosted on GitHub Pages (static, client-side only). Access to tool data requires signing in with a Google account that has been granted access to the shared Google Drive folder. Unauthorized visitors get a login screen — nothing else. No API keys are exposed in the code. This is sufficient security for an internal shop tool.

-----

## Architecture

```
Google Drive (shared team folder)
├── fusion_tool_library.json     ← Fusion 360 reads this directly
└── tool_metadata.json           ← Extra fields Fusion doesn't support

Web App (GitHub Pages, client-side only)
├── Google OAuth login (must have Drive folder access)
├── Loads both JSON files into memory on login
├── All search/filter runs in memory — no Drive calls during search
├── Writes changes back to Drive on save
└── Phase 2: Compare/merge interface for syncing job edits to master
```

The full tool list (~250 tools) is loaded into memory once on login. All search and filtering is client-side and instant. Drive is only called on load and on save.

-----

## Tech Stack

- **Frontend**: React (hosted on GitHub Pages, use HashRouter)
- **Storage**: Google Drive API (two JSON files)
- **Auth**: Google OAuth — user signs in with Google account that has Drive folder access
- **No backend server** — everything runs client-side

-----

## Data Model

### Tool Types

Each tool has a `type` field that determines which fields are required and which search facets are shown. Tool types match what Fusion 360 and ProShop support:

- `flat_end_mill`
- `ball_end_mill`
- `bull_nose_end_mill`
- `face_mill`
- `drill`
- `spot_drill`
- `chamfer_mill`
- `tap`
- `boring_bar`
- `turning_insert`

### Core Fields (all tool types)

```json
{
  "id": "unique string ID — never changes after creation",
  "type": "flat_end_mill",
  "description": "tool description",
  "vendor": "manufacturer name",
  "product_id": "part number",
  "diameter": 0.5,
  "overall_length": 3.0,
  "flute_length": 1.0,
  "number_of_flutes": 4,
  "material": "carbide",
  "coating": "AlTiN",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

### Speeds & Feeds Fields

```json
{
  "cutting_speed": 0,
  "spindle_speed": 0,
  "feed_per_tooth": 0,
  "feed_per_rev": 0,
  "cutting_feedrate": 0,
  "lead_in_feedrate": 0,
  "lead_out_feedrate": 0,
  "ramp_feedrate": 0,
  "plunge_feedrate": 0,
  "depth_of_cut": 0,
  "width_of_cut": 0
}
```

### Fusion 360 ↔ ProShop Field Mapping

This mapping is already defined in the tool extractor JSX — import and use it here.

|App Field         |Fusion 360 Field|ProShop Field     |
|------------------|----------------|------------------|
|`description`     |`description`   |`Tool Description`|
|`diameter`        |`diameter`      |`Diameter`        |
|`flute_length`    |`fluteLength`   |`Flute Length`    |
|`overall_length`  |`overallLength` |`Overall Length`  |
|`number_of_flutes`|`numberOfFlutes`|`# Flutes`        |
|`spindle_speed`   |`spindleSpeed`  |`RPM`             |
|`cutting_feedrate`|`feedrate`      |`Feed Rate`       |
|`vendor`          |`vendor`        |`Manufacturer`    |
|`product_id`      |`productId`     |`Part Number`     |

### Metadata Fields (stored in `tool_metadata.json`, not in Fusion JSON)

```json
{
  "id": "matches tool ID in fusion_tool_library.json",
  "notes": "freeform notes",
  "last_used_job": "job number or program name",
  "preferred_machine": "M300 / R650 / etc",
  "material_suitability": ["316L", "6061", "4140"],
  "proshot_id": "ProShop internal ID if applicable",
  "tags": ["roughing", "finishing", "stainless"],
  "updated_by": "username",
  "revision_notes": "what changed and why"
}
```

-----

## Search & Filter System

This is a core feature — not an afterthought. The landing page IS the search page.

### How It Works

**Cascading faceted search.** Each filter selection narrows the available options in all subsequent filters based on what’s currently in the filtered result set. If you select “Flat End Mill” and type “0.5” for diameter, the flute count filter only shows flute counts that actually exist among 0.5” flat end mills in the library. Add 3 flutes, and the length filter only shows lengths available for 0.5” 3-flute flat end mills.

**All filtering runs in memory.** The full tool list is loaded on login. No Drive API calls during search.

### Landing Page Layout

1. **Global search bar at top** — searches across all fields (vendor part numbers, descriptions, any text field). This is for when you know a specific thing but not the geometry.
1. **Tool type icons** — large clickable icons for each tool type. Selecting one is the first filter step and determines which facets appear below.
1. **Contextual facet filters** — appear after tool type is selected, ordered by most commonly used first. Each facet shows only values that exist in the current filtered set:
- Diameter (numeric input with autocomplete from available values)
- Number of flutes (pills/chips showing only available counts)
- Flute length / cutting length
- Overall length
- Material (carbide, HSS, etc.)
- Coating
- Vendor
- Preferred machine (M300, R650)
- Material suitability (what it cuts)
- Tags
1. **Live results** — tool cards update instantly as each filter is applied. Show count of matching tools.
1. **Autocomplete behavior** — when a filter field has only a small number of remaining options (e.g., 5 or fewer), it switches from a text input to showing all options as selectable chips.
1. **Clear filters** — easy way to reset individual filters or all at once.
1. **Add New Tool button** — prominent on landing page. Opens the tool extractor flow.

### Search Index

Build a client-side search index on load:

- For each field that is filterable, collect all unique values present in the library
- For cascading behavior: when filters are applied, recompute available options for all remaining facets from the current filtered subset
- Numeric fields (diameter, flute count, length) support both exact match and typed entry with autocomplete

-----

## ProShop Integration (Ongoing)

ProShop is not being replaced — it continues managing inventory and purchasing. This app owns tool data and specifications. The relationship:

- **Import**: One-time bulk import of current ProShop tool library to populate this app initially
- **Export single tool**: Downloads a ProShop-compatible CSV row
- **Export full library**: Downloads a complete ProShop CSV for bulk re-import (used after initial merge to normalize both systems)
- **Ongoing**: New tools created in this app get exported to ProShop manually as needed

ProShop export must always be maintained even as this app evolves toward a future ERP.

-----

## Initial Data Population (One-Time, ~250 Tools)

This is part of Phase 1. The process:

1. **Import Fusion library** — upload `fusion_tool_library.json` directly; app parses and loads all tools
1. **Merge ProShop library** — upload a ProShop CSV export; app matches tools by geometry/description and fills in missing fields (especially ProShop IDs and any fields ProShop has that Fusion doesn’t)
1. **Review & clean up** — use the app’s search and edit features to review merged results, fill gaps, correct errors
1. **Export full library to ProShop** — generate a complete ProShop CSV to re-import and normalize ProShop to match
1. **Export to Fusion** — write the cleaned library back to `fusion_tool_library.json` on Drive; Fusion picks it up automatically

The import/merge UI is a one-time setup flow, but the import logic (parse Fusion JSON, parse ProShop CSV) stays in the codebase for future use.

-----

## Phases

### Phase 1 — Foundation ✅ Build This First

- Google OAuth login
- Load both JSON files from Drive into memory
- **Landing page = cascading faceted search** (as described above)
- Tool detail view — all fields merged, organized into sections
- Edit tool inline — save back to Drive
- Add new tool — tool extractor flow + manual form
- Delete tool with confirmation
- Validation (required fields, numeric ranges)
- Export single tool: Fusion JSON, ProShop CSV
- Export full library: ProShop CSV bulk export
- **One-time import flow**: Fusion JSON import, ProShop CSV import with merge

### Phase 2 — Compare & Merge

- Import a modified tool JSON from a job file
- Diff against current master
- Side-by-side comparison, user selects what to commit
- Write back to both JSON files
- Duplicate detection

### Phase 3 — Program Indexing (future)

- Read program CSVs from Drive folder
- Parse tool IDs, link to tools
- Show “Used in programs: 1042, 1087” on tool detail
- Background refresh

### Phase 4 — Speeds & Feeds Intelligence (future)

- Material-based recommendations, TBD

-----

## Key Constraints

- Tool IDs are permanent — they link the two JSON files and future features
- Always read before write — prevents teammates overwriting each other
- Never put extra fields in the Fusion JSON — only Fusion-native fields go there
- GitHub Pages = HashRouter, not BrowserRouter
- Keep `.env` out of git — use `.env.example`
- ProShop export is a permanent feature, never remove it

-----

## Existing Code to Incorporate

The `tool-extractor.jsx` file contains:

- Full tool type definitions
- All required fields per tool type
- Fusion 360 ↔ ProShop field mapping table
- Image → tool data extraction UI (keep this as a feature, launched from Add New Tool)

Start from this file as the data schema foundation.
