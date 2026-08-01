# Claude Code Prompt — Holder Management System

## 0. Read this first

**`HolderManager.jsx` (attached) is the design reference. Build from it. Do
not design this UI from scratch.**

It is a working mockup — every screen, interaction, and edge case in it was
reviewed and iterated on with Dan. It runs standalone (inline styles, local
state, seeded with real data from `Master-Holder.json`) so you can open it and
click through. Its inline comments are addressed to you and are **part of this
spec** — several document decisions and bug fixes that are easy to
accidentally undo.

Your job is to port its **design and behaviour** into the real app using the
real CSS vars, the real shared-file plumbing, and the real Fusion conversion
path — not to reinvent it.

⚠️ **Use the repo's design system for all colours, fonts, spacing and
component styling.** The mockup's `T` token object and inline styles exist
only so it can run standalone — they are placeholders, not a palette to
copy. Where a mockup colour has *semantic* meaning (extension green, the
audit verdict colours, above-gauge dimming), map it to the nearest
equivalent token in the repo's system rather than pasting the hex. If the
design system has no equivalent, ask before inventing one.

### Ask, don't assume

Dan has repeatedly seen important details glossed over or silently
reinterpreted. **When something seems off, contradictory, or underspecified,
stop and ask.** Do not pick the interpretation that's easiest to build.

Specifically, ask before:
- changing anything that affects **holder descriptions** (§6 — this can
  silently orphan presets)
- inventing a data shape this doc doesn't specify
- "improving" a behaviour the mockup deliberately implements a particular way
- deciding a mockup detail was arbitrary — most weren't; check the comment
- bulk-writing to tools or holders

**Intent matters more than the exact data model here.** Where this doc names
fields, treat them as *the concepts that must exist*, not a schema to
reproduce literally. Fit them to the app's existing conventions. If something
here fights the codebase, the codebase probably wins — flag it and ask.

---

## 1. Why this exists (the intent)

Fusion **absorbs** holder geometry into each cutting tool. The link to the
holder library is one-directional and one-time: it copies the geometry in,
then forgets. The `holder_guid` left behind points at a snapshot, not a live
record.

So: the shop has refined its holder library, but **nothing is actually
linked**. Corrections only reach new tools. Older tools carry whatever
geometry was believed correct at the time — some of it wrong.

**Fusion's behaviour is correct for Fusion.** Once a preset is proven against
a holder you don't want geometry shifting under a live job. The frozen
snapshot is a feature at the CAM layer. The problem is it's the *only* layer.
This project builds the managed layer above it.

### The safety insight that drives the whole design

> **CAM reads the geometry. The operator reads the description.**

When those disagree, the machine and the human are working from different
information. That is the failure mode that actually hurts.

Consequences, and they aren't obvious:
- **Geometry drift alone is comparatively safe.** A holder swapped for a
  near-identical one gets proven out in CAM anyway.
- **A description that no longer matches its geometry is dangerous.** The
  operator sets up what the label says; CAM cut what the numbers said.
- Therefore matching is done on **parsed description + gauge length**, *not*
  segment-by-segment. If both agree, the odds the segments secretly differ are
  negligible — and segment diffing would bury the real signal in noise.

Preserve that priority ordering in anything you build here.

---

## 2. Architecture (locked — don't redesign)

- **The app-owned holder table is the source of truth.** The Fusion holder
  library becomes an **export target** — same relationship tool metadata
  already has with Fusion.
- **Tools carry a stable FK** to a holder record (app UUID), replacing
  reliance on Fusion's absorbed snapshot and its unusable GUID.
- **Refinement propagates on next edit/save.** Fix a holder once → each tool
  picks up current geometry on its next write. Fusion never changes it on its
  own; only a deliberate app write does.
- **Plus an explicit batch push** for corrections that need to reach
  everything now (§7).

This fits what exists: `splitToFusionInstances` **already** rebuilds holder
geometry from the live library entry on every write. The change is **where
"live" points** — from the read-only APS holder library to the app-owned
table — plus a real FK so the join is a key, not a name guess.

### Verify early (both may already be true — confirm, don't assume)
1. **Is the Fusion holder library writable via APS?** CLAUDE.md currently says
   read-only. Dan believes writes work. If they don't, fall back to exporting
   `holder_library.json` for manual re-upload and say so in the UI. **Tool**
   library writes are unaffected either way, so §7 re-stamping still works.
2. **Does the Machine record already carry a taper field?** Dan thinks yes.
   Needed for filtering assemblies by the selected machine's taper.

Report findings before building on either.

---

## 3. The data concepts

Fit these to existing app conventions. Names are illustrative.

### Mirrored from Fusion (so export round-trips)
`description`, `vendor`, `product-id`, `product-link`, `unit`, `gaugeLength`,
`segments[]`, `guid`, and the paired `expressions` entries.

