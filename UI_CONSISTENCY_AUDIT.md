# UI_CONSISTENCY_AUDIT.md — UI Consistency Pass

> **STATUS: Quick Wins + Mediums + the Larger Redesign all implemented ✅.** Item 11 (the
> two-column edit layout) shipped as part of a deeper change: view and edit now render the
> Geometry/Setup fields through ONE shared component (`ToolFields`) driven by one shared
> layout (`toolFieldLayout.js`), so they can't drift and field positions no longer shift
> between two tools of the same type (all applicable fields always render; only an explicit
> `VIEW_HIDE_WHEN_EMPTY` set collapses when empty). See the "Shared field layout" section at
> the bottom. Remaining: long-tail inline-style cleanup, done opportunistically.

Walkthrough of the main views against the design tokens in `src/index.css` (the `:root` block:
surfaces, `--blue/--orange/--green/--red/--amber`, radii, shadows, plus the button/panel/modal/
data-field-token classes). Every item below was verified in the code, with file:line references.

**Tags:** `[Quick Win]` small isolated change · `[Medium]` touches several spots or needs a new
shared class · `[Larger Redesign]` structural.

**Overall state:** the design system is in good shape — one CSS file, real tokens, consistent
modals, and the data-field token system (description badge / proshot pill / holder pill / machine
badge / location tag / preset tag) is applied consistently. The original three gaps — (1) a few
broken/missing tokens and (3) edit mode (ToolForm) being structurally barer than view mode — are
both **resolved** (see the STATUS banner + Suggested-order table). The remaining gap is (2) the
inline `style={{…}}` blocks (now ~650 across `src/`, partly because several new editor components
landed since this audit), absorbed opportunistically as components are touched.

> **Note:** §1–§8 below are the *original* findings. Most are now implemented; line numbers and
> present-tense "this is broken" wording have been refreshed to current state where the item shipped.

---

## 1. Global — `index.css` tokens

- **`--accent` is used but never defined** → ✅ **Resolved.** `--accent: #6366f1` is defined in
  `:root` (index.css:30). The export-picker Confirm button switches to `btn-primary` when enabled
  (`ToolDetail.jsx:798`) and `.assembly-picker-option.selected` (index.css:2800) renders its indigo
  highlight. `[Quick Win]`
- **Data-field token colors are hardcoded hexes** → ✅ **Resolved (tokenized).** The six classes
  live in the "Data-field visual tokens" block (index.css:2454+). Four — `.proshot-pill`,
  `.machine-num-badge`, `.location-tag`, `.description-badge` — compose their tints from `--tok-*`
  RGB-triplet `:root` vars (`rgba(var(--tok-*), a)`). `.holder-pill` and `.preset-tag` were taken
  further in the ToolDex design-system pass: each derives from a per-instance `--badge-color` custom
  property (holder size color via `holderColor`, material ISO-group color via `presetMaterialColor`),
  with the holder-size + ISO-group palettes promoted to `:root` tokens (`--holder-*`, `--iso-*`). The
  "update ALL usages" rule is now a one-line token change. `[Quick Win]`
- **Repeated raw `rgba()` warning/info tints with no shared class** → ✅ **Resolved.**
  `.banner-warn` / `.banner-info` exist next to `.error-banner` (index.css:1183–1203); ReconcileModal
  and NormalizeModal use them instead of hand-built inline amber. `[Quick Win]`
- **Scrollbar styling forked** → ✅ **Resolved.** `.preset-scroll` (index.css:1986–1992) now matches
  the global 6px thumb on `--bg` track (index.css:170). `[Quick Win]`
- **Inline styles at scale**: ✏️ **Partial / ongoing.** ~650 `style={{…}}` blocks across `src/` (up
  from the original 503 as several new editor components landed). Heaviest now: Settings (100),
  ToolDetail (56), MaterialsEditor (51), ImportPhotosModal (37), ImportFlow (37), MetadataConnect
  (26), DiffStep (25), DescRenameModal (24). The same few patterns repeat — a flex row with gap, a
  margin-bottom, a muted color. A handful of utility classes (`.row`, `.flex-wrap`, `.gap-6/8/12`,
  `.mb-8/12/16`) absorb most of them; `.flex-wrap` + `.picker-row` already exist. Best done
  opportunistically per component, not as one big sweep. `[Medium]`
- **Browser-default form controls** → ✅ **Resolved.** `accent-color: var(--blue)` on all
  checkboxes/radios (index.css:168), so they pick up the brand blue; `select.field-input` gets a
  theme chevron (`appearance: none` + inline SVG, index.css:405). Number-input spinners stay
  intentionally dimmed (index.css:171), not removed — operators still nudge values. `[Medium]`
- **Counterexample worth copying:** `PurchasingSection.jsx` has **near-zero** inline styles (2) —
  one of the newer components, it shows the house style works when classes exist. Use it as the
  template.

## 2. ToolForm (edit mode) vs ToolDetail (view mode) — the headline gap

