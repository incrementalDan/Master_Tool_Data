# Data Audit — 8-10-26 snapshot

Audit of `FUSION TOOL Library REF/8-10-26 Current App State and Fusion/` — the app's
own files vs. the Fusion library vs. the ProShop export, ahead of switching the
shop over for real.

**Sources compared**

| File | Contents |
|---|---|
| `ToolDEX - MASTER 8-10-26.json` | Fusion tool library — **303 entries** → **210 logical tools** |
| `ToolDEX-Holder 8-10-26.json` | Fusion holder library — 21 entries |
| `tool_metadata.json` | **276 records** |
| `holder_library.json` | 22 holder records, 2 parts |
| `tool_components.json` | 13 components |
| `materials.json` | 7 groups / 30 CAM presets / 65 alloys |
| `shop_settings.json` | 2 location systems, 3 machines, 1 tool + 1 holder library |
| `ProShop Export 8-10-26.csv` | 352 rows → **271 distinct `Tool #`** |

⚠️ **`jobs.json` and `vendor_registry.json` were not in the dump.** Every FK that
points into them is unverified — see G4.

---

## Verdict

**The sync is genuinely correct. The structure is sound. The library is not finished.**

Three distinct answers to your three questions:

1. **Is the data in sync?** — **Yes, and cleanly.** Across all 210 Fusion-linked
   tools there is **zero drift** between the app and Fusion on every shared field.
   Every Fusion round-trip invariant this repo has been bitten by is holding. This
   is the strongest possible result on this question and it is worth trusting.

2. **Is it structured for SQLite?** — **Almost.** The relational design is right.
   There are **four concrete blockers**, all mechanical, all fixable in an afternoon.
   None require a schema change.

3. **Are there bugs?** — **No code bugs found in the sync layer.** What's there is
   **data debt**: ~90 records with geometry that disagrees with ProShop or violates
   the length-ordering chain, plus a large unpopulated knowledge layer (presets,
   materials, purchasing links).

**Recommendation: fix Tier 1 and Tier 2 below, then start using it.** Tier 3 is
ongoing work that the app is designed to absorb incrementally — it is not a reason
to delay.

---

## What is verified clean

Not assumed — each of these was checked against the actual files.

| Check | Result |
|---|---|
| App metadata vs Fusion: `tool_id`, description, type, all geometry, machine #, location, preset counts | **0 disagreements** across 210 tools |
| Fusion expression ↔ native geometry (unit-aware) | **0 real disagreements** across 303 entries |
| Formula expressions preserved byte-for-byte | 17 found, all intact (incl. the big `tool_shaftDiameter` ternaries) |
| `use-stepdown`/`use-stepover` false with a leftover expression — *the recurring revert bug* | **0** across 671 Fusion presets |
| App-only fields leaked into Fusion JSON (`machine_id`, `job_ids`, `operation_type`, …) | **0** |
| Fusion coolant values | all 671 valid (`flood` 592, `flood tool` 61, `disabled` 11, `tool` 7) |
| `reference_guid: "<NEW TOOL GUID>"` placeholders | **0** |
| Duplicate primary keys — `metadata.id`, `assembly_id`, `component.id` | **0** |
| `materials.json` internal FKs (preset→group, alloy→preset, alloy→group) | **0 dangling** |
| Holder identity — record `fusion_guid` → Fusion holder library | **21 / 21 resolve** |
| Holder records pushed to Fusion (`last_pushed` stamped) | **22 / 22** |
| Assemblies carrying the `holder_id` FK | **303 / 311 (97%)** |
| Timestamps present and ISO-formatted | 276 / 276 |
| Duplicate-bin detection vs. your screenshot | **exact match** — 4 real duplicates, drill-index correctly exempted as `allowDuplicates` |

Two of these deserve to be called out because they are the failure modes this
codebase has been burned by repeatedly, and both are clean:

- **The expression/native pairing holds everywhere.** I initially flagged 31
  geometry mismatches; every one was a false positive once units were applied —
  16 tools carry mm-suffixed expressions (`'3mm'`) against inch natives
  (`0.1181"`), which is physically identical and legal in Fusion. See G5.
- **The stepdown/stepover three-way sync holds.** Zero ghost expressions.

**Your holder library is in the best shape of anything here.** Every record is
classified, pushed, and identity-matched; 97% of assemblies carry the real FK
rather than relying on Fusion's churning guid.

---

