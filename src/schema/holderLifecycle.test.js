// ─── The holder workflow, walked end to end ─────────────────────────────────
//
// WHY THIS EXISTS. Every other holder test checks one function. This walks the
// whole workflow in order — import → push → edit → link → re-stamp → merge →
// retire → restore → re-import — and asserts the invariants at each step.
//
// That matters because nearly every bad bug in this feature lived BETWEEN two
// correct functions: the same question answered twice with rules that could
// disagree (staleness vs identity), a write that corrected Fusion but not the
// in-memory copy the checker read, an importer that didn't know what the push
// knew. Unit tests pass through all of those; a lifecycle walk does not.
//
// The invariant numbers (I1…I8) are the ones in HOLDER_WORKFLOW.md. If this
// file and that document disagree, one of them is wrong.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  holderPushPlan, applyHolderPushPlan, holdersOutOfSync, auditFusionHolders,
  matchFusionHolder, recordForRef, recordsForGeometry, lastPushedFrom,
  retiredHolderFor, segmentsMatch,
} from './holderIdentity.js';
import { fusionHolderToRecord, holderRecordToFusion, restoreArchivedHolder } from './holderRecord.js';
import { backfillHolderIds, staleHolderTools, resolveHolderForWrite, assemblyUsesHolder } from './holderResolve.js';
import { applyHolderMerge, findHolderDuplicates } from '../utils/holderDuplicates.js';
import { buildHolderLinkPlan } from '../utils/holderLink.js';
import { splitToFusionInstances } from './logicalTools.js';
import { holderConfigOf } from './holderOptions.js';

const FUSION_HOLDERS = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;
const FUSION_TOOLS = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Full_Type_List Examples.json', import.meta.url), 'utf8')
).data.filter(t => t.holder?.segments?.length);

const CONFIG = holderConfigOf(null);

// One logical tool per Fusion entry, shaped the way loadTools builds them.
const toolsFrom = (entries) => entries.map((t, i) => ({
  id: `FTL-${i}`, tracking_id: `FTL-${i}`, tool_type: 'flat end mill',
  unit: t.unit || 'inches', diameter: 0.5, description: t.description || `tool ${i}`,
  assemblies: [{
    assembly_id: `a${i}`, instance_guid: t.guid,
    holder_guid: t.holder.guid, ooh: t.geometry?.LB ?? 1,
  }],
  _instancesRaw: [t],
}));

// The push, as pushHoldersToFusion performs it: plan → write → stamp what was
// actually written back onto each record.
function push(fusion, records, { scope = null } = {}) {
  const scoped = scope ? records.filter(r => scope.has(r.id)) : records;
  const plan = holderPushPlan(fusion, scoped, undefined, holderRecordToFusion);
  const next = applyHolderPushPlan(fusion, plan, holderRecordToFusion);
  const byRef = new Map(next.filter(e => e?.['product-id']).map(e => [e['product-id'], e]));
  const stamped = records.map(r => (scope && !scope.has(r.id) ? r : {
    ...r,
    fusion_guid: byRef.get(r.holder_ref)?.guid ?? r.fusion_guid,
    last_pushed: byRef.has(r.holder_ref) ? lastPushedFrom(r) : r.last_pushed,
  }));
  return { plan, fusion: next, records: stamped };
}

const redraw = (rec, mm = 5) => ({
  ...rec,
  segments: rec.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + mm } : { ...s })),
});

