# Claude Code Prompt — Unified Preset Editor + Strategy Support

**What this is:** a UI/UX rebuild of the Speeds & Feeds preset editor, worked
out as a standalone mockup first. The mockup is `UnifiedPresetEditor.jsx`
(attached). It is a **design reference, not drop-in code** — it uses inline
styles and a copy of the calc cascade so it runs on its own. Your job is to
integrate its *design and behavior* into the real app using the real CSS vars,
the real `handleNumChange`, the real components.

**Read `UnifiedPresetEditor.jsx` top to bottom first.** It has extensive inline
comments addressed to you (marked "Claude Code:") flagging exactly what's mock
vs. real and what invariants to preserve. Those comments are part of this spec.

**Golden rule:** this is a UI/UX change. **Do not touch the speeds/feeds math,
the Fusion round-trip, or the preset data model** except where this doc
explicitly adds a field. All the Fusion expression-sync invariants in CLAUDE.md
(stepdown/stepover triple-sync, expression suffix units, "sync never inject",
operation_type-never-in-JSON) still hold. If a change here would violate one,
stop and flag it.

---

## 1. The core change: merge two pages into one editor

Today the preset editor (`PresetPanel.jsx` `EditCard`) and the strategy picker
(`StrategyPickerUI.jsx`) are separate. Merge them into **one full-width inline
editor** that opens below the preset card row (same place it opens today).

The old layout wasted the right 1/3 of the page as dead space. The new editor
goes full width. Section order, top to bottom:

1. **Header** — name field, live modifier badge, Ø/flute readout, Save, ✕
2. **Setup row** — Material (opens existing `CamPresetPicker`, unchanged) |
   Assembly & Machine
3. **Strategy** — see §2 (this is the big new part)
4. **Speed + Passes & Linking** — side by side
5. **Feedrates** — the linked sliders + Small Bore
6. **Coolant + Jobs** — compact footer

**Visual grouping fix:** each section is a raised card (distinct surface, real
border, colored uppercase label). Today the groupings blend because their
backgrounds are nearly identical. Use real contrast. See the `Section` component
in the mockup and map its tokens to the app's CSS vars.

---

## 2. Strategy support — TWO preset formats coexist

This is the heart of it. Read carefully.

### The two formats
- **Old format** (existing presets): a **simple operation** — rough / finish /
  small bore / etc. **Fusion's old preset JSON has NO strategy field.** The
  operation is app-only (lives in the preset name + `operation_type`
  metadata, exactly as CLAUDE.md describes). **Leave all of this alone.**
- **New format** (new presets going forward): carries a **Fusion toolpath
  strategy** (2D Adaptive, Bore, Pocket, etc.) that maps to Fusion's **real
  strategy IDs**. This is a new capability Fusion now supports.

**Fusion reads both.** We are NOT converting existing old presets automatically
— we can't, because the old data has no strategy and there's no safe default.

### The UI rule
**The editor is identical for both formats EXCEPT the Strategy section.**
Everything else — sliders, MRR, small bore, passes — is speeds/feeds and is
format-independent. Only the Strategy section swaps:

- **Old-format preset** → Strategy section shows the **simple operation list**
  (the current rough/finish/etc. control) **plus a "Convert to new" button.**
  - If the old preset was rough or finish, **highlight** that in the new
    strategy UI as a visual aid when converting — but it behaves normally.
    The highlight is just a hint; **drop it once saved as new format.**
- **New-format preset** → Strategy section shows the **full strategy picker**
  we built: Rough/Finish bucket toggle, intensity, quick groups, pinned
  singles (2D Contour + Bore), selected pills, and an "All strategies…" popout.

### "Convert to new" flow
Pressing Convert on an old preset replaces the simple list with the full
strategy picker. Old rough/finish → pre-highlighted bucket. After the user
picks a strategy and saves, the preset is new-format; the highlight aid is gone.

