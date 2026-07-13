import { describe, it, expect } from 'vitest';
import { sharedSignature, instanceSig, classifyStrays, hasReconcileWork } from './reconcile.js';

// A raw Fusion library entry, minimal but realistic. Per-instance knobs:
// guid, holder guid, OOH (geometry.LB). Shared knobs: description, DC, preset feed.
const rawEntry = ({
  guid, holderGuid = 'H1', lb = 2.0,
  desc = '1/2 4FL EM', dc = 0.5, feed = 100,
} = {}) => ({
  guid,
  type: 'flat end mill',
  description: desc,
  'product-id': 'A-1',
  BMC: 'carbide',
  geometry: { DC: dc, LCF: 1, OAL: 3, NOF: 4, LB: lb, assemblyGaugeLength: 4 + lb },
  holder: { guid: holderGuid, description: 'BT30 ER16 2.5' },
  'start-values': { presets: [{ name: 'AL Rough', n: 8000, v_f: feed }] },
});

describe('sharedSignature — what counts as "the same tool"', () => {
  it('ignores per-instance holder, OOH, and assemblyGaugeLength', () => {
    const a = rawEntry({ guid: 'g1', holderGuid: 'H1', lb: 2.0 });
    const b = rawEntry({ guid: 'g2', holderGuid: 'H2', lb: 2.75 });
    expect(sharedSignature(a)).toBe(sharedSignature(b));
  });

  it('changes when a genuinely shared field changes (geometry, preset speeds)', () => {
    const base = rawEntry({ guid: 'g1' });
    expect(sharedSignature(rawEntry({ guid: 'g3', dc: 0.375 }))).not.toBe(sharedSignature(base));
    expect(sharedSignature(rawEntry({ guid: 'g4', feed: 150 }))).not.toBe(sharedSignature(base));
  });

  it('ignores loosely-controlled fields that resolve by rule (description, OAL, shoulder)', () => {
    const base = rawEntry({ guid: 'g1' });
    // A " (copy)" or other description difference must NOT force a conflict — it
    // resolves by rule (keep primary), so the shared signature is unchanged.
    expect(sharedSignature(rawEntry({ guid: 'g2', desc: '1/2 4FL EM (copy)' }))).toBe(sharedSignature(base));
    // OAL (biggest wins) and shoulder-length (smallest wins) are likewise excluded.
    const oalDiff = rawEntry({ guid: 'g3' }); oalDiff.geometry.OAL = 3.5;
    expect(sharedSignature(oalDiff)).toBe(sharedSignature(base));
    const shoulderDiff = rawEntry({ guid: 'g4' }); shoulderDiff.geometry['shoulder-length'] = 1.2;
    expect(sharedSignature(shoulderDiff)).toBe(sharedSignature(base));
  });

  it('is GUID-independent (a copied entry with a new guid still matches)', () => {
    expect(sharedSignature(rawEntry({ guid: 'g1' }))).toBe(sharedSignature(rawEntry({ guid: 'copy' })));
  });
});

describe('instanceSig', () => {
  it('is the (holder, OOH) pair', () => {
    expect(instanceSig(rawEntry({ guid: 'g1', holderGuid: 'H1', lb: 2 })))
      .toBe(instanceSig(rawEntry({ guid: 'g2', holderGuid: 'H1', lb: 2 })));
    expect(instanceSig(rawEntry({ guid: 'g1', holderGuid: 'H1', lb: 2 })))
      .not.toBe(instanceSig(rawEntry({ guid: 'g2', holderGuid: 'H2', lb: 2 })));
    expect(instanceSig(rawEntry({ guid: 'g1', holderGuid: 'H1', lb: 2 })))
      .not.toBe(instanceSig(rawEntry({ guid: 'g2', holderGuid: 'H1', lb: 2.5 })));
  });
});

