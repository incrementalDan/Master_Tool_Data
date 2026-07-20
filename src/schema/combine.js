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

// Shared specs compared to preview whether two tools sharing a ProShop number are
// really the same tool. Fusion-native fields both sides carry.
const MERGE_PREVIEW_FIELDS = ['tool_type', 'diameter', 'flute_length', 'overall_length', 'number_of_flutes'];

const normPid = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

// The shared specs (cut diameter, flute count, …) where two tools sharing a
// ProShop number DISAGREE — the preview shown before merging so the user sees what
// they'll have to reconcile. `{ field, a, b }` per differing field; empty when the
// specs agree. Used by both the normalize-time candidate list and the tool-page
// merge banner.
export function sharedSpecConflicts(a, b) {
  const isEmpty = (v) => v == null || v === '';
  const out = [];
  for (const f of MERGE_PREVIEW_FIELDS) {
    const av = a?.[f], bv = b?.[f];
    if (isEmpty(av) || isEmpty(bv)) continue;
    const differ = (typeof av === 'number' && typeof bv === 'number')
      ? round4(av) !== round4(bv)
      : String(av).trim() !== String(bv).trim();
    if (differ) out.push({ field: f, a: av, b: bv });
  }
  return out;
}

// Detect NEW (untracked) Fusion tools that share a ProShop number with an existing
// no-Fusion tool — the case that used to surface as two separate library entries.
// A ProShop-only import makes a metadata-only tool (no_fusion_link); later the same
// physical tool is uploaded into Fusion under its own tracking ID but the SAME
// product-id. Match is by tool_id only (the physical identity). Each candidate
// pairs the untracked Fusion tool with the no-Fusion tool it matches, plus a small
// conflict preview (shared specs that differ, e.g. cut diameter) so the user can
// see what to fix before merging. Surfaced in the Normalize dialog — the app never
// merges these silently; the user decides per tool.
export function findNoFusionMergeCandidates(tools) {
  const noFusionByPid = new Map();
  for (const t of (tools || [])) {
    if (!t?.no_fusion_link) continue;
    const pid = normPid(t.tool_id);
    if (pid) noFusionByPid.set(pid, t);
  }
  const out = [];
  for (const t of (tools || [])) {
    if (!t || t.tracking_id || t.no_fusion_link) continue;   // only NEW untracked Fusion tools
    const pid = normPid(t.tool_id);
    if (!pid) continue;
    const existing = noFusionByPid.get(pid);
    if (!existing) continue;
    const conflicts = sharedSpecConflicts(t, existing).map(c => ({ field: c.field, fusion: c.a, existing: c.b }));
    out.push({ toolId: t.tool_id, fusionTool: t, existingTool: existing, conflicts });
  }
  return out;
}

// Other EXISTING tools that share `tool`'s ProShop number — the tool-page
// duplicate detector behind MergeSiblingBanner. THIS is the invariant the original
// bug violated: a no-Fusion (ProShop-only) tool and a separately-tracked Fusion
// tool carrying the same ProShop number must NOT silently coexist as two
// unconnected records — the app has to surface them as mergeable. Kept as a pure,
// tested helper (not inline in the banner) so a future refactor can't quietly drop
// the detection. Match is by normalized ProShop number; a pair where BOTH sides are
// linked to a real Fusion library is excluded (cross-library — writes must stay
// routable, so it's never an auto-merge candidate).
export function findProShopSiblings(tool, tools) {
  const pid = normPid(tool?.tool_id);
  if (!pid) return [];
  return (tools || []).filter(t =>
    t && t.id !== tool.id &&
    normPid(t.tool_id) === pid &&
    !(t.library_id != null && tool.library_id != null));
}

// Merge a NEW Fusion tool into an existing no-Fusion tool that shares its ProShop
// number — the explicit merge the user confirms at normalization. The Fusion tool
// is primary so its real geometry/presets/raw instance win; the CALLER must have
// already set its tracking_id to the no-Fusion record's id so the merged tool
// updates that record in place (no orphan left behind). The no-Fusion tool's
// ProShop-only fields (purchasing, location, vendor, min_ooh, tags) gap-fill onto
// it, and any shared spec that genuinely differs is flagged as a conflict
// (_combineConflicts) for the user to resolve on the tool page — exactly like two
// Fusion tools that disagree.
export function mergeNoFusionIntoFusion(fusionTool, noFusionTool) {
  return mergeLogicalTools([fusionTool, noFusionTool]);
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
