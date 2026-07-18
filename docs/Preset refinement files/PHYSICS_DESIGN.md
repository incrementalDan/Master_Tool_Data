# Cutting Physics — Design Doc (future dedicated project)

**Status:** design only. Do not build yet. This is the spec for a later
focused pass, kept separate from the UI unification build so the two don't
tangle.

**One-line goal:** answer trade-off questions like *"if I drop the feedrate
but open up the stepover, does MRR go up while deflection and cutting force
stay put?"* — using numbers that are **relative to the shop's own proven
presets**, not absolute lab values.

---

## The core principle: relative, not absolute

The whole thing hinges on one decision: **never show a fake absolute number.**

- A number like "847 N" or "84 µm" implies a calibrated model we don't have.
  That's the lie. It would need per-tool geometry, per-material coefficients
  from testing, and machine data we can't fully trust.
- A number like **"1.4× your baseline"** is honest *and* more useful. It says
  "this change loads the tool 40% harder than a pass you already trust."
  Machinists already think in "hog it vs. baby it" — this puts a number on
  that instinct.

**Why relative is also EASIER (the key insight):**
The hard, paper-heavy parts of the physics **cancel out** when you compare two
setups on the same tool in the same material.

Deflection formula (endmill as a cantilever beam):

```
y = (F × L³) / (3 × E × I)
```

