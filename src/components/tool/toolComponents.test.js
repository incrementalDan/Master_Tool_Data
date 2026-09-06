import { describe, it, expect } from 'vitest';

// ⚠️ WHY THIS EXISTS. Extracting a component out of a big file and importing it
// back as a DEFAULT export when it was written as a NAMED one leaves `undefined`
// at the call site. Lint can't see it (the symbol is defined), and nothing here
// renders — several of these panels only appear behind a condition (a scan in
// progress, a stray found on open), so a broken export would have shipped and
// surfaced as a blank page the first time someone scanned a spec sheet.
//
// This asserts only the shape of each module's exports. Cheap, and it covers
// every piece Phase 2 pulled out of ToolDetail / ToolForm at once.
const MODULES = [
  ['./ToolSection.jsx', ['default']],
  ['./DetailField.jsx', ['default']],
  ['./SidebarBtn.jsx', ['default']],
  ['./AssembliesSection.jsx', ['default']],
  ['./AssemblyExportPicker.jsx', ['default']],
  ['./ToolStickyHeader.jsx', ['default']],
  ['./ToolBanners.jsx', ['default']],
  ['./ToolActionSidebar.jsx', ['default']],
  ['./ToolIdentitySection.jsx', ['default']],
  ['./FieldInput.jsx', ['default']],
  ['./SpecScanPanels.jsx', ['default', 'SpecPurchasingPanel']],
];

describe('the extracted tool-page components', () => {
  for (const [path, names] of MODULES) {
    it(`${path} exports ${names.join(', ')} as component functions`, async () => {
      const mod = await import(path);
      for (const name of names) {
        expect(typeof mod[name], `${path} → ${name}`).toBe('function');
      }
    });
  }
});
