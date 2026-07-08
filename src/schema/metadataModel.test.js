import { describe, it, expect } from 'vitest';
import { buildMetadataTool, mergeFusionAndMetadata, detectFusionDrift, mergeSharedFieldsWithFusion } from './metadataModel.js';
import { buildLogicalTool, buildUnlinkedTool, isUnlinkedMeta, materializeUnlinkedTools, mergePresetsWithFusion, mergeInstanceFieldsWithFusion } from './logicalTools.js';

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
  // fusionToolToInternal always populates this (defaults to Right Hand), so both
  // sides carry it in real data — set it here so drift compares like-for-like.
  cutting_direction: 'Right Hand',
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

// ── Increment 2: presets into the app record ────────────────────────────────
const toolWithPresets = {
  ...sampleTool,
  presets: [
    {
      guid: 'preset-guid-1', name: 'AL 2.0 SK13 - Rough',
      material: { category: 'all', query: 'Aluminum', 'use-hardness': false },
      n: 12000, v_c: 900, v_f: 120, f_z: 0.0025, f_n: 0,
      'use-stepdown': true, stepdown: 0.05, 'use-stepover': false, stepover: null,
      'tool-coolant': 'flood', 'ramp-angle': 2,
      operation_type: 'rough', machine_id: 'machine-uuid-1', job_ids: ['job-1'],
    },
  ],
};

describe('Phase A increment 2 — presets in the complete record', () => {
  it('buildMetadataTool persists the full preset set (modeled + Fusion-native keys + app-only fields)', () => {
    const meta = buildMetadataTool(toolWithPresets);
    expect(meta.presets).toHaveLength(1);
    const p = meta.presets[0];
    expect(p.guid).toBe('preset-guid-1');
    expect(p.n).toBe(12000);
    expect(p['use-stepdown']).toBe(true);   // un-modeled Fusion-native key preserved
    expect(p.stepdown).toBe(0.05);
    expect(p.operation_type).toBe('rough'); // app-only fields carried too
    expect(p.machine_id).toBe('machine-uuid-1');
    expect(p.job_ids).toEqual(['job-1']);
    // preset_meta (the linked-read overlay) is still written and consistent
    expect(meta.preset_meta['preset-guid-1']).toMatchObject({
      operation_type: 'rough', machine_id: 'machine-uuid-1', job_ids: ['job-1'],
    });
  });

  it('a LINKED tool still reads presets from Fusion (metadata copy is inert)', () => {
    // Raw Fusion instance carrying its own presets; metadata carries a DIFFERENT
    // preset set. Fusion must win for a linked tool — no behavior change.
    const raw = {
      guid: 'inst-1',
      'post-process': { comment: 'FTL-ABC123' },
      type: 'flat end mill', unit: 'inches',
      geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 },
      'start-values': { presets: [{ guid: 'fusion-preset', name: 'FUSION PRESET', n: 8000 }] },
    };
    const meta = buildMetadataTool(toolWithPresets); // has 'preset-guid-1'
    const metaByTracking = new Map([['FTL-ABC123', { ...meta, id: 'FTL-ABC123' }]]);
    const tool = buildLogicalTool([raw], metaByTracking);
    expect(tool.presets).toHaveLength(1);
    expect(tool.presets[0].guid).toBe('fusion-preset'); // Fusion's, not metadata's
    expect(tool.presets[0].n).toBe(8000);
  });

  it('a NO-FUSION tool reconstructs its presets from metadata', () => {
    // Raw Fusion instance with NO presets (start-values empty) — stands in for a
    // tool that has no real Fusion cutting data. The complete metadata presets
    // fill in, app-only fields intact.
    const raw = {
      guid: 'inst-1',
      'post-process': { comment: 'FTL-ABC123' },
      type: 'flat end mill', unit: 'inches',
      geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 },
      'start-values': { presets: [] },
    };
    const meta = buildMetadataTool(toolWithPresets);
    const metaByTracking = new Map([['FTL-ABC123', { ...meta, id: 'FTL-ABC123' }]]);
    const tool = buildLogicalTool([raw], metaByTracking);
    expect(tool.presets).toHaveLength(1);
    expect(tool.presets[0].guid).toBe('preset-guid-1');
    expect(tool.presets[0].n).toBe(12000);
    expect(tool.presets[0]['use-stepdown']).toBe(true);
    expect(tool.presets[0].operation_type).toBe('rough');
    expect(tool.presets[0].machine_id).toBe('machine-uuid-1');
    expect(tool.presets[0].job_ids).toEqual(['job-1']);
  });
});

