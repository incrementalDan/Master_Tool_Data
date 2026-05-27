# Fusion Tool Library Manager

## Project Overview

A web application for managing a CNC cutting tool library. It replaces a fragmented, manual workflow where tools are pulled from a master Fusion library, modified per-job, and rarely synced back — causing duplicates and data loss.

The app reads and writes directly to JSON files stored on Google Drive, which Fusion 360 can also read. A separate metadata JSON on the same Drive stores additional fields beyond what Fusion supports. The app acts as the single source of truth, keeping everything in sync across the team.

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

## Architecture

```
Google Drive
├── fusion_tool_library.json     ← Fusion 360 reads this directly
└── tool_metadata.json           ← Extra fields Fusion doesn't support

Web App (GitHub Pages)
├── Reads both JSON files via Google Drive API
├── Displays, edits, and validates tools
├── Writes changes back to both JSON files
└── Phase 2: Compare/merge interface for syncing job edits to master
```

-----

## Tech Stack

- **Frontend**: React (hosted on GitHub Pages)
- **Storage**: Google Drive API (two JSON files as described above)
- **Auth**: Google OAuth (user signs in with their Google account tied to the shared Drive)
- **No backend server** — everything runs client-side via Google Drive API

-----

## Data Model

### Tool Types

Each tool has a `type` field that determines which fields are required. Tool types match what Fusion 360 and ProShop support:

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
  "id": "unique string ID",
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

## Phases

### Phase 1 — Foundation ✅ Build This First

- Google OAuth login
- Load `fusion_tool_library.json` and `tool_metadata.json` from Google Drive
- Display tool list with search, filter by type, filter by tag
- Tool detail view showing all fields from both files merged together
- Edit tool — update any field, save back to both JSON files
- Add new tool — form with required fields per tool type
- Delete tool (with confirmation)
- Basic validation (required fields, numeric ranges)
- Export single tool to Fusion 360 JSON format
- Export single tool to ProShop CSV format
- Tool Extractor feature (image → tool data) lives here as a tab or modal

### Phase 2 — Compare & Merge

- Import a modified tool JSON (from a job file)
- Diff it against the current master version of that tool
- Show a side-by-side comparison of what changed
- User selects which changes to commit to master
- Commit writes back to `fusion_tool_library.json` and `tool_metadata.json`
- Duplicate detection — warn if a tool with similar specs already exists

### Phase 3 — Program Indexing (future)

- Read program CSV files from a Google Drive folder
- Parse tool IDs from each CSV
- Link program numbers to tools
- Show on tool detail: “Used in programs: 1042, 1087, 2031”
- Background refresh when viewing a tool

### Phase 4 — Speeds & Feeds Intelligence (future)

- TBD — likely material-based recommendations

-----

## Key Constraints

- Must work across the whole team via shared Google Drive
- No data loss — Drive file history is the backup
- No backend server — keep it simple and hostable on GitHub Pages
- Tool IDs must be stable — they’re the link between the two JSON files and future program indexing
- Don’t modify Fusion JSON structure beyond what Fusion expects — extra fields go in the metadata file

-----

## Existing Code to Incorporate

The `tool-extractor.jsx` file contains:

- Full tool type definitions
- All required fields per tool type
- Fusion 360 ↔ ProShop field mapping table
- Image → tool data extraction UI (keep this as a feature tab)

Start from this file as the data schema foundation.