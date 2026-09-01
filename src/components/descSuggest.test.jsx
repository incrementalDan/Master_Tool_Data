import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// The generated description is now READ before it is taken, not discovered by
// pressing the button that overwrites what you had. What is locked here is the
// part that makes that true: the value is on the page, it is scoped to editing
// an existing tool, and it disappears once there is nothing left to suggest —
// a line restating the box would be noise on every tool in the library.

const ctx = {
  tools: [],
  components: { components: [] },
  holders: [], holderLibrary: { holders: [] },
  materials: { groups: [], presets: [], materials: [] },
  vendorRegistry: { entities: [] },
  shopSettings: { machines: [], tool_id_system: { mode: 'proshop' }, location_config: { systems: [] } },
  notify: vi.fn(), saveVendorRegistry: vi.fn(),
  googleAuthenticated: true, demoMode: false, fusionEnabled: true,
};

vi.mock('../context/AppContext.jsx', () => ({
  useApp: () => ctx,
  AppProvider: ({ children }) => children,
}));

const { default: ToolForm } = await import('./ToolForm.jsx');
const { buildDesc } = await import('../utils/toolNaming.js');
const { toolToExtractor } = await import('../schema/toolSchema.js');

const tool = {
  id: 'FTL-A', tool_id: 'A-1', tool_type: 'flat end mill',
  description: 'AN OLD HAND-TYPED NAME',
  diameter: 0.5, flute_length: 1, overall_length: 3, number_of_flutes: 4,
  material: 'carbide', unit: 'inches', assemblies: [], presets: [],
};

const render = (props) => renderToString(
  <MemoryRouter><ToolForm tool={tool} onSave={() => {}} onCancel={() => {}} {...props} /></MemoryRouter>,
);
const generated = buildDesc(toolToExtractor(tool));

describe('the description suggestion', () => {
  it('is shown in full before anything is clicked', () => {
    const html = render({ isNew: false });
    expect(generated).toBeTruthy();
    expect(html).toContain('desc-suggest-value');
    expect(html).toContain(generated);
  });

  it('is hidden — and the button disabled — once the description already matches', () => {
    const html = renderToString(
      <MemoryRouter>
        <ToolForm tool={{ ...tool, description: generated }} onSave={() => {}} onCancel={() => {}} isNew={false} />
      </MemoryRouter>,
    );
    expect(html).not.toContain('desc-suggest-value');
    // Nothing to suggest ⇒ nothing to press. Saying why beats a button that
    // looks live and does nothing.
    expect(html).toContain('already matches what the geometry generates');
  });

  it('is not shown in the add flow', () => {
    // A new tool opens with a generated description already in the box, so a
    // line underneath repeating it word for word would say nothing.
    expect(render({ isNew: true })).not.toContain('desc-suggest-value');
  });
});
