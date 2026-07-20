// Load-time auto-combine: fold separate logical tools that share a ProShop
// number (`tool_id`) into ONE logical tool. See CLAUDE.md → Sync & Merge
// Workflows → Load-time auto-combine.
import { readTrackingId, round4 } from './identity.js';
import { isMetadataOnly } from './fieldRegistry.js';
import { mergePresetLists } from '../utils/presetMerge.js';

// Flat speed/feed fields are a DERIVED cache of preset 0 — the presets carry the
// real values, so a difference here is not an independent conflict (the preset
// merge handles it). Excluded from the shared-field conflict scan.
const SPEED_FEED_MIRROR = new Set([
  'spindle_speed', 'cutting_feedrate', 'plunge_feedrate', 'ramp_feedrate',
  'lead_in_feedrate', 'lead_out_feedrate', 'feed_per_tooth', 'feed_per_rev',
  'cutting_speed',
]);

// Fields resolved by an explicit rule instead of ever being flagged as a
// conflict: description may legitimately differ across copies (keep the primary's);
// overall length takes the biggest; shoulder length is loosely controlled and
// takes the smallest (ProShop's MIN OOH locks it down later). See the per-field
// merge policy in CLAUDE.md / the setup plan.
const AUTO_RESOLVE = new Set(['description', 'overall_length', 'shoulder_length']);

// ─── Combine logical tools that share a ProShop number ─────────────────────
// The ProShop number (Fusion's `product-id`, our `tool_id`) is the
// authoritative identity of a physical tool. Two library entries carrying the
// same ProShop number are the same tool — different holder/OOH setups at most —
// so they are folded into ONE logical tool regardless of any other field
// (type, diameter, description, …). Instances (assemblies), raw Fusion entries,
// presets and merge history are unioned; identical assemblies (same holder +
// OOH) collapse to one. Tools with no ProShop number are left untouched.
//
// Used everywhere new entries appear (load, normalize, import, add) so
// duplicates never split into separate logical tools.
function mergeLogicalTools(group) {
  // Prefer an already-tracked tool as the primary so its tracking ID (and the
  // metadata keyed to it) survives the combine.
  const primary = group.find(t => t.tracking_id) || group[0];
  const ordered = [primary, ...group.filter(t => t !== primary)];

  const unit = primary.unit;
  const assemblies = [];
  const seenAsmSig = new Set();   // collapse identical instances (holder + OOH)
  const raws = [];
  const seenRawGuid = new Set();
  let presets = [];               // unioned via mergePresetLists (tolerance-aware)
  const mergeHistory = [];
  const registered = [];
  const seenRegGuid = new Set();
  let machine = null;

  for (const t of ordered) {
    for (const ra of (t._registeredAssemblies || [])) {
      if (ra?.instance_guid && seenRegGuid.has(ra.instance_guid)) continue;
      if (ra?.instance_guid) seenRegGuid.add(ra.instance_guid);
      registered.push(ra);
    }
    for (const a of (t.assemblies || [])) {
      const sig = `${a.holder_guid || ''}|${round4(Number(a.ooh) || 0)}`;
      if (seenAsmSig.has(sig)) continue;
      seenAsmSig.add(sig);
      assemblies.push(a);
    }
    for (const r of (t._instancesRaw || [])) {
      if (!r?.guid || seenRawGuid.has(r.guid)) continue;
      seenRawGuid.add(r.guid);
      raws.push(r);
    }
    // Merge presets: identical-within-tolerance ones collapse; a same-name preset
    // with genuinely different values is kept, its name indexed up (Rough → Rough 2).
    presets = mergePresetLists(presets, t.presets || [], unit);
    if (machine == null && t.machine_tool_number != null) machine = t.machine_tool_number;
    if (Array.isArray(t.merge_history)) mergeHistory.push(...t.merge_history);
  }

  // ── Gap-fill + conflict detect ──────────────────────────────────────────────
  // Start from primary's scalar values. For every other tool in the group:
  //   - If the current (primary or previously gap-filled) value is empty and
  //     the other tool has a non-empty value → take it (gap-fill).
  //   - If both are non-empty primitive values that differ → record a conflict.
  // The unioned arrays and per-instance / transient / audit fields are excluded.
  const SKIP_KEYS = new Set([
    'id', 'tracking_id', 'machine_tool_number', 'no_fusion_link',
    'assemblies', 'presets', 'merge_history',
    '_instancesRaw', '_fusionRaw', '_registeredAssemblies', '_combineConflicts',
    'ooh', 'selected_holder_guid',
    'created_at', 'updated_at', 'updated_by', 'revision_notes',
  ]);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const scalarConflict = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return round4(a) !== round4(b);
    if (typeof a === 'string' && typeof b === 'string') return a.trim() !== b.trim();
    return a !== b;
  };

  const merged = { ...primary };

  // Loosely-controlled lengths resolve by rule (never a conflict): overall length
  // = the biggest across the group; shoulder length = the smallest (ProShop MIN
  // OOH locks it down on the later ProShop import). Description keeps the primary's.
  const oals = group.map(t => Number(t.overall_length)).filter(v => !isNaN(v) && v > 0);
  if (oals.length) merged.overall_length = Math.max(...oals);
  const shoulders = group.map(t => Number(t.shoulder_length)).filter(v => !isNaN(v) && v > 0);
  if (shoulders.length) merged.shoulder_length = Math.min(...shoulders);

  const combineConflicts = [];
  const allKeys = new Set(group.flatMap(t => Object.keys(t)));

  for (const key of allKeys) {
    if (SKIP_KEYS.has(key) || key.startsWith('_')) continue;
    // Gap-fill still applies to every field; only CONFLICT flagging is suppressed
    // for fields that resolve by rule (description/OAL/shoulder), are a derived
    // cache of the presets (flat speed/feed), or are metadata/ProShop-only and thus
    // absent on the Fusion side (custom_grind, min_ooh, vendor, coating, …).
    const conflictable = !AUTO_RESOLVE.has(key) && !SPEED_FEED_MIRROR.has(key) && !isMetadataOnly(key);
    for (const other of ordered.slice(1)) {
      const curVal = merged[key];
      const otherVal = other[key];
      if (isEmpty(curVal) && !isEmpty(otherVal)) {
        merged[key] = otherVal;                                  // gap-fill
      } else if (
        conflictable &&
        !isEmpty(curVal) && !isEmpty(otherVal) &&
        (typeof curVal === 'string' || typeof curVal === 'number' || typeof curVal === 'boolean') &&
        (typeof otherVal === 'string' || typeof otherVal === 'number' || typeof otherVal === 'boolean') &&
        scalarConflict(curVal, otherVal) &&
        !combineConflicts.some(c => c.field === key)            // one entry per field
      ) {
        combineConflicts.push({
          field: key,
          values: [curVal, otherVal],
          guids: [
            primary._fusionRaw?.guid || primary.id,
            other._fusionRaw?.guid || other.id,
          ],
        });
      }
    }
  }

  // no_fusion_link: clear the flag if any tool in the group is a real Fusion entry.
  const no_fusion_link = group.every(t => t.no_fusion_link) ? true : false;

  return {
    ...merged,
    no_fusion_link,
    machine_tool_number: machine,
    assemblies,
    presets,
    merge_history: mergeHistory,
    _instancesRaw: raws,
    _fusionRaw: primary._fusionRaw || raws[0] || null,
    _registeredAssemblies: registered,
    ...(combineConflicts.length > 0 ? { _combineConflicts: combineConflicts } : {}),
  };
}