## Tier 1 — Blockers (fix before any SQLite import)

### B1. Eight orphan metadata records
Records with no Fusion entry that are **not** marked `no_fusion_link`. The app
leaves them dormant and invisible (correct — the orphan-ghost guard), so they are
harmless today. They are not harmless in a database.

| id | `tool_id` | description | what it actually is |
|---|---|---|---|
| `FTL-1CE114` | `D-249` | #41 (.096) 118DEG CARB DRILL | **ghost** — live twin `FTL-76E09B` |
| `FTL-2AE352` | `B-259` | 1mm Ball 3FL EM | **ghost** — live twin `FTL-1038E0` |
| `FTL-A5E6D5` | `A-253` | 3/16 BULL R.004 | **ghost** — live twin `FTL-F74F31` |
| `FTL-9EB70F` | `03-0574` | 1/2 BULL R.06 3FL | stale, no twin |
| `FTL-644D97` | `75677120` | RTA 15 M8 X1.25 Bottoming | stale, no twin |
| `FTL-BA9810` | `I-167/ G-169` | 2.5 FACE MILL HAAS 45DEG ST | stale, no twin |
| `FTL-C16243` | `min OOH 2.33` | NBT30-SK13-120 OOH2.33 | **not a tool — a holder** |
| `FTL-DCE8C3` | `TC52 (142174); TC62 (142892)` | Blum TC52/TC62 Styli | **not a tool — a probe** |

**These 8 records are the single highest-leverage fix in this audit.** They are the
sole cause of:
- all **5 duplicate machine numbers** (T35, T76, T77, T129, T220 — every pair is
  one orphan against one live tool)
- both **below-start machine numbers** (A-253 = T1, B-259 = T2, start is T30)
- all **7 dangling `assembly.instance_guid`** references
- 3 of the 3 **duplicate `tool_id`** clusters

Delete the 8 records and every one of those problems disappears at once.

> The last two are also carrying junk in the `tool_id` field — `min OOH 2.33` and
> `TC52 (142174); TC62 (142892)` are notes, not IDs.

### B2. 26 preset GUIDs shared across different tools
Never duplicated *within* a tool, so `preset_meta` (keyed by guid, scoped per
record) is safe at runtime. But a `presets` table with `guid` as the primary key
**will fail to import**.

Caused by duplicating tools in Fusion — the copy carries the original's preset
guids. Worst case is one guid on six tools:

```
33cad77a-5312-4ee4-9a3d-ddba8d0eec4b
    A-61  'Default preset'      A-30  'SS'      A-188 'SS 1.325 30-SK13-60 - Rough'
    A-29  'SS'                  A-103 'SS'      A-111 'SS'
```

**Fix:** either give the table a composite PK `(tool_record_id, guid)`, or re-mint
guids so they're globally unique. The composite key is less invasive and matches
how the app already treats them.

### B3. `bin` stored as both a string and an integer
21 records store `bin: "10000"` (string); the other 245 store an integer. This is
exactly the `normalizeBin` drift CLAUDE.md warns about — a fixed-bin system's
`fixedVal` is a config *string* and got written straight through.

The proof it's drift and not a convention: **`A-252` sits in the same drill-index
system with `bin: 10000` as an integer.** One drawer, two types.

**Fix:** run every `bin` through `normalizeBin` on the next write, or one-shot
patch the 21 records. Changes nothing at runtime (every comparison goes through
`String()`), but it decides whether that column is `INTEGER` or `TEXT`.

### B4. Two records with an invalid `tool_type`
`FTL-DCE8C3` is `"probe"` and `FTL-C16243` is `"holder"` — neither is in
`TOOL_TYPES`. They'll miss the type→icon, facet, and `AUTO_GROUP` mappings, and
they are also the only two records claiming `unit: "millimeters"` while Fusion
holds nothing for them.

Both are in the B1 delete list, so **B1 fixes this too.** Flagged separately
because if you'd rather keep the probe as a record, it needs a real home — a probe
is not a cutting tool and doesn't belong in `tool_metadata.json`.

---

## Tier 2 — Data correctness (fix before trusting the numbers)

### C1. 62 assemblies stick out less than the tool's own minimum
`ooh < min_ooh` on 62 assemblies — the floor rule that `AssemblyForm` hard-blocks
and `normalizeLibrary` is supposed to enforce.