// ── Phase B increment 1: buildUnlinkedTool + the orphan-ghost guard ──────────
const unlinkedSourceTool = {
  ...toolWithPresets,
  tracking_id: 'FTL-NOFUS1',
  no_fusion_link: true,
  assemblies: [{
    assembly_id: 'asm-1', instance_guid: null, holder_guid: 'holder-1',
    holder_description: 'ER32 100mm', ooh: 2.0, source: 'manual',
  }],
};

describe('Phase B increment 1 — no-Fusion tools (build from metadata alone)', () => {
  it('isUnlinkedMeta only flags EXPLICITLY marked records (orphan-ghost guard)', () => {
    expect(isUnlinkedMeta({ no_fusion_link: true })).toBe(true);
    // A tool deleted in Fusion leaves an UNMARKED metadata record — must stay
    // dormant, never materialized as a ghost.
    expect(isUnlinkedMeta({ no_fusion_link: false })).toBe(false);
    expect(isUnlinkedMeta({})).toBe(false);
    expect(isUnlinkedMeta(null)).toBe(false);
  });

  it('buildUnlinkedTool reconstructs a complete tool from metadata with no Fusion side', () => {
    const meta = buildMetadataTool(unlinkedSourceTool);
    const tool = buildUnlinkedTool(meta);
    // Identity + geometry from metadata (no Fusion defaults masking them)
    expect(tool.id).toBe('FTL-NOFUS1');
    expect(tool.tracking_id).toBe('FTL-NOFUS1');
    expect(tool.tool_type).toBe('flat end mill');
    expect(tool.unit).toBe('inches');
    expect(tool.diameter).toBe(0.5);
    expect(tool.number_of_flutes).toBe(4);
    expect(tool.material).toBe('carbide');
    // Presets reconstructed with app-only fields intact
    expect(tool.presets).toHaveLength(1);
    expect(tool.presets[0].n).toBe(12000);
    expect(tool.presets[0].operation_type).toBe('rough');
    // Flat speed/feed mirror derived from preset 0 (O1)
    expect(tool.spindle_speed).toBe(12000);
    expect(tool.cutting_feedrate).toBe(120);
    expect(tool.feed_per_tooth).toBe(0.0025);
    // Assemblies carried from metadata; no Fusion instance
    expect(tool.assemblies).toHaveLength(1);
    expect(tool.assemblies[0].holder_guid).toBe('holder-1');
    expect(tool.assemblies[0].instance_guid).toBeNull();
    // Unlinked markers
    expect(tool.no_fusion_link).toBe(true);
    expect(tool.library_id).toBeNull();
    expect(tool._instancesRaw).toEqual([]);
    expect(tool._fusionRaw).toBeNull();
  });

  it('buildUnlinkedTool PRESERVES a stored no_fusion_link:false (Fusion-disabled-mode build)', () => {
    // In disabled mode buildUnlinkedTool runs for every record, including
    // formerly-linked ones — they must keep their flag so re-enabling Fusion
    // doesn't spuriously detach them.
    const meta = buildMetadataTool({ ...sampleTool, tracking_id: 'FTL-LINKED2', no_fusion_link: false });
    const tool = buildUnlinkedTool(meta);
    expect(tool.no_fusion_link).toBe(false);
    expect(tool.tool_type).toBe('flat end mill'); // still fully reconstructed from metadata
    expect(tool.diameter).toBe(0.5);
  });
});

