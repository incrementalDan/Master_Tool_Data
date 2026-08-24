import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// Executing a component body (which renderToString does) catches what lint and
// the build both miss: a symbol referenced but not imported, a helper renamed on
// one side, a field read off a shape that doesn't have it. The status work
// touched five components at once, which is exactly when that happens.

const tools = [
  { id: 'FTL-A', tool_id: 'A-1', tool_type: 'flat end mill', description: '1/2 EM', diameter: 0.5, unit: 'inches', assemblies: [] },
  { id: 'FTL-B', tool_id: 'A-2', tool_type: 'flat end mill', description: '1/2 EM BETA', tool_status: 'beta', diameter: 0.5, unit: 'inches', assemblies: [] },
  { id: 'FTL-R', tool_id: 'A-3', tool_type: 'flat end mill', description: '3/8 EM RETIRED', tool_status: 'retired', replaced_by: 'FTL-A', diameter: 0.375, unit: 'inches', assemblies: [] },
  // Retired, pointing at a tool that is no longer in the library.
  { id: 'FTL-D', tool_id: 'A-4', tool_type: 'drill', description: 'DRILL RETIRED', tool_status: 'retired', replaced_by: 'FTL-GONE', diameter: 0.25, unit: 'inches', assemblies: [] },
];

const ctx = {
  tools,
  components: { components: [] },
  holders: [], holderLibrary: { holders: [] },
  materials: { groups: [], presets: [], materials: [] },
  vendorRegistry: { entities: [] },
  shopSettings: { machines: [], tool_id_system: { mode: 'proshop' }, location_config: { systems: [] } },
  notify: vi.fn(), saveTool: vi.fn(), cloneTool: vi.fn(), isSaving: false,
  googleAuthenticated: true, demoMode: false, fusionEnabled: true,
};

vi.mock('../context/AppContext.jsx', () => ({
  useApp: () => ctx,
  AppProvider: ({ children }) => children,
}));

const { default: ToolCard } = await import('./ToolCard.jsx');
const { default: StatusBadge } = await import('./StatusBadge.jsx');

const render = (ui) => renderToString(<MemoryRouter>{ui}</MemoryRouter>);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/<!--.*?-->/g, '').replace(/\s+/g, ' ').trim();

describe('StatusBadge renders', () => {
  it('nothing at all for an active tool', () => {
    expect(render(<StatusBadge tool={tools[0]} />)).toBe('');
    expect(render(<StatusBadge tool={{}} />)).toBe('');
  });

  it('but does when explicitly asked (the edit form)', () => {
    expect(text(render(<StatusBadge tool={tools[0]} showActive />))).toContain('Active');
  });

  it('a label for beta and retired', () => {
    expect(text(render(<StatusBadge tool={tools[1]} />))).toContain('Beta');
    expect(text(render(<StatusBadge tool={tools[2]} />))).toContain('Retired');
  });

  it('carries the colour as one --badge-color token, not three hard-coded rules', () => {
    expect(render(<StatusBadge tool={tools[2]} />)).toContain('--badge-color');
  });
});

describe('ToolCard renders every status without throwing', () => {
  for (const variant of ['grid', 'list']) {
    it(`${variant}: an active tool wears no status badge`, () => {
      const html = text(render(<ToolCard tool={tools[0]} variant={variant} />));
      expect(html).not.toContain('Retired');
      expect(html).not.toContain('Beta');
    });

    it(`${variant}: a retired tool does`, () => {
      expect(text(render(<ToolCard tool={tools[2]} variant={variant} />))).toContain('Retired');
    });

    it(`${variant}: a beta tool does`, () => {
      expect(text(render(<ToolCard tool={tools[1]} variant={variant} />))).toContain('Beta');
    });
  }
});