```
D-209  ooh=1.50  min_ooh=1.51      A-50   ooh=1.10  min_ooh=1.19
N-48   ooh=0.60  min_ooh=0.62      R-149  ooh=1.44  min_ooh=1.72
A-35   ooh=0.61  min_ooh=0.65      A-123  ooh=0.30  min_ooh=0.33
```

Most gaps are small, but they run up to **0.36"** (`D-90`, 0.70 → 1.06) — large
enough to be a real machining change, so these want per-row review rather than a
blanket apply.

What happened: **`min_ooh` arrived from the ProShop merge (2026-07-17) *after*
normalize ran (2026-07-14)**, and the flooring pass never re-ran.

⚠️ **Re-running normalize cannot fix this** — an earlier draft of this document said
it could, and that was wrong. `normalizeLibrary` applies the floor only inside its
`for (const raw of untracked)` loop; already-tracked tools are explicitly *"rebuild
unchanged"*. Every tool here is tracked, so `needsNormalize` is false (the banner
never renders and `NormalizeModal` is unreachable) and the pass would be a no-op
even if it could be opened. **Fixed instead by Settings → Library Health →
"Assemblies below MIN OOH"**, added for this.

Also in the same family:
- **9** tools with `shoulder_length > min_ooh` (normalize sets shoulder = min_ooh)
- **1** with `flute_length > shoulder_length` (`D-33`: 0.75 > 0.625)
- **1** with `min_ooh > overall_length` (`D-18`: 1.73 > 1.72)

**Fix:** re-run normalize, or a one-shot floor pass. This is the largest single
block of genuinely wrong numbers in the library.

### C2. Geometry that disagrees with ProShop
| Field | Count | Notable |
|---|---|---|
| `flute_length` | 34 | `R-19` 1.25 vs 0.8 · `D-53` 2.375 vs 1.693 · `A-1` 1.0 vs 0.875 |
| `overall_length` | 30 | `A-9` 2.5 vs 1.5 · `D-26` 3.0 vs 5.2 |
| `diameter` | 9 | **`K-164` .125 vs .046** · **`K-213` .125 vs .045** · **`R-145` .291 vs .25** |
| `number_of_flutes` | 4 | `A-1` 3 vs 4 · `L-108` 5 vs 6 |

The three bolded diameters are large enough to be a wrong tool, not a measurement
difference — check those first.

**Worth knowing:** `overall_length` clusters hard on round numbers — 2.5 (38
records), 1.5 (38), 2.0 (30), 4.0 (20). That's 136 of 276 on four values. Some are
genuine, but combined with the ProShop disagreements it suggests a chunk were
filled with a plausible default rather than measured. Treat OAL as unverified
until spot-checked.

### C3. Fourteen unresolved conflicts already queued
The "informed, not blocked" flow caught these and is holding them correctly:

```
A-1    flute_length [0.875, 1]   number_of_flutes [4, 3]   material ['hss','carbide']
D-26   flute_length [1.5, 1.6]   tip_angle [118, 140]
B-7    flute_length [0.7, 0.75]      A-61  flute_length [0.9, 1]
D-33   flute_length [0.75, 0.5]
A-252  tool_id ['A-252','N-252']     A-112 tool_id ['A-112','A-106']
A-35   location ['LC-52', 'MSC/ HArvey ']
A-61   location ['LC-72', 'Jones kinden ']
A-30   location ['LC-31', 'MSC ']
B-34   location ['Jones Kinden  ', 'LC-56']
```

Two observations:
- The 4 location conflicts have a **vendor name in ProShop's Location column**.
  That's bad data in ProShop, not in the app — and the app was right to flag rather
  than overwrite. Fix them in ProShop.
- The 2 `tool_id` conflicts resolve the reconciliation gap: `A-106` and `N-252`
  appear in ProShop but not the app because they were **renumbered** to `A-112`
  and `A-252`. Only `A-6 (Ar)` is genuinely missing.

### C4. Four presets pointing at a deleted Fusion material
`stock-materials` naming something that is no longer a CAM preset — a dangling
reference to the wiped Fusion material library:

```
A-252  'AL'                    holds ['AL 6061']   → should be 'Al Wrought - 6061+'
A-253  '…- Rough' / '- Finish' holds ['SS Harder'] → should be 'SS Austenitic - 310, 316'
D-249  'SS316 Drill'           holds ['SS Harder'] → should be 'SS Austenitic - 310, 316'
```