### The segment record — where the interesting work is
Each segment has `height`, `upper-diameter`, `lower-diameter` plus **three
boolean flags**:

| Flag | Meaning |
|---|---|
| `agl` | Above gauge line. Fusion already has this. Excluded from gauge length. |
| `ext` | **New.** This segment is part of the extension. |
| `shankSeg` | **New.** This segment's diameter is the extension's mating shank. Single-select across the holder. |

**Why `ext` matters — verified against real data, not assumed:**

```
NBT30-SK13C-60                    gauge 54.999mm,  9 segments
NBT30-SK13C-60 w/ ER8 EXT 1.2OOH  gauge 85.479mm, 10 segments
difference = 30.48mm = EXACTLY 1.2 inches = the "1.2OOH" in the name
```

The extension is literally **one extra segment at the tip**. So flag the
extension segments, sum their heights, and that sum **is** the extension OOH.
Derived, never typed. It then feeds the description.

`shankSeg` works the same way: the shop runs the same collet with different
shank diameters to fit different holders, and that diameter is one specific
segment *within* the extension. Verified — the SK20/ER16 holder has two ext
segments (Ø22.225 and Ø19.05); 19.05mm = exactly 0.75″, matching its real
`"Shank .75"` description. The other is the collar.

### ⚠️ "OOH" means two different things — never conflate
- **Extension OOH** — property of the holder+extension. Fixed. Derived from
  flagged segments. **Functionally a setup instruction** — it's how the shop
  communicates how to set the extension up, which is why it must survive into
  the description.
- **Assembly OOH** (`geometry.LB`) — the **cutting tool's** stickout.
  Per-assembly, varies per tool.

Different layers, same word. Don't merge them; don't default one from the
other.

### `length` — the engraved nominal, NOT the computed gauge length
The `-60` / `-90` / `-120` in a part number is the **manufacturer's nominal
gauge length, measured with the collet nut backed off** — and it's physically
engraved on the holder. Fusion's modelled geometry is measured with the nut
**tight**, so the computed gauge length runs a few mm shorter.

**This gives a third validation check, and it works.** Against the real
library, subtracting any extension first, the delta clusters tightly:

```
nominal − (gauge − extensionOOH)  ≈  +2.2 to +5.0 mm   (13 of 15 holders)
```

Two real holders fall outside that band and should be flagged for review:

| Holder | Nominal | Base gauge | Delta |
|---|---|---|---|
| `NBT30-SK20C-60` | 60 | 62.000 | **−2.000** — measures *longer* than nominal, which is backwards |
| `NBT30-SK20C-60 w/ER16 EXT 2.385OOH` | 60 | 31.845 | **+28.155** — base gauge ~25mm short; looks like missing segments |

Implement as a soft check with a configurable band (start ~1.5–6mm), not a
hard rule — the delta looks collet-family dependent (SK13 ≈ 3mm, SK20 ≈ 4–5mm)
and the sample is small. **Ask Dan before treating any specific band as
authoritative.** Surface it the same way as the audit: informational, never an
auto-fix.

### App-owned structured fields
`type`, `taper`, `colletFamily`, `colletSize`, `is_tap_collet`, `length`,
`hasExtension` + extension sub-record (its own manufacturer / part no /
vendor), `purchasing` (**reuse the existing shape**), `location` (free text
with type-ahead over existing values), `notes`, `tags`, `photo`,
`attachments`, `legacy_ids[]`, and `color` (§5).

### Extensible option lists — use the `bin_sizes` pattern
`type`, `taper`, `colletFamily`, `colletSize` are **UUID-referenced shared
lookups**, not free strings. Holder records store the UUID. Rename a label
once → everything referencing it updates. "Add custom" appends to the shared
list.

Why: the real data already shows the failure mode of free text — `vendor` is
inconsistently a company (`Maritool`) or a collet spec (`SK13-ER8`), and
type/taper/collet exist **only** inside free-text descriptions today. UUID
refs also match the documented SQLite path.

---

## 4. Segments: display vs storage (get this right)

Fusion's JSON stores segments **bottom-up** (`array[0]` = tool tip). Fusion's
own editor UI shows them **top-down** (row 1 = gauge line / spindle end).

**The app follows Fusion's UI: top-down.** The mockup reverses for display
only; every edit maps back to the real index so the stored array order for
export never changes. New segments are added at the tip (visually the bottom
row) — that's where an extension actually attaches.

This mirrors a flip the app already does for gauge math
(`jsonIndex = S − fusionNumber`).

### Per-holder unit toggle (mm / inch)
Independent of every other unit setting in the app — a holder is drawn in
whatever unit its manufacturer published. Toggling performs a **real value
conversion** of every stored dimension, not a display relabel.

