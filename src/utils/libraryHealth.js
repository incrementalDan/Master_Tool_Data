// Library health — two library-wide detectors for states the app can reach but
// has no way to SHOW, and therefore no way for anyone to fix.
//
// Both exist for the same reason, and it is the reason worth remembering: a
// record the app declines to load, and a field the validator declines to check,
// are indistinguishable from correct data. Neither of these was a silent bug in
// the writing — each is a gap in the READING.
//
//   1. ORPHAN METADATA — a tool deleted directly in Fusion 360 leaves its
//      metadata record behind. `materializeUnlinkedTools` deliberately refuses to
//      build it (the orphan-ghost guard: only records explicitly marked
//      `no_fusion_link` are real no-Fusion tools). That guard is correct and must
//      stay — but it means the record is invisible in the UI while still holding
//      a machine number, a tool_id and an assembly. On the real library, eight
//      such records were the sole cause of five duplicate machine numbers, two
//      below-start numbers, seven dangling instance_guids and all three duplicate
//      tool_id clusters. Nothing on screen said so.
//
//   2. ASSEMBLY OOH BELOW MIN OOH — `validateGeometry` checks the tool-level
//      chain (flute ≤ shoulder ≤ min_ooh ≤ OAL) but never looked at an
//      assembly's own `ooh`, even though `AssemblyForm` hard-blocks saving one
//      below the floor and `normalizeLibrary` floors them on import. So the app
//      refused to CREATE the state while having no way to REPORT it once
//      present. It gets there easily: ProShop's MIN OOH is imported after
//      normalize has already run, and normalize only ever floors UNTRACKED
//      tools ("already-tracked tools: rebuild unchanged"), so a fully-tracked
//      library can never be re-floored by re-running it. 62 assemblies on the
//      real library.
//
// Framework-free and side-effect-free, like locationSystem.js — the detectors
// are recomputed on demand, never stored, so a row disappears by itself as the
// thing behind it is fixed.
import { lengthEps, unitAbbr, convertLength } from './units.js';
import { TOOL_TYPES } from '../schema/toolSchema.js';
import { assemblyUsesHolder } from '../schema/holderResolve.js';

const VALID_TOOL_TYPES = new Set(TOOL_TYPES);

// Match the ProShop-id normalization used everywhere else (dash/space/case
// insensitive) so a ghost is recognized as the twin of its live tool.
const normId = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

// ─── 1. Orphan metadata records ─────────────────────────────────────────────
//
// ⚠️ Takes the STORED records, not the in-memory tools. The whole point is a
// record the app never built — it is absent from `tools` by definition, so
// comparing anything against `tools` alone can only ever report nothing. Same
// reasoning as relinkPresetMaterials diffing the stored records.
//
// A record is an orphan when it is neither built (no Fusion entry carries its
// tracking id) nor marked `no_fusion_link` (an intentional metadata-only tool).
//
// `reason` separates the two shapes the real data takes, because they want
// different decisions:
//   'ghost' — a LIVE tool holds the same tool_id, so this is the leftover half
//             of a tool that was re-created in Fusion under a fresh tracking id.
//             Deleting is unambiguous; the live twin already carries the data.
//   'stale' — nothing else claims its tool_id. Deleting loses whatever was on
//             it, so the row shows enough to decide (assemblies, presets, photo).
export function orphanMetadataRecords(metaList, tools) {
  const built = new Set((tools || []).map(t => t.tracking_id || t.id).filter(Boolean));
  const liveByToolId = new Map();
  for (const t of (tools || [])) {
    const k = normId(t.tool_id);
    if (k) liveByToolId.set(k, t);
  }

  const out = [];
  for (const rec of (metaList || [])) {
    if (!rec?.id) continue;
    if (built.has(rec.id)) continue;
    if (rec.no_fusion_link === true) continue;

    const twin = liveByToolId.get(normId(rec.tool_id)) || null;
    out.push({
      id: rec.id,
      tool_id: rec.tool_id || '',
      description: rec.description || '',
      tool_type: rec.tool_type || '',
      // Not a separate finding — an invalid type only ever showed up ON an
      // orphan (a probe and a holder filed as tools), and naming it here is
      // what tells the user this record was never a cutting tool at all.
      invalidType: !!rec.tool_type && !VALID_TOOL_TYPES.has(rec.tool_type),
      machine_tool_number: rec.machine_tool_number ?? null,
      assemblyCount: (rec.assemblies || []).length,
      presetCount: (rec.presets || []).length,
      hasPhoto: !!rec.primary_photo_id,
      updated_at: rec.updated_at || null,
      reason: twin ? 'ghost' : 'stale',
      twinId: twin ? (twin.tracking_id || twin.id) : null,
      twinDescription: twin ? (twin.description || '') : null,
    });
  }
  return out.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'ghost' ? -1 : 1));
}

