# Parts module — fix later (decisions needed together)

Written during the post-restructure bug sweep. **Nothing here is a bug** — the
real bugs found in those sweeps were fixed and test-locked. These are layout and
scope choices that need a decision before they're worth touching.

**Resolved since the first draft:** the file renames (§1) and the "job" ambiguity
(§3) are done — see the two closed sections at the bottom for what was decided
and why, so the reasoning isn't lost.

---

## 1. `PartsPage.jsx` is doing two jobs in one file (~460 lines)

It holds the grouped view, the flat table, the filter/sort bar wiring, and the
page shell. `PartDetailPage.jsx` is similarly large (~500). Neither is unwieldy
*yet*, and both already delegate their forms and mutations to the shared
modules, so there's no duplicated logic — only length.

**Decision needed:** split now (e.g. `PartsGroupedView` / `PartsTableView` as
their own files) or leave it until something else needs to change there. My
read: leave it. Splitting a file nobody is currently confused by trades a real
diff for a hypothetical benefit.

---

## 2. `docs/` is a mixed bag

`docs/` holds the design references the app is built against
(`LocationSystemUI.tsx`, `HOLDER SYSTEM PROMPT.md`), the label-printing source
of truth (`proshop_brother_label_extension_v9/`), and setup notes — while ~14
audit/plan/finding documents sit at the repo **root** alongside `CLAUDE.md`.

**Decision needed:** whether the root `*_AUDIT.md` / `*_PLAN.md` /
`*_FINDINGS.md` set moves under `docs/` (or `docs/audits/`), and whether the
finished ones are archived. ⚠️ **CLAUDE.md references several by name**
(`SCHEMA_AUDIT.md`, `FUSION_DECOUPLING_AUDIT.md`, `PHASE_A_TOOL_RECORD_SCHEMA.md`,
`DECOUPLING_FOLLOWUP_FINDINGS.md`, `THREE SYSTEM CONTEXT PROMPT.md`), so a move
has to update those pointers in the same commit or the trail goes cold.

---

## 3. Small things, no decision needed — just not done yet

- **`utils/parts.js` is ~420 lines** and covers the model, display forms,
  filtering and sorting. Splitting `applyPartsFilters` / `sortParts` into
  `partsFilters.js` would mirror how the location system splits its concerns.
  Low value today.
- **The Sequence Detail tab still renders the raw file's values**, so it can
  disagree with the Tool List about a location the app has since corrected.
  This is **already a documented TODO in CLAUDE.md** with the three options
  written out; listed here only so it isn't discovered twice.
- **`ProgramsImportModal` is reached from Settings → Import Program List.** Now
  that the Parts page exists, that may belong on the Parts page instead. Purely
  a placement question.
- **`ProgramsImportModal.jsx` / `programsImport.js` / `programActions.js` keep
  their names** — each is genuinely about programs (see the closed §A). Revisit
  only if the import grows to cover parts and routings as first-class inputs.

---
---

## CLOSED — §A. File names now match what the code is

`ProgramsPage.jsx` already exported `PartsPage`, so `import PartsPage from
'./ProgramsPage.jsx'` was what the app read. Renamed together, in one commit
that changed nothing else:

| Was | Now | Why |
|---|---|---|
| `ProgramsPage.jsx` | `PartsPage.jsx` | its export was already `PartsPage` |
| `programsUi.jsx` | `partsUi.jsx` | shared Parts-module widgets + forms |
| `JobsSection.jsx` | `ProgramUsageSection.jsx` | matches its export `toolProgramUsage` |
| `JobProgramPicker.jsx` | `ProgramPicker.jsx` | it picks a program |

**Kept as-is on purpose:** `AddProgramModal.jsx`, `programsImport.js`,
`programActions.js` — each really is about programs, not parts.

## CLOSED — §B. "Job" now means exactly one thing

The word meant three things at once. It now names only **a Fusion job file** —
what a programmer copies a tool into, and what **Sync Job** syncs *from*. Every
other use moved to `program*`:

| Was | Now |
|---|---|
| `jobLink` / `job_linked` | `programLink` / `program_linked` |
| `jobSel` / `jobEnabled` / `onJobInput` | `programSel` / `programLinkEnabled` / `onProgramInput` |
| `PresetJobsBlock`, the "Jobs" editor section | `PresetProgramsBlock`, "Programs" |
| `JobFiles/` (Drive) | `ProgramFiles/` |
| `.preset-jobs-*`, `.job-pick-*`, `.sd-job-list` (CSS) | `.preset-programs-*`, `.pick-*`, `.sd-all-tools` |
| `jobRows` / `jobKeys` (PartDetailPage) | `partRows` / `partKeys` |
| `last_used_job` (metadata field) | **removed** — dead since it left the form |

Two things worth remembering about how this was done:

- **The Drive folder rename is non-destructive.** `ensureProgramFolder` looks
  for `ProgramFiles`, and if it finds only a legacy `JobFiles` it **renames it
  in place** — a Drive rename keeps the folder's ID, so every already-uploaded
  raw CSV survives. Creating a second folder would have stranded them somewhere
  the app no longer looks, which is indistinguishable from losing them.
- **`last_used_job` was already retired from the form and from Sync Job**, held
  no value on any demo record, and had no reader anywhere. Removing it stops it
  being written; any string a tool still carries is dropped on that tool's next
  save.

The reserved word matters going forward: an ERP **work order** is a job in the
real sense, and that record is still coming. Leaving "job" on two other things
is what would have made it impossible to name.
