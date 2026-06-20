# ToolDex Design System

**ToolDex** is a cutting-tool library manager for precision CNC machine shops — a single source of truth for every end mill, drill, tap, holder, assembly, and the speeds & feeds proven to run them. It scales from a one-person shop to a 1,000-person operation, and is being dialed in internally first before rolling out to other companies.

The product is dark-first, dense, and unapologetically technical: operators scan large tables of tools under shop-floor glare, so the interface optimizes for fast recognition and zero ambiguity. Its signature move is **color-coding data by type** — a value is identifiable even with no label beside it.

## Sources

This system was reverse-engineered from the product codebase. Explore these to build higher-fidelity ToolDex designs:

- **GitHub — [incrementalDan/Master_Tool_Data](https://github.com/incrementalDan/Master_Tool_Data)** — the React/Vite application. Key reads: `src/index.css` (the full class system), `src/components/ToolCard.jsx`, `src/components/AssemblyCard.jsx` (holder color system), `src/components/PresetDot.jsx` + `src/utils/presetNaming.js` (material→ISO-group preset colors), `material_iso_lookup.jsx` (ISO 513 group definitions + colors), and `FUSION_example_tool_library.json` (real tool data).

The app imports from Autodesk Fusion tool libraries and exports to Fusion + ProShop, so its data vocabulary (ProShop IDs, holders, assemblies, OOH/stickout, presets) mirrors those systems.

---

## Content Fundamentals

**Voice — terse, shop-literal, operator-to-operator.** Copy reads like it was written by a machinist for machinists. No marketing gloss, no hand-holding.

- **Casing:** UI labels are UPPERCASE micro-caps with letter-spacing (`DESCRIPTION`, `MACHINE #`, `STICKOUT`). Body and values are sentence case. Buttons are sentence case ("Add tool", "Change library").
- **Person:** Mostly impersonal/imperative — the UI names objects and actions, not "you". Empty states address the user directly but plainly ("Import your Fusion library or add tools manually").
- **Domain language is exact, never softened:** *ProShop ID, holder, assembly, OOH (out-of-holder / stickout), preset, flutes, LOC, ⌀ diameter, machine tool #, ISO 513 group.* Use the real terms. Abbreviate the way the shop does (FL = flutes, LOC = length of cut, OOH = stickout).
- **Numbers are first-class.** Measurements carry units and fixed precision (`0.3125 in`, `1.693 LOC`, fixed 3-decimal stickout). Machine numbers prefix with `T` (T4). Always monospace.
- **No emoji.** None in the product UI. Status is carried by color + a line icon, never an emoji. (One ⚠️ appears in an internal reference tool, not the shipping UI — don't propagate it.)
- **Tone in alerts:** factual and consequence-first — "Google Drive disconnected — metadata changes won't be saved." State what happened and what it means, then offer the fix.

Examples pulled from the product: `PS D-53 5/16 Carbide drill 1.693 LOC` (a description), `SS 1.500 30-SK13-60 - Rough` (a preset name: material code · stickout · holder short-name · operation), `NBT30-SK13C-60` (a holder).

---

## Visual Foundations

**Overall vibe:** dark, industrial, instrument-panel. Think machine-controller HMI, not consumer SaaS. Information density is a feature.

- **Color:** A tight ramp of warm-neutral greys with the app canvas as the *lightest* layer (`#383838` app), cards sitting *inset/darker* on it (`#2a2a2a` card → `#333` raised → `#3c3c3c` pop), and inputs recessed deepest (`#1e1e1e`). One confident blue (`#4a8fff`) is the only action/brand color. Status hues (green/red/amber/orange) are reserved for meaning. See `tokens/colors.css`.
- **The signature system — data colored by type:** identity fields have fixed colors (description = violet, ProShop ID = amber mono pill, machine # = green, location = indigo). **Holders are colored by physical size** — each taper-collet-gauge combination (30-SK13-60, 30-SK20-90, …) carries its own color *everywhere* it appears. **Presets and everything speeds-&-feeds-related inherit the color of the selected material's ISO 513 group** (P-Steel blue, M-Stainless brown, K-Cast-Iron red, N-Non-Ferrous green, S-High-Temp orange, H-Hardened grey). These two are not fixed swatches — they're functions of size and material. See the "Data-field colors" card and `components/data/DataBadge.jsx`.
- **Type:** Three faces, three jobs. **Space Grotesk** for display/wordmark; **system-UI stack** for interface body & labels (exactly what the app uses); **JetBrains Mono** for *all* measured data (diameters, speeds, feeds, IDs, machine numbers). Base size is a tight 14px. See `tokens/typography.css`. ⚠ The two webfonts are a ToolDex brand decision loaded from Google Fonts — see Caveats.
- **Spacing & shape:** 4px grid, most gaps 6–16px. Radii are small — 5px (controls), 8px (cards/panels), 12px (modals), pill (badges/chips). Dense by design.
- **Borders & elevation:** Hairline `#484848` borders define nearly every surface; borders lift on hover (`#4a4a4a`). Shadows are deep and dark (`rgba(0,0,0,0.3–0.5)`), never soft grey. Cards are flat at rest (subtle `shadow-sm`) and lift 2px with a stronger shadow on hover.
- **Backgrounds:** Flat solid greys. No gradients, no imagery, no textures, no glassmorphism/blur. The only "imagery" is the line-art tool icons. Selected/active states use a dark blue *tint* fill (`#16263b`) with a blue border — not a solid blue fill.
- **Motion:** Functional and fast. One easing curve (`cubic-bezier(0.4,0,0.2,1)`), ~160ms. Hover *brightens* (`filter: brightness(1.1)`); press *nudges down 1px* (`translateY(1px)`). Toasts/modals fade-slide in at ~220ms. No bounces, no decorative loops, no parallax.
- **Hover/press states:** buttons brighten on hover + nudge on press; secondary/ghost controls fill one surface-step lighter; card-row quick-actions fade in on hover (and are always visible on touch). Focus is a 2px blue ring, offset, never removed.
- **Cards:** surface fill, 1px hairline border, 8px radius, subtle shadow. No colored left-border-accent cards, no rounded-corner pill cards with a single accent stripe.

---

## Iconography

- **System:** [**lucide**](https://lucide.dev) line icons (the app uses `lucide-react`) — 1.5–2px stroke, `currentColor`, rounded caps/joins. Link from CDN (`https://unpkg.com/lucide@latest`) or use `lucide-react` in production. In this design system's specimen cards, the handful of UI glyphs (search, X, check, alert, grid, list, triangle) are inlined as matching lucide SVG paths so cards stay dependency-free.
- **The ToolDex signature — tool-type icons:** a bespoke set of hand-drawn line silhouettes, one per CNC tool type (flat/ball/bull end mills, drills, taps, reamers, face mills, the circle-segment family, etc.). These are NOT lucide — they're the product's own iconography and the most recognizable brand asset. Shipped here as the `ToolTypeIcon` component (`components/data/ToolTypeIcon.jsx`); see the "Tool-type icon set" Brand card. They share a 24×24 viewBox, stroke `currentColor`, and tint to context (blue on cards, blue when selected).
- **Logo:** the end-mill mark on the brand-blue rounded tile (`assets/tooldex-mark.svg`), paired with the "Tool**Dex**" wordmark in Space Grotesk (the "Dex" set in blue). See the "Logo & wordmark" Brand card.
- **No emoji, no unicode-as-icon** in product UI. Geometric marks like ⌀ (diameter) appear inline with measurements as typographic symbols, not icons.

---

## Index

**Root**
- `styles.css` — the single entry point consumers link; `@import`s everything below.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill manifest for use in Claude Code.

**`tokens/`** — `colors.css`, `typography.css`, `spacing.css` (radius/shadow/motion/layout), `semantic.css` (role aliases), `fonts.css` (Google Fonts import), `base.css` (resets, scrollbars, focus), `components.css` (the token-driven class layer).

**`components/`** — reusable React primitives, each with `.jsx` + `.d.ts` + `.prompt.md`:
- `core/` — `Button`, `IconButton`, `Badge`, `Card`, `Chip`, `SegmentedToggle`
- `forms/` — `Input`, `Select`, `SearchBar`
- `feedback/` — `Toast` (+ `ToastStack`), `Banner`, `Spinner`
- `data/` — `ToolTypeIcon`, `DataBadge`, `ToolCard` (the signature objects)

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab.

**`ui_kits/tooldex/`** — interactive recreation of the product: login → library (search, tool-type filters, grid/list) → tool detail (dimensions, assemblies with size-colored holders, presets colored by material). `index.html` + `app.jsx` + `data.js` + `icons.jsx` + `shell.css`.

**`assets/`** — `tooldex-mark.svg` (logo).

---

## Caveats & substitutions

- **Webfonts are a brand decision, not from the codebase.** The source app ships only the system-UI stack. ToolDex adds **Space Grotesk** (display) and **JetBrains Mono** (data) from Google Fonts. If the team has licensed brand faces, swap them in `tokens/fonts.css` + `tokens/typography.css`.
- **ISO group colors come from the shop's editable Materials library** (`materials.json` `groups[]`). The values here are the canonical defaults from the reference lookup; a given shop may have tuned them.
- **Holder colors** beyond the seven canonical sizes are assigned by a stable hash in the app, falling back to the teal `--holder-default`.
