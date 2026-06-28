# Context: Three-System Identification Architecture

## Read before working on any ID, location, or assembly numbering feature.

This app has three parallel configurable identification systems. They were
designed to follow the same architectural principles intentionally. Understanding
the pattern is essential before touching any of them.

---

## The Three Systems

| System | Config key | What it identifies | Status |
|--------|-----------|-------------------|--------|
| Tool ID | `tool_id_system` | The tool itself | Built |
| Location | `location_config` | Where the tool physically lives | Built |
| Assembly ID | `assembly_id_system` | A specific tool+holder assembly | Pending |

All three live in `shop_settings.json` and are loaded at startup alongside
`tool_metadata.json`.

---

## Shared Architectural Principles

Every system follows these rules — no exceptions:

**1. Stable UUIDs internally, human-readable strings as output**
Internal records reference other records by UUID. Display strings are composed
at read time from those UUID references, never stored. This is the same pattern
used in `vendor_registry.json` (entity UUIDs) and `materials.json` (group IDs).

**2. Configurable modes**
Each system supports multiple modes (sequential, prefix-based, location-driven,
ERP-compatible, etc.). The user picks a mode in settings. All modes produce the
same internal data shape — only the generation logic differs.

**3. Normalize/migrate action for legacy data**
When a shop already has location strings or IDs in free text (from ProShop,
Fusion, or manual entry), a normalize action parses those strings, maps them
to the new structured format, and stores the structured version. This is
always a preview-then-commit flow, never silent.

**4. Legacy reference tracking**
When switching modes or renumbering, old values go to a `legacy_*` array
on the record (e.g. `legacy_ids[]`, `legacy_locations[]`). Legacy values
stay searchable and are used for import matching. They are hidden from the
UI by default.

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

The initial setup flow walks through all three in sequence as related steps:
1. Choose your tool ID format
2. Configure your storage location system
3. Configure your assembly ID format

These are not three unrelated settings screens. They are three steps in the
same conceptual setup flow.

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
