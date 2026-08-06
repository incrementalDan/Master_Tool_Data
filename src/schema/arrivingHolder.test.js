// ─── A tool arrives carrying OLDER holder data ──────────────────────────────
//
// The everyday case, and the one the whole holder system exists for. A holder
// is corrected here; meanwhile someone builds an assembly in Fusion, or syncs a
// job, and that tool arrives carrying the OLD frozen copy — because Fusion
// absorbed the holder at copy time and keeps no link back.
//
// Four routes in (dumped into Fusion, Sync Job, a new assembly, a whole job),
// but they converge on one question: does the app notice, and does the tool end
// up carrying the CORRECTED geometry? These assert the whole chain — link,
// flag, correct — plus the two ways it can fail to resolve at all.
//
// Every number here is measured against the real reference library.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fusionHolderToRecord } from './holderRecord.js';
import { backfillHolderIds, staleHolderTools, resolveHolderForWrite } from './holderResolve.js';
import { splitToFusionInstances } from './logicalTools.js';
import { buildHolderLinkPlan } from '../utils/holderLink.js';
import { holderConfigOf } from './holderOptions.js';

const load = (f) => JSON.parse(
  readFileSync(new URL(`../../FUSION TOOL Library REF/${f}`, import.meta.url), 'utf8')).data;
const FUSION_HOLDERS = load('Master-Holder.json');
const TOOLS = load('Full_Type_List Examples.json').filter(t => t.holder?.segments?.length);
const CFG = holderConfigOf(null);

const base = FUSION_HOLDERS.find(h => h.description?.includes('SK13C-60'));

// The record, CORRECTED in the app: segment 0 is 8mm taller than Fusion's copy
// — the size of difference the user actually reports for a redraw.
// ⚠️ Build the list ONCE: fusionHolderToRecord mints a new id per call, so
// correcting a separately-built record would leave it absent from the library.
const ALL = FUSION_HOLDERS.map(fusionHolderToRecord);
const IDX = ALL.findIndex(r => r.description === base.description);
const CORRECTED = {
  ...ALL[IDX],
  segments: ALL[IDX].segments.map((s, i) => (i === 0 ? { ...s, height: (s.height || 0) + 8 } : s)),
};
const RECORDS = ALL.map((r, i) => (i === IDX ? CORRECTED : r));
const OLD_H = base.segments[0].height;
const NEW_H = CORRECTED.segments[0].height;

const incoming = TOOLS[0];
// A tool as it lands: the OLD holder baked in, and no holder_id — nothing has
// linked it yet, whichever route it came in by.
const arriving = (over = {}, baked = { ...base }) => ({
  id: 'FTL-NEW', tracking_id: 'FTL-NEW', tool_type: 'flat end mill',
  unit: incoming.unit || 'inches', description: 'freshly synced tool',
  assemblies: [{ assembly_id: 'a1', instance_guid: incoming.guid,
    holder_guid: baked.guid, holder_description: baked.description, ooh: 1.0, ...over }],
  _instancesRaw: [{ ...incoming, holder: baked }],
});
const seg0 = (t, records = RECORDS) =>
  splitToFusionInstances(t, FUSION_HOLDERS, records).fusionInstances[0].holder?.segments?.[0]?.height;

