# Phase A — Complete Tool Record & SQLite Schema Design

**Date:** 2026-07-06
**Companion to:** `FUSION_DECOUPLING_AUDIT.md` (Part 3). This is the "design the full tool record + SQLite schema together" deliverable that Part 3's order-of-operations calls for.
**Status:** design only — no implementation. Field set is extracted verbatim from `src/schema/fieldRegistry.js` (81 tool-level fields), `metadataModel.js`, `PresetPanel.blankPreset`, `insertFamilies.newComponent/newPairing`, and `jobs.json` v2 — **not invented**.

**What this locks in:** every field the app models, *who owns it* (app vs. Fusion vs. shared), what happens on a Fusion conflict (D2), and the SQLite table/column it maps to. Implement this shape on today's JSON storage first (behavior-identical), then swap the storage layer to SQLite later.

---

## 1. Design principles (the ground rules the schema obeys)

1. **The app record is complete and standalone (D1).** Today the app record is an *overlay* — it has no `tool_type`, `description`, geometry, `unit`, or presets; those live only in Fusion. After Phase A the app record holds **everything**, so a tool can exist with zero Fusion entries.
2. **Fusion is a removable adapter, not the spine.** All Fusion-side data (raw JSON, instance guids, holder internals) lives in **separate tables that a no-Fusion tool simply doesn't have rows in**. Dropping the Fusion integration = ignoring those tables, never a schema change.
3. **Conflict authority is a setting (D2), and it only governs shared cutting/geometry data.** The identifiers the TMS already owns (`tool_id`, `location`, `machine_tool_number`) are *always* app-authoritative — the toggle never touches them.
4. **Stable UUIDs everywhere; normalized shapes; FK references, not embedded copies.** (The repo's existing SQLite guidance.) No positional indexes as keys; arrays become child tables; the `purchasing.manufacturers/vendors`, jobs, and location-UUID patterns are the model to extend.
5. **Preserve un-modeled Fusion fields byte-for-byte.** The round-trip audit passes because writes preserve `...existing` (turning geometry, native formulas, expressions the app doesn't model). The schema keeps a **`raw_json` blob per Fusion instance and per preset** so nothing is lost on round-trip.
6. **Derived values are never stored** — composed location string, `proshop_location`, Auto `asm_number`, pairing asm number, combined ProShop id, `O####` program form. Computed at read, same as today.

---

## 2. Ownership taxonomy (5 categories — every field is exactly one)

This is the single most important table in the doc: it's what makes D2 a one-branch change instead of a rewrite.

| # | Category | Who is source of truth | On Fusion conflict | Exists for a no-Fusion tool? |
|---|---|---|---|---|
| **1** | **App-owned** (`metadataOnly: true`) | App store | n/a — no Fusion copy | Yes |
| **2** | **App-owned, mirrored to Fusion** | App store (always wins) | App wins **always** (not D2-governed) | Yes (just not mirrored) |
| **3** | **Shared / D2-governed** (Fusion-native, `metadataOnly: false`) | Configurable | `authority` setting picks winner | Yes (app is sole source) |
| **4** | **Fusion-structural** (un-modeled) | Fusion | Fusion only; app caches | **No** (this is the adapter layer) |
| **5** | **Derived** | Computed at read | n/a | Yes |

- **Category 2** is exactly three fields — `tool_id` (→ `product-id`), `location` (→ `expressions.tool_vendor`), `machine_tool_number` (→ `post-process.number`). Doc rule today: "metadata wins." They get *mirrored* into the Fusion write but the app is authoritative on read regardless of the D2 setting.
- **Category 3** is where the D2 toggle lives: `tool_type`, `description`, `unit`, all `geometry.*`, `material` (BMC), and the presets. `authority: 'fusion'` (default) = today's behavior exactly; `authority: 'app'` = app value wins and is pushed.
- **Category 4** is the `raw_json` blobs + instance guids. A no-Fusion tool has none — which is the entire point.

---

## 3. Entity–relationship overview

```
shop_settings (singleton config)
material_groups ─< cam_presets ─< alloys
vendor_entities ─< vendor_aliases
machines
parts ─< programs           jobs (program#+part# link)
                              │
tools ──────────────┬─────────┼───────────────┐
 │                  │         │               │
 ├─< assemblies ─── │ ──1:0..1─> fusion_instances (raw_json)   ← THE adapter layer
 │        │         │
 │        └─>< assembly_presets >─┐
 ├─< tool_presets ────────────────┘  (raw_json per preset)
 │        └─< preset_jobs >── jobs
 ├─< tool_jobs >── jobs
 ├─< purchasing_manufacturers ─< purchasing_vendors
 ├─< speed_feed_refs ── cam_presets
 ├─< merge_history
 ├─< attachments,  legacy_ids
 └─1:0..1─ tool_pairings ── components (holder_body / insert)
                                  └─< (components own purchasing, attachments,
                                       location, legacy_locations too)
```

- **`tools` → `assemblies` → `fusion_instances`** is the decoupling spine. An assembly is an app concept (holder + OOH). It maps to **0-or-1** `fusion_instances` row. **Linked tool** = ≥1 assembly has a fusion_instance; **unlinked/no-Fusion tool** = zero fusion_instances rows anywhere. That single fact replaces today's "every assembly IS a Fusion entry, minimum 1" invariant.

---

## 4. The `tools` table — scalar fields, grouped, with ownership

One row per **logical tool**. PK is a surrogate `id` UUID; `tracking_id` is the stable business key (today's `FTL-XXXXXX`, the Fusion↔metadata join). Every field below is a column on `tools` unless it says "→ *table*".

### 4a. Identity & system

| Field | Type | Owner | Fusion path | ProShop | Notes |
|---|---|---|---|---|---|
| `id` | uuid | — | — | — | surrogate PK |
| `tracking_id` | string | 2 | native comment | — | unique; the join key |
| `tool_type` | string | **3** | `type` | — | D2-governed |
| `description` | string | **3** | `description` | Tool Description | D2-governed |
| `unit` | string | **3** | `unit` | — | `inches`/`millimeters` |
| `tool_id` | string | **2** | `product-id` | Tool # | app wins always |
| `location` (string) | string | **2** | `expressions.tool_vendor` | Location | app wins; *derived* when structured (see `tool_location`) |
| `machine_tool_number` | number | **2** | `post-process.number` | — | app wins always |
| `grouping` | string | 1 | — | Tool Group | ProShop cabinet letter |
| `preset_name` | string | 1 | — | — | legacy |
| `no_fusion_link` | boolean | 1 | — | — | **retire after Phase B** (replaced by "has zero fusion_instances") |
| `vendor` (manufacturer) | string | 1 | — | Manufacturer | never written to Fusion |
| `coating` | string | 1 | — | Coating | |
| `material` | string | **3** | `BMC` | Tool Material | |
| `preferred_machine` | string | 1 | — | — | |
| `selected_holder_guid` | string | 1 | — | — | |
| `library_id` | uuid | **4** | (runtime) | — | which Fusion file; **null for no-Fusion tools** |

### 4b. Geometry (all Category 3 — D2-governed; all `canonicalUnit: native`)

| Field | Fusion path | | Field | Fusion path |
|---|---|---|---|---|
| `diameter` | `geometry.DC` | | `tip_diameter` | `geometry.tip-diameter` |
| `flute_length` | `geometry.LCF` | | `thread_pitch` | `geometry.TP` |
| `overall_length` | `geometry.OAL` | | `shoulder_length` | `geometry.shoulder-length` |
| `number_of_flutes` | `geometry.NOF` | | `cutting_direction` | `geometry.HAND` |
| `shank_diameter` | `geometry.SFDM` | | `tip_angle` | `geometry.SIG` |
| `corner_radius` | `geometry.RE` | | `taper_angle` | `geometry.TA` |

App-owned geometry-ish (Category 1, `metadataOnly`, no Fusion field): `lower_radius`, `upper_radius`, `profile_radius`, `axial_distance`, `min_ooh`, `helix_angle`, `depth_of_cut`, `width_of_cut`. (`ooh` is per-**assembly** → `geometry.LB`; see §5.)

### 4c. Tap / thread (all Category 1 app-owned except `thread_pitch` above)

`pitch`, `tap_class`, `class_of_fit`, `tap_sub_type`, `is_sti`, `tap_thread_unit`, `min_thread_pitch`, `max_thread_pitch`, `tpi_min`, `tpi_max`, `thread_profile_angle`, `point_type`, `tip_to_first_thread`, `stub_jobber`, `full_profile`, `double_ended`, `backside_capable`, `center_cutting`, `flute_type`, `flute_design`, `custom_grind`, `tsc_capable`.

### 4d. Flat speed/feed mirror (Category 3 — mirror of `presets[0]`, kept for non-editor forms)

`spindle_speed`(n), `cutting_feedrate`(v_f), `plunge_feedrate`(v_f_plunge), `ramp_feedrate`(v_f_ramp), `lead_in_feedrate`(v_f_leadIn), `lead_out_feedrate`(v_f_leadOut), `feed_per_tooth`(f_z), `feed_per_rev`(f_n), `cutting_speed`(v_c). **Open question O1:** keep these denormalized on `tools`, or derive from preset row 0? (Recommend: keep — they're a cheap read cache and some forms use them without loading presets.)

### 4e. Provenance & housekeeping (Category 1)

`updated_by`, `revision_notes`, `created_at`, `updated_at`, `last_used_job` (retired from UI, kept for data).

### 4f. → child tables (arrays/objects, NOT columns on `tools`)

`presets` → **tool_presets**; `assemblies` → **assemblies**; `purchasing` → **purchasing_manufacturers/vendors**; `tags`, `material_suitability` → **tool_tags / tool_material_suitability** (or a JSON column — see O2); `job_ids` → **tool_jobs**; `speed_feed_refs` → **speed_feed_refs**; `merge_history` → **merge_history**; `attachments` → **attachments**; `legacy_ids` → **legacy_ids**; `tool_location` → **columns** (system_id, zone_id, station_id, drawer_id, bin) or a small **tool_location** 1:1 table; `bin_size_id` → column; `pairing` → **tool_pairings**; `primary_photo_id`/`primary_photo_name` → columns.

---

## 5. `assemblies` and `fusion_instances` — the decoupling core

**`assemblies`** (app-owned — a holder + OOH combo proven on this tool):

| Column | Type | Owner | Notes |
|---|---|---|---|
| `id` (assembly_id) | uuid | 1 | |
| `tool_id` | uuid FK→tools | 1 | |
| `holder_guid` | string | 1 | FK-ish to holder library (external) |
| `holder_description` | string | 1 | cached label |
| `ooh` | number | **3** | per-instance stick-out → `geometry.LB` when linked |
| `asm_number` | string | 1 | Auto = derived/not stored; RTA/sequential = stored |
| `notes`, `source` | string | 1 | |
| `target_gauge_length` | number | 1 | formula TBD |
| `measured_gauge_length` | number | 1 | immutable physical reading |
| `measured_at` / `measured_by` / `measured_serial` | — | 1 | presetter provenance |
| `created_at` | ts | 1 | |
| → `legacy_asm_numbers` | | 1 | child table |
| → `assembly_presets` | | 1 | M:N join to tool_presets |

**`fusion_instances`** (Category 4 — the adapter layer; **no rows for a no-Fusion tool**):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `assembly_id` | uuid FK→assemblies | **1:0..1** — an assembly has zero or one Fusion instance |
| `guid` | string | the Fusion entry guid (today's `instance_guid`) |
| `library_id` | uuid | which Fusion file it lives in |
| `raw_json` | blob/json | the full Fusion entry — **preserves every un-modeled field** for byte-for-byte round-trip |

- **`tool.is_linked`** = `EXISTS (fusion_instance for any of its assemblies)`. Replaces `no_fusion_link` and the "≥1 instance" invariant.
- **Promote** (create Fusion entry) = insert fusion_instances rows + split/write to Fusion. **Detach** = delete fusion_instances rows, keep assemblies. These are the two halves of today's `writeLogicalTool`.

---

## 6. `tool_presets` — presets become app-owned (Category 3)

Today presets live **only** in Fusion. Phase A moves them into the app record; `raw_json` preserves the Fusion-native extras (`normalizePreset` preserves `...rest`).

| Column | Type | Owner | Source |
|---|---|---|---|
| `id` (guid) | uuid | 1 | stable across rename (job links key on it) |
| `tool_id` | uuid FK | 1 | |
| `name` | string | 3 | the durable convention name |
| `operation_type` | string | 1 | **app-only** — never in Fusion JSON (parsed from name) |
| `machine_id` | uuid FK→machines | 1 | **app-only** |
| `material_query` | string | 3 | `material.query` |
| `n`,`v_c`,`v_f`,`f_z`,`f_n`,`v_f_plunge`,`v_f_retract`,`v_f_ramp`,`v_f_leadIn`,`v_f_leadOut`,`v_f_transition`,`n_ramp` | number | 3 | speeds/feeds |
| `use_stepdown`,`stepdown`,`use_stepover`,`stepover`,`ramp_angle`,`ramp_spindle_speed` | mixed | 3 | (the three-way stepdown sync stays in the Fusion adapter, not the schema) |
| `tool_coolant` | string | 3 | |
| `raw_json` | blob | 4 | un-modeled Fusion preset fields + expressions |
| → `preset_jobs` | | 1 | M:N join to jobs (the `job_ids`) |

**Open question O3:** `operation_type`/`machine_id`/`job_ids` are app-only and must **never** serialize into `raw_json` or the Fusion write (today enforced by `normalizePreset`'s destructure). In SQLite they're just columns/joins, so the leak risk goes away — but the Fusion *writer* must still strip them. Keep that rule in the adapter.

---

## 7. Insert components & pairings

**`components`** (holder body / insert — metadata-only, never in Fusion; from `newComponent`):

`id`, `role` (`holder_body`/`insert`), `family`, `tool_id`, `description`, `designation`, `size`, `corner_radius`, `overall_length`, `shank_size`, `grade`, `coating`, `unit`, `notes`, `location` (string), `bin_size_id`, `primary_photo_id/name`, `created_at`, `updated_at`. → child tables: `tool_location` cols, `legacy_locations`, `purchasing_*`, `attachments` (all via `owner_type='component'`).

**`tool_pairings`** (1:0..1 with tools; from `newPairing`):

`tool_id` (PK/FK), `family`, `holder_component_id` FK→components, `insert_component_id` FK→components, `rta_number`. Null row = regular tool.

- **Constraint to add:** unique index on `components.tool_id` (normalized) — this is F4 (the duplicate-component-id guard) enforced at the DB level instead of in the UI. **This is a payoff of the migration**: F3/F4 stop being app-code concerns.

---

## 8. Jobs domain (already normalized in jobs.json v2 → near-direct table mapping)

- **`parts`**: `id`, `part_number`, `customer`, `rev`, `material_id` FK→alloys, `material_custom`, `created_at`, `created_by`.
- **`programs`**: `id`, `program_number` (int, permanent, unique), `part_id` FK, `operation`, `description`, `machine_id` FK→machines, `machine_label`, `is_fixture`, `internal_external`, `fixturing`, `material_id` FK→alloys, `material_custom`, `pallet`, `created_at`, `created_by`.
- **`jobs`** (the program#+part# link registry): `id`, `program_number`, `part_number`, `program_id` FK→programs, `created_at`, `created_by`, `notes`.
- **Join tables:** `tool_jobs (tool_id, job_id)`, `preset_jobs (preset_id, job_id)`.
- **`speed_feed_refs`**: `id`, `tool_id` FK, `cam_preset_id` FK→**cam_presets** (⚠ *not* tool_presets — naming clash to rename on migration: call it `cam_preset_id`), `operation_type`, `sfm`, `chip_load`.

---

## 9. Shop-wide reference tables (from the shared Drive files)

- **Materials (3-tier):** `material_groups` (P/M/K/N/S/H, color, code, iso) → `cam_presets` (group_id FK, name, code, iso_513, kennametal, vdi_3323, order) → `alloys` (group_id, preset_id FK, label, category, condition, code, iso_513, kennametal, notes, order) + `alloy_aliases (alloy_id, alias)`.
- **Vendors:** `vendor_entities` (unified: name, is_manufacturer, is_vendor, has_own_catalog_number, material_code_system, edp_url_pattern, vendor_num_url_pattern, proshop_id) + `vendor_aliases (entity_id, alias)`.
- **Machines:** `machines` (id, model, machine_type, taper, max_rpm, horsepower, through_coolant, through_coolant_psi, order).
- **`shop_settings`:** stays a **config document/singleton** (it's genuinely config, edited as a unit): shop_name, default_units, `integrations.fusion.{enabled, authority}` (**D2 lives here**), machine_number{start,skip}, default_machine_id, tool_id_system{…}, location_config{systems[…], bin_sizes[…]}, assembly_id_system{…}, presetter{…}, setup_steps{…}. **Open question O4:** location systems + bin sizes are borderline entity-ish; leaving them nested in config is fine for now (they're edited as a unit and referenced by UUID), normalize later if a UI needs to query across them.

---

## 10. How D2 (authority) actually resolves — the one load-time branch

On load, per tool, per **Category-3** field, pick the value:

```
value = (authority === 'app' && appRecord.hasValue(field))
          ? appRecord[field]                     // app wins → push to Fusion on next write
          : fusionInstance ? fusionValue(field)  // fusion wins (today's default)
                           : appRecord[field];   // no Fusion entry → app is sole source
```

- Categories 1 & 2: **always** `appRecord[field]` (2 is mirrored out on write).
- Category 4: always from `fusion_instances.raw_json`.
- No-Fusion tool: no fusion_instance, so every field resolves to the app record regardless of `authority` — the toggle is a no-op for it, exactly as it should be.
- The **guarded flip** (D2): before switching `authority` to `'app'`, run the existing reconcile/Sync-Job pull so nothing Fusion-side is lost, *then* flip. Switching back runs the reverse. This is a settings action, not a schema concern.

**This is the whole D2 cost:** one branch here + the guarded-flip settings action. Everything else is unchanged.

---

## 11. Migration & sequencing

1. **Build this record shape on today's JSON storage** (no SQLite yet). `mergeFusionAndMetadata` grows to populate the now-complete record; `internalToFusionTool` is unchanged (still the Fusion writer). Default `authority: 'fusion'` → **behavior identical**, round-trip audit stays green.
2. **No migration shims** — per the repo rule and the disposable-metadata window. When the shop commits for real, the app record is authoritative from day one.
3. **SQLite swap is a later, separate step:** replace the `driveService` / shared-file read-write layer with a SQLite-backed repository exposing the same interface the actions already call. The tables above are the target; the record shape won't change again.
4. **The seam already exists:** every write funnels through `writeLogicalTool` / `saveFullLibrary` / `saveSharedFile` / `driveService`. That's the repository boundary both the Fusion-adapter split and the SQLite swap need — one refactor, both payoffs.

---

## 12. Open questions for the owner (decide during implementation, not blocking)

- **O1 — flat speed/feed mirror on `tools`:** keep denormalized (recommended, cheap read cache) or derive from `tool_presets` row 0?
- **O2 — `tags` / `material_suitability`:** child tables (queryable/faceted) vs. a JSON column (simpler). Search facets on them today suggest **child tables**.
- **O3 — app-only preset fields:** confirmed they must never reach the Fusion write; the adapter keeps stripping them (schema makes them plain columns).
- **O4 — location systems / bin sizes:** keep nested in `shop_settings` config (recommended for now) or normalize into tables?
- **O5 — unify `tools` + `components`?** Both are "tool-like records with tool_id + location + purchasing + photo." A future single `items` table with a `kind` could simplify purchasing/attachments (drop the polymorphic `owner_type`). **Recommendation: don't unify in Phase A** — components are deliberately Fusion-invisible and browse-only; keep them separate, revisit only if the "component = unlinked tool" idea from the audit's Phase C is pursued.

---

## What I did & why

- **Pulled the field set straight from `fieldRegistry.js` (81 fields) and the factory functions** rather than reconstructing it from memory — the ownership column (app / mirrored / shared / structural / derived) is grounded in the real `metadataOnly` flags and the documented "metadata wins" rules, so the D2 boundary is exact.
- **Made `fusion_instances` a separate table with a `raw_json` blob** — that one modeling choice is what turns "decouple from Fusion" into "a table some tools don't have rows in," and it's also what preserves the round-trip audit (un-modeled Fusion fields are never dropped).
- **Kept D2 to a single documented load-time branch** so the "user chooses who wins" feature is provably cheap, and flagged the five real implementation questions (O1–O5) instead of silently baking in answers.
