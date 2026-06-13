# UI_CONSISTENCY_AUDIT.md — UI Consistency Pass

> **STATUS: Quick Wins + Mediums implemented ✅** (items 1–10 of the suggested order; see
> per-item ✅/✏️ notes below). Two items turned out to already be fine on closer inspection:
> DiffStep's row grid was already a CSS class (`.diff-row`), and QueuePanel items already
> have hover/active states — both struck through below. Still open: item 11, the two-column
> edit layout (Larger Redesign), and the long-tail inline-style cleanup which is being done
> opportunistically as components get touched.

Walkthrough of the main views against the design tokens in `src/index.css` (the `:root` block:
surfaces, `--blue/--orange/--green/--red/--amber`, radii, shadows, plus the button/panel/modal/
data-field-token classes). Every item below was verified in the code, with file:line references.

**Tags:** `[Quick Win]` small isolated change · `[Medium]` touches several spots or needs a new
shared class · `[Larger Redesign]` structural.

**Overall state:** the design system is in good shape — one CSS file, real tokens, consistent
modals, and the data-field token system (description badge / proshot pill / holder pill / machine
badge / location tag / preset tag) is applied consistently. The gaps are concentrated in (1) a few
broken/missing tokens, (2) ~500 inline `style={{…}}` blocks re-creating the same layout patterns,
and (3) edit mode (ToolForm) being structurally barer than view mode (ToolDetail).

---

## 1. Global — `index.css` tokens

- **`--accent` is used but never defined** → resolves to nothing. `ToolDetail.jsx:899` (export
  picker's Confirm button — its "enabled" highlight silently doesn't render) and `index.css:2435`
  (`.assembly-picker-option.selected` border). The companion rgba on :2435 is indigo
  `rgba(99,102,241,…)`, so either define `--accent: #6366f1` in `:root` or switch both usages to
  `--blue`. `[Quick Win]` — this is a live visual bug, not just hygiene.
- **Data-field token colors are hardcoded hexes**, not tokens: `.proshot-pill` `#f59e0b`,
  `.machine-num-badge` `#4ade80`, `.location-tag` `#818cf8`, `.holder-pill` `#2dd4bf`,
  `.preset-tag` `#34d399`, `.description-badge` violet rgba (all in the "Data-field visual tokens"
  block, index.css:2167–2285). The documented rule says "when changing any token's style, update ALL
  usages" — promoting these six to `:root` variables (`--c-proshot`, `--c-holder`, …) makes that a
  one-line change and lets the inline per-holder overrides in AssemblyCard reference them.
  `[Quick Win]`
- **Repeated raw `rgba()` warning/info tints with no shared class** — the amber warning banner is
  hand-built inline in `ReconcileModal.jsx:50` and `NormalizeModal.jsx` (`rgba(234,179,8,…)` +
  `#fde047`), while LandingPage uses a real `.error-banner` class. Add `.banner-warn` / `.banner-info`
  next to `.error-banner` and swap the inline copies. `[Quick Win]`
- **Scrollbar styling forked**: global 6px thumb on `--bg` track (index.css:53–56) vs.
  `.preset-scroll`'s own 5px/transparent-track variant (index.css:1704–1707). Pick one treatment.
  `[Quick Win]`
- **Inline styles at scale**: 503 `style={{…}}` blocks across `src/`. Heaviest: ToolDetail (70),
  Settings (55), ImportFlow (35), ToolForm (32), DiffStep (24), ReconcileModal (18), AssemblyForm
  (16), NormalizeModal (17), HolderPicker (15). The same few patterns repeat — a flex row with gap
  (`display:'flex', alignItems:'center', gap:8…`), a margin-bottom, a muted color. A handful of
  utility classes (`.row`, `.row-wrap`, `.gap-6/8/12`, `.mb-8/12/16`) would absorb most of them.
  Best done opportunistically per component, not as one big sweep. `[Medium]`
- **Browser-default form controls**: bare `<input type="checkbox">` in ToolForm (e.g. :315, :411,
  :472), PresetPanel and DiffStep's field checkboxes; `<select>`s get `.field-input` but keep the
  native arrow; number-input spinners only dimmed (index.css:51). A custom checkbox + a
  `.select-input` with chevron would modernize every form at once. `[Medium]`
- **Counterexample worth copying:** `PurchasingSection.jsx` has **zero** inline styles — it's the
  newest component and shows the house style works when classes exist. Use it as the template.

## 2. ToolForm (edit mode) vs ToolDetail (view mode) — the headline gap

View mode is the benchmark: frozen action sidebar, sticky identity header (type icon + description
badge + proshot pill), 65/35 two-column layout, iconed collapsible panels. Entering edit mode
(`ToolDetail.jsx:163–181`) throws all of that away and renders a bare page: a `btn-ghost` Back
button + a generic `<h2 style={{fontSize:16…}}>Edit Tool</h2>`, then a flat single-column form.

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
- Export-picker Confirm button styles itself via inline `--accent` override on `.btn-secondary`
  (:899) instead of switching to `btn-primary` when enabled — and `--accent` doesn't exist (§1).
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
- The inline amber banners (ReconcileModal:50, NormalizeModal) → `.banner-warn` from §1. `[Quick Win]`
- HolderPicker's selected-row state is an inline `borderLeft: '3px solid var(--blue)'` (:48) —
  move to a `.selected` modifier like `.assembly-picker-option.selected` (and that class is the
  other `--accent` casualty). `[Quick Win]`

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

- Panel/section title casing: CSS uppercases all panel headers (index.css:627), so view and edit
  titles render identically despite mixed-case source strings.
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
| 3 | Tokenize the six data-field colors | Quick Win ✅ — `--tok-*` RGB-triplet vars in `:root`; all six token classes compose tints via `rgba(var(--tok-*), a)` |
| 4 | `.btn-toggle` segmented control → ToolForm unit picker + Settings | Quick Win ✅ |
| 5 | Collapse type grid when editing an existing tool | Quick Win ✅ — current type chip + “Change type…” expander; full grid kept for the create flow |
| 6 | Shared `.empty-state`; scrollbar unification; lucide chevrons | Quick Win ✅ — LandingPage no-results uses `.empty-state`; `.preset-scroll` matches the global scrollbar; panel chevrons are lucide `ChevronDown/Right` |
| 7 | Sticky identity header in edit mode | Medium ✅ — edit mode reuses `.tool-sticky-header` (icon, “Editing · type”, description badge, ProShop pill) |
| 8 | Custom checkbox/select styling | Medium ✅ — `accent-color: var(--blue)` on all checkboxes/radios; `select.field-input` gets a theme chevron (`appearance: none` + inline SVG) |
| 9 | Utility classes + opportunistic inline-style cleanup | Medium ✏️ partial — `.flex-wrap` + `.picker-row` added; ToolForm rows and HolderPicker rows converted; remaining inline styles cleaned as components get touched |
| 10 | ~~DiffStep `.diff-table` + shared `.list-item`~~ | Already fine — `.diff-row` grid and `.queue-item` hover/active were already CSS classes; original finding overstated |
| 11 | Two-column edit layout mirroring view mode | Larger Redesign |