describe('a tool arrives carrying older holder data', () => {
  it('is linked to the corrected record even though its shape no longer matches', () => {
    // The shape tier can't help — the baked copy is the OLD geometry. The guid
    // is the fallback that carries it, which is the one job the guid still has.
    const after = backfillHolderIds([arriving()], RECORDS);
    expect(after[0].assemblies[0].holder_id).toBe(CORRECTED.id);
  });

  it('is FLAGGED as carrying older geometry — the correction is never silent', () => {
    const after = backfillHolderIds([arriving()], RECORDS);
    expect(staleHolderTools(after, { records: RECORDS, fusionHolders: FUSION_HOLDERS }))
      .toHaveLength(1);
  });

  it('carries the CORRECTED geometry on its next write, not the copy it arrived with', () => {
    const after = backfillHolderIds([arriving()], RECORDS);
    expect(seg0(after[0])).toBe(NEW_H);
    expect(NEW_H).not.toBe(OLD_H);            // the test would pass vacuously otherwise
  });

  // Sync Job commits through mergeTool → writeLogicalTool, which runs BEFORE
  // any load-time backfill: the assembly it creates carries holder_guid and no
  // holder_id (DiffStep). So the write path must resolve on the guid alone —
  // otherwise a synced job would push the old holder straight back into Fusion.
  it('a Sync Job commit corrects it at commit time, with no FK stored yet', () => {
    expect(arriving().assemblies[0].holder_id).toBeUndefined();
    expect(seg0(arriving())).toBe(NEW_H);
  });

  // Both ways it can fail to resolve. Neither is silent, and neither blanks the
  // holder the tool already carries.
  it('a guid Fusion has since re-issued leaves it for the link worklist', () => {
    const t = arriving({ holder_guid: 'guid-fusion-just-invented' },
      { ...base, guid: 'guid-fusion-just-invented' });
    const after = backfillHolderIds([t], RECORDS);
    expect(after[0].assemblies[0].holder_id).toBeFalsy();
    expect(buildHolderLinkPlan(after, RECORDS, CFG).rows).toHaveLength(1);
  });

  // ─── Auto-match, but never silently when it isn't certain ─────────────────
  // Certain = BOTH signals agree: our holder_ref (baked into the holder's
  // product-id) and the segments. Anything less is still linked — nothing is
  // left dangling — but marked, listed, and changeable.

  it('both signals agreeing links silently', () => {
    const ref = CORRECTED.holder_ref;
    // The tool carries the corrected shape AND our ref → certain.
    const t = arriving({}, { ...base, 'product-id': ref, segments: CORRECTED.segments });
    const a = backfillHolderIds([t], RECORDS)[0].assemblies[0];
    expect(a.holder_id).toBe(CORRECTED.id);
    expect(a._linkGuess).toBeUndefined();
    expect(buildHolderLinkPlan([{ ...t, assemblies: [a] }], RECORDS, CFG).rows).toHaveLength(0);
  });

  it('the ID says one holder and the geometry says another → linked, but flagged', () => {
    const other = RECORDS.find(r => r.id !== CORRECTED.id && r.segments?.length);
    // Carries the corrected SHAPE but a different holder's ref.
    const t = arriving({}, { ...base, 'product-id': other.holder_ref, segments: CORRECTED.segments });
    const a = backfillHolderIds([t], RECORDS)[0].assemblies[0];
    expect(a.holder_id).toBe(CORRECTED.id);        // geometry wins — it's what the tool carries
    expect(a._linkGuess).toBe(true);               // …but one of the two is wrong
    const plan = buildHolderLinkPlan([{ ...t, assemblies: [a] }], RECORDS, CFG);
    expect(plan.confirm).toHaveLength(1);
    expect(plan.confirm[0].via).toBe('shape');
    expect(plan.confirm[0].record.id).toBe(CORRECTED.id);   // pre-filled with the guess
  });

  it('a guid-only match is a guess, and lands on the confirm list', () => {
    const a = backfillHolderIds([arriving()], RECORDS)[0].assemblies[0];
    expect(a.holder_id).toBe(CORRECTED.id);
    expect(a._linkGuess).toBe(true);
    expect(buildHolderLinkPlan([{ ...arriving(), assemblies: [a] }], RECORDS, CFG).confirm)
      .toHaveLength(1);
  });

  // ⚠️ THE NAG-WALL GUARD. Every tool copied before the first push carries no
  // ref, so if shape-alone counted as uncertain the ENTIRE pre-existing library
  // would land on a confirmation list. Measured against the real export.
  it('shape alone, with no ID baked in, stays silent — no confirmation wall', () => {
    const withoutRef = TOOLS.map((raw, i) => ({
      id: `T${i}`, tool_type: 'flat end mill', unit: raw.unit || 'inches', description: `t${i}`,
      assemblies: [{ assembly_id: `a${i}`, instance_guid: raw.guid, holder_guid: raw.holder.guid }],
      _instancesRaw: [raw],
    }));
    const after = backfillHolderIds(withoutRef, ALL);      // uncorrected library
    const linked = after.filter(t => t.assemblies[0].holder_id);
    const guessed = linked.filter(t => t.assemblies[0]._linkGuess);
    // Measured: 212 of 221 linked, and only 3 asked about (two whose baked
    // product-id resolves to a record whose shape disagrees, one guid-only).
    // A handful is a worklist; a hundred would be wallpaper.
    expect(linked.length).toBeGreaterThan(200);
    expect(guessed.length).toBeLessThan(10);
    expect(guessed.every(t => t.assemblies[0]._linkVia !== 'shape')).toBe(true);
  });

  // ⚠️ CHECKLIST Q8 — can the user make the flag go away? Accepting a guess
  // KEEPS the same holder_id, so a "nothing changed, skip it" test in the link
  // commit made accepting it a total no-op: nothing written, the flag still
  // set, and the next load re-guessed and re-flagged it. This mirrors what
  // linkToolsToHolders does to the assembly, which is what clears the row.
  it('confirming a guess is a real change, even when the holder does not move', () => {
    const a = backfillHolderIds([arriving()], RECORDS)[0].assemblies[0];
    expect(a._linkGuess).toBe(true);

    const holderId = a.holder_id;                       // accept the guess as-is
    const confirming = !!a._linkGuess;
    expect(a.holder_id === holderId && !confirming).toBe(false);   // NOT skippable

    const { _linkGuess, _linkVia, ...rest } = a;
    const confirmed = { ...rest, holder_id: holderId };
    expect(confirmed._linkGuess).toBeUndefined();
    expect(buildHolderLinkPlan([{ ...arriving(), assemblies: [confirmed] }], RECORDS, CFG).rows)
      .toHaveLength(0);                                 // the row is gone for good
  });

  it('a holder retired before the tool arrived: worklist, and the write falls back to Fusion', () => {
    const retired = RECORDS.map(r => (r.id === CORRECTED.id ? { ...r, archived: true } : r));
    const after = backfillHolderIds([arriving()], retired);
    expect(after[0].assemblies[0].holder_id).toBeFalsy();        // archived is invisible (I6)
    expect(buildHolderLinkPlan(after, retired, CFG).rows).toHaveLength(1);
    // ⚠️ Falls back to the Fusion entry rather than resolving to nothing — the
    // tool keeps the holder it has instead of being written with none.
    expect(resolveHolderForWrite(base.guid, { records: retired, fusionHolders: FUSION_HOLDERS }).source)
      .toBe('fusion');
  });
});
