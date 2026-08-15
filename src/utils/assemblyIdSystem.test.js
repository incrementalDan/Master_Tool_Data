import { describe, it, expect } from 'vitest';
import {
  composeAsmNumber, trimOoh, nextAsmSerial, usedAsmSerials,
  resolveAsmSeparator, backfillAsmNumbers, autoAsmNumber, shouldRetireAsmNumber,
} from './assemblyIdSystem.js';

describe('trimOoh', () => {
  it('drops trailing zeros, keeps significant decimals', () => {
    expect(trimOoh(2.125)).toBe('2.125');
    expect(trimOoh(2.5)).toBe('2.5');
    expect(trimOoh(2.0)).toBe('2');
    expect(trimOoh(null)).toBe('');
  });
});

describe('resolveAsmSeparator', () => {
  it('inherits the tool-id separator when its own is null', () => {
    expect(resolveAsmSeparator({ separator: null }, { separator: '.' })).toBe('.');
    expect(resolveAsmSeparator({ separator: '_' }, { separator: '.' })).toBe('_');
    expect(resolveAsmSeparator({ separator: null }, {})).toBe('-');
  });
});

describe('composeAsmNumber — auto', () => {
  const cfg = { mode: 'auto', separator: null };
  it('uses the holder DESCRIPTION, Tool ID, and OOH', () => {
    expect(composeAsmNumber(cfg, { separator: '-' }, {
      holderDescription: 'NBT30-SK13C-60', tool_id: '1001', ooh: 2.125,
    })).toBe('NBT30-SK13C-60-1001-2.125');
  });
  it('falls back to last 6 of the assembly UUID when no tool_id', () => {
    const out = composeAsmNumber(cfg, { separator: '-' }, {
      holderDescription: 'NBT30-SK20C-90', ooh: 1.875, assembly_id: 'abcdef12-3456-7890-aaaa-bbbbccccdddd',
    });
    expect(out).toBe('NBT30-SK20C-90-ccdddd-1.875');
  });
  it('omits empty pieces', () => {
    expect(composeAsmNumber(cfg, { separator: '-' }, { holderDescription: '', tool_id: 'T30', ooh: 2.5 }))
      .toBe('T30-2.5');
  });
});

describe('composeAsmNumber — other modes', () => {
  it('sequential returns the serial; rta/erp return empty (not auto-generated)', () => {
    expect(composeAsmNumber({ mode: 'sequential' }, {}, {}, 10000)).toBe('10000');
    expect(composeAsmNumber({ mode: 'proshop_rta' }, {}, { tool_id: '1' })).toBe('');
    expect(composeAsmNumber({ mode: 'erp_external' }, {}, { tool_id: '1' })).toBe('');
  });
});

describe('serial helpers', () => {
  it('collects only plain-integer asm_numbers and picks the next free one', () => {
    const tools = [{ assemblies: [{ asm_number: '10000' }, { asm_number: '30-SK13-60-1-2' }] }, { assemblies: [{ asm_number: '10001' }] }];
    const used = usedAsmSerials(tools);
    expect(used.has(10000)).toBe(true);
    expect(used.has(10001)).toBe(true);
    expect(nextAsmSerial(10000, used)).toBe(10002);
  });
});

describe('retirement — digital reference vs. re-derivable Auto', () => {
  const asm = { holderDescription: 'NBT30-SK13C-60', tool_id: '1001', ooh: 2.125 };
  const auto = autoAsmNumber({ mode: 'proshop_rta', separator: null }, { separator: '-' }, asm);

  it('autoAsmNumber composes the Auto value regardless of the active mode', () => {
    expect(auto).toBe('NBT30-SK13C-60-1001-2.125');
  });
  it('retires an externally-assigned value (RTA# ≠ Auto)', () => {
    expect(shouldRetireAsmNumber('RTA-1234', auto)).toBe(true);
  });
  it('does NOT retire a re-derivable Auto value', () => {
    expect(shouldRetireAsmNumber('NBT30-SK13C-60-1001-2.125', auto)).toBe(false);
  });
  it('never retires an empty old value', () => {
    expect(shouldRetireAsmNumber('', auto)).toBe(false);
    expect(shouldRetireAsmNumber(null, auto)).toBe(false);
  });
});