⚠️ **Round to 5 decimals in the conversion, not 4.** At 4 decimals of inch
precision a single mm→in→mm round trip loses real resolution (2mm →
0.0787in → 1.999mm) because 0.0001″ is coarser than 0.001mm. This was a real
bug; the constant matters.

**Display precision: metric 3 decimals, inch 4.** One helper (`formatLen`)
owns this so it can't drift between spots.

---

## 5. Colour system

Two independent colour concepts that must never fight for the same surface:

1. **Holder colour** — per holder, custom picker, seeded from the app's
   existing theme palette.
2. **Collet-size colour** — per collet-size *option* (shared lookup, not per
   holder). Tints the collet substring inside descriptions.

**They don't clash because the holder colour never fills a background.** It
renders as thick end caps + a thin border on the pill; the middle stays one
neutral surface. So collet text always sits on the same background regardless
of holder colour.

⚠️ **`HolderPill` REPLACES the app's existing tool-holder pill UI.** Dan
reviewed both and prefers this one. Don't run them side by side.

**Extension colour is semantic, not decorative.** One token (`T.ext`) with
tint and border derived from it *by alpha*, so hue can't drift. Everything
referring to an extension uses it: profile shape, segment row, Extension
column and section, derived readouts, filter pill, healer chip. It was
previously teal in one place and orange in another and read as unrelated
features — don't let that happen again.

---

## 6. ⚠️ THE CASCADE RISK — descriptions are load-bearing

`holderShortName()` parses the description → feeds **preset names** and
**`asm_number`** → and `presetMatchesAssembly` links presets to assemblies by
parsing the holder short name back out of the preset name. CLAUDE.md is
explicit that a stale value there **silently orphans the preset**.

So auto-generating or normalizing descriptions can cascade into preset names,
assembly numbers, and preset↔assembly links.

**Rules:**
1. Changing a description is a **first-class operation**, not a side effect.
   Route through the existing re-derivation path.
2. **Never rewrite a description silently** on load or import. Auto-suggestion
   is something the user accepts, never automatic.
3. Verify `holderShortName()` still produces the same token after any change.
   If it would change, preview old → new with affected presets listed.
4. Regression tests: description change → short name stable; description
   change → dependent names correctly re-derived.

**Stop and confirm with Dan before any bulk description rewrite.**

### Auto-suggested description
Composed from the structured fields. Real targets:
```
NBT30-SK13C-60
NBT30-SK13C-60 w/ ER8 EXT 1.2OOH
NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75
NBT30SK13-90 -ER16 TAP C EX2.33OOH
```
- **Suggestion only.** The 64-char limit comes from the shop's **physical tool
  tags**, not from Fusion — Dan intends to revisit it later, so keep it a
  single named constant rather than scattering the number. The shop
  hand-shortens regularly. Use the existing `nameManual` + `↺ Auto` pattern
  from preset names — a manual edit must survive later field changes.
- **Extension OOH always prints in inches** (matching real descriptions) even
  on an mm-native holder. **Shank diameter prints in the holder's own unit**
  (`Shank 12mm` vs `Shank .75`). This asymmetry is deliberate.

---

## 7. Linking, propagation, and the audit

### Two link signals, both needed
- **Reference token** written into Fusion's `product-id`. **Overwrite it** —
  the app is source of truth. But **migrate what's there first**: 2 holders
  have real vendor SKUs (move to purchasing fields), 2 have ad-hoc notes
  (`"min OOH 2.33"`, `"STUB"` → move to `notes`). Don't discard.
- **Geometry check** via gauge length (see the audit below).

### Propagation
- **Lazy (default):** next tool save pulls current holder geometry.
- **Batch push:** "Re-stamp all tools using this holder", with preview.
  Honour per-library write routing. Recompute
  `geometry.assemblyGaugeLength` — never carry it forward.

### The audit — label-vs-geometry truth check
The feature that serves §1's safety insight. See `AuditView` in the mockup.

For each tool, compare its **frozen holder description** and **frozen gauge
length** against the holder record:

- **Description match** — parse out taper / collet size / length / extension
  presence / extension collet, score each component. Report *which component*
  failed, not just a percentage; "75%" isn't actionable, `Length: 120 ≠ 60`
  is.
- **Gauge match** — tolerance **0.005″**, compared in a common unit so mm- and
  inch-native records compare correctly.

**Verdicts, ordered by risk (not by size of difference):**

| Verdict | Meaning | Bulk-fixable? |
|---|---|---|
| **OK** | Both agree | n/a |
| **Stale geometry** | Description agrees, gauge drifted past tolerance | **Yes** — expected, safe |
| **Description conflict** | Description disagrees with its holder | **Never** — the dangerous one |
| **Unmatched** | Neither agrees; probably a different holder | Never — manual relink |