**Likely constraint (confirm against real Fusion):** Fusion probably won't
accept a new-format preset that claims rough/finish **without** a toolpath
strategy chosen. So in new format, a strategy selection is effectively
required — surface that (the mockup already shows "No strategies selected —
Fusion may reject this preset").

### Strategy data — REAL IDs coming
The mockup's `STRATEGIES` list has `confirmed: true/false` flags. **`false` =
the internal Fusion ID was guessed** and Fusion silently drops unrecognized
IDs. Dan is adding the **real Fusion strategy values** to the repo (from real
Fusion JSON exports). **Replace the guessed IDs with the real ones** and drop
the `confirmed` flag once they're all verified. Do not ship guessed IDs.

The strategy constants (`STRATEGIES`, `QUICK_GROUPS`, `PINNED_STRATEGIES`,
`AUTO_LINK_PAIR`, `SMALL_BORE_STRATEGIES`) should live in a schema file
(e.g. `src/schema/camStrategies.js`), not inline in a component.

### Strategy groups (2D / 3D / Drilling / Multi-Axis)
The mockup groups strategies into columns. Dan will **refine the group
definitions later** — treat the current grouping as a starting point.

### Picker look
Dan wants the strategy picker to feel like the **`CamPresetPicker`** (search +
color pills + rich rows). The "All strategies…" popout in the mockup follows
that pattern. Bucket colors: Rough and Finish each get their own color (orange /
teal in the mockup); the other operations keep their own accents. "Fine finish"
and "rough fast" are **not** separate strategies — they're name modifiers
(intensity) folded into the preset name pushed to Fusion, while bucket stays
rough/finish. Small Bore is **always finish**.

---

## 3. Linked sliders (the CloudNC-style control)

Every numeric field in the editor becomes a **slider + number input side by
side**. Extract as `src/components/LinkedSlider.jsx`.

**Driving vs driven maps 1:1 onto the app's existing `fx` state:**
- `fx === 'manual'` = **driving** — bright track, bold value
- `fx === 'formula'` = **driven** — the **track only** dims to ~55%; label,
  fx badge, and the number stay full brightness (a driven value is still a
  number you read). Grabbing a driven slider or typing its input promotes it
  to driving.

**Do NOT reimplement the cascade.** The mockup copies `handleNumChange` so it
runs standalone. Wire `LinkedSlider.onChange` straight into the app's real
`handleNumChange`. The whole point is that the slider is a skin over the
existing driving/driven calc — RPM↔SFM, fz↔feed, fn↔plunge, lead/transition
followers all already work.

**Details baked into the mockup (preserve them):**
- Number inputs **left-justified** (decimal point stays put across values).
- **fz and feed-per-rev keep 4 decimals** incl. trailing zeros (0.0010, not
  0.001). See `FIXED_DECIMALS`.
- **Native spinner arrows suppressed** (`.td-noSpin`) — the slider is the
  increment control.
- **Soft max** on feedrate + chip-load fields: hold the handle pinned at the
  right edge ~0.5s and the ceiling climbs, taking the value with it. Release
  and it snaps back to the default ceiling unless the value still needs the
  room. Chevrons (`›››` / `‹‹‹`) announce the rescale and fade after.
  - Defaults: **cutting feed max 225 in/min**, **fz max 0.020**, **RPM max
    16000**. `SLIDER_RANGES` holds them.
  - Soft-max chevrons must fire **only on user-driven stretch**, never on the
    auto-fit that widens a driven field's track when its partner pushes it
    past the ceiling (see `stretchedByUser` in the mockup — this was a real
    bug, keep the gate).
- **Wheel support**: horizontal wheel (deltaX) or shift+vertical wheel over a
  track nudges by one step. **This needs a non-passive listener** —
  `addEventListener('wheel', ..., { passive: false })` in a `useEffect`, NOT
  React's `onWheel` (which can't `preventDefault` reliably and will scroll the
  page). Horizontal-wheel direction varies by OS/mouse — make the sign a
  setting rather than guessing if it feels backwards.

**Slider ranges are placeholders for now.** `SLIDER_RANGES` is one config
object on purpose. Real per-tool/per-material limits are a future feature
(Dan deferred). The RPM max should later map to the **selected machine's max
spindle speed** (already on the machine record), falling back to 16000.

---

## 4. Passes & Linking — stepdown / stepover as factor sliders

Stepdown/stepover are decided as a **percentage** of a reference dimension
(stepdown of flute length, stepover of diameter). The `FactorSlider` in the
mockup drives the percentage and reads out as one (86%, not 0.86).

- **Two entry points, driving/driven pair:** drag/type the % (1% steps) and the
  inch value follows (fx badge on it); type the inch value directly and the %
  follows. Whichever touched last drives.
- **Fusion stores ABSOLUTES**, not %/factors. Convert on save. Percent never
  enters the data model. **And critically:** writing stepdown/stepover must
  honor the **triple-sync invariant** from CLAUDE.md (`use-stepdown` boolean +
  numeric + `expressions.tool_stepdown` all agree; boolean is source of truth;
  strip the expression when disabled; rewrite a literal expression when the
  numeric changed). Route through `normalizePreset` — do not write the three
  pieces by hand.