> ✅ **Resolved (shipped as the "Shared field layout" redesign — see bottom).** `ToolForm` now uses
> the same two-column `.detail-layout` and `.tool-sticky-header` as view mode, and renders the
> Geometry/Setup fields through the shared `<ToolFields mode="edit">` (`ToolForm.jsx:143–146`). Edit
> is now "view, unlocked." The bullets below are the original findings that drove that redesign.

View mode is the benchmark: frozen action sidebar, sticky identity header (type icon + description
badge + proshot pill), 65/35 two-column layout, iconed collapsible panels. Edit mode *used to* throw
all of that away and render a bare page: a `btn-ghost` Back button + a generic `<h2>Edit Tool</h2>`,
then a flat single-column form.

- **No identity context while editing.** Scrolling a long form, nothing tells you which tool you're
  on. Reuse the existing sticky header (`.tool-sticky-header`) in edit mode — same icon, description
  badge, proshot pill — with the dirty indicator beside it. The bottom `.form-actions-bar` already
  exists and is good. `[Medium]` — biggest single polish win for the user-flagged "edit feels less
  dialed" issue.
- **The 26-type chip grid is fully expanded at the top even when editing an existing tool**
  (`ToolForm.jsx:158–178`). Type changes after creation are rare; the grid pushes the real fields
  below the fold. Collapse it to the current type chip + a "Change type…" expander (keep the full
  grid for the create flow). `[Quick Win]`
- **Single flat column vs. the view's two-column layout.** Identity/Notes/Tags live at the bottom of
  the edit form but top-right in view mode, so the page "shape" flips completely between modes. A
  two-column edit layout mirroring `.detail-layout` (geometry/speeds left, identity/notes/tags right)
  would make edit feel like "view, unlocked" instead of a different app. `[Larger Redesign]`
- **Repeated hand-built rows**: machine-number badges row (`ToolForm.jsx:183, 190`), unit row
  (:199), description + Suggest button (:222) — all inline flex. The unit picker (two
  `btn-primary/btn-secondary` buttons, :201–211) wants a real `.btn-toggle` segmented-control class;
  Settings' Default Unit toggle needs the identical control, so build it once. `[Quick Win]`
- What's already consistent (keep): `Section` panels reuse `.panel/.panel-header` with lucide icons
  and CSS-uppercased titles — same as view mode; `.field-label`/`.field-input` styling matches;
  dirty-guard + ⌘S hints are good UX.

## 3. ToolDetail (view mode)

- The benchmark — only nits. 70 inline styles, nearly all layout flex/gap (e.g. :231); absorb with
  the utility classes from §1 when touched. `[Medium]`
- Export-picker Confirm button → ✅ **Resolved.** It now switches between `btn-secondary` and
  `btn-primary` on the `canConfirm` flag (`ToolDetail.jsx:798`), and `--accent` is defined (§1).
  `[Quick Win]`
