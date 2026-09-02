import { describe, it, expect } from 'vitest';
import {
  orphanMetadataRecords, orphanImpact,
  assemblyOohIssues, floorAssemblyOoh, oohIssuesByTool, isNotableOohDelta,
  descriptionLocMismatches, geometryChainIssues,
  duplicateAssemblyIssues, duplicateAssemblyIssuesByTool, dedupeAssemblies, describeDuplicateAssembly,
} from './libraryHealth.js';

const rec = (id, over = {}) => ({
  id, tool_id: '', description: '', tool_type: 'drill',
  assemblies: [], presets: [], no_fusion_link: false, ...over,
});
const tool = (tracking_id, over = {}) => ({
  tracking_id, id: tracking_id, tool_id: '', description: '',
  unit: 'inches', assemblies: [], ...over,
});

describe('orphanMetadataRecords', () => {
  it('reports a record with no built tool and no no_fusion_link mark', () => {
    const out = orphanMetadataRecords([rec('FTL-AAA111', { tool_id: 'D-1' })], []);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('FTL-AAA111');
  });

  it('never reports a built tool', () => {
    const out = orphanMetadataRecords([rec('FTL-AAA111')], [tool('FTL-AAA111')]);
    expect(out).toEqual([]);
  });

  // The orphan-ghost guard's other half: an intentional metadata-only tool is
  // NOT an orphan. Reporting it would offer to delete a real tool.
  it('never reports an intentional no-Fusion tool', () => {
    const out = orphanMetadataRecords([rec('FTL-AAA111', { no_fusion_link: true })], []);
    expect(out).toEqual([]);
  });

  it('classifies as a ghost when a live tool holds the same tool_id', () => {
    const out = orphanMetadataRecords(
      [rec('FTL-OLD001', { tool_id: 'D-249' })],
      [tool('FTL-NEW001', { tool_id: 'D-249', description: 'live one' })],
    );
    expect(out[0].reason).toBe('ghost');
    expect(out[0].twinId).toBe('FTL-NEW001');
  });

  // Real data has 'D-249', 'D 249' and 'd249' for one tool.
  it('matches a twin across dash/space/case differences', () => {
    const out = orphanMetadataRecords(
      [rec('FTL-OLD001', { tool_id: 'd 249' })],
      [tool('FTL-NEW001', { tool_id: 'D-249' })],
    );
    expect(out[0].reason).toBe('ghost');
  });

  it('classifies as stale when nothing else claims the tool_id', () => {
    const out = orphanMetadataRecords([rec('FTL-OLD001', { tool_id: 'Z-9' })], [tool('FTL-X', { tool_id: 'A-1' })]);
    expect(out[0].reason).toBe('stale');
    expect(out[0].twinId).toBeNull();
  });

  it('flags a tool_type that is not a real tool type', () => {
    const out = orphanMetadataRecords([
      rec('FTL-P', { tool_type: 'probe' }),
      rec('FTL-D', { tool_type: 'drill' }),
    ], []);
    expect(out.find(o => o.id === 'FTL-P').invalidType).toBe(true);
    expect(out.find(o => o.id === 'FTL-D').invalidType).toBe(false);
  });

  it('is a no-op on a clean library', () => {
    const tools = [tool('FTL-A'), tool('FTL-B')];
    const meta = [rec('FTL-A'), rec('FTL-B'), rec('FTL-C', { no_fusion_link: true })];
    expect(orphanMetadataRecords(meta, tools)).toEqual([]);
  });
});

