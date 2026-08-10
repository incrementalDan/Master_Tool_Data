# Data Audit — 8-10-26

Audit of the app's own files against the Fusion library and the ProShop export,
ahead of switching the shop over for real.

**Re-run against `8-10-26 POST CLEAN UP PM FIX/`** after the first pass was
actioned. The original snapshot is in
`FUSION TOOL Library REF/8-10-26 Current App State and Fusion/`.

| File | Then | Now |
|---|---|---|
| `ToolDEX - MASTER 8-10-26PM.json` | 303 entries → 210 logical tools | unchanged |
| `tool_metadata.json` | 276 records | **268** (8 orphans deleted) |
| assemblies | 311 | 303 |
| app presets / Fusion presets | 358 / 671 | 335 / 612 |
| `holder_library.json` | 22 records | unchanged |
| `vendor_registry.json` | *not supplied* | **70 entities** |
| ProShop export | 271 distinct `Tool #` | unchanged (not re-exported) |

`jobs.json` still to come — no job FKs are in use yet, so nothing is blocked on it.

---

## Verdict

**Everything that was blocking is fixed. The structure is sound. Start using it.**

The first pass found four blockers and four correctness problems. **Seven of those
eight are now zero.** Nothing new appeared.

What remains splits cleanly in two:

- **Two SQLite blockers** that are invisible by nature and cannot be seen or fixed
  in the app — they don't affect it running, only the migration. Leave them.
- **14 tools with contradictory dimensions**, which had no library-wide surface.
  They do now — **Settings → Library Health → Geometry review**.

---

## Fixed since the first pass

| | Then | Now |
|---|---|---|
| Orphan metadata records | 8 | **0** ✅ |
| Assemblies below MIN OOH | 62 | **0** ✅ |
| Unresolved conflicts | 14 | **0** ✅ |
| Duplicate machine numbers | 5 | **0** ✅ |
| Machine numbers below start | 2 | **0** ✅ |
| Invalid `tool_type` | 2 | **0** ✅ |
| Presets with a material but no CAM-preset FK | 18 | **0** ✅ |
| Dangling `stock-materials` | 4 | **0** ✅ |
| Tools with no machine number | 1 | **0** ✅ |

Deleting the 8 orphans did exactly what it was predicted to do — every machine-number
problem went with them.

## Still verified clean

Re-checked, not carried over:

| Check | Result |
|---|---|
| App vs Fusion — ID, description, type, all geometry, machine #, location, preset counts | **0 disagreements** across 210 tools |
| Fusion expression ↔ native geometry (unit-aware) | **0** across 303 entries |
| Stepdown/stepover flag false with a leftover expression | **0** across 612 presets |
| App-only fields leaked into Fusion JSON | **0** |
| Fusion coolant values | 612 / 612 valid |
| `reference_guid` placeholders | **0** |
| **Every foreign key in the app** — incl. `vendor_registry` for the first time | **0 dangling** |
| Holder identity — record `fusion_guid` → Fusion library | 21 / 21 |
| Holder records pushed to Fusion | 22 / 22 |
| Assemblies carrying `holder_id` | 302 / 303 |
| Duplicate PKs — records, assemblies, components | **0** |

The one assembly without a holder FK is `TF-194/TO-195`, the turning tool —
excluded by design (`HOLDER_LINK_SKIP_TYPES`), since a Fusion turning entry carries
no holder object to match against.

---

## Open — 1. Two SQLite blockers

Neither affects the app. Both matter only when the data becomes tables, and
**neither is visible in the UI because neither is a problem the app can have** —
they're artifacts of the JSON shape.

### S1 · 21 preset GUIDs shared across different tools
Down from 26 (the orphan deletion took five). Never duplicated *within* a tool, so
`preset_meta` — keyed by guid, scoped per record — is correct at runtime. A
`presets` table with `guid` as primary key **will fail to import**.

Caused by duplicating tools in Fusion; the copy carries the original's preset guids.

**Fix at migration time:** composite key `(tool_record_id, guid)`. Nothing to do now.

### S2 · `bin` stored as both string and integer
19 records store `bin: "10000"` as a string, 247 store an integer. Same
`normalizeBin` drift as before — a fixed-bin system's `fixedVal` is a config
*string* written straight through. `A-252` still sits in that same drill-index
system with `bin: 10000` as an **integer**, which is what proves it's drift.