// What deleting the given orphans clears elsewhere. Reported BEFORE the delete
// because "8 records" understates it — those records are why the machine-number
// card and the reconcile pass have anything to say.
export function orphanImpact(orphans, tools, { machineStart = null } = {}) {
  const live = (tools || []);
  const liveNums = new Map();
  for (const t of live) {
    const n = t.machine_tool_number;
    if (n != null) liveNums.set(Number(n), t);
  }
  let clashes = 0, belowStart = 0, danglingRefs = 0, ghosts = 0;
  for (const o of (orphans || [])) {
    if (o.reason === 'ghost') ghosts++;
    if (o.machine_tool_number != null) {
      if (liveNums.has(Number(o.machine_tool_number))) clashes++;
      if (machineStart != null && Number(o.machine_tool_number) < machineStart) belowStart++;
    }
    danglingRefs += o.assemblyCount;
  }
  return { clashes, belowStart, danglingRefs, ghosts, total: (orphans || []).length };
}

// ─── 2. Assemblies sticking out less than the tool's own minimum ────────────
//
// MIN OOH is the floor: no assembly may stick out LESS, though any may stick out
// more. Compared in the tool's own unit — min_ooh and every assembly ooh are
// both stored natively, so no conversion (§ Units). The epsilon is the shared
// unit-aware match tolerance, so float noise and a genuine 0.0001" nick don't
// register as a violation.
export function assemblyOohIssues(tools) {
  const out = [];
  for (const t of (tools || [])) {
    const min = t?.min_ooh;
    if (min == null || !(min > 0)) continue;
    const eps = lengthEps(t.unit);
    for (const a of (t.assemblies || [])) {
      const ooh = a?.ooh;
      if (ooh == null || !(ooh > 0)) continue;
      if (ooh >= min - eps) continue;
      out.push({
        toolKey: t.tracking_id || t.id,
        tool_id: t.tool_id || '',
        description: t.description || '',
        unit: t.unit,
        assembly_id: a.assembly_id || null,
        asm_number: a.asm_number || null,
        holder_description: a.holder_description || '',
        ooh,
        min_ooh: min,
        // The number that matters: how far the stickout actually moves, and so
        // how far the assembly gauge length moves with it.
        delta: Math.round((min - ooh) * 1e6) / 1e6,
      });
    }
  }
  return out.sort((a, b) => b.delta - a.delta);
}

// Group the issues by tool — the fix is applied per tool (one Fusion entry set
// per logical tool), so the write path wants tools, not assemblies.
export function oohIssuesByTool(issues) {
  const m = new Map();
  for (const i of (issues || [])) {
    if (!m.has(i.toolKey)) m.set(i.toolKey, []);
    m.get(i.toolKey).push(i);
  }
  return m;
}

// Raise every below-floor assembly up to min_ooh. Returns the SAME tool
// reference when nothing moves, so a caller can use identity to decide whether
// there is anything to write — the same contract as syncPresetMaterialName.
// Never lowers an assembly that already sticks out further: that is a proven
// setup, and the floor is a minimum, not a target.
export function floorAssemblyOoh(tool) {
  const min = tool?.min_ooh;
  if (min == null || !(min > 0)) return tool;
  const eps = lengthEps(tool.unit);
  let changed = false;
  const assemblies = (tool.assemblies || []).map(a => {
    if (a?.ooh == null || !(a.ooh > 0) || a.ooh >= min - eps) return a;
    changed = true;
    return { ...a, ooh: min };
  });
  return changed ? { ...tool, assemblies } : tool;
}