describe('the holder workflow, end to end', () => {
  // ── 1. Import ───────────────────────────────────────────────────────────
  it('1 · import: every Fusion holder becomes a record, none flagged', () => {
    const records = [];
    for (const f of FUSION_HOLDERS) {
      expect(retiredHolderFor(f, records)).toBeNull();
      expect(matchFusionHolder(f, records).status).toBe('none');   // nothing known yet
      records.push(fusionHolderToRecord(f));
    }
    expect(records).toHaveLength(FUSION_HOLDERS.length);
    expect(records.every(r => r.last_pushed == null)).toBe(true);  // never pushed
  });

  // ── 2. The automatic first push ─────────────────────────────────────────
  it('2 · the auto first push only ADOPTS — no create, no delete, no geometry moves', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);
    const scope = new Set(records.map(r => r.id));          // exactly what import made
    const { plan, fusion, records: after } = push(FUSION_HOLDERS, records, { scope });

    expect(plan.creates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.flagged).toHaveLength(0);
    for (const u of plan.updates) {
      for (const d of u.diff) expect(['segments', 'gaugeLength', 'unit']).not.toContain(d.key);
    }
    // Our ID is now on every entry, and the two libraries agree.
    expect(fusion.every(e => /^HLD-[0-9A-F]{6}$/.test(e['product-id']))).toBe(true);
    expect(holdersOutOfSync(fusion, after, holderRecordToFusion)).toBe(0);
    expect(fusion).toHaveLength(FUSION_HOLDERS.length);
  });

  it('2b · I4 — pushing again has nothing to do, three rounds running', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));
    for (let i = 0; i < 3; i++) {
      const { plan, fusion: f2, records: r2 } = push(fusion, records);
      expect(plan.updates.filter(u => u.stale)).toHaveLength(0);
      expect(plan.creates).toHaveLength(0);
      expect(plan.deletes).toHaveLength(0);
      fusion = f2; records = r2;
    }
    expect(holdersOutOfSync(fusion, records, holderRecordToFusion)).toBe(0);
    expect(fusion).toHaveLength(FUSION_HOLDERS.length);   // I2 — no entry multiplied
  });

  it('2c · I3 — the whole audit survives Fusion re-issuing every GUID', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));
    const churned = fusion.map((e, i) => ({ ...e, guid: `fusion-reissued-${i}` }));
    const a = auditFusionHolders(churned, records);
    expect(a.matched).toHaveLength(records.length);
    expect(a.flagged).toHaveLength(0);
    expect(a.unpushed).toHaveLength(0);
  });

  // ── 3. Editing a holder here ────────────────────────────────────────────
  it('3 · a redraw HERE pushes out; a Fusion-side edit is flagged instead', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));

    // The user redraws one holder in the app.
    const edited = records.map((r, i) => (i === 0 ? redraw(r) : r));
    expect(matchFusionHolder(fusion[0], edited).status).toBe('ref-only');
    const mine = holderPushPlan(fusion, edited, undefined, holderRecordToFusion);
    expect(mine.updates.filter(u => u.stale)).toHaveLength(1);
    expect(mine.flagged).toHaveLength(0);
    expect(holdersOutOfSync(fusion, edited, holderRecordToFusion)).toBe(1);

    // Someone edits it in FUSION instead — same status, opposite handling.
    const movedInFusion = fusion.map((e, i) => (i === 0
      ? { ...e, segments: e.segments.map((s, k) => (k === 0 ? { ...s, height: s.height + 7 } : s)) }
      : e));
    const theirs = holderPushPlan(movedInFusion, records, undefined, holderRecordToFusion);
    expect(theirs.updates.filter(u => u.stale)).toHaveLength(0);
    expect(theirs.flagged.map(f => f.status)).toEqual(['ref-only']);
  });

  // ── 4. Linking the tools ────────────────────────────────────────────────
  it('4 · linking: the real library links by SHAPE, and never to an archived record', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);
    const tools = toolsFrom(FUSION_TOOLS);
    const linked = backfillHolderIds(tools, records);
    const asms = linked.flatMap(t => t.assemblies);
    const withFk = asms.filter(a => a.holder_id).length;
    expect(withFk / asms.length).toBeGreaterThan(0.9);        // ~95% on real data

    // I6 — archive them all and nothing links.
    const archived = records.map(r => ({ ...r, archived: true }));
    expect(backfillHolderIds(tools, archived).flatMap(t => t.assemblies)
      .filter(a => a.holder_id)).toHaveLength(0);

    // An assembly pointing at an archived record is OFFERED for re-linking,
    // not silently skipped.
    const one = { ...linked[0], assemblies: [{ ...linked[0].assemblies[0], holder_id: 'gone' }] };
    expect(buildHolderLinkPlan([one], records, CONFIG).rows).toHaveLength(1);
  });

  // ── 5. Correct a holder → its tools go stale → re-stamp clears it ───────
  it('5 · I8 — a correction flags its tools, and re-stamping makes the flag go away', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);
    const tools = backfillHolderIds(toolsFrom(FUSION_TOOLS), records);
    const ctx = { records, fusionHolders: FUSION_HOLDERS };

    const target = records.find(r => tools.some(t => t.assemblies[0].holder_id === r.id));
    const before = staleHolderTools(tools, ctx).length;

    const corrected = records.map(r => (r.id === target.id ? redraw(r) : r));
    const stale = staleHolderTools(tools, { ...ctx, records: corrected });
    expect(stale.length).toBeGreaterThan(before);

    // The write rebuilds each tool's holder AND refreshes _instancesRaw.
    const restamped = stale.map((t) => {
      const { fusionInstances } = splitToFusionInstances(t, FUSION_HOLDERS, corrected);
      return { ...t, _instancesRaw: fusionInstances };
    });
    expect(staleHolderTools(restamped, { ...ctx, records: corrected })).toHaveLength(0);
  });

  it('5b · I5 — staleness can never contradict identity', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);
    const tools = backfillHolderIds(toolsFrom(FUSION_TOOLS), records);
    for (const t of staleHolderTools(tools, { records, fusionHolders: FUSION_HOLDERS })) {
      const rec = records.find(r => r.id === t.assemblies[0].holder_id);
      if (!rec) continue;
      const baked = t._instancesRaw[0].holder;
      expect(segmentsMatch(baked.segments, baked.unit, rec.segments, rec.unit)).toBe(false);
    }
  });

  // ── 6. Merge ────────────────────────────────────────────────────────────
  it('6 · merging archives the loser, repoints its tools, and deletes its Fusion entry', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));

    const [survivor, loser] = records;
    const file = applyHolderMerge({ version: 1, holders: records, parts: [] }, survivor.id, loser.id);
    const merged = file.holders;

    // I7 — archived, not dropped, and its geometry is still there.
    expect(merged).toHaveLength(records.length);
    const retired = merged.find(h => h.id === loser.id);
    expect(retired.archived).toBe(true);
    expect(retired.segments).toEqual(loser.segments);

    // I6 — invisible to every matcher; the survivor answers for its ref.
    expect(recordForRef(merged, loser.holder_ref).id).toBe(survivor.id);
    expect(recordsForGeometry(merged, fusion[1]).find(r => r.id === loser.id)).toBeUndefined();

    // A tool on the loser's baked guid resolves to the SURVIVOR, not the archive.
    const r = resolveHolderForWrite(loser.fusion_guid, { records: merged, fusionHolders: fusion });
    expect(r.recordId).toBe(survivor.id);

    // The push removes the loser's Fusion entry and nothing else.
    const plan = holderPushPlan(fusion, merged, undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0].record.id).toBe(survivor.id);
    expect(applyHolderPushPlan(fusion, plan, holderRecordToFusion))
      .toHaveLength(fusion.length - 1);
  });

  // The manual "merge with another holder" dropdown is NOT gated by the
  // duplicate detector, so a user can merge two records of different shapes.
  // The tools on the loser can't repoint by shape then — they land in the
  // LINK worklist, which is the designed recovery, rather than silently
  // pointing at a retired holder forever.
  // A merge of two records with DIFFERENT shapes is the case that decides
  // whether "these are the same holder" actually reaches the tools. The shape
  // tier can't help — the baked copy matches the loser, and the loser is gone.
  // The survivor absorbing the loser's GUIDs is what carries the link across,
  // and the geometry correction those tools now need must be SURFACED, because
  // nothing has written it to them yet (I8).
  it('6c · a cross-shape merge repoints its tools, and reports them stale', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);
    const tools = backfillHolderIds(toolsFrom(FUSION_TOOLS), records);
    const loser = records.find(r => tools.some(t => t.assemblies[0].holder_id === r.id));
    const users = tools.filter(t => t.assemblies[0].holder_id === loser.id);
    const survivor = records.find(r => r.id !== loser.id
      && !segmentsMatch(r.segments, r.unit, loser.segments, loser.unit));

    const merged = applyHolderMerge({ version: 1, holders: records, parts: [] },
      survivor.id, loser.id).holders;
    const after = backfillHolderIds(tools, merged);

    // Nothing is left pointing at the archived record (I6) …
    expect(after.filter(t => t.assemblies[0].holder_id === loser.id)).toHaveLength(0);
    // … they followed the merge onto the survivor, via its absorbed GUIDs.
    const moved = after.filter(t => users.some(u => u.id === t.id));
    expect(moved).toHaveLength(users.length);
    expect(moved.every(t => t.assemblies[0].holder_id === survivor.id)).toBe(true);

    // Correctly linked, wrongly shaped — every one of them is flagged for the
    // re-stamp that actually corrects Fusion. A merge alone writes no tools.
    const stale = staleHolderTools(moved, { records: merged, fusionHolders: [] });
    expect(stale).toHaveLength(moved.length);
  });

  it('6b · a different collet is never offered as a duplicate', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord)
      .map(r => ({ ...r, collet_size_id: 'cs-sk13', type_id: 'ht-collet' }));
    const clash = [records[0], { ...records[0], id: 'other', collet_size_id: 'cs-sk20' }];
    expect(findHolderDuplicates(clash, CONFIG)).toHaveLength(0);
  });

  // ── 7. Retire, and the round trip back ──────────────────────────────────
  it('7 · retiring removes it from Fusion and import does NOT bring it back', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));

    const retired = records.map((r, i) => (i === 0
      ? { ...r, archived: true, archived_reason: 'removed' } : r));

    // The push deletes its entry…
    const plan = holderPushPlan(fusion, retired, undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.creates).toHaveLength(0);          // archived is retired, not missing

    // …and until it does, Import must not re-create it (the resurrection bug).
    expect(retiredHolderFor(fusion[0], retired)).toBeTruthy();
    expect(matchFusionHolder(fusion[0], retired).status).toBe('none');   // invisible (I6)

    const after = applyHolderPushPlan(fusion, plan, holderRecordToFusion);
    expect(after).toHaveLength(fusion.length - 1);
    expect(holdersOutOfSync(after, retired, holderRecordToFusion)).toBe(0);
  });

  it('7b · retiring one never pushed still removes its entry, by shape', () => {
    const records = FUSION_HOLDERS.map(fusionHolderToRecord);       // no last_pushed
    const retired = records.map((r, i) => (i === 0 ? { ...r, archived: true } : r));
    const plan = holderPushPlan(FUSION_HOLDERS, retired, undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0].why).toMatch(/before it was pushed/);
  });

  it('8 · restore is a COPY, and it pushes as a brand-new holder', () => {
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));

    const archived = { ...records[0], archived: true };
    const copy = restoreArchivedHolder(archived);
    expect(copy.id).not.toBe(archived.id);
    expect(copy.holder_ref).not.toBe(archived.holder_ref);
    expect(copy.fusion_guid).toBeNull();
    expect(copy.last_pushed).toBeNull();
    expect(copy.segments).toEqual(archived.segments);   // the reference survives

    // Its entry is deleted (the original is retired) and the copy is created.
    const plan = holderPushPlan(fusion, [...records.slice(1), archived, copy],
      undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.creates.map(c => c.id)).toEqual([copy.id]);
  });

  // ── The whole thing, in order ───────────────────────────────────────────
  it('9 · the full workflow leaves both libraries agreeing and nothing flagged', () => {
    // import → push → redraw one → push → link → re-stamp → merge → push
    let records = FUSION_HOLDERS.map(fusionHolderToRecord);
    let fusion = FUSION_HOLDERS;
    ({ fusion, records } = push(fusion, records));

    records = records.map((r, i) => (i === 2 ? redraw(r, 3) : r));
    ({ fusion, records } = push(fusion, records));
    expect(holdersOutOfSync(fusion, records, holderRecordToFusion)).toBe(0);

    let tools = backfillHolderIds(toolsFrom(FUSION_TOOLS), records);
    tools = tools.map(t => {
      if (!staleHolderTools([t], { records, fusionHolders: fusion }).length) return t;
      const { fusionInstances } = splitToFusionInstances(t, fusion, records);
      return { ...t, _instancesRaw: fusionInstances };
    });
    expect(staleHolderTools(tools, { records, fusionHolders: fusion })).toHaveLength(0);

    // A REAL merge: the same physical holder entered twice. (Merging two
    // genuinely different holders is no longer offered — a different collet is
    // a different bore — so a survivor always shares the loser's shape, which
    // is what lets the tools repoint.)
    const inUse = records.find(r => tools.some(t => t.assemblies[0].holder_id === r.id));
    const dup = {
      ...inUse, id: 'rec-duplicate', holder_ref: 'HLD-DUP001',
      fusion_guid: null, last_pushed: null,
    };
    const file = applyHolderMerge(
      { version: 1, holders: [...records, dup], parts: [] }, dup.id, inUse.id);
    ({ fusion, records } = push(fusion, file.holders));

    // ⚠️ A merge leaves every tool that held the loser's holder_id pointing at
    // an ARCHIVED record. The app closes that immediately — commitMerge calls
    // relinkHolders, which is this same pure pass — and without it the tools
    // sit on a retired holder until the next load. Walking the workflow WITHOUT
    // this step is what made the final assertion below fail: exactly the sort
    // of gap between two correct functions this file exists to catch.
    tools = backfillHolderIds(tools, records);
    expect(tools.some(t => t.assemblies[0].holder_id === dup.id)).toBe(true);

    const audit = auditFusionHolders(fusion, records);
    expect(audit.flagged).toHaveLength(0);
    expect(audit.unknown).toHaveLength(0);
    expect(audit.unpushed.filter(r => r.archived !== true)).toHaveLength(0);
    expect(holdersOutOfSync(fusion, records, holderRecordToFusion)).toBe(0);

    // And every tool still resolves to a LIVE holder (I6).
    for (const t of tools) {
      for (const a of t.assemblies) {
        if (!a.holder_id) continue;
        const rec = records.find(r => r.id === a.holder_id);
        if (rec) expect(rec.archived).not.toBe(true);
        else expect(records.some(r => assemblyUsesHolder(a, r) && r.archived !== true)).toBe(true);
      }
    }
  });
});