- Text-glyph chevrons `▾/▸` in panel headers (shared with ToolForm's Section) vs. lucide
  `ChevronDown` icons used elsewhere — minor datedness; swap in the shared Section/panel header
  only. `[Quick Win]`

## 4. LandingPage

- Lightest inline-style usage (9) — in good shape.
- **Empty states aren't unified**: LandingPage's "no results" (min-height inline block, :207 area)
  vs. `.detail-field-empty` ("—") vs. `.preset-empty` (24px padded). A single `.empty-state`
  (+ `.empty-state-sm`) class with consistent muted text would tidy all three. `[Quick Win]`

## 5. Settings

- **55 inline styles — the heaviest concentration relative to its size**; sections are hand-laid
  rather than leaning on `.panel`/`.field-group` the way ToolDetail/ToolForm do. When the
  `.btn-toggle` control exists (§2), the Default Unit toggle adopts it; the rest is incremental
  cleanup to the shared classes. `[Medium]`

## 6. Modals (HolderPicker, ReconcileModal, NormalizeModal, DescRenameModal, AttachmentUploadModal, delete/export confirms)

- **Structure is consistent** — all use `.modal-backdrop`/`.modal`/`.modal-title`/`.modal-actions`
  with the same footer button order. Good.
- The inline amber banners (ReconcileModal, NormalizeModal) → ✅ **Resolved**, now use `.banner-warn`
  from §1. `[Quick Win]`
- HolderPicker's selected-row state → ✅ **Resolved.** It uses a `.picker-row.selected` modifier
  (`HolderPicker.jsx:53`), not an inline `borderLeft`. `[Quick Win]`

## 7. MergeFlow (ImportStep → MatchStep → DiffStep → CommitStep → SummaryStep, QueuePanel)

- Step-to-step look is consistent (shared step header, queue sidebar, `.preset-tag` reuse matches
  the token rule). Main item: **three different "row of data" patterns** — DiffStep's inline
  `grid-template-columns: 24px 1fr 120px 20px 120px` rows, MatchStep's `.match-table`, and the
  flex-based summary rows. Extract a `.diff-table` class for DiffStep (it's the one defined inline,
  DiffStep.jsx ~:24 inline-style sites) and align paddings across the three. `[Medium]`
- QueuePanel item rows are plainer (no hover state) than visually similar list rows elsewhere
  (HolderPicker results, assembly picker). One shared `.list-item` hover/selected treatment.
  `[Medium]`

## 8. Not broken — explicitly checked and fine

- Panel/section title casing: CSS uppercases all panel headers (`.panel-header`, index.css:826), so
  view and edit titles render identically despite mixed-case source strings.
- Data-field token usage: spot-checked `.description-badge`/`.proshot-pill`/`.machine-num-badge`
  across ToolCard, sticky header, Identity section — consistent with the documented system.
- AssemblyCard's physical-tag layout (`.operator-tag`/`.tag-box`) — intentional exception per
  CLAUDE.md; leave as is.

---

## Suggested order

| # | Item | Tag |
|---|---|---|
| 1 | Define/replace `--accent` (live visual bug) | Quick Win ✅ — `--accent: #6366f1` added to `:root`; the export-modal Confirm button now switches to `btn-primary` when enabled |
| 2 | `.banner-warn`/`.banner-info` + swap the two inline modal banners | Quick Win ✅ — classes added; ReconcileModal + NormalizeModal converted |
| 3 | Tokenize the six data-field colors | Quick Win ✅ — four (proshot/machine/location/description) compose tints via `rgba(var(--tok-*), a)`; holder + preset later moved to a per-instance `--badge-color` (holder-size / ISO-group, ToolDex pass) |
| 4 | `.btn-toggle` segmented control → ToolForm unit picker + Settings | Quick Win ✅ |
| 5 | Collapse type grid when editing an existing tool | Quick Win ✅ — current type chip + “Change type…” expander; full grid kept for the create flow |
| 6 | Shared `.empty-state`; scrollbar unification; lucide chevrons | Quick Win ✅ — LandingPage no-results uses `.empty-state`; `.preset-scroll` matches the global scrollbar; panel chevrons are lucide `ChevronDown/Right` |
| 7 | Sticky identity header in edit mode | Medium ✅ — edit mode reuses `.tool-sticky-header` (icon, “Editing · type”, description badge, ProShop pill) |
| 8 | Custom checkbox/select styling | Medium ✅ — `accent-color: var(--blue)` on all checkboxes/radios; `select.field-input` gets a theme chevron (`appearance: none` + inline SVG) |
| 9 | Utility classes + opportunistic inline-style cleanup | Medium ✏️ partial — `.flex-wrap` + `.picker-row` added; ToolForm rows and HolderPicker rows converted; remaining inline styles cleaned as components get touched |
| 10 | ~~DiffStep `.diff-table` + shared `.list-item`~~ | Already fine — `.diff-row` grid and `.queue-item` hover/active were already CSS classes; original finding overstated |
| 11 | Two-column edit layout mirroring view mode | Larger Redesign |

---

## Shared field layout (the larger redesign) ✅

The biggest source of "why do the fields move around" was that the view
(`ToolDetail`) and the edit form (`ToolForm`) each had their *own* list of which
fields to show, with different visibility rules — view used `{tool.x && <Field/>}`
(hide when empty), edit used `{visibleFields.has('x') && <input/>}` (gate by type).
So a missing value shifted positions, and view/edit could silently disagree.

**Fix — one source of truth that both modes render from:**

- `src/schema/toolFieldLayout.js` — the field order for the Geometry and Setup
  sections, the tool-type groups (shared with the landing grid), the select option
  lists, and `VIEW_HIDE_WHEN_EMPTY` (the only fields allowed to collapse when empty,
  currently just `custom_grind`). `getToolFieldSections(type)` returns the
  type-applicable fields in fixed order.
- `src/components/ToolFields.jsx` — a `mode="view"|"edit"` renderer. Both screens
  drop in `<ToolFields tool=… mode=… />`. Same fields, same order, same positions;
  edit just swaps the read-only value for an input. A field added to the layout
  appears in both modes automatically — they cannot drift.

**Behavior now:**

- **Stable positions:** every field that applies to the tool type renders in both
  modes regardless of whether it has a value (empty → "—" in view, empty box in
  edit). Two tools of the same type line up field-for-field.
- **Edit = view, unlocked:** `ToolForm` uses the same two-column `.detail-layout`
  and the same sticky identity header as the view; the left column is
  `<ToolFields mode="edit">`, the right is Identity + Notes.
- **Opt-out, not opt-in:** to make a field disappear when empty, add it to
  `VIEW_HIDE_WHEN_EMPTY` (view-only; edit always shows the box so you can fill it).
  This is the one knob to refine.
- **Tool-type picker:** `ToolTypeDropdown` — a dropdown of grouped icon cards
  (Milling / Hole Making / Turning / Other), the same grouping as the search page
  (now both read `TOOL_TYPE_GROUPS` from `toolFieldLayout.js`).

**To add or move a tool field in future:** edit the field's entry in
`fieldRegistry.js` (applies-to-types, label) and its position in
`GEOMETRY_FIELDS` / `SETUP_FIELDS` / `THREAD_FIELDS` in `toolFieldLayout.js`.
Both view and edit update together — there is no second list to keep in sync.