// How much stickout movement is worth calling out in the preview. A correction
// of a few thou is housekeeping; a third of an inch moves the tool somewhere
// materially different, and the real library has both.
//
// ⚠️ Unit-derived, not a bare 0.05 — an inch-sized threshold on a millimetre
// tool flags 0.05mm (two thou) as significant, which is noise.
export const OOH_DELTA_NOTABLE_IN = 0.05;
export function isNotableOohDelta(delta, unit) {
  return Math.abs(delta) >= convertLength(OOH_DELTA_NOTABLE_IN, 'inches', unit);
}

// ─── 3. Geometry review, library-wide ───────────────────────────────────────
//
// `validateGeometry` has always produced these warnings, but the only place they
// render is inside ONE tool's Geometry section — so finding the handful of tools
// that have them means opening all of them. Same shape of gap as the two above:
// the check existed, the surface didn't.
//
// No fix button, deliberately. "Shoulder 0.95 > MIN OOH 0.75" does not say which
// of the two numbers is wrong, and guessing would write a real dimension into
// Fusion. This lists them and links out; the correction is a human call.
export function geometryChainIssues(tools, validate) {
  const out = [];
  for (const t of (tools || [])) {
    const warnings = validate(t) || [];
    if (warnings.length) {
      out.push({
        toolKey: t.tracking_id || t.id,
        tool_id: t.tool_id || '',
        description: t.description || '',
        messages: warnings.map(w => w.message),
      });
    }
  }
  return out;
}

