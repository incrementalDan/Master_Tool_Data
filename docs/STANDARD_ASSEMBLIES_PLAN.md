# Standard Tool Assemblies (RTAs) — plan

**Status:** plan only, nothing built. Written 2026-08-24.

-----

## What we are actually modelling

ProShop assumes **every** tool assembly is an RTA. That is not how the shop works.

- An **RTA is a STANDARD (core) tool assembly** — one tool ID, one fixed holder, one fixed
  OOH, one fixed collet size and type, built once and left assembled, ready to drop into whatever machine needs it.
- Most assemblies in the library are **not** standard. They are job-specific stick-outs that
  happened to get proven once. They are real, they keep their `asm_number`, and they must
  keep working exactly as they do now.
- **No standard RTAs are defined yet.** This is a greenfield start, not a migration.

So "standard" is a **property of an assembly**, not a mode of the shop. That single sentence
drives every decision below.

-----

## ⚠️ The finding: `proshop_rta` as a MODE is the wrong shape

`shop_settings.assembly_id_system.mode = 'proshop_rta'` currently means *"every assembly's
number IS a ProShop RTA# you type by hand."* That is **ProShop's wrong assumption baked into
our config** — it is exactly the thing we are correcting.

It also can't coexist cleanly with the new flag: in that mode a non-standard assembly would be
sitting there demanding an RTA number it should never have.

**Recommendation — retire `proshop_rta` as a mode; re-home RTA into the standard layer.**

- Nothing to migrate: the shop is on the default `auto` mode, and no RTAs exist yet.
- `asm_number` stays what it is — the **universal** digital reference every assembly gets
  (Auto-composed today). Unchanged.
- The RTA becomes a **second, sparse field** that only standard assemblies carry.
- Leave the mode id in `ASM_MODES` marked deprecated/hidden rather than deleting it, so any
  stored `mode: 'proshop_rta'` still loads (falls back to `auto` behaviour) instead of
  producing blank numbers.

*(If you'd rather keep the mode, everything below still works — it just means an RTA number can
live in two fields, and we'd need a rule for which wins. I don't recommend it.)*

-----

## Data model — two new fields on an assembly

