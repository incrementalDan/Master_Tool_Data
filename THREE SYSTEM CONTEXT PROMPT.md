# Context: Three-System Identification Architecture

## Read before working on any ID, location, or assembly numbering feature.

This app has three parallel configurable identification systems. They were
designed to follow the same architectural principles intentionally. Understanding
the pattern is essential before touching any of them.

---

## The Three Systems

| System | Config key | What it identifies | "Which configuration" selector | Status |
|--------|-----------|-------------------|-----------|--------|
| Tool ID | `tool_id_system` | The tool itself | `mode`: proshop / location / sequential / type_prefix / size_first / machine_linked / other_erp | Built |
| Location | `location_config` | Where the tool physically lives | the **location *system*** the tool belongs to (`location_config.systems[]`) | Built |
| Assembly ID | `assembly_id_system` | A specific tool+holder assembly | `mode`: auto / proshop_rta / sequential / erp_external | Built |

All three live in `shop_settings.json` and are loaded at startup alongside
`tool_metadata.json`.

**On the word "mode" vs "system":** every identification system has a
user-chosen selector for *which way an ID is generated/configured*. Tool ID
calls it `mode`; the Location system calls each option a **"system"** because it
maps to a real physical place (a tool *belongs to* a cabinet/zone system, it
isn't "in sequential mode"). **Different words, same role.** The Bin's
auto-increment-vs-fixed choice is just *one field inside* a location system — it
is **not** itself a mode/system. Assembly ID, not being tied to a place, will
use `mode` like Tool ID.

---

## Shared Architectural Principles

Every system follows these rules — no exceptions:

**1. Stable UUIDs internally, human-readable strings as output**
Internal records reference other records by UUID. Display strings are composed
at read time from those UUID references, never stored. This is the same pattern
used in `vendor_registry.json` (entity UUIDs) and `materials.json` (group IDs).

**2. Configurable — an explicit, user-chosen selector**
Each system exposes an explicit selector for *which way an ID is
generated/configured*, picked in settings. Every option produces the same
internal data shape — only the generation logic differs. Tool ID names this
selector `mode` (the ID scheme). The Location system names each option a
**"system"** — the user picks which physical location system a tool belongs to;
"system" is used instead of "mode" because it's tied to a real place, but it
plays the **same role** as Tool ID's `mode`. (The Bin's auto-increment-vs-fixed
choice is a field *within* a location system, not a mode of its own.) Assembly
ID should ship with an explicit `mode` from the start, not an implicit shape.

**3. Normalize/migrate action for legacy data**
When a shop already has location strings or IDs in free text (from ProShop,
Fusion, or manual entry), a normalize action parses those strings, maps them
to the new structured format, and stores the structured version. This is
always a preview-then-commit flow, never silent.

**4. Legacy reference tracking**
When switching modes, renumbering, or normalizing, old values go to a `legacy_*`
array on the record (e.g. `legacy_ids[]`, `legacy_locations[]`). Legacy values
stay searchable and are used for import matching. Whether they are *displayed*
is governed by a per-system **`show_legacy` toggle** in settings: Tool ID
defaults **on** (shows a muted "Formerly:" line), Location and Assembly default
**off**. Regardless of the toggle, a search that *matches* a legacy value always
surfaces it on the result card — the toggle only controls always-on display.

**5. Source of truth hierarchy**
This app owns the data. Fusion and ProShop are outputs. When a value exists
in metadata, it wins over what Fusion or ProShop has. The normalize action
establishes this app as the authority for that system.

**6. Clean path to SQLite**
Every entity that has a list (location options, assembly modes, etc.) carries
a UUID so it can become a database table row. No ID is derived from display
text — display text can change, IDs cannot.

---

## Settings UI

All three systems appear in Settings as adjacent, visually connected sections.
They are related — the location system can drive the tool ID system (location
mode), and the assembly ID uses the tool ID as a component. A user who
understands one system should immediately understand the others.

## Setup Wizard

The initial setup checklist walks through all three in sequence as related
steps, configured right after the data sources (Fusion + Drive) are connected:
1. Choose your tool ID format
2. Configure your storage location system
3. Configure your assembly ID format

These are not three unrelated settings screens. They are three steps in the
same conceptual setup flow. They live in the unified setup checklist
(`SETUP_STEPS` in `src/context/AppContext.jsx`: `toolIdConfigured`,
`locationConfigured`, `assemblyIdConfigured`) and check off when the user saves
that system's config. The **assembly step is a disabled "coming soon"
placeholder** (`disabled: true`, excluded from the completion/progress math)
until the Assembly ID system ships.

---

## What this means in practice

When building any of these features:
- UI patterns should be consistent across all three systems
- Error states, normalize flows, and legacy displays should look and behave
  the same way
- Settings placement should reinforce that they are related
- CLAUDE.md entries for all three should cross-reference each other

This architecture was independently derived from the same principles as GS1's
identification standards (GTIN/GLN/SSCC) — three parallel ID systems for
product, location, and shipment. The parallel to CNC tooling is intentional
and worth preserving.

---

## Current status (what's actually wired)

The two built systems were brought into alignment with these principles before
the third is added — so Assembly ID can be copied from a consistent pattern. As
of this pass:

- **Legacy tracking is at parity.** `legacy_locations[]` is now populated on
  Location normalize (mirroring how `renumberAllToolIds` retires `legacy_ids`),
  is searchable (`searchEngine.matchedLegacyLocation` + included in `textSearch`),
  and a retired location is no longer re-imported from ProShop.
- **Selector parallel documented.** Tool ID's `mode` and the Location system's
  per-tool "which system" choice are the same kind of selector under different
  words — noted here and in CLAUDE.md. The Bin's auto/fixed picker stays a field
  inside a system (not elevated to a mode).
- **`show_legacy` toggle** added to both systems (Tool ID on, Location off).
- **Setup wizard** has the three ID/location/assembly steps (all now real,
  completable).
- **SQLite cleanliness:** `bin_sizes` seed id is a UUID, not the old `'standard'`.

**Assembly ID system (built).** `assembly_id_system` config with an explicit
`mode` (auto / proshop_rta / sequential / erp_external) + `show_legacy: false`
(no renumber → no `legacy_*` retirement). `asm_number` is stored per assembly,
immutable, generated once in `writeLogicalTool` (auto backfilled in-memory at
load). Five gauge-length tiers added per assembly (`target_gauge_length`,
`measured_gauge_length`, `measured_at`, `measured_by`, `measured_serial`) —
`geometry.assemblyGaugeLength` (Fusion) is never overridden. Settings has the
Assembly ID card; the `assemblyIdConfigured` setup step is enabled. See the
**Assembly ID System** section in CLAUDE.md. Pending: ProShop RTA CSV format,
the collet-correction `target_gauge_length` formula, and presetter measurement
entry (all flagged as TODO / data-only).
