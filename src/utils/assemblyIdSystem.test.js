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
  it('uses the existing holderShortName (30-SK13-60), Tool ID, and OOH', () => {
    expect(composeAsmNumber(cfg, { separator: '-' }, {
      holderDescription: 'NBT30-SK13C-60', tool_id: '1001', ooh: 2.125,
    })).toBe('30-SK13-60-1001-2.125');
  });
  it('falls back to last 6 of the assembly UUID when no tool_id', () => {
    const out = composeAsmNumber(cfg, { separator: '-' }, {
      holderDescription: 'NBT30-SK20C-90', ooh: 1.875, assembly_id: 'abcdef12-3456-7890-aaaa-bbbbccccdddd',
    });
    expect(out).toBe('30-SK20-90-ccdddd-1.875');
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
    expect(auto).toBe('30-SK13-60-1001-2.125');
  });
  it('retires an externally-assigned value (RTA# ≠ Auto)', () => {
    expect(shouldRetireAsmNumber('RTA-1234', auto)).toBe(true);
  });
  it('does NOT retire a re-derivable Auto value', () => {
    expect(shouldRetireAsmNumber('30-SK13-60-1001-2.125', auto)).toBe(false);
  });
  it('never retires an empty old value', () => {
    expect(shouldRetireAsmNumber('', auto)).toBe(false);
    expect(shouldRetireAsmNumber(null, auto)).toBe(false);
  });
});

describe('backfillAsmNumbers', () => {
  const shop = { assembly_id_system: { mode: 'auto', separator: null }, tool_id_system: { separator: '-' } };
  it('fills auto asm_number for assemblies missing one, leaves existing untouched', () => {
    const tools = [{
      tool_id: '1001',
      assemblies: [
        { assembly_id: 'a', holder_description: 'NBT30-SK13C-60', ooh: 2.125 },
        { assembly_id: 'b', holder_description: 'NBT30-SK13C-90', ooh: 3, asm_number: 'KEEP-ME' },
      ],
    }];
    const out = backfillAsmNumbers(tools, shop);
    expect(out[0].assemblies[0].asm_number).toBe('30-SK13-60-1001-2.125');
    expect(out[0].assemblies[1].asm_number).toBe('KEEP-ME');
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
    expect(out[0].assemblies[0].asm_number).toBe('30-SK13-60-1001+1042-2.125');
  });
});