All four have the right FK already — one click of **Use \<CAM preset\>** in
`MaterialLinkBanner` each. (Two are on B1 orphans and vanish with them.)

---

## Tier 3 — Incomplete, not broken

This is the honest read on **intent**. The app's job is to be the single source of
truth for proven setup knowledge — which holder, which stickout, which speeds, for
which material, on which job. Right now it is an **excellent Fusion mirror and
ProShop reconciler**, but that knowledge layer is mostly empty.

| Layer | State |
|---|---|
| Preset → assembly FK | **41 / 358 (11%)** |
| Preset `operation_type` | **97 / 358 (27%)** |
| Preset names in convention | **44 / 358 (12%)** — 261 are bare legacy (`AL`, `SS`, `Default preset`) |
| Preset → CAM preset FK | 182 / 358 (51%); 158 presets have no material at all |
| Purchasing → vendor registry FK | mfg **22%**, vendor **32%** |
| Jobs / tags / notes / speed-feed refs | **0 / 0 / 2 / 0** |
| Photos | 236 / 276 ✅ |

These interlock. Preset names like `'AL - Rough'` carry no OOH or holder token, so
`presetMatchesAssembly` can't seed the assembly FK — which is why it sits at 11%.
Naming the presets is what unlocks the links.

**The 58 no-Fusion tools all have zero assemblies and zero presets.** Expected —
they're ProShop-only rows that were never built in Fusion — but it means they carry
no holder and no speeds/feeds. That's the bulk of your remaining work.

Also outstanding:
- **18 presets** have a material string but no FK — 12 bare codes (`AL`, `SS`) and
  6 group labels (`STEEL`). Bare codes are the documented "shop decides once"
  case; the 6 group labels can be linked directly.
- **Missing geometry:** `min_ooh` on 70, `shoulder_length` on 68, `overall_length`
  on 31, `number_of_flutes` on 21, `diameter` on 9.

---

## Tier 4 — Hygiene

| # | Finding | Detail |
|---|---|---|
| G1 | `tool_id` with a trailing space | **`'D-148 '`** — breaks exact-match joins in SQL and ProShop matching |
| G2 | Description whitespace | 20 leading/trailing, 18 with double spaces |
| G3 | Test records still live | `FTL-C0ECBD` `'#42 … .141LOCtesttttt'` (blank `tool_id`), `L-189` `'1/8 chamfer test'`, and holder `HLD-AC5E04` `'TEST NBT30-SK13C-fake'` — **pushed to Fusion** |
| G4 | **`jobs.json` + `vendor_registry.json` missing from dump** | `registry_id` and all job FKs unverified |
| G5 | 16 tools carry mm-suffixed Fusion expressions | Physically correct today, but the next app write normalizes them to inches (`internalToFusionTool` derives one `lenUnit` from `tool.unit`). No corruption — you lose the mm reading in Fusion. Tie to `input_was_mm` if you want it preserved |
| G6 | 3 holder records unclassified | `HLD-CE3310`, `HLD-6AF522`, `HLD-B94907` — no type/taper/collet |
| G7 | `preferred_machine_id` unused | 0 of 276 set; `default_machine_id` is `null` |
| G8 | Schema drift in the file | `input_was_mm` and `preferred_machine_id` present on 212 of 276 records (older writer) — nullable, harmless |

---

## ⚠️ One thing to decide before you re-import ProShop

**109 of 271 matched tools have a different description in the app than in ProShop**,
and the app's are the good ones:

```
A-8   ProShop '3/4 EM 3FL 2.5 LOC'        App '0.75 EM 3FL 2.5"LOC AL'
A-9   ProShop '1/4" Dia EM 3/4" LOC, 3 Fl' App '1/4 EM 3FL .75 LOC AL'
A-12  ProShop '1/4 BULL .03R AL 1" LOC…'   App '0.25 .03R BULLEM 3FL 1.25LOC AL'
```

That's the `buildDesc` standardization working. But the documented field-priority
rule is **"ProShop description wins"** — so a full ProShop re-import would offer to
revert all 109 renames. The per-tool rename confirmation UI protects you from doing
it silently, but it's 109 decisions.

**Suggestion:** flip the description rule to app-wins now that normalization has
run, or push the app's descriptions *to* ProShop and re-export before any further
import. The `proshopExported` step is stamped 2026-07-21 but this 8-10 export still
has the old names, so that push either didn't happen or didn't take.

---

## SQLite readiness