describe('Phase B increment 5a — Fusion drift detection (D3)', () => {
  it('reports no drift when the app copy matches Fusion', () => {
    const meta = buildMetadataTool(sampleTool);
    const fusionInternal = { ...sampleTool };
    expect(detectFusionDrift(fusionInternal, meta)).toEqual([]);
  });

  it('detects a differing numeric field (someone changed diameter in Fusion)', () => {
    const meta = buildMetadataTool(sampleTool);           // diameter 0.5 stored
    const fusionInternal = { ...sampleTool, diameter: 0.375 }; // Fusion now says 0.375
    const drift = detectFusionDrift(fusionInternal, meta);
    expect(drift).toEqual([{ field: 'diameter', fusionValue: 0.375, appValue: 0.5 }]);
  });

  it('detects a differing string field (description edited in Fusion)', () => {
    const meta = buildMetadataTool(sampleTool);
    const fusionInternal = { ...sampleTool, description: 'CHANGED IN FUSION' };
    const drift = detectFusionDrift(fusionInternal, meta);
    expect(drift).toEqual([{ field: 'description', fusionValue: 'CHANGED IN FUSION', appValue: '1/2 4FL EM' }]);
  });

  it('does NOT flag a field the app has not populated yet (no false alarm on old metadata)', () => {
    // Pre-complete-record metadata: no stored diameter → not drift even though
    // Fusion has one.
    const meta = { id: 'FTL-OLD', description: '1/2 4FL EM', tool_type: 'flat end mill' };
    const fusionInternal = { ...sampleTool, description: '1/2 4FL EM', tool_type: 'flat end mill' };
    expect(detectFusionDrift(fusionInternal, meta)).toEqual([]);
  });

  it('absorbs Fusion float round-trip noise below significance', () => {
    const meta = buildMetadataTool({ ...sampleTool, diameter: 0.5 });
    const fusionInternal = { ...sampleTool, diameter: 0.5000002 };
    expect(detectFusionDrift(fusionInternal, meta)).toEqual([]);
  });

  it('flags drift when ANY instance diverged — even a non-canonical assembly', () => {
    // Multi-instance tool: instance 0 (canonical) still matches the app; instance
    // 1 was edited in Fusion. Detection must catch it and report the diverged value.
    const meta = buildMetadataTool(sampleTool);  // flute_length 1.0
    const canonical = { ...sampleTool, flute_length: 1.0 };
    const editedInstance = { ...sampleTool, flute_length: 1.5 };
    const drift = detectFusionDrift([canonical, editedInstance], meta);
    expect(drift).toEqual([{ field: 'flute_length', fusionValue: 1.5, appValue: 1.0 }]);
  });

  it('accepts a single object too (back-compat)', () => {
    const meta = buildMetadataTool(sampleTool);
    expect(detectFusionDrift({ ...sampleTool, diameter: 0.375 }, meta))
      .toEqual([{ field: 'diameter', fusionValue: 0.375, appValue: 0.5 }]);
  });

  it('buildLogicalTool attaches _drift for a linked tool whose Fusion geometry diverged', () => {
    const meta = buildMetadataTool(sampleTool);           // diameter 0.5
    const raw = {
      guid: 'inst-1', 'post-process': { comment: 'FTL-ABC123' },
      type: 'flat end mill', unit: 'inches',
      geometry: { DC: 0.375, LCF: 1, OAL: 3, NOF: 4 },    // Fusion diameter differs
      'start-values': { presets: [] },
    };
    const metaByTracking = new Map([['FTL-ABC123', { ...meta, id: 'FTL-ABC123' }]]);
    const tool = buildLogicalTool([raw], metaByTracking);
    const dia = tool._drift.find(d => d.field === 'diameter');
    expect(dia).toEqual({ field: 'diameter', fusionValue: 0.375, appValue: 0.5 });
  });
});

describe('mergePresetsWithFusion — never wipe a concurrent Fusion preset edit', () => {
  const base   = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 100, operation_type: 'rough', machine_id: 'm1', job_ids: ['j1'] }];
  const local  = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 100, operation_type: 'rough', machine_id: 'm1', job_ids: ['j1'] }];

  it('adopts a Fusion edit the app did not touch (the wipe bug)', () => {
    // Fusion changed the feed (100 -> 130); the app left the preset alone.
    const remote = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 130 }];
    const out = mergePresetsWithFusion(local, base, remote);
    expect(out[0].v_f).toBe(130);              // Fusion's edit preserved — NOT wiped
    expect(out[0].operation_type).toBe('rough'); // app-only overlay kept
    expect(out[0].machine_id).toBe('m1');
    expect(out[0].job_ids).toEqual(['j1']);
  });

  it('keeps the app edit when Fusion did not change the preset', () => {
    const appEdit = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 150, operation_type: 'rough', machine_id: 'm1', job_ids: [] }];
    const remote = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 100 }]; // Fusion unchanged
    const out = mergePresetsWithFusion(appEdit, base, remote);
    expect(out[0].v_f).toBe(150);   // app's edit preserved
  });

  it('keeps the app version when BOTH changed the same preset (conflict → app wins)', () => {
    const appEdit = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 150 }];
    const remote  = [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 130 }];
    const out = mergePresetsWithFusion(appEdit, base, remote);
    expect(out[0].v_f).toBe(150);
  });

  it('keeps an app-added preset not present in Fusion', () => {
    const added = [{ guid: 'p2', name: 'Finish', n: 12000, v_f: 60 }];
    const out = mergePresetsWithFusion(added, base, base);
    expect(out[0].guid).toBe('p2');
  });
});