Harmless at runtime (every comparison goes through `String()`); it decides whether
that column is `INTEGER` or `TEXT`.

### S3 · `shop_settings.holder_config` still isn't in the file
Holder `type_id` / `taper_id` / `collet_family_id` / `collet_size_id` reference
stable slugs (`ht-collet`, `tp-nbt30`, `cs-sk13`) that exist **only in the code
seed** (`seedHolderConfig()`). Correct at runtime — the seed is the documented
fallback — but there's no lookup table in the data to import. Materialize it before
migrating.

---

## Open — 2. Fourteen tools with contradictory dimensions

**You now have a way to see these: Settings → Library Health → Geometry review.**

They weren't hidden before — `validateGeometry` has always produced them — but they
rendered only inside *one tool's* Geometry section, so finding nine tools out of
268 meant opening all 268. That's the gap; the check was there, the surface wasn't.

Read-only by design. "Shoulder 0.95 > MIN OOH 0.75" doesn't say *which* number is
wrong, and guessing would write a real dimension into Fusion.

### Chain violations (9)
```
A-244   Shoulder 1.9   > MIN OOH 0.49     3/64 (.047) 5FL EM .071LOC P C6
L-74    Shoulder 0.875 > MIN OOH 0.32     .375 90DEG CHAMFER
D-203   Shoulder 2     > MIN OOH 1.64     11/64 (.1719) Carbide Drill TSC
A-25    Shoulder 0.95  > MIN OOH 0.75     3/8 AiTin EM 4FL 7/8 LOC
R-41    Shoulder 1.2   > MIN OOH 0.9      M3 x 0.5 D3 Bottoming form tap
D-84    Shoulder 4     > MIN OOH 3.95     13/32 (.406) HSS Drill
D-20    Shoulder 1.47  > MIN OOH 1.46     Letter U Drill
D-26    Flute 1.6      > Shoulder 1.5     7.45 mm Drill 140 Deg
D-18    MIN OOH 1.73   > OAL 1.72         7.45mm (.293) Carbide Drill
```
`D-20`, `D-84` and `D-18` are off by 0.01" — likely a typo in one of the two
fields. The rest are real gaps worth measuring.

### Description contradicts the stored flute length (5)
A cross-check the app didn't have. It's the only thing that catches a length typed
into the wrong field:

```
A-244   description says .071 LOC   stored flute length 1.9    ← see below
D-174   description says 1.065 LOC  stored 1.378
A-12    description says 1.25 LOC   stored 1
A-30    description says .75 LOC    stored 0.875
D-185   description says .295 LOC   stored 0.197
```

⚠️ **`A-244` is the one to fix first.** It is the only tool that appears in *both*
lists. A 3/64″ (.047) end mill carrying a **1.9″ flute length** is a 40:1
length-to-diameter ratio — physically impossible — and its shoulder length is 1.9″
against a MIN OOH of 0.49″. Its own description says `.071LOC`. Almost certainly a
value landed in the wrong field.

---

## Open — 3. ProShop dimension differences

You said you're not worried and the export wasn't re-run — this is just the list you
asked for. Most differences are explainable; these are the ones that look like real
errors.

**Diameter — worth checking physically:**
```
K-213   ProShop 0.125   app 0.045   "1/8Ø corner round .04R .045PilotØ"
K-164   ProShop 0.125   app 0.046   ".125 Corner round .03 radius .046 pilot"
```
Both corner rounders store the **pilot** diameter where Fusion expects the cutting
diameter. Consistent across both, so it may be deliberate — but Fusion's `DC` drives
toolpath geometry, so if it's not deliberate it matters. The other seven diameter
differences are ≤0.017″ and read as nominal-vs-measured.

```
R-145   ProShop 0.291   app 0.25    "1/4-28 UNF 3B Form tap"
```
A form tap's actual OD is above nominal, so ProShop's 0.291 is probably the true
one and the app has the nominal 1/4.

**Flute count — one of the two is wrong:**
```
L-108   ProShop 5   app 6    .135 Back Chamf
B-158   ProShop 3   app 4    1/16Ø Ball 3/16 LOC
K-164   ProShop 2   app 1    .125 Corner round
```