**Group by holder** so a whole group is corrected at once — the same stale
holder is usually referenced in many places. Re-stamp must structurally
exclude conflicts even when they sit in the same group.

**Taper variants normalize for matching.** NBT30 / BBT30 / "BT30 Dual
Contact" are all physically a BT30 taper; matching strictly creates false
mismatches on naming alone. Derive the taper list **from the `OPT.taper`
lookup**, don't hardcode — add a taper to the lookup and matching picks it up.
The toggle exists because "treat variants as equal" is a real assumption worth
being able to turn off.

### Where the audit runs — it's a normalization pass, and its own one
Real legacy tools have **no holder FK** — establishing it is the point. So
holder-linking is part of normalization, and it runs in three places:

1. **On first tool-library upload** — the initial bulk link.
2. **On opening any tool page** — a cheap per-tool check, so drift and
   missing links surface as you work rather than only on demand.
3. **Bulk re-run, triggered from the Settings menu.** This one is
   **deliberately separate from the rest of normalization** — the other
   normalization steps don't need repeating, and re-running everything to
   catch a few unlinked holders is wasteful and risks churn.

**The bulk re-run only looks at what isn't linked yet.** It must not redo
already-linked tools or re-litigate resolved decisions. Its job is "did
anything get missed, or arrive since?" — not "start over."

Give it its own entry point, its own progress/summary, and its own
confirmation. Don't fold it into the general normalize action.

---

## 8. The 2D profile preview

`ProfileView` in the mockup. Spindle end up, tip down.

- **Click a segment** → highlights in profile *and* table row; hover syncs both
  ways.
- **Above-gauge** dim + dashed, **extension** green, **shank segment** green
  with a violet edge, **gauge line** drawn where measurement starts.
- **True proportions** — one uniform scale, never stretched to fit. A
  distorted profile hides exactly the errors this view exists to catch.

**Built deliberately generic.** Dan wants the same component reused for
cutting tools and full assemblies later. It takes a segment list, not a
holder, and all type-specific styling routes through one `kindOf()` hook so
new segment types slot in without touching geometry code. An assembly is
holder segments + tool segments concatenated.

---

## 9. Other UI behaviour worth not losing

- **Sidebar:** Holders is a **rail item under "Sync Job"**, not a new top tab.
- **List grouping:** by taper → collet → extension collet, on by default,
  smallest gauge first within each group. Clicking a column header sorts and
  **auto-ungroups** (grouped-and-sorted answers neither question clearly).
  Sorting compares numbers in a common unit; nulls sink in both directions.
- **Sticky column header** requires a bounded scroll container *and*
  `borderCollapse: separate` — in `collapse` mode browsers don't reliably
  paint sticky cell backgrounds. Group headers are deliberately **not** sticky
  (they pile up on each other).
- **Shift-click row numbers** in the segment table → range select with a
  running height total. Clears on edit and on add/delete so stale indices
  can't point at wrong rows.
- **Holder name healer** — parses legacy free-text descriptions into
  structured fields, graded high/medium/low confidence with flags. Preview →
  commit, never silent (§6). It fills structured fields; it does **not**
  rewrite descriptions.
- **"Used by N tools" is clickable** → the tool list filtered to that holder.

---

## 10. Invariants that still apply

Everything in CLAUDE.md's Fusion round-trip section holds:
- **Expression/numeric sync** — never write a native field without its paired
  expression; derive unit suffixes from the record's unit (**holder data is
  often millimetres**).
- **`buildHolderObject`** prefers the computed gauge sum and clamps to the
  section sum.
- **`geometry.assemblyGaugeLength`** always recomputed, never carried forward.
- **App-only fields must never leak into Fusion JSON** — the new structured
  fields (type, taper, collet, extension, colour, location, tags…) are
  metadata-only, exactly like `operation_type`. Add them to the strip guard
  and lock it with a test.

---

## 11. Build order

Confirm with Dan between phases. Don't run ahead.

1. **Verify §2** (holder library writable? machine taper field?) → report.
2. **Data model + shared file**, migration from the current read-only library
   (including the 4 `product-id` values to preserve).
3. **FK + link states** (linked / stale / unlinked), reference token,
   gauge-based matching.
4. **Holders page** — list, filters, grouping/sorting, detail view read-only.
5. **Editing** — structured fields, segment table (top-down, the three flags),
   unit toggle, profile preview, purchasing, extension, attachments.
6. **Description auto-suggestion** — with §6 guards and tests. **Confirm
   first.**
7. **Propagation** — lazy + batch re-stamp with preview.
8. **Audit view** — after resolving the §7 open question.
9. **Machine taper filtering** for assemblies.

---

## Attached
- **`HolderManager.jsx`** — the design reference. Read its comments.
- `Master-Holder.json` — the real 20-record holder library.
- Fusion holder UI screenshots.