// A LOC stated in the description that disagrees with the stored flute length.
// A weak signal on its own, but it is the ONLY check that catches a length
// written into the wrong field — on the real library it found a 3/64" end mill
// carrying a 1.9" flute length (a 40:1 ratio, physically impossible) whose own
// description says .071 LOC. Nothing else in the app looks at that.
//
// ⚠️ Fractions are the whole difficulty: "3/16 LOC" must not parse as 16, and a
// naive \d+ pattern reads every fraction as a wild mismatch. Handles both forms
// and stays quiet unless the gap is real (>12%, floored so tiny tools don't spam).
const LOC_RE = /(?:(\d+)\s*\/\s*(\d+)|(\d*\.?\d+))\s*"?\s*LOC/i;
export function descriptionLocMismatches(tools) {
  const out = [];
  for (const t of (tools || [])) {
    const fl = t?.flute_length;
    if (fl == null || !(fl > 0)) continue;
    // A pairing's description names the assembled unit while flute_length is the
    // insert's — they legitimately differ, so don't report them.
    if (t.pairing) continue;
    const m = LOC_RE.exec(t.description || '');
    if (!m) continue;
    const said = m[1] ? Number(m[1]) / Number(m[2]) : Number(m[3]);
    if (!(said > 0)) continue;
    const delta = Math.abs(said - fl);
    if (delta <= Math.max(0.015, 0.12 * said)) continue;
    out.push({
      toolKey: t.tracking_id || t.id,
      tool_id: t.tool_id || '',
      description: t.description || '',
      unit: t.unit,
      stated: said,
      stored: fl,
      delta: Math.round(delta * 1e6) / 1e6,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

// One-line summary for the preview, in the tool's own unit.
export function describeOohIssue(i) {
  const u = unitAbbr(i.unit);
  const f = (n) => Number(n).toFixed(u === 'in' ? 4 : 3).replace(/\.?0+$/, '');
  return `${f(i.ooh)} → ${f(i.min_ooh)} ${u} (+${f(i.delta)})`;
}

// ─── 4. Two assemblies that are the SAME assembly ───────────────────────────
//
// A logical tool's instances differ ONLY by holder and OOH — that is the whole
// multi-instance model. So two assemblies with the same holder AND the same
// stickout are not two setups, they are one setup recorded twice, and the tool
// sits in Fusion two or three times identically.
//
// ⚠️ NOTHING IN THE APP COULD SEE THIS. `classifyStrays` (reconcile.js) does
// classify a duplicate — but only among STRAYS, entries the app finds in Fusion
// that its metadata does not know about. These are all properly REGISTERED:
// each has its own `instance_guid`, each guid is live in Fusion, each carries a
// holder FK. Registered means reconcile never looks at them, so the state was
// unreportable and unfixable. Same shape of gap as 1–3: the app declines to
// create it (a second identical assembly is not something any form offers) while
// having no way to report one that is already there.
//
// How they get there: EDITING an OOH onto a value another assembly already has.
// On the real library two of them still carry the stale Auto asm_numbers from
// before that edit — `…-A-139-1.7` and `…-A-139-1.85` sitting on two assemblies
// whose stickout is now 1.88 on both, in metadata AND in Fusion's own
// `geometry.LB`. Nothing said the edit had collapsed them together.
//
// ⚠️ THE HOLDER IS COMPARED BY RESOLVED RECORD, NEVER BY RAW GUID. Fusion
// re-issues holder guids, so the same physical holder legitimately appears under
// two guids on one tool — exactly the A-253 case, where one assembly carries a
// live FK and the other a guid that resolves to nothing. Grouping on the guid
// misses it, which is the "every link is an ID" rule applied to a comparison.
// When neither signal resolves, the DESCRIPTION is the fallback: a holder's name
// IS its description in this app, so two unresolvable assemblies naming the same
// holder are the same holder.
function holderIdentityOf(assembly, holderRecords) {
  const rec = (holderRecords || []).find(r => r && r.archived !== true && assemblyUsesHolder(assembly, r));
  const desc = String((rec ? rec.description : assembly?.holder_description) ?? '').trim().toLowerCase();
  return { recId: rec ? rec.id : null, desc, guid: assembly?.holder_guid || null };
}

// ⚠️ RESOLVED-vs-UNRESOLVED IS THE CASE THAT MATTERS, so the comparison is not a
// single key. On A-253 one assembly carries a live FK and the other a guid that
// resolves to nothing — two records' worth of key, one physical holder. Keying
// on either alone misses it.
//   · both resolve → the RECORD decides, even if the descriptions agree: two
//     distinct records are two distinct holders, and saying otherwise here would
//     merge across a holder-library duplicate rather than reporting one.
//   · otherwise → the DESCRIPTION decides, because a holder's name IS its
//     description in this app, and it is the only signal an unresolvable
//     assembly still has.
function sameHolder(a, b) {
  if (a.recId && b.recId) return a.recId === b.recId;
  if (a.desc || b.desc) return a.desc === b.desc;
  return !!a.guid && a.guid === b.guid;
}

// ⚠️ MERGING MUST NOT LOSE ANYTHING, so two fields veto it rather than being
// quietly dropped. `measured_gauge_length` is the IMMUTABLE presetter reading —
// the physical record of a real assembly — and two different readings on one
// stickout is a genuine disagreement nobody but the shop can settle. Different
// NOTES are the same: prose the app cannot merge without inventing an order.
// Both are vetoes, not merges; the row is still reported so it is visible.
// Bucket a tool's assemblies by holder, then by stickout within the shared
// unit-aware tolerance — the same epsilon presets and OOH already use, so float
// noise never splits a pair and a real 0.001" difference never joins one. (A
// null stickout only ever groups with another null.) ONE grouper, so the
// detector and the healer cannot disagree about what a duplicate is.
function groupAssemblies(assemblies, holderRecords, eps) {
  const groups = [];
  for (const a of (assemblies || [])) {
    const h = holderIdentityOf(a, holderRecords);
    const ooh = a?.ooh == null ? null : Number(a.ooh);
    const hit = groups.find(g => sameHolder(g.h, h)
      && (g.ooh == null || ooh == null ? g.ooh === ooh : Math.abs(g.ooh - ooh) <= eps));
    if (hit) hit.items.push(a);
    else groups.push({ h, ooh, items: [a] });
  }
  return groups;
}

function mergeBlocker(group) {
  const measured = group.map(a => a?.measured_gauge_length).filter(v => v != null);
  if (new Set(measured.map(Number)).size > 1) return 'two different presetter measurements';
  const notes = [...new Set(group.map(a => String(a?.notes ?? '').trim()).filter(Boolean))];
  if (notes.length > 1) return 'different notes on each';
  return null;
}

// One row per duplicate GROUP (not per assembly) — the group is the decision.
export function duplicateAssemblyIssues(tools, holderRecords = []) {
  const out = [];
  for (const t of (tools || [])) {
    const eps = lengthEps(t.unit);
    const groups = groupAssemblies(t.assemblies, holderRecords, eps);
    for (const g of groups) {
      if (g.items.length < 2) continue;
      const blocked = mergeBlocker(g.items);
      out.push({
        toolKey: t.tracking_id || t.id,
        tool_id: t.tool_id || '',
        description: t.description || '',
        unit: t.unit,
        holder_description: g.items.find(a => a.holder_description)?.holder_description || '',
        ooh: g.ooh,
        count: g.items.length,
        asm_numbers: g.items.map(a => a.asm_number || null),
        // What merging would carry over — the honest headline for the preview.
        presetsMoved: new Set(g.items.slice(1).flatMap(a => a.linked_preset_guids || [])).size,
        blocked: !!blocked,
        blockedWhy: blocked,
      });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export function duplicateAssemblyIssuesByTool(issues) {
  const m = new Map();
  for (const i of (issues || [])) {
    if (!m.has(i.toolKey)) m.set(i.toolKey, []);
    m.get(i.toolKey).push(i);
  }
  return m;
}

// Collapse each duplicate group to one assembly. Returns the SAME tool
// reference when nothing merges — the identity contract every other healer in
// this codebase follows, so a caller can tell there is nothing to write.
//
// ⚠️ THE SURVIVOR IS THE ONE CARRYING A PRESETTER MEASUREMENT, else the first.
// Keeping the first blindly would drop an immutable physical record in favour of
// a copy that has none. Preset links and retired assembly numbers are UNIONED
// across the group: a preset pointing at a dropped assembly would be orphaned,
// and a retired number is searchable history.
//
// The dropped assemblies' Fusion entries need no separate delete —
// writeLogicalTool rebuilds a tool's entry set from its assemblies, so the extra
// instances simply stop being written.
export function dedupeAssemblies(tool, holderRecords = []) {
  const groups = groupAssemblies(tool?.assemblies, holderRecords, lengthEps(tool?.unit));
  let changed = false;
  const assemblies = [];
  for (const g of groups) {
    if (g.items.length < 2 || mergeBlocker(g.items)) { assemblies.push(...g.items); continue; }
    changed = true;
    const keep = g.items.find(a => a?.measured_gauge_length != null) || g.items[0];
    const presets = [...new Set(g.items.flatMap(a => a.linked_preset_guids || []))];
    const legacy = [...new Set(g.items.flatMap(a => a.legacy_asm_numbers || []))];
    const notes = g.items.map(a => String(a?.notes ?? '').trim()).find(Boolean) || '';
    assemblies.push({
      ...keep,
      linked_preset_guids: presets,
      ...(legacy.length ? { legacy_asm_numbers: legacy } : {}),
      ...(notes ? { notes } : {}),
    });
  }
  return changed ? { ...tool, assemblies } : tool;
}

// One-line summary for the preview, in the tool's own unit.
export function describeDuplicateAssembly(i) {
  const u = unitAbbr(i.unit);
  const ooh = i.ooh == null ? 'no stickout' : `${Number(i.ooh).toFixed(u === 'in' ? 4 : 3).replace(/\.?0+$/, '')} ${u}`;
  return `${i.count}× ${i.holder_description || 'unknown holder'} @ ${ooh}`;
}