- `F` = cutting force
- `L` = tool stickout (overhang)
- `E` = tool material stiffness (modulus of elasticity)
- `I` = area moment of inertia (from the tool's core diameter)

Compare setup A vs setup B on the **same tool, same material**:
- `L`, `E`, `I` are identical → they **cancel**
- The material coefficient inside `F` (see `Kc` below) → **cancels**
- What's left is a **ratio of chip cross-section areas** — pure geometry from
  numbers already in the app (`fz`, `ae`, `ap`)

So the exact question Dan cares about answers itself with almost no material
data. The physics gets *simpler* the moment we stop demanding absolute values.

---

## The one model to implement: mechanistic cutting force

This is the backbone of every paper in the collection. Don't implement several
competing models — implement this one, cleanly.

**Cutting force** (tangential, the main component):
```
Ft ≈ Kc × A
```
- `Kc` = specific cutting force / cutting coefficient — a per-material number
  (units: force per unit chip area)
- `A` = chip cross-section area = `ae_engaged × fz`
  - `ae_engaged` = actual radial width of cut engaging the tool
  - `fz` = feed per tooth (chip load)

**Deflection** = the cantilever formula above, with `F = Ft`.

That's the entire spine. Everything else is refinement (see Phase B).

---

## Two indices to show (Phase A — the useful, honest version)

Both normalized so the **baseline preset = 1.00×**.

### 1. Relative Force Index
```
ForceIndex = (Kc_mat × ae × fz)  /  (Kc_baseline × ae_base × fz_base)
```
Same material → `Kc` cancels → it's a ratio of `(ae × fz)`. Pure geometry.

### 2. Relative Deflection Index
```
DeflIndex = (F × L³ / I)  /  (F_base × L_base³ / I_base)
```
Same tool → `L`, `I`, `E` cancel → collapses to the force ratio **unless**
stickout or tool geometry differs. With the stepped-beam model below, `I` is
not one value but a sum over segments — so a reduced-neck or long-reach setup
reads much higher here even at the same chip load. That sensitivity is the
point.

### 3. Relative Spindle Load Index
Spindle load is just the **power** the cut demands — and power is nearly free
once `Kc` exists, because it reuses MRR:
```
P_cut = MRR × Kc          (metal removal rate × specific cutting force = power)
Torque = P_cut / RPM      (with unit constants)
```
- Torque matters because spindles are **torque-limited at low RPM** and
  **power-limited at high RPM** — the same cut can be fine at 8000 RPM and
  stall the spindle at 2000.
- **Relative now:** `LoadIndex = P_cut / P_cut_baseline`. No machine data
  needed — reuses the live MRR readout and the one `Kc`.
- **Absolute later (Phase B):** true horsepower, and load-% against the
  selected machine's **spindle power curve** (`P_cut / spindle_max_power`).
  The machine record carries the rating once machine selection is wired.

**The optimization quad** (this is the whole point):
Show these next to the existing **MRR** readout — four numbers: **MRR, Force,
Deflection, Spindle Load.** The target pattern Dan described is: **MRR up, the
other three flat.** When a change pushes MRR up without moving Force,
Deflection, or Load, that's a free win. When they all rise together, you're
just trading tool life and spindle for speed. Side by side, that's visible at a
glance — and the trade-off question ("drop feed, open stepover, hold the
limits") answers itself.

---

## What the app already has vs. what's missing

| Have (in app today) | Missing (needed for physics) |
|---|---|
| `fz`, `ae`, `ap`, feed, RPM | **`Kc` per material** — add a column to the existing materials table |
| Tool diameter, flute count | (core diameter is now **derived** — see below, no data needed) |
| **Tool stickout / OOH** — confirmed in assembly data | (the big lever, and we have it) |
| **Flute length, shank diameter, reduced-neck geometry** — all in tool data | (used for the stepped-beam model below — this is what makes deflection tool-specific) |

### Core diameter — derived, not stored
Core (the solid web the flutes are cut into) is a fraction of the outside
diameter that **grows with flute count** — more flutes leave less room for
flute valleys, so more solid material stays in the middle. Close-enough ratios
(good to ~5%, plenty for a relative index):

| Flutes | Core ≈ |
|---|---|
| 2 | 0.55 × OD |
| 3 | 0.58 × OD |
| 4 | 0.60 × OD |
| 5 | 0.63 × OD |
| 6 | 0.65 × OD |

```
d_core = coreRatio(fluteCount) × cutDiameter
```
No new data entry — computed from cut diameter and flute count already on the
tool. `I = π/64 × d_core⁴` for the fluted section.

### Deflection is a STEPPED beam, not one uniform rod
This is the correction that makes the index reflect the *actual* tool. A real
endmill is not one diameter — it's segments of different stiffness stacked from
the holder down to the tip, and the app already stores all of them:

- **Shank** (top, at the holder) — bends on the **shank diameter**. Often
  bigger than the cut diameter → stiff.
- **Reduced neck** (if present) — a deliberately skinny section → the **weakest**
  link, weaker than even the core.
- **Fluted length** (the business end) — bends on the derived **core diameter**.

Because deflection goes with **L³**, *where* the skinny sections sit dominates
the result. A reduced-neck tool hanging out far deflects far more than a plain
cantilever predicts. Model it as **stacked segments**, each with its own
diameter (→ its own `I`) and length, and sum the contributions. Same force at
the tip; each segment bends according to its own stiffness and its distance
from the tip.

Practical version: treat it as segments in series from tip to holder. Each
segment `i` has length `Lᵢ`, moment of inertia `Iᵢ`, and a distance from the
tip. The tip deflection is the sum of each segment's bend plus the angular
"lever" effect of the segments below it. Even a simplified 2–3 segment sum
(neck / flute / shank) captures the dominant behavior and ranks tools correctly
— which is the acceptance bar, not absolute microns.

Data needed, all already on the tool record: cut diameter, shank diameter,
flute length, overall stickout, and reduced-neck length + diameter when present.

**Data model stubs to add when the physics project starts:**
- `material.Kc` — specific cutting force. Rough values ranked correctly by
  material are enough for relative math; precise values are a Phase B concern.
- `tool.coreDiameter` (or a per-type `coreRatio`) → drives `I = π/64 × d_core⁴`.
- Baseline linkage: each tool needs a pointer to its **known-good preset**
  (the 1.00× reference). Dan chose user-marked "known good" as the baseline
  source — add a `preset.isBaseline` flag, one per tool.

---

## Baseline = user-marked "known good"

Decision: the 1.00× reference is a preset the **user explicitly marks** as
known-good, not an auto-pick or a textbook value.

- Rationale: the shop's proven pass is the only reference a machinist actually
  trusts. "1.4× the deflection of the pass I ran last week without chatter"
  means something; "1.4× a handbook number" doesn't.
- One baseline per tool. If none is marked, the indices show "—" rather than
  guessing (don't fabricate a reference).
- UI: a small "known good" star/flag on a preset card. The baseline preset
  itself reads exactly 1.00× on all indices (sanity check for the user).

---

## Kc — the one piece of real material data

- `Kc` (specific cutting force, sometimes `k_c1.1` in the papers) is the only
  material property that doesn't cancel in absolute terms — but it **does**
  cancel for same-material comparisons, which is the common case.
- It matters only when comparing **across materials** (rare in a single preset
  edit) or if Phase B adds absolute numbers.
- Start with a **coarse table** — one representative `Kc` per ISO material
  group (P/M/K/N/S/H) is enough for correct *ranking*. Refine later.
- Chip-thinning nuance (radial engagement below ~50% of diameter raises the
  effective chip load) can be layered in later; note it but don't gate Phase A
  on it.

---

## Scope split — be honest about the line

### Phase A — buildable, genuinely useful, HONEST
- Relative Force, Deflection, and Spindle Load indices — all × baseline.
- **Deflection uses the stepped-beam model** (neck / flute / shank segments),
  so it reflects the specific tool, not a generic rod.
- **Core diameter derived** from cut dia + flute count (no data entry).
- **Kc added as a column** to the existing materials table.
- Uses only data already on the tool + a coarse `Kc`. No calibration. Shows
  "× baseline," never absolute units.
- Answers Dan's actual question (the MRR / force / deflection / load quad).
- **This is the version to build when the physics project starts.**

### Phase B — bigger project, needs the papers
- Absolute numbers: Newtons of force, microns of deflection, real horsepower.
- Spindle **load-% vs. the machine's power curve** (the relative Load Index
  becomes an absolute % once the machine rating is wired).
- **Chatter / stability lobes** (regenerative vibration) — its own research
  effort; depth-of-cut sweet spots vs. RPM.
- Chip-thinning correction, helix/lead angle effects, multi-flute engagement
  timing.
- Requires: full `Kc` per material from testing, real tool geometry, machine
  power curves. Worth doing. Not now.

---

## Data model — what to add when the physics project starts

- **`material.Kc`** — a new column on the **existing materials table** (not a
  new table). Coarse values ranked correctly by ISO group are enough for
  relative math.
- **`preset.isBaseline`** — one "known good" flag per tool (the 1.00× ref).
- **Core diameter** — NOT stored. Derived at calc time from cut diameter +
  flute count via the coreRatio table.
- **Tool geometry for the stepped beam** — already on the tool record; the
  physics code just needs to READ it: cut diameter, shank diameter, flute
  length, stickout/OOH, and reduced-neck length + diameter when present.

---

## Why this is documented, not built now

- Physics touches **three layers at once**: data model (`Kc`, core dia,
  baseline flag), math engine (new relative-index functions), and UI (indices
  next to MRR, the known-good flag).
- Folding it into the current UI-unification build would tangle two unrelated
  changes and make both harder to review.
- Cleaner sequence: **ship the UI → then do physics as its own focused pass**
  against this spec, which is already thought through.

---

## First tasks when the physics project begins (not now)

1. Add **`Kc` column** to the existing materials table; seed coarse values by
   ISO group (P/M/K/N/S/H). Add `preset.isBaseline` flag (one per tool).
2. `coreRatio(fluteCount)` helper + `d_core` derivation. No stored core dia.
3. **Stepped-beam deflection**: a function that reads the tool's segment
   geometry (neck / flute / shank) and sums each segment's contribution to tip
   deflection. Pure, unit-testable.
4. Math engine: `forceIndex`, `deflectionIndex`, `spindleLoadIndex` — all
   pure functions taking `(preset, baseline)`, returning × baseline.
5. UI: "known good" flag on preset cards; the four-number readout (MRR, Force,
   Deflection, Load) beside the existing MRR spot in the Passes section.
6. Validate **ordering** against real cuts Dan knows — a reduced-neck tool at
   reach should read clearly higher deflection than a stub. Ranking
   correctness is the acceptance test, not absolute accuracy.