describe('backfillAsmNumbers', () => {
  const shop = { assembly_id_system: { mode: 'auto', separator: null }, tool_id_system: { separator: '-' } };
  it('fills a missing auto asm_number, and CORRECTS a stale one', () => {
    // An Auto number is purely derived and has no edit UI in this mode, so a
    // stored value that no longer matches the fields is stale, not custom —
    // e.g. the OOH was changed in Fusion, or the tool was re-numbered.
    const tools = [{
      tool_id: '1001',
      assemblies: [
        { assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125 },
        { assembly_id: 'b', holder_description: 'NBT30-SK13C-90', ooh: 3, asm_number: 'NBT30-SK13C-90-1001-2.5' },
      ],
    }];
    const out = backfillAsmNumbers(tools, shop);
    expect(out[0].assemblies[0].asm_number).toBe('NBT30-SK13C-60-1001-2.125'); // filled
    expect(out[0].assemblies[1].asm_number).toBe('NBT30-SK13C-90-1001-3');     // corrected
    expect(out[0]._asmNumbersFixed).toEqual([          // reports old → new, not just a count
      { from: 'NBT30-SK13C-90-1001-2.5', to: 'NBT30-SK13C-90-1001-3' },
    ]);
  });

  it('is idempotent and raises no flag when every number is already correct', () => {
    const tools = [{
      tool_id: '1001',
      assemblies: [{ assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125, asm_number: 'NBT30-SK13C-60-1001-2.125' }],
    }];
    const out = backfillAsmNumbers(tools, shop);
    expect(out).toBe(tools);                        // untouched reference
    expect(out[0]._asmNumbersFixed).toBeUndefined();
  });

  it('never touches numbers in a non-derived mode (ProShop RTA)', () => {
    const tools = [{
      tool_id: '1001',
      assemblies: [{ assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125, asm_number: 'RTA-77' }],
    }];
    const rta = { ...shop, assembly_id_system: { ...shop.assembly_id_system, mode: 'proshop_rta' } };
    expect(backfillAsmNumbers(tools, rta)).toBe(tools);
  });
  it('is a no-op for non-auto modes', () => {
    const tools = [{ tool_id: '1', assemblies: [{ assembly_id: 'a', holder_description: 'X', ooh: 1 }] }];
    expect(backfillAsmNumbers(tools, { assembly_id_system: { mode: 'sequential' } })).toBe(tools);
  });

  // F2: a tier-3 paired tool whose components aren't linked yet must NOT bake the
  // combined slash tool_id into an immutable Auto number — leave it unstamped so
  // the real "{holder}+{insert}" token composes once the components link.
  it('does not stamp a tier-3 paired tool with unlinked components', () => {
    const tools = [{
      tool_id: 'I-167/G-168', tool_type: 'face mill',
      pairing: { family: 'milling_insert', holder_component_id: null, insert_component_id: null },
      assemblies: [{ assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125 }],
    }];
    const out = backfillAsmNumbers(tools, shop);
    // Unchanged reference — nothing stamped (would otherwise be the slash form).
    expect(out).toBe(tools);
    expect(out[0].assemblies[0].asm_number).toBeUndefined();
  });

  it('stamps the both-ids token once a tier-3 pairing is linked to components', () => {
    const components = [
      { id: 'h', role: 'holder_body', tool_id: '1001' },
      { id: 'i', role: 'insert', tool_id: '1042' },
    ];
    const tools = [{
      tool_id: 'I-167/G-168', tool_type: 'face mill',
      pairing: { family: 'milling_insert', holder_component_id: 'h', insert_component_id: 'i' },
      assemblies: [{ assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125 }],
    }];
    const out = backfillAsmNumbers(tools, shop, { components });
    expect(out[0].assemblies[0].asm_number).toBe('NBT30-SK13C-60-1001+1042-2.125');
  });
});

describe('backfillAsmNumbers — no FALSE "out of date" flags', () => {
  const shopAuto = { assembly_id_system: { mode: 'auto' }, tool_id_system: { separator: '-' } };

  it('resolves the holder from the LIBRARY when the cached description is blank', () => {
    // The stamper (writeLogicalTool) falls back to the holder library by guid.
    // If this checker didn't, the two would compose different numbers and the
    // flag would fire on every load and could never be saved away.
    const tools = [{
      tool_id: '1001',
      assemblies: [{
        assembly_id: 'a', holder_guid: 'H1', holder_description: '', ooh: 1.4,
        asm_number: 'NBT30-SK13C-150-1001-1.4',
      }],
    }];
    const holders = [{ guid: 'H1', description: 'NBT30-SK13C-150' }];
    const out = backfillAsmNumbers(tools, shopAuto, null, holders);
    expect(out).toBe(tools);                        // nothing to correct
    expect(out[0]._asmNumbersFixed).toBeUndefined();
  });

  it('float noise in the OOH does not produce a spurious mismatch', () => {
    // Fusion's geometry.LB can arrive as 1.4000000000000001; a raw String()
    // would compose "…-1.4000000000000001" and never match.
    const tools = [{
      tool_id: 'M-132',
      assemblies: [{
        assembly_id: 'a', holder_description: 'NBT30-SK13C-150',
        ooh: 1.4000000000000001, asm_number: 'NBT30-SK13C-150-M-132-1.4',
      }],
    }];
    const out = backfillAsmNumbers(tools, shopAuto, null, []);
    expect(out).toBe(tools);
    expect(out[0]._asmNumbersFixed).toBeUndefined();
  });
});