export function combineToolsByToolId(tools) {
  const groups = new Map();   // key -> [tool, ...]
  const order = [];           // preserve first-seen order
  let anon = 0;
  for (const tool of (tools || [])) {
    const pid = String(tool.tool_id || '').trim();
    const key = pid ? `pid:${pid}` : `anon:${anon++}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(tool);
  }
  return order.map(key => {
    const group = groups.get(key);
    return group.length === 1 ? group[0] : mergeLogicalTools(group);
  });
}

// Fold a no-Fusion tool and a Fusion-linked tool that share a ProShop number.
//
// The per-library combineToolsByToolId above only ever sees the entries built
// from ONE Fusion library, so it can't catch this case: a ProShop-only import
// creates a metadata-only tool (no_fusion_link, its own tracking ID), and later
// the same physical tool is uploaded into the Fusion library under a DIFFERENT
// tracking ID but the SAME product-id/tool_id. Those two live in different piles
// at load (one is materialized from metadata, the other built from Fusion), so
// without this pass they surface as two separate library entries sharing a
// ProShop number — the exact duplicate the app is meant to prevent.
//
// Runs once over the UNION (linked tools + materialized no-Fusion tools). It is
// library-safe: a group is folded only when it maps to AT MOST ONE real Fusion
// library (no-Fusion tools have `library_id: null`), so two DIFFERENT Fusion
// libraries that happen to share a tool_id are never merged — writes must stay
// routable to exactly one library. The linked tool is ordered first so it becomes
// the primary, keeping its library_id, tracking ID and raw Fusion instances; the
// no-Fusion tool's ProShop-only fields (purchasing, location, vendor, min_ooh)
// gap-fill onto it, and any genuinely-shared field that differs is flagged as a
// conflict (_combineConflicts) — informed, not blocked.
export function combineUnlinkedByToolId(tools) {
  const groups = new Map();   // key -> [tool, ...]
  const order = [];           // preserve first-seen order
  let anon = 0;
  for (const tool of (tools || [])) {
    const pid = String(tool.tool_id || '').trim();
    const key = pid ? `pid:${pid}` : `anon:${anon++}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(tool);
  }
  const out = [];
  for (const key of order) {
    const group = groups.get(key);
    if (group.length === 1) { out.push(group[0]); continue; }
    // Never fold two DISTINCT real Fusion libraries — a combined tool must belong
    // to exactly one library so writes route. (The per-library combine already
    // folded same-library dups, so a >1-library group here is genuinely cross-lib.)
    const libs = new Set(group.map(t => t.library_id).filter(v => v != null));
    if (libs.size > 1) { out.push(...group); continue; }
    // Linked tool first → it wins as primary (mergeLogicalTools prefers a tracked
    // tool, but both are tracked here, so order decides). Keeps library routing.
    const ordered = [...group].sort(
      (a, b) => (a.library_id != null ? 0 : 1) - (b.library_id != null ? 0 : 1));
    out.push(mergeLogicalTools(ordered));
  }
  return out;
}

// Combined tools that are actually MORE THAN ONE Fusion tracking-ID group folded
// together because they share a tool_id (usually a duplicate from human error in
// the legacy/Fusion data). These are the tools a bulk re-number would split into
// separate IDs (it works per tracking group), so the UI surfaces them for an
// explicit merge-to-one-ID vs split decision. Each cluster's tool_id is unique
// (the combine already folded same-id tools into one). Returns
// [{ tool_id, description, count }] where count = distinct tracking IDs folded.
export function duplicateIdClusters(tools) {
  const out = [];
  for (const t of (tools || [])) {
    const tids = new Set();
    for (const r of (t._instancesRaw || [])) {
      const tid = readTrackingId(r);
      if (tid) tids.add(tid);
    }
    if (tids.size > 1) out.push({ tool_id: t.tool_id, description: t.description, count: tids.size });
  }
  return out;
}
