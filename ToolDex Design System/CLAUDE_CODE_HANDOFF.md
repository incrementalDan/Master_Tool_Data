# Claude Code Handoff — ToolDex Design System

## What this is
This project **is** the ToolDex design system — the source of truth for the visual language: color tokens, type scale, spacing, the signature "data colored by type" system, and a set of reference components. Hand the whole project to Claude Code; this file is the entry point.

These files are **design references**, not drop-in production code. The task is to apply this visual language to the real app — **[incrementalDan/Master_Tool_Data](https://github.com/incrementalDan/Master_Tool_Data)** (React + Vite), whose live class system lives in `src/index.css`. Most of this maps to **CSS custom properties + classes you already have** — you are reconciling two CSS systems, not rebuilding the app.

## Fidelity
**High-fidelity.** Every color, font, radius, shadow, and spacing value is final and intentional. Match the hex values and class behavior exactly.

## How to apply it (recommended order)

1. **Read `readme.md`** end-to-end — the full design system guide. It explains the philosophy: dark-first, dense, instrument-panel; one blue for action; **data color-coded by type**; holders colored by physical size; presets colored by the material's ISO 513 group. The color *system* matters more than any single value.

2. **Reconcile the token layer.** Canonical tokens live in `tokens/`:
   - `colors.css` — surface ramp, text ramp, accents, identity/ISO/holder colors
   - `typography.css` — the three font roles + scale
   - `spacing.css` — radius / shadow / motion / layout
   - `semantic.css` — role aliases · `base.css` — resets, scrollbars, focus
   - `components.css` — the token-driven class layer (`.meta-badge`, `.preset-tag`, `.holder-pill`, `.tool-card`, …)
   - `styles.css` (root) `@import`s them all in order.

   Map these onto the `:root` custom properties and classes already in the app's `src/index.css`. Where a value differs, **this project wins** — it's the newer decision. Keep everything **token-driven**; do not hard-code hex values inline.

3. **Apply component-level detail** from `components/` (each has `.jsx` + `.d.ts` + `.prompt.md`). The `.prompt.md` describes intent/usage; the `.jsx` shows exact markup and class structure.

4. **Verify against the spec cards** — the `.card.html` files in `components/` and `guidelines/` render each piece in isolation. The interactive product recreation is in `ui_kits/tooldex/` (login → library → tool detail).

---

## Latest design-pass deltas (apply these specifically)

If the app has an older version of these tokens, these are the exact changes to apply — all in `tokens/colors.css` and `tokens/components.css`:

1. **Lighter app canvas.** `--bg`: `#202020` → **`#383838`**. The canvas is now the *lightest* layer; cards/boxes stay as darker inset panels (do **not** change card/button/input fills — only the page background lifted).

2. **Brighter text ramp.** `--text` `#ebebeb`→**`#f5f5f5`**, `--text-label` `#d0d0d0`→**`#dcdcdc`**, `--text-sub` `#adadad`→**`#bdbdbd`**, `--text-faint` `#555555`→**`#6e6e6e`**.

3. **ISO material preset pills (`.preset-tag`).** Background is now flat dark gray (`--input-bg`) instead of a color tint; the ISO-group color stays on **text + border** only; the colored dot is removed; bigger/bolder (`13px / 700`, padding `4px 13px`). New **`.preset-tag.is-all`** modifier = solid gray fill (`--text-faint` 45% over `--input-bg`) + white border matched to text, for the "All" / selected state.

4. **Holder pills (`.holder-pill`).** Colored background toned down (tint `20%` → **`9%`** over `--input-bg`); text brightened toward white (`60% holder-color / 40% white`); border kept at holder color. Full holder names preserved (`white-space: nowrap` — never truncate).

5. **Orange diameter glyph.** New utility `.dia { color: var(--orange); font-weight: 600 }`. Wrap the **⌀** symbol in `<span className="dia">⌀</span>` everywhere a diameter renders — tool-card meta badges, the tool detail panel, and any `<Badge>` containing a diameter. Number/units stay neutral; only the glyph is orange.

---

## Notes & caveats
- **Webfonts** (Space Grotesk, JetBrains Mono) are a ToolDex brand decision loaded from Google Fonts — *not* in the source app, which ships only the system-UI stack. Keep them unless the team licenses brand faces; if so, swap in `tokens/fonts.css` + `tokens/typography.css`.
- **ISO group colors** are canonical defaults; a shop's editable Materials library (`materials.json` `groups[]`) may override them at runtime — keep them token-driven, not hard-coded.
- **Holder colors** beyond the seven canonical sizes are assigned by a stable hash in the app, falling back to teal `--holder-default`. Preserve that mechanism.
- **Icons:** lucide line icons for UI glyphs; the bespoke `ToolTypeIcon` set is the product's own iconography — keep it, don't substitute lucide for tool types.
- Ignore the build artifacts (`_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json`) and `uploads/` — they are tooling, not part of the design.