describe('orphanImpact', () => {
  it('counts the machine numbers an orphan is squatting on', () => {
    const orphans = orphanMetadataRecords(
      [rec('FTL-O1', { machine_tool_number: 77, assemblies: [{}] }),
       rec('FTL-O2', { machine_tool_number: 1, assemblies: [{}, {}] })],
      [tool('FTL-L1', { machine_tool_number: 77 })],
    );
    const impact = orphanImpact(orphans, [tool('FTL-L1', { machine_tool_number: 77 })], { machineStart: 30 });
    expect(impact.clashes).toBe(1);      // T77 collides with a live tool
    expect(impact.belowStart).toBe(1);   // T1 is below the start of 30
    expect(impact.danglingRefs).toBe(3); // 1 + 2 assemblies
    expect(impact.total).toBe(2);
  });
});

describe('assemblyOohIssues', () => {
  it('reports an assembly sticking out less than the tool minimum', () => {
    const out = assemblyOohIssues([tool('FTL-A', {
      tool_id: 'D-209', min_ooh: 1.51, assemblies: [{ assembly_id: 'a', ooh: 1.5 }],
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].delta).toBeCloseTo(0.01, 6);
  });

  it('leaves an assembly that sticks out further alone — the floor is a minimum', () => {
    const out = assemblyOohIssues([tool('FTL-A', {
      min_ooh: 1.0, assemblies: [{ ooh: 2.5 }, { ooh: 1.0 }],
    })]);
    expect(out).toEqual([]);
  });

  it('does not fire on float noise', () => {
    const out = assemblyOohIssues([tool('FTL-A', {
      min_ooh: 1.51, assemblies: [{ ooh: 1.5099999999 }],
    })]);
    expect(out).toEqual([]);
  });

  // A millimetre tool's tolerance is 25.4x an inch tool's; using the inch
  // epsilon on a mm tool would report noise as a violation.
  it('uses the tool\'s own unit for the tolerance', () => {
    const mm = tool('FTL-M', { unit: 'millimeters', min_ooh: 38.1, assemblies: [{ ooh: 38.095 }] });
    expect(assemblyOohIssues([mm])).toEqual([]);
    const real = tool('FTL-M', { unit: 'millimeters', min_ooh: 38.1, assemblies: [{ ooh: 36.0 }] });
    expect(assemblyOohIssues([real])).toHaveLength(1);
  });

  it('ignores a tool with no min_ooh', () => {
    expect(assemblyOohIssues([tool('FTL-A', { assemblies: [{ ooh: 0.2 }] })])).toEqual([]);
  });
});

describe('floorAssemblyOoh', () => {
  it('raises a below-floor assembly to the minimum', () => {
    const t = tool('FTL-A', { min_ooh: 1.51, assemblies: [{ assembly_id: 'a', ooh: 1.5 }] });
    expect(floorAssemblyOoh(t).assemblies[0].ooh).toBe(1.51);
  });

  it('never lowers a longer, proven stickout', () => {
    const t = tool('FTL-A', { min_ooh: 1.0, assemblies: [{ ooh: 2.5 }, { ooh: 0.9 }] });
    const next = floorAssemblyOoh(t);
    expect(next.assemblies[0].ooh).toBe(2.5);
    expect(next.assemblies[1].ooh).toBe(1.0);
  });

  // Callers use identity to decide whether there is anything to persist — a
  // fresh object every time would make every tool look dirty forever.
  it('returns the SAME reference when nothing moves', () => {
    const t = tool('FTL-A', { min_ooh: 1.0, assemblies: [{ ooh: 1.2 }] });
    expect(floorAssemblyOoh(t)).toBe(t);
  });

  it('is idempotent — a second pass has nothing to do', () => {
    const t = tool('FTL-A', { min_ooh: 1.51, assemblies: [{ ooh: 1.5 }] });
    const once = floorAssemblyOoh(t);
    expect(floorAssemblyOoh(once)).toBe(once);
  });

  // The flag must be clearable by the action that fixes it, or it is a nag loop.
  it('the fix makes the detector stop firing', () => {
    const t = tool('FTL-A', { min_ooh: 1.51, assemblies: [{ ooh: 1.5 }, { ooh: 1.2 }] });
    expect(assemblyOohIssues([t])).toHaveLength(2);
    expect(assemblyOohIssues([floorAssemblyOoh(t)])).toEqual([]);
  });
});

describe('isNotableOohDelta', () => {
  it('treats 0.05in as notable on an inch tool', () => {
    expect(isNotableOohDelta(0.06, 'inches')).toBe(true);
    expect(isNotableOohDelta(0.01, 'inches')).toBe(false);
  });

  // A bare 0.05 would call two thou on a millimetre tool "significant".
  it('scales the threshold for a millimetre tool', () => {
    expect(isNotableOohDelta(0.05, 'millimeters')).toBe(false);
    expect(isNotableOohDelta(2.0, 'millimeters')).toBe(true);   // 0.079in
  });
});

describe('descriptionLocMismatches', () => {
  const t = (over) => tool('FTL-A', { tool_id: 'A-1', ...over });

  // The whole reason this check exists: a length written into the wrong field.
  it('catches a flute length that cannot belong to the tool', () => {
    const out = descriptionLocMismatches([t({
      description: '3/64 (.047) 5FL EM .071LOC P C6', flute_length: 1.9,
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].stated).toBeCloseTo(0.071, 6);
    expect(out[0].stored).toBe(1.9);
  });

  // A naive \d+ pattern reads "3/16 LOC" as 16 and reports every fractional
  // description in the library as a wild mismatch.
  it('reads a fraction as a fraction, not as its denominator', () => {
    expect(descriptionLocMismatches([t({ description: '1/16Ø Ball 3/16 LOC', flute_length: 0.1875 })])).toEqual([]);
    expect(descriptionLocMismatches([t({ description: '3/8 EM 4FL 7/8 LOC', flute_length: 0.875 })])).toEqual([]);
  });

  it('accepts a decimal LOC written with no space', () => {
    expect(descriptionLocMismatches([t({ description: '1/32 Ball 1/8LOC 4 fl', flute_length: 0.125 })])).toEqual([]);
  });

  it('stays quiet when the description states no LOC', () => {
    expect(descriptionLocMismatches([t({ description: '3/8 Endmill', flute_length: 1.9 })])).toEqual([]);
  });

  // A pairing's description names the assembled unit; flute_length is the
  // insert's. They differ by design, so reporting them is a row nobody can clear.
  it('skips an insert-style pairing', () => {
    const out = descriptionLocMismatches([t({
      description: '3/4Ø High feed indexable body 2.0 LOC', flute_length: 0.03,
      pairing: { family: 'generic_insert' },
    })]);
    expect(out).toEqual([]);
  });

  it('tolerates rounding', () => {
    expect(descriptionLocMismatches([t({ description: '.75 LOC EM', flute_length: 0.752 })])).toEqual([]);
  });
});

describe('geometryChainIssues', () => {
  it('collects the tools a validator reports on', () => {
    const validate = (x) => (x.tool_id === 'BAD' ? [{ message: 'shoulder > MIN OOH' }] : []);
    const out = geometryChainIssues([tool('FTL-A', { tool_id: 'BAD' }), tool('FTL-B', { tool_id: 'OK' })], validate);
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual(['shoulder > MIN OOH']);
  });

  it('is empty on a clean library', () => {
    expect(geometryChainIssues([tool('FTL-A')], () => [])).toEqual([]);
  });
});

describe('oohIssuesByTool', () => {
  it('groups by tool so the write path gets tools, not assemblies', () => {
    const issues = assemblyOohIssues([
      tool('FTL-A', { min_ooh: 1.0, assemblies: [{ ooh: 0.8 }, { ooh: 0.9 }] }),
      tool('FTL-B', { min_ooh: 2.0, assemblies: [{ ooh: 1.0 }] }),
    ]);
    const grouped = oohIssuesByTool(issues);
    expect(grouped.get('FTL-A')).toHaveLength(2);
    expect(grouped.get('FTL-B')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TWO ASSEMBLIES THAT ARE THE SAME ASSEMBLY.
//
// A logical tool's instances differ ONLY by holder and OOH, so two agreeing on
// both are one setup recorded twice — and the tool sits in Fusion two or three
// times identically. `classifyStrays` classifies a duplicate only among STRAYS;
// these are properly registered, so nothing in the app could see them.
//
// Measured on the shop's real library: 10 groups on 10 tools, 11 redundant
// assemblies, 0 preset links lost, second run a no-op.
// ─────────────────────────────────────────────────────────────────────────────
const asm = (over = {}) => ({
  assembly_id: `a-${Math.random().toString(16).slice(2, 8)}`,
  instance_guid: `g-${Math.random().toString(16).slice(2, 8)}`,
  holder_id: 'h1', holder_guid: 'hg1', holder_description: 'NBT30-SK13C-90',
  ooh: 1.5, linked_preset_guids: [], notes: '', ...over,
});
const HOLDERS = [
  { id: 'h1', description: 'NBT30-SK13C-90', fusion_guid: 'hg1' },
  { id: 'h2', description: 'NBT30-SK13C-60', fusion_guid: 'hg2' },
];

describe('duplicateAssemblyIssues', () => {
  it('finds a same-holder same-stickout pair', () => {
    const t = tool('T1', { tool_id: 'A-50', assemblies: [asm(), asm()] });
    const [i] = duplicateAssemblyIssues([t], HOLDERS);
    expect(i.count).toBe(2);
    expect(i.tool_id).toBe('A-50');
  });

  it('leaves a different stickout alone — that is a real second setup', () => {
    const t = tool('T1', { assemblies: [asm({ ooh: 1.5 }), asm({ ooh: 2.0 })] });
    expect(duplicateAssemblyIssues([t], HOLDERS)).toHaveLength(0);
  });

  it('leaves a different holder alone', () => {
    const t = tool('T1', {
      assemblies: [asm(), asm({ holder_id: 'h2', holder_guid: 'hg2', holder_description: 'NBT30-SK13C-60' })],
    });
    expect(duplicateAssemblyIssues([t], HOLDERS)).toHaveLength(0);
  });

  // ⚠️ THE CASE A RAW-GUID COMPARE MISSES. Fusion re-issues holder guids, so the
  // same physical holder appears under two guids on one tool — one assembly with
  // a live FK, the other with a guid that resolves to nothing. This is A-253.
  it('groups a live FK with an assembly whose guid resolves to nothing', () => {
    const t = tool('T1', {
      assemblies: [
        asm({ holder_id: 'h1', holder_guid: 'hg1' }),
        asm({ holder_id: null, holder_guid: 'dead-guid', holder_description: 'NBT30-SK13C-90' }),
      ],
    });
    expect(duplicateAssemblyIssues([t], HOLDERS)[0].count).toBe(2);
  });

  // Two DISTINCT records are two distinct holders even when their descriptions
  // agree — merging there would paper over a holder-library duplicate.
  it('does NOT group two different records that share a description', () => {
    const holders = [
      { id: 'h1', description: 'NBT30-SK13C-90', fusion_guid: 'hg1' },
      { id: 'hDUP', description: 'NBT30-SK13C-90', fusion_guid: 'hgDUP' },
    ];
    const t = tool('T1', {
      assemblies: [asm({ holder_id: 'h1' }), asm({ holder_id: 'hDUP', holder_guid: 'hgDUP' })],
    });
    expect(duplicateAssemblyIssues([t], holders)).toHaveLength(0);
  });

  it('float noise does not split a pair', () => {
    const t = tool('T1', { assemblies: [asm({ ooh: 1.5 }), asm({ ooh: 1.5000001 })] });
    expect(duplicateAssemblyIssues([t], HOLDERS)[0].count).toBe(2);
  });

  it('groups three, and counts the preset links a merge would carry over', () => {
    const t = tool('T1', {
      assemblies: [asm(), asm({ linked_preset_guids: ['p1'] }), asm({ linked_preset_guids: ['p2'] })],
    });
    const [i] = duplicateAssemblyIssues([t], HOLDERS);
    expect(i.count).toBe(3);
    expect(i.presetsMoved).toBe(2);
    expect(duplicateAssemblyIssuesByTool([i]).size).toBe(1);
  });

  it('reports in the tool\'s own unit', () => {
    const t = tool('T1', { unit: 'millimeters', assemblies: [asm({ ooh: 38.1 }), asm({ ooh: 38.1 })] });
    expect(describeDuplicateAssembly(duplicateAssemblyIssues([t], HOLDERS)[0])).toContain('mm');
  });
});

describe('dedupeAssemblies', () => {
  it('collapses the group and keeps every preset link', () => {
    const t = tool('T1', {
      assemblies: [asm({ linked_preset_guids: ['p1'] }), asm({ linked_preset_guids: ['p2'] })],
    });
    const next = dedupeAssemblies(t, HOLDERS);
    expect(next.assemblies).toHaveLength(1);
    expect(next.assemblies[0].linked_preset_guids.sort()).toEqual(['p1', 'p2']);
  });

  it('returns the SAME reference when nothing merges', () => {
    const t = tool('T1', { assemblies: [asm({ ooh: 1.5 }), asm({ ooh: 2.0 })] });
    expect(dedupeAssemblies(t, HOLDERS)).toBe(t);
  });

  it('is idempotent', () => {
    const t = tool('T1', { assemblies: [asm(), asm(), asm()] });
    const once = dedupeAssemblies(t, HOLDERS);
    expect(once.assemblies).toHaveLength(1);
    expect(dedupeAssemblies(once, HOLDERS)).toBe(once);
  });

  // ⚠️ The presetter reading is the IMMUTABLE physical record of a real
  // assembly. Keeping the first blindly would drop it for a copy that has none.
  it('keeps the assembly carrying a presetter measurement, not merely the first', () => {
    const measured = asm({ measured_gauge_length: 6.2, measured_by: 'dan' });
    const t = tool('T1', { assemblies: [asm(), measured] });
    const next = dedupeAssemblies(t, HOLDERS);
    expect(next.assemblies[0].measured_gauge_length).toBe(6.2);
  });

  it('REFUSES to merge two different presetter measurements', () => {
    const t = tool('T1', {
      assemblies: [asm({ measured_gauge_length: 6.2 }), asm({ measured_gauge_length: 6.4 })],
    });
    expect(dedupeAssemblies(t, HOLDERS)).toBe(t);
    const [i] = duplicateAssemblyIssues([t], HOLDERS);
    expect(i.blocked).toBe(true);            // still REPORTED, just not merged
    expect(i.blockedWhy).toMatch(/presetter/);
  });

  it('REFUSES to merge conflicting notes rather than picking one', () => {
    const t = tool('T1', { assemblies: [asm({ notes: 'runs hot' }), asm({ notes: 'use tap collet' })] });
    expect(dedupeAssemblies(t, HOLDERS)).toBe(t);
    expect(duplicateAssemblyIssues([t], HOLDERS)[0].blocked).toBe(true);
  });

  it('carries notes over when only one side has them', () => {
    const t = tool('T1', { assemblies: [asm(), asm({ notes: 'runs hot' })] });
    expect(dedupeAssemblies(t, HOLDERS).assemblies[0].notes).toBe('runs hot');
  });

  it('unions retired assembly numbers — they stay searchable', () => {
    const t = tool('T1', {
      assemblies: [asm({ legacy_asm_numbers: ['RTA-1'] }), asm({ legacy_asm_numbers: ['RTA-2'] })],
    });
    expect(dedupeAssemblies(t, HOLDERS).assemblies[0].legacy_asm_numbers.sort()).toEqual(['RTA-1', 'RTA-2']);
  });
});