describe('classifyStrays — entries dumped into Fusion outside the app', () => {
  const canonical = rawEntry({ guid: 'known-1', holderGuid: 'H1', lb: 2.0 });
  const registered = [{ instance_guid: 'known-1', holder_guid: 'H1', ooh: 2.0 }];

  it('identical copy of a registered assembly → duplicate (offer delete)', () => {
    const copy = rawEntry({ guid: 'stray-1', holderGuid: 'H1', lb: 2.0 });
    const res = classifyStrays({
      matchingRaws: [canonical, copy],
      registeredAssemblies: registered,
      canonicalRaw: canonical,
    });
    expect(res.duplicates.map(d => d.guid)).toEqual(['stray-1']);
    expect(res.newAssemblies).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('same tool, new holder/OOH → newAssembly (offer add or delete)', () => {
    const newSetup = rawEntry({ guid: 'stray-2', holderGuid: 'H2', lb: 2.75 });
    const res = classifyStrays({
      matchingRaws: [canonical, newSetup],
      registeredAssemblies: registered,
      canonicalRaw: canonical,
    });
    expect(res.newAssemblies.map(d => d.guid)).toEqual(['stray-2']);
    expect(res.newAssemblies[0].ooh).toBe(2.75);
    expect(res.duplicates).toEqual([]);
  });

  it('a second identical copy of a NEW setup counts as duplicate, not two new assemblies', () => {
    const newSetup = rawEntry({ guid: 'stray-2', holderGuid: 'H2', lb: 2.75 });
    const newSetupCopy = rawEntry({ guid: 'stray-3', holderGuid: 'H2', lb: 2.75 });
    const res = classifyStrays({
      matchingRaws: [canonical, newSetup, newSetupCopy],
      registeredAssemblies: registered,
      canonicalRaw: canonical,
    });
    expect(res.newAssemblies.map(d => d.guid)).toEqual(['stray-2']);
    expect(res.duplicates.map(d => d.guid)).toEqual(['stray-3']);
  });

  it('shared fields differ → conflict (manual review, never auto-resolved)', () => {
    const edited = rawEntry({ guid: 'stray-4', holderGuid: 'H1', lb: 2.0, feed: 999 });
    const res = classifyStrays({
      matchingRaws: [canonical, edited],
      registeredAssemblies: registered,
      canonicalRaw: canonical,
    });
    expect(res.conflicts.map(d => d.guid)).toEqual(['stray-4']);
    expect(res.duplicates).toEqual([]);
    expect(res.newAssemblies).toEqual([]);
  });

  it('registered instances are never flagged', () => {
    const res = classifyStrays({
      matchingRaws: [canonical],
      registeredAssemblies: registered,
      canonicalRaw: canonical,
    });
    expect(hasReconcileWork(res)).toBe(false);
  });

  it('no metadata registry → new-assembly detection is disabled (kept silently), conflicts still surface', () => {
    const newSetup = rawEntry({ guid: 'stray-5', holderGuid: 'H2', lb: 3.0 });
    // A real shared-field difference (preset feed), not just a description edit —
    // description no longer counts toward the signature.
    const edited = rawEntry({ guid: 'stray-6', holderGuid: 'H3', lb: 2.0, feed: 999 });
    const res = classifyStrays({
      matchingRaws: [canonical, newSetup, edited],
      registeredAssemblies: [],          // Drive not connected
      canonicalRaw: canonical,
    });
    expect(res.newAssemblies).toEqual([]);                       // NOT misflagged
    expect(res.conflicts.map(d => d.guid)).toEqual(['stray-6']); // real diff still caught
  });
});

describe('hasReconcileWork', () => {
  it('true only when something was flagged', () => {
    expect(hasReconcileWork({ duplicates: [], newAssemblies: [], conflicts: [] })).toBe(false);
    expect(hasReconcileWork({ duplicates: [{}], newAssemblies: [], conflicts: [] })).toBe(true);
    expect(hasReconcileWork(null)).toBe(false);
  });
});