**Lengths — mostly the app's round placeholders.** `overall_length` still clusters
on 1.5 (38 tools), 2.5 (37), 2.0 (28), 4.0 (19) — 122 of 238 on four values. Five
index drills (`D-153`, `D-154`, `D-238`, `D-236`, `D-26`) all carry **5.2** against
ProShop's 2.0–3.2, and three taps (`R-19`, `R-191`, `R-41`) all carry flute length
**0.8**. Those are defaults, not measurements. Not urgent — OAL doesn't drive
toolpath — but treat it as unverified.

Insert pairings (`I-232`, `I-246`, `G-233`, `I-126`) differ by design: ProShop
describes one component, the app describes the combined Fusion entity. Ignore those.

---

## Open — 4. Hygiene

| Finding | Detail |
|---|---|
| `tool_id` with a trailing space | **`'D-148 '`** — the one that will bite a SQL join or a ProShop match |
| Descriptions with stray whitespace | 20 leading/trailing (you said ongoing — noted, not urgent) |
| Test records still live | `L-189` *"1/8 chamfer test"*, and `FTL-C0ECBD` *"#42 … .141LOCtesttttt"* — the latter has **no Tool ID**, an OAL of 21.5″, and is in the unassigned-location list in your screenshot |
| Test holder still live in Fusion | `HLD-AC5E04` *"TEST NBT30-SK13C-fake"* |
| 6 holder records unclassified | `HLD-CE3310`, `HLD-6AF522`, `HLD-B94907` (no type/taper/collet); `HLD-7E7DDD`, `HLD-D5FFE8`, `HLD-5BBE03` (no collet — reasonable for a drill chuck, face mill and boring holder) |

---

## Open — 5. The knowledge layer

Unchanged in character, and deliberately so — you said you wanted the structure
right first. For the record:

| Layer | Coverage |
|---|---|
| Preset → assembly FK | 55 / 335 (16%) — was 41 / 358 |
| Preset `operation_type` | 90 / 335 (27%) |
| Preset → CAM preset FK | 187 / 335 (56%) · **0 unlinked** |
| Purchasing → registry FK (mfg / vendor) | 32% / 46% — was 22% / 32% |
| Jobs / tags / notes / speed-feed refs | 0 / 0 / 2 / 0 |
| Photos | 236 / 268 |

Preset naming is still the lever: a name like `AL - Rough` carries no OOH or holder
token, so `presetMatchesAssembly` can't seed the assembly FK. Name them to the
convention and the link, the material and the operation type all follow.

The 58 no-Fusion tools still have zero assemblies and zero presets — expected, since
they were never built in Fusion.

---

## Location issues

Matches your screenshot exactly: **4 duplicate bins** (173, 59, 49, 24), **8 gap
runs**, **8 unassigned**. The drill-index bin 10000 with 22 records is correctly
exempt (`allowDuplicates`). Three of the eight unassigned are components (`I-126`,
`I-167`, `G-169`) — assign them like any tool. You said this can wait; nothing here
blocks anything.

---

## What changed in the app for this audit

`Settings → Library Health` — derived worklists in the same shape as
`LocationIssuesPanel`, recomputed on demand, never stored:

1. **Orphaned records** — find and delete metadata whose tool was deleted in Fusion.
   *(Used; now reports zero.)*
2. **Assemblies below MIN OOH** — per-tool selection, writes `geometry.LB` and the
   assembly gauge together. *(Used; now reports zero.)*
3. **Geometry review** — the whole library's contradictory dimensions in one list,
   plus the description-vs-flute-length cross-check. Read-only, links to each tool.

`validateGeometry` also gained the per-assembly end of the MIN OOH rule, so a
below-floor assembly now warns on the tool page as well.

---

## Bottom line

Everything that would have made this a bad foundation is gone. **Zero drift with
Fusion, zero dangling foreign keys, zero unresolved conflicts, zero orphans.**

What's left is a short list of tools to measure — start with **`A-244`** — two
migration notes to remember later, and a knowledge layer you'll fill in as tools
come across the bench.

**The structure is right. Go use it.**
