# Parts module — fix later (decisions needed together)

Written during the post-restructure bug sweep. **Nothing here is a bug** — the
real bugs found in that sweep were fixed and test-locked. These are naming and
file-layout choices that are now inconsistent with what the code actually is,
and each one needs a decision before it's worth touching, because renaming a
file is cheap and renaming the *wrong* thing is a second rename later.

Grouped by how tangled each one is. Nothing here changes behaviour.

---

## 1. File names still say "Programs" / "Jobs"; the module is Parts

The tab is **Parts**, the routes are `/parts` and `/parts/:id`, the shared file
is `parts.json`, and the helpers are `utils/parts.js`. The files around them
weren't renamed with it:

| File today | What it actually is | Note |
|---|---|---|
| `components/ProgramsPage.jsx` | the **Parts** page — its default export is already named `PartsPage` | the sharpest mismatch: `import PartsPage from './ProgramsPage.jsx'` |
| `components/programsUi.jsx` | shared **Parts-module** widgets + the one part/routing/operation edit-form implementation | |
| `components/AddProgramModal.jsx` | walks **part → routing → operation** | it does add a program, but only as the last step |
| `components/JobProgramPicker.jsx` | picks an **operation** (by its program number) | "Job" is now a reserved word — see §3 |
| `components/JobsSection.jsx` | the tool page's **"Where Used"** panel | the UI text was already changed; the file wasn't |
| `utils/programsImport.js` | imports the program-list CSV into **parts/routings/operations** | arguably still accurate — the CSV *is* a program list |
| `context/programActions.js` | Sequence Detail actions | accurate |

**Cost:** mechanical, but it touches every importer of each file, and a rename
plus an edit in one commit makes the diff unreadable. **Recommendation:** do the
renames on their own, in one commit that changes nothing else — the same reason
`tool-extractor.tsx` still has that name (noted in CLAUDE.md).

**Decision needed:** which of these get renamed, and to what. `ProgramsPage.jsx`
→ `PartsPage.jsx` and `JobsSection.jsx` → `WhereUsedSection.jsx` look
uncontroversial; `AddProgramModal` and `programsImport` are genuinely about
programs and may be right as they are.

---

## 2. `ProgramsPage.jsx` is doing two jobs in one file (~460 lines)

It holds the grouped view, the flat table, the filter/sort bar wiring, and the
page shell. `PartDetailPage.jsx` is similarly large (~500). Neither is unwieldy
*yet*, and both already delegate their forms and mutations to the shared
modules, so there's no duplicated logic — only length.

**Decision needed:** split now (e.g. `PartsGroupedView` / `PartsTableView` as
their own files) or leave it until something else needs to change there. My
read: leave it. Splitting a file nobody is currently confused by trades a real
diff for a hypothetical benefit.

---

## 3. "Job" is now ambiguous in the codebase, and it matters

CLAUDE.md settled the tier name deliberately: **routing**, not job, because in
an ERP a **job is a work order** — a production run — and that record is still
coming. But "job" survives in several places meaning *different* things:

- **`Sync Job`** (the Phase 2 merge flow) — "job" here means *a Fusion job
  file*, which is a third meaning again, and is the shop's own word for it.
  Probably correct as-is.
- **`jobLink`** (the `mergeTool` argument) — now carries `{ operation_id, label }`.
  Reads as if it links to a job record; it links to an operation.
- **`job_linked`** (the merge-history key) — same.
- **`last_used_job`** (tool metadata, free text) — predates all of this.
- **`JobFiles/{O####}/`** (the Drive folder for raw posted CSVs) — a *file*
  folder, arguably fine.
- **`jobRows` / `jobKeys`** (local names in `PartDetailPage`) — mean "every row
  across the whole part".

**Decision needed:** whether to reserve "job" strictly for the future work-order
record and rename the rest, or accept that "job" is contextual and only fix the
two that name a link (`jobLink`, `job_linked`). ⚠️ `job_linked` is a **stored**
key inside `merge_history[]` — renaming it is backwards-incompatible with any
merge history already on Drive (it would render blank, not break). Worth
knowing before deciding, not worth doing casually.

---

## 4. `docs/` is a mixed bag

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

## 5. Small things, no decision needed — just not done yet

- **`utils/parts.js` is ~380 lines** and covers the model, display forms,
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
