# Context: Three-System Identification Architecture

## Read before working on any ID, location, or assembly numbering feature.

This app has three parallel configurable identification systems. They were
designed to follow the same architectural principles intentionally. Understanding
the pattern is essential before touching any of them.

---

## The Three Systems

| System | Config key | What it identifies | Mode field | Status |
|--------|-----------|-------------------|-----------|--------|
| Tool ID | `tool_id_system` | The tool itself | `mode`: proshop / location / sequential / type_prefix / size_first / machine_linked / other_erp | Built |
| Location | `location_config` | Where the tool physically lives | per-system `mode`: sequential / fixed / manual (bin generation) | Built |
| Assembly ID | `assembly_id_system` | A specific tool+holder assembly | `mode` (design with an explicit enum from day one) | Pending |

All three live in `shop_settings.json` and are loaded at startup alongside
`tool_metadata.json`.

---

## Shared Architectural Principles

Every system follows these rules — no exceptions:

**1. Stable UUIDs internally, human-readable strings as output**
Internal records reference other records by UUID. Display strings are composed
at read time from those UUID references, never stored. This is the same pattern
used in `vendor_registry.json` (entity UUIDs) and `materials.json` (group IDs).

**2. Configurable modes — an explicit `mode` enum**
Each system exposes an explicit `mode` field that the user picks in settings.
All modes produce the same internal data shape — only the generation logic
differs. Tool ID's `mode` selects the ID scheme; Location's per-system `mode`
(`sequential` / `fixed` / `manual`) selects the bin-numbering strategy (and
keeps the implicit `bin.fixed` flag in sync); Assembly ID should be designed
with an explicit `mode` from the start, not an implicit config shape.

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
- **Explicit `mode` everywhere.** Location gained a per-system `mode`
  (`sequential` / `fixed` / `manual`) surfaced in settings, parallel to Tool ID.
- **`show_legacy` toggle** added to both systems (Tool ID on, Location off).
- **Setup wizard** now has the three ID/location/assembly steps (assembly
  disabled until it ships).
- **SQLite cleanliness:** `bin_sizes` seed id is a UUID, not the old `'standard'`.

**Pending / when Assembly ID is built:** give it a `assembly_id_system` config
with an explicit `mode`, a `legacy_*` array + `show_legacy: false`, a
preview→commit normalize, and the now-enabled `assemblyIdConfigured` setup step.
Cross-reference its CLAUDE.md section to the Tool ID and Location sections.
