# Phase A — Complete Tool Record & SQLite Schema Design

**Date:** 2026-07-06
**Companion to:** `FUSION_DECOUPLING_AUDIT.md` (Part 3). This is the "design the full tool record + SQLite schema together" deliverable that Part 3's order-of-operations calls for.
**Field set** is extracted verbatim from `src/schema/fieldRegistry.js` (81 tool-level fields), `metadataModel.js`, `PresetPanel.blankPreset`, `insertFamilies.newComponent/newPairing`, and `jobs.json` v2 — **not invented**.

**Implementation status:**
- ✅ **Increment 1 — complete scalar record (done).** `buildMetadataTool` now persists the Fusion-native identity + geometry + unit + material scalars (§4a/§4b); `mergeFusionAndMetadata` reads them back with Fusion still winning for linked tools (the `tip_angle` fallback pattern). `integrations.fusion.{enabled, authority}` scaffolded in `DEFAULT_SHOP_SETTINGS`. **Behavior byte-for-byte unchanged.**
- ✅ **Increment 2 — presets into the app record (done).** `buildMetadataTool` persists the FULL preset set (modeled speeds/feeds + un-modeled Fusion-native keys + app-only fields — the JSON equivalent of the `tool_presets` row + its `raw_json`); `buildLogicalTool` sources presets from Fusion for a linked tool and **falls back to the metadata presets when the Fusion side has none** (a no-Fusion tool). `preset_meta` is retained as the linked-read overlay (redundant-but-consistent subset; folds into columns at the SQLite migration). **Linked-tool reads byte-for-byte unchanged** — 189 tests + round-trip audit green. **The app record is now complete** (scalars + presets); it can reconstruct a tool with no Fusion entry.
- 🔨 **Phase B (in progress)** — where behavior deliberately extends. Decomposed:
  - ✅ **B1 — foundation (done).** `buildUnlinkedTool(meta)` reconstructs a complete logical tool from metadata alone (identity + geometry + presets + assemblies, flat speed/feed derived from preset 0 per O1, `_instancesRaw: []`, `library_id: null`). `isUnlinkedMeta(meta)` = the **orphan-ghost guard**: only an explicitly-marked (`no_fusion_link`) record is materialized, so a tool deleted directly in Fusion 360 (unmarked orphan metadata) stays dormant instead of resurrecting as a ghost. Preset overlay extracted to shared `overlayPresets`. Pure + fully tested; **zero wiring, zero behavior change** (191 tests + audit green).
  - ✅ **B2 — load-append (done).** `materializeUnlinkedTools(builtTools, metaList)` appends a `buildUnlinkedTool` for each marked, unrepresented metadata record; wired into `loadTools` right before pairing/backfill so unlinked tools get identical in-memory treatment. Triple-guarded (marked-only / not-already-built / malformed-skipped). **A no-op on today's data** (marked tools still carry a Fusion placeholder → not orphaned), so zero behavior change now; activates once B3/Phase C retires placeholder-minting. 195 tests + audit green. *(Deferred to a later increment: the "Fusion disabled, no libraries" mode + relaxing the hard error — that belongs with the B4 onboarding toggle.)*
  - ✅ **B3 — no-Fusion write path (done; Option A — placeholder-minting retired).** `writeLogicalTool` early-branches on `no_fusion_link`: metadata-only, **no Fusion library round-trip** (proven by a mocked-Drive test that fails if `download/uploadFusionList` is called), `library_id` cleared to null, Drive required. `deleteTool` removes metadata only for a no-Fusion tool. `saveFullLibrary` **partitions** no-Fusion tools out of the Fusion writes (so a ProShop unmatched row **no longer mints a placeholder entry**) but keeps them in the metadata write and re-materializes them into in-memory state. `ImportFlow` Review messaging updated ("saved as no-Fusion tools, no Fusion entry created"). **First user-visible change** — 198 tests + audit green; linked path byte-for-byte identical. *(This pulled the audit's Phase-C "retire placeholder-minting" forward.)* Deferred: bulk ID/number ops (`assignToolIds` / `renumber*`) don't yet assign to no-Fusion tools (they operate on downloaded Fusion lists) — a follow-up.
  - ✅ **B4a — no-Fusion tool UI + promote/detach (done).** `promoteToolToFusion` (flip flag → linked write mints Fusion instances) and `detachToolFromFusion` (remove Fusion entries → metadata-only, instance guids cleared) actions. `ToolDetail`: "Not in Fusion" note, a **Create in Fusion** / **Detach** sidebar action, Sync Job + Copy-to-Fusion hidden and reconcile-on-open skipped for no-Fusion tools. `ToolCard` "Not in Fusion" pill re-messaged. `writeLogicalTool` keeps `instance_guid` null for a no-Fusion tool's assemblies (honest — they map to no Fusion entry). 201 tests + audit green (6 mocked-Drive tests cover the no-Fusion write/delete/promote/detach paths, incl. promote-refused-without-a-library and detach removing exactly this tool's entries).
  - ✅ **B4b-1 — "turn Fusion off after setup" (done).** `integrations.fusion.enabled` toggle in Settings → Fusion Libraries (persisted; `managedSig` excludes it so it doesn't collide with the page draft). When off: `loadTools` builds **every** tool from metadata (no Fusion download, no library requirement, no holder load); `writeLogicalTool` routes **all** writes metadata-only (`fusionDisabled` in the `isUnlinked` check); `buildUnlinkedTool` **preserves** each record's `no_fusion_link` flag so re-enabling doesn't spuriously detach formerly-linked tools; context exposes `fusionEnabled`; `ToolDetail` hides Fusion actions + shows a "Fusion sync is off" note and gates promote/detach on `fusionEnabled`. Takes full effect on reload. 203 tests + audit green. Requires the shop to already be past onboarding (has a library from prior setup) — the "turn off *after* setup" case.
  - ⏳ **B4b-2 (deferred)** — "never connect Autodesk at all": the `App.jsx` AppShell gate relaxation (a no-Fusion shop skips the LibrarySetup/ShopConnect library requirement, requires Drive instead) + a localStorage mirror of the flag for gate-time reads + the onboarding "no CAM" path. This is the high-blast-radius auth/gate rewrite; deferred as its own step.
  - ✅ **B5a — drift detection (done).** `detectFusionDrift` + `_drift` on each linked tool; `authority` added to defaults. Pure, no behavior change.
  - ✅ **B5b — drift review UI (done).** `DriftBanner` on `ToolDetail` (linked tools only): "Differs from Fusion in N fields", per-field Keep-Fusion / Keep-app choice pre-selected by the shop `authority`, Apply writes the chosen value to **both** stores and clears drift. Settings → Fusion Libraries gained the **authority** radio (Fusion wins / App wins). Because drift is *always* surfaced, switching authority is safe (it only changes the default pre-selection — never a silent overwrite), so no guarded-flip machinery was needed. Replaced the stale "placeholder needs setup" `no_fusion_link` banner (the bottom "Not in Fusion" note now covers that correctly). 209 tests + audit + `vite build` all green. **This delivers the owner's no-silent-override requirement (D3).**

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

`spindle_speed`(n), `cutting_feedrate`(v_f), `plunge_feedrate`(v_f_plunge), `ramp_feedrate`(v_f_ramp), `lead_in_feedrate`(v_f_leadIn), `lead_out_feedrate`(v_f_leadOut), `feed_per_tooth`(f_z), `feed_per_rev`(f_n), `cutting_speed`(v_c). **O1 (resolved): keep as columns, but as an explicitly DERIVED cache of `tool_presets` row 0** — always recomputed from preset 0 on write, never independently editable (like an invoice header's `total` that's defined by its line items). `tool_presets` is the source of truth; if the mirror ever disagrees, preset 0 wins. Preserves today's convenience (forms/exports/cards read one "primary rpm/feed" without loading presets) without a second editable source that can drift.

### 4e. Provenance & housekeeping (Category 1)

`updated_by`, `revision_notes`, `created_at`, `updated_at`, `last_used_job` (retired from UI, kept for data).

### 4f. → child tables (arrays/objects, NOT columns on `tools`)

`presets` → **tool_presets**; `assemblies` → **assemblies**; `purchasing` → **purchasing_manufacturers/vendors**; `tags` → **tool_tags**, `material_suitability` → **tool_material_suitability** (O2 resolved: **child tables**, so search facets can query them); `job_ids` → **tool_jobs**; `speed_feed_refs` → **speed_feed_refs**; `merge_history` → **merge_history**; `attachments` → **attachments**; `legacy_ids` → **legacy_ids**; `tool_location` → **columns** (system_id, zone_id, station_id, drawer_id, bin) or a small **tool_location** 1:1 table; `bin_size_id` → column; `pairing` → **tool_pairings**; `primary_photo_id`/`primary_photo_name` → columns.

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

**O3 (resolved):** `operation_type`/`machine_id`/`job_ids` are app-only and must **never** serialize into `raw_json` or the Fusion write (today enforced by `normalizePreset`'s destructure). In SQLite they're just columns/joins, so the leak risk goes away — but the Fusion *writer* must still strip them. **Forward note (owner):** Fusion has since added fields that may let some of this currently app-only data (e.g. operation type) be pushed legitimately. That doesn't change Phase A — they stay app-owned columns now — but the adapter can adopt those Fusion fields later, moving a field from Category 1 → Category 3 with no schema change. Deferred.

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

## 10. How D2 (authority) resolves + D3 (drift is never silent)

On load, per tool, per **Category-3** field, the authority setting picks the **default** value shown:

```
value = (authority === 'app' && appRecord.hasValue(field))
          ? appRecord[field]                     // app value is the default
          : fusionInstance ? fusionValue(field)  // fusion value is the default (today's behavior)
                           : appRecord[field];   // no Fusion entry → app is sole source
```

- Categories 1 & 2: **always** `appRecord[field]` (2 is mirrored out on write).
- Category 4: always from `fusion_instances.raw_json`.
- No-Fusion tool: no fusion_instance, so every field resolves to the app record regardless of `authority` — the toggle is a no-op for it, and drift can't exist.

### D3 — drift is always surfaced, never silently applied (owner requirement)

The `authority` setting picks the **default winner, not a silent overwrite.** Whenever a linked tool's app record and its live Fusion entry differ on any field (either authority mode), opening the tool raises a **banner + per-field diff** (app value vs Fusion value) that the user confirms — nothing is silently overwritten in either direction.

- **Phase A is the enabler:** field-level drift detection is only possible because the app record now holds its own copy of every field (D1). Today the app can't diff geometry/presets at all — it has no independent value. So D3 is a *payoff* of the complete record, not extra scaffolding.
- **The `authority` setting = the pre-selected choice** in that diff (one click to accept if the user agrees), so it stays low-friction while never being silent.
- **Reuses existing machinery:** the reconcile-on-open + Sync Job `DiffStep` UI, extended from structural strays to **field-level** drift, with the same significance tolerances (`PRESET_SIGNIFICANCE` / `valuesEqual`) so Fusion float noise isn't flagged.
- **Cost model:** detected on tool open (same per-tool live-fetch as today's reconcile-on-open). Until reviewed, the app does not push app values over the differing Fusion fields. **Bulk full-library rewrites** (import / normalize) keep their own existing Review step — the per-tool open is the primary drift surface.
- **The guarded flip** (D2): before switching `authority` to `'app'`, run the reconcile/pull so nothing Fusion-side is lost, *then* flip. Switching back runs the reverse. Settings action, not a schema concern.

**Total D2+D3 cost:** the one default-picking branch above, the drift-diff on open (mostly existing UI), and the guarded-flip settings action. Everything else is unchanged.

---

## 11. Migration & sequencing

1. **Build this record shape on today's JSON storage** (no SQLite yet). `mergeFusionAndMetadata` grows to populate the now-complete record; `internalToFusionTool` is unchanged (still the Fusion writer). Default `authority: 'fusion'` → **behavior identical**, round-trip audit stays green.
2. **No migration shims** — per the repo rule and the disposable-metadata window. When the shop commits for real, the app record is authoritative from day one.
3. **SQLite swap is a later, separate step:** replace the `driveService` / shared-file read-write layer with a SQLite-backed repository exposing the same interface the actions already call. The tables above are the target; the record shape won't change again.
4. **The seam already exists:** every write funnels through `writeLogicalTool` / `saveFullLibrary` / `saveSharedFile` / `driveService`. That's the repository boundary both the Fusion-adapter split and the SQLite swap need — one refactor, both payoffs.

---

## 12. Open questions — RESOLVED with the owner (2026-07-06)

- **O1 — flat speed/feed mirror on `tools`:** ✅ **keep as a derived cache** of `tool_presets` row 0 (recomputed on write, not independently editable). `tool_presets` is source of truth.
- **O2 — `tags` / `material_suitability`:** ✅ **child tables** (`tool_tags`, `tool_material_suitability`) so search facets can query them.
- **O3 — app-only preset fields:** ✅ stay app-owned columns; the Fusion writer keeps stripping them. Forward note: Fusion has added fields that may let some (e.g. operation type) be pushed later — Category 1 → 3 with no schema change, deferred.
- **O4 — location systems / bin sizes:** ✅ **keep nested in `shop_settings` config** (edited as a unit, referenced by UUID). Normalize later only if a UI needs to query across them.
- **O5 — unify `tools` + `components`?** ✅ **do not unify in Phase A** — components are deliberately Fusion-invisible and browse-only; keep separate. Revisit only if the "component = unlinked tool" idea from the audit's Phase C is pursued.

All five are settled inputs to implementation; none remain blocking.

---

## What I did & why

- **Pulled the field set straight from `fieldRegistry.js` (81 fields) and the factory functions** rather than reconstructing it from memory — the ownership column (app / mirrored / shared / structural / derived) is grounded in the real `metadataOnly` flags and the documented "metadata wins" rules, so the D2 boundary is exact.
- **Made `fusion_instances` a separate table with a `raw_json` blob** — that one modeling choice is what turns "decouple from Fusion" into "a table some tools don't have rows in," and it's also what preserves the round-trip audit (un-modeled Fusion fields are never dropped).
- **Kept D2 to a single documented load-time branch** so the "user chooses who wins" feature is provably cheap, and flagged the five real implementation questions (O1–O5) instead of silently baking in answers.