Both **metadata-only**. Fusion has nowhere to put either (correct per *"If Fusion has a place
for it, Fusion must have it"* — it doesn't, so this is genuinely metadata-only).

```jsonc
{
  "assembly_id": "uuid",
  "asm_number": "NBT30-SK13C-60-1001-2.125",   // unchanged — every assembly has one
  "is_standard": false,                         // NEW — is this a core/standard assembly?
  "standard_asm_number": null,                  // NEW — the RTA#, only when is_standard
  "legacy_asm_numbers": []                      // reused — retired RTAs land here
}
```

- `is_standard` — plain boolean, defaults `false`. **`false` and absent mean the same thing**
  (nothing predates this feature, so there is no "nobody answered" state to preserve — same
  reasoning as `tool_status`'s Active default).
- `standard_asm_number` — the human-facing RTA string (`RTA-1001`). **Null unless standard.**

**Why a second field and not a reuse of `asm_number`:** the two answer different questions.
`asm_number` is *"how do I refer to this assembly in software"* and is re-derivable from
holder + tool_id + OOH. The RTA is *"which pre-built assembly on the shelf is this"* — assigned
by a person, not derivable from anything. Collapsing them would make the Auto backfill fight
the RTA on every load.

### Retirement

An RTA is precisely the case `legacy_asm_numbers[]` was built for (it is a **non-derivable,
externally-meaningful** value — see `shouldRetireAsmNumber`). So:

- Renumbering a standard assembly → old RTA retires into `legacy_asm_numbers[]`.
- **Un-flagging** an assembly as standard → RTA retires and the field clears. An RTA on an
  assembly nobody calls standard is a stale claim (same rule as `replaced_by` clearing when a
  tool leaves `retired`).
- Retired values stay **searchable** and show under the existing `show_legacy` "Formerly:" line
  with zero new wiring.

*Tradeoff accepted:* `legacy_asm_numbers[]` will hold two namespaces (old Auto-ish numbers and
old RTAs). Search and display are both substring matches, so nothing breaks — and a separate
`legacy_standard_asm_numbers[]` would mean new search + new display code for no user-visible
gain.

-----

## Config — a `standard` block inside the Assembly ID System

**Not a fourth ID system.** This is a numbering layer *inside* the Assembly ID System, the same
way the Bin's auto-vs-fixed picker is a field inside a Location System rather than a system of
its own (see *Three-System Identification Architecture*).

```jsonc
"assembly_id_system": {
  "mode": "auto",
  "separator": null,
  "serial_start": 10000,
  "show_legacy": false,

  "standard": {                 // NEW — the whole block is optional
    "enabled": false,           // master switch; off = feature invisible everywhere
    "mode": "sequential",       // 'sequential' (we assign) | 'manual' (you type it)
    "prefix": "RTA",
    "separator": "-",
    "start": 1001,
    "skip": [],
    "digits": 4
  }
}
```

- **`enabled: false` by default** — nothing changes in the UI until you turn it on.
- `sequential` composes `RTA-1001` from prefix + separator + padded counter.
- `manual` shows a free-text box (for the day ProShop hands you the number instead).
- Preview in Settings via a `previewStandardAsmNumber(cfg)` helper, mirroring
  `previewToolId` / `previewAsmNumber`.

-----

## Numbering rules

1. **Unique shop-wide.** An RTA points at one physical assembly on a shelf. Two assemblies on
   one number is the same class of bug as two operations on one program number.
   → `usedStandardAsmNumbers(tools)` scans the whole library; `nextStandardAsmNumber(cfg, used)`
   walks up from `start`, honouring `skip`.
2. **Computed max+1, never a stored counter.** Same rule as `nextProgramNumber` — a stored
   counter drifts the moment anything is deleted or hand-edited.
3. **Generation never auto-runs.** A number is minted at the *explicit act* of flagging an
   assembly standard. Nothing backfills at load, because there is nothing to derive it from.
   ⚠️ `backfillAsmNumbers` must not touch these fields at all.
4. **Never re-derived, so never "stale".** Unlike Auto `asm_number`, an RTA is not a product of
   holder/tool_id/OOH — so changing the OOH does **not** renumber it (see the open question
   about what changing the OOH *should* mean).

-----

## Code touch points

### New pure helpers — `src/utils/assemblyIdSystem.js`

Framework-free, alongside the existing helpers:

| Helper | Does |
|---|---|
| `standardConfig(asmConfig)` | read-with-defaults for the `standard` block |
| `isStandardEnabled(asmConfig)` | the master switch, read in one place |
| `composeStandardAsmNumber(cfg, n)` | `prefix + sep + padNumber(n, digits)` |
| `usedStandardAsmNumbers(tools)` | every RTA in use, incl. retired ones (never re-issue) |
| `nextStandardAsmNumber(cfg, used)` | next free, honouring `start` + `skip` |
| `previewStandardAsmNumber(cfg)` | the Settings live preview |
| `standardAssembliesOf(tool)` | the standard assemblies on one tool |
| `retireStandardAsmNumber(asm, next)` | the clear/renumber + legacy push, in one place |

### ⚠️ The three-place persistence trap

A new assembly field must be added in **all three** or it is silently dropped on the next save:

1. `schema/metadataModel.js` → `buildMetadataTool`'s `assemblies.map` (~line 425)
2. `schema/logicalTools.js` → `buildLogicalTool`'s assembly map (~line 51)
3. `schema/logicalTools.js` → `buildUnlinkedTool`'s assembly map (~line 411)

`completeRecord.test.js` already round-trips assemblies, so add both fields to its fixture —
that test is what will catch a missed spot.

### Write path — `src/context/toolActions.js`

- `writeLogicalTool`'s asm-stamp block (~line 128): mint a `standard_asm_number` for any
  assembly that is `is_standard` and has none, threading a `nextStandard` counter across the
  batch exactly like `nextSerial` does today.
- `updateAssembly` (~line 1069): it already re-derives on OOH/holder change. It must **not**
  re-derive the RTA (not derivable) — but see the open question below about whether changing a
  standard assembly's OOH should be blocked or warned.

### Search — `src/services/searchEngine.js`

- `textSearch` (~line 196) → add `standard_asm_number` to the assembly scan.
- `~line 225` (the id collection) → include it.
- Optional: a `matchedStandardAsmNumber` helper so a card can say *why* it matched, mirroring
  `matchedLegacyAsmNumber`.

-----

## UI surfaces (all gated on `standard.enabled`)

| Where | What |
|---|---|
| **Settings → Assembly ID System** | An "Enable standard assemblies (RTA)" toggle, and when on: mode radios, prefix / separator / start / skip / digits, and a live preview. Buffered into the page draft like everything else on that page. |
| **`AssemblyForm`** | A **Standard assembly** checkbox. Ticking it (sequential mode) shows the number that *will* be assigned; in manual mode, a text box. Unticking warns that the RTA will be retired. |
| **`AssemblyCard`** | An **RTA badge** next to the existing blue `asm_number` badge — visually distinct (it is a different kind of ID), plus a small STANDARD marker so a core assembly reads at a glance. Retired RTAs already ride the existing "Formerly:" line. |
| **`ToolDetail` → Assemblies** | Sort or mark standard assemblies first — when someone opens a tool to pick a setup, the pre-built one is the answer most of the time. |
| **Labels** | See below — the one that needs care. |

-----

## ⚠️ Labels — the RTA field exists and is deliberately blank today

`utils/toolLabels.js` already emits `RTA: ''` with the comment *"it isn't assigned at this
stage and a stale one is worse than a blank."* Standard RTAs are what finally let us fill it —
**but only under a strict condition.**

A label row comes from a posted **Sequence Detail CSV row**, which resolves to a *tool*, not to
an assembly. To print an RTA we must first decide **which assembly the posted program actually
ran**, using the row's own holder + OOH.

**The rule:**

> Print the RTA **only** when the posted row's holder and OOH match a **standard** assembly
> (holder by the usual normalized description match, OOH within `lengthEps(unit)`).
> Otherwise the field stays **blank**.

Why this is not optional: if the job was posted with a non-standard stick-out and we print the
standard RTA anyway, we send an operator to fetch a **pre-built assembly that is not what the
program expects**. That is the exact crash-adjacent failure the *CSV always wins* rule exists to
prevent. A blank is correct there — the operator builds it from the holder/OOH on the tag, as
they do today.

Mechanics:
- New resolver in `sequenceImport.js` (next to `resolveRowLocation`), e.g.
  `resolveRowStandardRta(row, toolsById)` — returns the RTA or `''`.
- `labelFieldsOf` calls it instead of hardcoding `''`.
- **`labelKey` needs no change** — it already includes `f.RTA`. And because the RTA is derived
  from holder + OOH, which are already in the key, adding it can never split a label that the
  key doesn't already split. Dedupe stays correct.
- ⚠️ Resolve **live at render**, not stored at import — so assigning an RTA today fixes the
  next label print with no CSV re-upload. Same reasoning as the location exception.

-----

## Insert pairings — the third place an RTA lives

`pairing.rta_number` already exists (`insertFamilies.js`, edited in `PairingSections.jsx`),
because for a turning family *"RTA is structurally the 2-tier pairing"* — there is no tier-3
assembly to hang it on.

That is a **legitimate** second home, but we should not end up with two unrelated RTA concepts.

- **Phase 1: leave it alone.** Assemblies only.
- **Follow-up:** give the pairing the same pair of fields (`is_standard` +
  `standard_asm_number`), fed by the same counter and the same uniqueness scan, and deprecate
  `pairing.rta_number`. A turning pairing *is* a fixed body+insert combination, so it is a
  natural standard assembly.

-----

## ProShop export — deferred, but the shape is now known

Not building it. Two things to record so we don't rebuild the wrong assumption:

1. **Only standard assemblies export as RTAs** — one ProShop RTA row per standard assembly, not
   one per assembly. That is the whole correction.
2. ⚠️ **Rewrite the stale TODO** at `utils/proShopExport.js:6`, which currently says *"when
   mode is `proshop_rta`, export each assembly's RTA# (`asm_number`)"* — that encodes exactly
   the model we are moving away from and will mislead whoever picks it up.

Import stays out of scope entirely (agreed — no ProShop RTA data to bring in).

-----

## Explicitly NOT doing

- No separate "standard assemblies" page, table, or browse view. A standard assembly is an
  assembly.
- No enforcement that a tool may have only one standard assembly (a short and a long standard
  setup is plausible — don't guess).
- No detector / worklist for "tools with no standard assembly." Every tool legitimately lacks
  one right now, so it would be a flag nobody can clear — wallpaper by day two.
- No auto-promotion of an existing assembly to standard based on usage frequency. That is a
  judgement call, and judgement calls are surfaced, never guessed.
- No changes to Fusion writes. Neither field has a Fusion home.

-----

## Backwards compatibility

**Compatible — no data to re-enter, nothing to migrate.** Both fields are new and optional and
default cleanly (`is_standard: false`, `standard_asm_number: null`) on every record written
before them. The `standard` config block is additive and off by default.

The one thing worth naming: if you have a shop stored with `mode: 'proshop_rta'`, retiring that
mode changes how its assemblies get numbered. **Verified not the case here** — the default is
`auto` and nothing has been switched.

-----

## Suggested build order

1. **Helpers + config defaults** (`assemblyIdSystem.js`, `sharedDefaults.js`) + their unit
   tests, incl. uniqueness and skip handling. No UI yet.
2. **Persistence** — the three schema spots + the `completeRecord.test.js` fixture. Prove a
   flagged assembly survives a save/reload round trip *before* building any UI on top of it.
3. **Write path** — the stamp in `writeLogicalTool`, the retire-on-unflag rule.
4. **Settings UI** — the enable toggle + numbering config + preview.
5. **`AssemblyForm` + `AssemblyCard`** — flag it, see it.
6. **Search.**
7. **Labels** — the resolver + the match rule. Last, because it depends on real RTAs existing to
   test against.
8. *(Later)* pairings, then ProShop export.

Steps 1–3 are the part worth getting exactly right; 4–7 are ordinary UI.

-----

## Open questions

1. **Changing a standard assembly's OOH or holder** — what should happen? It stops being the
   assembly the RTA describes. Options: (a) block it, (b) warn and keep the RTA, (c) warn and
   retire the RTA. My lean is **(b) warn** — the shop may legitimately re-build a standard to a
   new stick-out and keep the same shelf number — but this is yours to call.
2. Re-flagging an assembly standard after un-flagging: mint a **new** number (my lean, and the
   old one stays searchable in legacy), or re-adopt the retired one?
3. RTA format — is `RTA-1001` right, or does ProShop expect a bare number / a different prefix?

-----

## 📌 NOTED FOR LATER — the exact collet in the assembly

**Not designed yet. Placeholder so it isn't lost.** Raised while planning standard assemblies:
a standard RTA is *"one tool, one holder, one OOH"* — and it is not fully specified until it
also says **which collet**. Two collets in the same holder are two different assemblies.

### The gap, precisely

What we model today is the holder's **collet SERIES**, not the collet:

| Thing | Where it lives now |
|---|---|
| Collet **family** (SK / ER / TG) | `holder.collet_family_id` → `shop_settings.holder_config` |
| Collet **series / nut size** (SK13, ER16) | `holder.collet_size_id` → same |
| **The actual collet** (SK13 × 1/4", 0.240–0.250 range) | ⚠️ **nowhere** |

An SK13 holder accepts many collets. Which one is in it depends on the tool's shank — so this
is a property of the **assembly**, not of the holder.

### Why it is not one parameter

At minimum: **series** (SK13) · **nominal bore** (1/4" / 6mm) · **clamping range** (min/max —
a collet grips a *band*, not a size) · its **own unit** (an inch collet on a metric tool is
normal) · **sealed / coolant-through** · **manufacturer + part number** · and the
**gauge-length consequence** — CLAUDE.md's `target_gauge_length` note already says *"SK collets
shift actual gauge by shank-vs-range"*, with the formula marked TBD. That formula almost
certainly needs the collet's range and the tool's actual shank diameter, which means this note
and `target_gauge_length` are the same piece of work.

### The structural question to answer first

**Is a collet a `tool_components.json` component record?** It fits that shape exactly — a real
physical object the shop buys, stores in a drawer, and looks up, that Fusion must never see
(Fusion has no collet concept; the holder geometry is already baked). That would give it a
location, purchasing, and a photo for free via the existing component machinery, and the
assembly would hold a plain `collet_component_id` FK.

The alternative — a `collet_id` into a new shared list in `holder_config`, like the option
lookups — is lighter but gives a collet no location or purchasing, which is probably wrong for
something you physically own dozens of.

**Lean: component record.** Decide before writing anything.

### Interactions to check when this is picked up

- **Standard assemblies** (this doc): the collet belongs in the RTA's definition, and probably
  on the printed label — an operator building from a tag needs to know which collet.
- **`target_gauge_length`**: likely unblocked by this. Same work.
- **Validation**: warn when the tool's shank diameter falls outside the collet's clamping range.
- **Insert pairings**: `holdsOwnLocation` — a collet is another thing whose location lives on
  the component, not the tool.
- **Holder retire/replace flows**: swapping a holder may invalidate the collet choice.
