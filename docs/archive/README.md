# Archive

Design references that have already been built into the app. **Nothing here is
imported by the application** — verified before archiving — so these files do not
affect the build and can be deleted whenever you're confident you won't want to
look back at them.

They are kept rather than deleted because `CLAUDE.md` still cites the first one
as the approved design reference for that feature's layout and copy.

| File | Built into |
|---|---|
| `LocationSystemUI.tsx` | `src/components/LocationSystemSettings.jsx` |
| `HolderManager.tsx` | `src/components/HoldersPage.jsx`, `HolderDetail.jsx` |
| `ProgramNumberManager.tsx` | `src/components/PartsPage.jsx`, `PartDetailPage.jsx` |
| `material_iso_lookup.jsx` | `src/components/MaterialsEditor.jsx` |

⚠️ **Not archived, and not to be moved:** `FUSION TOOL Library REF/`,
`Material REF Docs/` and `docs/proshop_brother_label_extension_v9/` look like
reference material but are **read by the test suite, `scripts/roundtrip-audit.mjs`
and `src/demo/`**. Moving them breaks 15+ test files.