describe('mergeSharedFieldsWithFusion — never wipe a concurrent Fusion geometry edit', () => {
  const base = { diameter: 0.5, flute_length: 1.0, description: 'EM', material: 'carbide' };

  it('adopts a Fusion field edit the app did not touch', () => {
    const tool = { diameter: 0.5, flute_length: 1.0, description: 'EM', material: 'carbide' };
    const remote = { ...base, flute_length: 1.25 };   // Fusion changed flute length
    const out = mergeSharedFieldsWithFusion(tool, base, remote);
    expect(out.flute_length).toBe(1.25);   // preserved — not wiped
    expect(out.diameter).toBe(0.5);
  });

  it('keeps the app edit when Fusion did not change the field', () => {
    const tool = { diameter: 0.5, flute_length: 1.5, description: 'EM', material: 'carbide' }; // app edited flute
    const remote = { ...base };  // Fusion unchanged
    const out = mergeSharedFieldsWithFusion(tool, base, remote);
    expect(out.flute_length).toBe(1.5);
  });

  it('keeps the app version when BOTH changed the same field', () => {
    const tool = { ...base, diameter: 0.375 };
    const remote = { ...base, diameter: 0.25 };
    const out = mergeSharedFieldsWithFusion(tool, base, remote);
    expect(out.diameter).toBe(0.375);
  });
});

describe('mergeInstanceFieldsWithFusion — never wipe a concurrent Fusion OOH edit', () => {
  it('adopts a Fusion OOH edit the app did not touch', () => {
    // base OOH 2.0 (geometry.LB), Fusion changed it to 2.5; app assembly still 2.0.
    const baseRaws = [{ guid: 'g1', geometry: { LB: 2.0 } }];
    const remoteRaws = [{ guid: 'g1', geometry: { LB: 2.5 } }];
    const assemblies = [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 2.0 }];
    const out = mergeInstanceFieldsWithFusion(assemblies, baseRaws, remoteRaws);
    expect(out[0].ooh).toBe(2.5);   // Fusion's OOH edit preserved
  });

  it('keeps the app OOH when the app changed it', () => {
    const baseRaws = [{ guid: 'g1', geometry: { LB: 2.0 } }];
    const remoteRaws = [{ guid: 'g1', geometry: { LB: 2.5 } }];
    const assemblies = [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 3.0 }]; // app changed to 3.0
    const out = mergeInstanceFieldsWithFusion(assemblies, baseRaws, remoteRaws);
    expect(out[0].ooh).toBe(3.0);
  });
});

describe('Phase B increment 2 — materializeUnlinkedTools (load-append + guards)', () => {
  const markedMeta = buildMetadataTool(unlinkedSourceTool); // id FTL-NOFUS1, no_fusion_link true
  const orphanMeta = buildMetadataTool({ ...sampleTool, tracking_id: 'FTL-ORPHAN', no_fusion_link: false });
  const builtLinked = [{ tracking_id: 'FTL-LINKED1' }];

  it('appends a marked, unrepresented no-Fusion tool', () => {
    const out = materializeUnlinkedTools(builtLinked, [markedMeta]);
    expect(out).toHaveLength(2);
    expect(out[1].tracking_id).toBe('FTL-NOFUS1');
    expect(out[1].no_fusion_link).toBe(true);
  });

  it('does NOT materialize an unmarked orphan (deleted-in-Fusion metadata stays dormant)', () => {
    const out = materializeUnlinkedTools(builtLinked, [orphanMeta]);
    expect(out).toBe(builtLinked);            // same reference — nothing added
    expect(out).toHaveLength(1);
  });

  it('does NOT double-add a marked record already backed by a built (linked) tool', () => {
    const built = [{ tracking_id: 'FTL-NOFUS1' }]; // same id is already linked
    const out = materializeUnlinkedTools(built, [markedMeta]);
    expect(out).toBe(built);
    expect(out).toHaveLength(1);
  });

  it('is a no-op (same reference) when there is nothing marked to add', () => {
    const out = materializeUnlinkedTools(builtLinked, [orphanMeta, {}, null].filter(Boolean));
    expect(out).toBe(builtLinked);
  });
});
