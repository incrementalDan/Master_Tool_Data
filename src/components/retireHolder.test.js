// Retiring a holder — the two rules that keep the library from getting messy.
//
// A retired record is invisible to `resolveHolderForWrite`, so any tool left
// pointing at one silently reverts to Fusion's geometry on its next save. That
// makes "which tools use this" a load-bearing question, and it has two answers
// that must never be confused: the real one, and the one you get before the
// tool library has been normalized.

import { describe, it, expect } from 'vitest';
import { assembliesUsing } from './RetireHolderModal.jsx';

const REC = { id: 'h1', holder_ref: 'HLD-000001', description: 'NBT30-SK13C-60',
  fusion_guid: 'g-fusion-1', segments: [], unit: 'inches' };
const OTHER = { id: 'h2', holder_ref: 'HLD-000002', description: 'NBT30-SK13C-90' };

const tool = (id, assemblies) => ({ id, description: `tool ${id}`, assemblies });

describe('who is left without a holder', () => {
  it('finds assemblies by the FK', () => {
    const tools = [
      tool('t1', [{ assembly_id: 'a1', holder_id: 'h1' }]),
      tool('t2', [{ assembly_id: 'a2', holder_id: 'h2' }]),
    ];
    expect(assembliesUsing(REC, tools).map(u => u.tool.id)).toEqual(['t1']);
  });

  // The FK is the authority, but a tool that predates linking only carries the
  // baked guid. Missing those would under-report exactly the tools at risk.
  it('also finds one that only carries the baked Fusion guid', () => {
    const tools = [tool('t3', [{ assembly_id: 'a3', holder_guid: 'g-fusion-1' }])];
    expect(assembliesUsing(REC, tools)).toHaveLength(1);
  });

  it('counts every assembly, not every tool — a tool can use it twice', () => {
    const tools = [tool('t4', [
      { assembly_id: 'a4', holder_id: 'h1' },
      { assembly_id: 'a5', holder_id: 'h1' },
      { assembly_id: 'a6', holder_id: 'h2' },
    ])];
    expect(assembliesUsing(REC, tools)).toHaveLength(2);
  });

  // ⚠️ THE REASON RETIRE IS BLOCKED BEFORE NORMALIZE. An un-normalized library
  // has no assemblies to read, so the honest answer is "unknown" — but the
  // count returns 0, which reads as "safe to retire, nothing uses it". The gate
  // exists because those two are indistinguishable from here.
  it('reports zero for a library with no assemblies yet — which is why the gate exists', () => {
    const preNormalize = [{ id: 't5', description: 'untracked', assemblies: [] }];
    expect(assembliesUsing(REC, preNormalize)).toHaveLength(0);
  });

  it('ignores an assembly on a different holder', () => {
    expect(assembliesUsing(OTHER, [tool('t6', [{ assembly_id: 'a7', holder_id: 'h1' }])]))
      .toHaveLength(0);
  });
});