- Never above 100%.

---

## 5. MRR indicator

Under the step sliders, show **Material Removal Rate** live:
`MRR = stepover(radial) × stepdown(axial) × cutting feed`, in in³/min. Big
number, tinted to the bucket color, math shown on hover (tooltip). Updates as
any of the three inputs move. Toggle a step off → that factor is 0. See
`MRRIndicator`. No bar fill, no always-visible math (Dan cut both).

---

## 6. Small Bore — now inside Feedrates

Small Bore compensation moved out of its own area into the **Feedrates section**
(it compensates chip load, so it belongs next to the cutting-feed cluster).

- **Two fixed-height rows** (never pops open downward as you type).
- **Applies live** — no "Apply" button. Change bore Ø or start fz and the
  compensated fz pushes through the normal cascade, so cutting feed follows and
  dims like any edit.
- **Override highlight**: if the user moves the feed/fz slider away from what
  compensation computed, the box turns amber, strikes through the computed
  value, shows the value in effect + an OVERRIDDEN badge + a Restore button.
- Still **locks the Strategy bucket to Finishing** (cross-section lock; the
  note shows in both places). Small Bore is only available when a Bore/Contour
  strategy is selected.
- `boreCompensation()` + `SmallBoreIcon` are **shared utils** — one source,
  reused anywhere bore comp appears. Don't duplicate the math.
- **Persist the uncompensated base fz** on the preset (new field, e.g.
  `f_z_base`). Without it, reopening a saved small-bore preset re-compensates
  an already-compensated fz and the feed shrinks a little every open. The
  mockup keeps it in local state only — you must persist it.

---

## 7. Copy preset → paste into Fusion (JSON)

New capability: a **"Copy for Fusion"** button that copies a single preset as
Fusion-format JSON to the clipboard, so it can be pasted directly into Fusion
(this paste works inside Fusion today).

- **Two placements:** on each **preset card** AND inside the **editor**.
- **Both formats export**, with **different formatting**:
  - **Old format** → no strategy block (there is no strategy in old Fusion
    presets; it's app-only).
  - **New format** → includes the strategy block with the real Fusion strategy
    ID.
- Reuse the existing Fusion-conversion path (`internalToFusionTool` /
  `normalizePreset` / `fusionExport.js`) so every expression-sync invariant is
  honored — the copied JSON must be byte-compatible with what a full library
  write would produce. **Do not hand-serialize a preset.** Dan will pin the
  exact clipboard shape/formatting with you interactively.

---

## 8. Things explicitly OUT of scope

- **CAM material picker (`CamPresetPicker`)** — do not change. Referenced,
  reused, untouched.
- **Old-format presets' existing behavior** — don't auto-convert, don't
  restyle their operation logic beyond adding the Convert button.
- **The speeds/feeds calc, the Fusion round-trip, the data model** — unchanged
  except the two new persisted fields called out here (`f_z_base`, and the
  new-format strategy field) and the existing stepdown/stepover write path.
- **Physics (deflection / cutting force / spindle load)** — separate future
  project. See `PHYSICS_DESIGN.md`. Not part of this build. (The MRR readout is
  the only "physics-ish" thing in scope, and it's just geometry.)

---

## 9. Suggested build order (one phase at a time)

Per Dan's working style — feed these to yourself one at a time, not all at once:

1. **Shell**: full-width editor scaffold, the `Section` cards + contrast, all
   existing fields wired but as-is (no sliders yet). Confirm nothing broke.
2. **LinkedSlider**: extract the component, replace numeric fields, wire to the
   real `handleNumChange`. Driving/driven, left-justify, decimals, spinners.
3. **Soft max + wheel**: the ceiling-stretch behavior and wheel listeners
   (non-passive). Get the chevron `stretchedByUser` gate right.
4. **FactorSlider + MRR**: stepdown/stepover as % sliders w/ inch pair, MRR
   readout. Honor the triple-sync on save.
5. **Small Bore into Feedrates**: two-row, live-apply, override highlight,
   `f_z_base` persistence.
6. **Strategy section**: the format split, simple-list vs full-picker, Convert
   button, real strategy IDs from the repo, schema file.
7. **Copy for Fusion**: both placements, both formats, via the real conversion
   path.

Stop and confirm with Dan after the shell (step 1) and before the strategy
work (step 6) — those are the two places scope could balloon.

---

## Attached
- `UnifiedPresetEditor.jsx` — the design/behavior reference (read its comments)
- `PHYSICS_DESIGN.md` — future project, out of scope here, included for context