**The relational design is sound and does not need rework.** Every link the audit
inventory claims is an ID *is* an ID:

- 276 / 276 `metadata.id` are `FTL-XXXXXX`; all 311 `assembly_id`, 358 preset guids
  and 13 component ids are UUIDs
- No duplicate PKs on records, assemblies, or components
- Materials, holders, components, machines and location systems all resolve
- Dangling ids appear only where the design deliberately tolerates them

**Four things to settle before the import:**

1. **B2 — preset guid PK.** Composite `(tool_record_id, guid)`, or re-mint.
2. **B3 — `bin` column type.** Normalize to integer.
3. **`shop_settings.holder_config` doesn't exist in the file.** Holder
   `type_id`/`taper_id`/`collet_family_id`/`collet_size_id` point at stable slugs
   (`ht-collet`, `tp-nbt30`, `cs-sk13`) that live **only in the code seed**
   (`seedHolderConfig()`). Runtime is fine — the seed is the documented fallback —
   but there is no lookup table in the data. **Materialize it into
   `shop_settings.json` before migrating**, or those four columns import as
   dangling FKs.
4. **`holder_guid` will not survive as a join.** 161 of 305 point at guids that
   exist nowhere — exactly as designed, since Fusion re-issues them. Import it as
   a nullable hint column, never a foreign key. `holder_id` is the join.

**Not a problem:** the mixed `int`/`float` across `diameter`, `overall_length` etc.
is just JSON writing `2.0` as `2`. SQLite `REAL` takes both.

---

## Suggested order of work

Each step's output is checkable, and the early ones are cheap.

> **Steps 1 and 2 had no UI when this audit was written** — an orphan is
> deliberately never loaded, and assembly OOH sat outside `validateGeometry`'s
> chain, so neither was reachable or even visible. Both are now
> **Settings → Library Health**, built as derived preview→commit worklists in the
> same shape as `LocationIssuesPanel`.

**1 — Delete the 8 orphans** *(minutes, highest leverage)*
Settings → Library Health → **Check for orphaned records**. Clears 5 duplicate
machine numbers, 2 below-start numbers, 7 dangling `instance_guid`s, 3 duplicate
`tool_id` clusters and both invalid `tool_type`s in one action. Ghosts (a live tool
already holds the Tool ID) are pre-ticked; the 5 stale ones start unticked so each
is a deliberate call. Decide separately where the probe and the holder record
should live.
*Verify: the machine-number issues card reads zero.*

**2 — Raise the 62 assemblies to their MIN OOH floor** *(minutes)*
Settings → Library Health → **Check stickout against MIN OOH**. Per-tool
selection, because this writes `geometry.LB` and moves the assembly gauge length
with it — corrections over 0.05″ are highlighted. The same violations now also
show as geometry warnings on each tool page.
*Verify: re-check — it should report zero, and a second run has nothing to do.*

**3 — Clear the 14 conflicts + fix the 4 `stock-materials` rows** *(under an hour)*
The 4 location conflicts are ProShop-side bad data (vendor names in the Location
column) — fix in ProShop. The 4 material rows are one click each.

**4 — Clean the known location issues** *(your screenshot)*
4 duplicate bins, 8 gap runs, 8 unassigned. Note 3 of the 8 unassigned are
**components** (`I-126`, `I-167`, `G-169`) — assign them like any tool. The
drill-index bin 10000 is correctly exempt; nothing to do there.

**5 — Hygiene sweep** *(minutes)*
Trim `'D-148 '`, the 20 descriptions with stray spaces, and delete the 3 test
records — including the test holder that's live in Fusion.

**6 — Spot-check the 3 large diameter disagreements** *(K-164, K-213, R-145)*
Then decide on the ProShop description policy above before any re-import.

**7 — Then start using it.**
Tier 3 is data entry the app is built to absorb one tool at a time. Preset naming
is the highest-value of it — naming presets to the convention is what makes the
assembly FK, the material link and the operation type fall out automatically. Do it
as tools come across the bench, not as a project.

**Before the SQLite migration** (not now): B2, B3, and materialize `holder_config`.

---

## Bottom line

Nothing found here argues for delaying. The two things that would have — silent
drift against Fusion, or a broken relational model — are both demonstrably fine.
What's left is one deletion that fixes seven problems at once, one normalize re-run,
and a list of small corrections.

The library is not complete. But it is **correct as far as it goes**, which is the
property that actually matters before you commit to it.
