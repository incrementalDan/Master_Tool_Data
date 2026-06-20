---
name: tooldex-design
description: Use this skill to generate well-branded interfaces and assets for ToolDex, the CNC cutting-tool library manager, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation

- **What it is:** ToolDex is a dark-first, dense, technical CNC tool-library manager (one-person up to 1,000-person shops). Imports from Autodesk Fusion, exports to Fusion + ProShop.
- **Signature move:** data is color-coded *by type*. Identity fields have fixed colors (description=violet, ProShop ID=amber, machine #=green, location=indigo). **Holders are colored by physical size**; **presets and all speeds & feeds inherit the selected material's ISO 513 group color**. Don't invent new color meanings — reuse this system (`tokens/colors.css`, `components/data/DataBadge.jsx`).
- **Type:** Space Grotesk (display/wordmark), system-UI (body/labels), JetBrains Mono (all measured data). Link `styles.css` and it's all wired.
- **Icons:** lucide line icons + the bespoke `ToolTypeIcon` set (the brand's most recognizable asset). No emoji.
- **Don't:** add gradients, imagery, blur, soft grey shadows, or colored-left-border cards — none of that is in the product.

## Files
- `styles.css` — the single stylesheet to link; pulls in all tokens, fonts, base resets, and the component class layer.
- `readme.md` — full design guide (content voice, visual foundations, iconography, index, caveats).
- `tokens/` — color/type/spacing/semantic tokens, fonts, base, component classes.
- `components/` — React primitives (`core/`, `forms/`, `feedback/`, `data/`) with `.d.ts` + `.prompt.md`.
- `ui_kits/tooldex/` — interactive recreation of the product (login → library → tool detail). Copy `shell.css` + the JSX for full-screen mockups.
- `assets/` — `tooldex-mark.svg` logo.
- `guidelines/` — specimen cards.
