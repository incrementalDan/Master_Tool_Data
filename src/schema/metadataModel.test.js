import { describe, it, expect } from 'vitest';
import { buildMetadataTool, mergeFusionAndMetadata } from './metadataModel.js';

// Fusion-decoupling Phase A (increment 1): the app's metadata record now carries
// the Fusion-native SCALAR fields (identity + geometry + unit + material) so it's
// a complete, standalone record — not just an overlay. These lock the two
// properties that increment must have: (a) the record is written complete, and
// (b) a LINKED tool's read behavior is unchanged (Fusion still wins).

const sampleTool = {
  tracking_id: 'FTL-ABC123',
  tool_type: 'flat end mill',
  description: '1/2 4FL EM',
  unit: 'inches',
  diameter: 0.5,
  flute_length: 1.0,
  overall_length: 3.0,
  number_of_flutes: 4,
  shank_diameter: 0.5,
  corner_radius: 0.03,
  taper_angle: null,
  thread_pitch: null,
  material: 'carbide',
};

describe('Phase A — buildMetadataTool persists the complete scalar record', () => {
  it('writes the Fusion-native identity + geometry + material scalars into metadata', () => {
    const meta = buildMetadataTool(sampleTool);
    expect(meta.tool_type).toBe('flat end mill');
    expect(meta.description).toBe('1/2 4FL EM');
    expect(meta.unit).toBe('inches');
    expect(meta.diameter).toBe(0.5);
    expect(meta.flute_length).toBe(1.0);
    expect(meta.overall_length).toBe(3.0);
    expect(meta.number_of_flutes).toBe(4);
    expect(meta.shank_diameter).toBe(0.5);
    expect(meta.corner_radius).toBe(0.03);
    expect(meta.material).toBe('carbide');
  });

  it('stores absent optionals as null rather than inventing values', () => {
    const meta = buildMetadataTool({ tracking_id: 'FTL-1', tool_type: 'drill' });
    expect(meta.diameter).toBeNull();
    expect(meta.taper_angle).toBeNull();
    expect(meta.thread_pitch).toBeNull();
  });
});

describe('Phase A — mergeFusionAndMetadata keeps LINKED-tool reads Fusion-authoritative', () => {
  it('Fusion wins for the completed scalars (metadata is only a fallback)', () => {
    // A linked tool: fusionInternal carries the live Fusion values; the metadata
    // copy is stale/different. Fusion must still win — no behavior change.
    const fusionInternal = { ...sampleTool, diameter: 0.5, tool_type: 'flat end mill', description: 'FUSION DESC' };
    const meta = { id: 'FTL-ABC123', diameter: 0.25, tool_type: 'ball end mill', description: 'META DESC' };
    const merged = mergeFusionAndMetadata(fusionInternal, meta);
    expect(merged.diameter).toBe(0.5);
    expect(merged.tool_type).toBe('flat end mill');
    expect(merged.description).toBe('FUSION DESC');
  });

  it('reconstructs scalars from metadata when the Fusion side lacks them (no-Fusion tool)', () => {
    // Simulates a tool with no live Fusion entry: the Fusion-derived object has
    // null geometry. The complete metadata record fills it — the "no longer
    // amnesiac" property that Phase B's no-Fusion tools rely on.
    const fusionInternal = {
      tool_type: undefined, description: undefined, unit: undefined,
      diameter: null, flute_length: null, overall_length: null,
      number_of_flutes: null, shank_diameter: null, corner_radius: null,
      taper_angle: null, thread_pitch: null, material: undefined,
    };
    const meta = buildMetadataTool(sampleTool);
    const merged = mergeFusionAndMetadata(fusionInternal, meta);
    expect(merged.tool_type).toBe('flat end mill');
    expect(merged.unit).toBe('inches');
    expect(merged.diameter).toBe(0.5);
    expect(merged.number_of_flutes).toBe(4);
    expect(merged.material).toBe('carbide');
  });
});
