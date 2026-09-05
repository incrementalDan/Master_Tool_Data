// Which keys may be written to metadata ON THEIR OWN — the guard that keeps the
// autosave path from ever reaching a field Fusion also holds.
//
// ⚠️ THE INVARIANT THIS PROTECTS. Metadata and Fusion are written TOGETHER by
// writeLogicalTool, so when the two disagree it means exactly one thing:
//
//     metadata ≠ Fusion  means  FUSION moved.
//
// detectFusionDrift (metadataModel.js) is built on that reading and DriftBanner
// acts on it — "Fusion has X, the app has Y, keep which?". Write a Fusion-backed
// field to metadata ALONE and the sentence stops being true: the same difference
// would also mean "the user typed something and hasn't pushed it", and "Keep
// Fusion" would silently discard their edit. That is the holder `ref-only` bug
// in a new place, and holders needed a whole `last_pushed` snapshot to escape it.
//
// So: a Fusion-backed field NEVER travels this path. Enforced here, structurally,
// rather than remembered at each call site — see metadataScope.test.js, which
// fails on a field that does not exist yet until it is classified below.
//
// ⚠️ THIS IS NOT THE UI's "which section autosaves" RULE. That one is coarser on
// purpose (a whole section waits for the Save button if it holds ANY Fusion-
// backed field, so the user never has to know which store a field lives in).
// This module answers the narrower, safety question: *may* this key be written
// alone? A field can be autosavable here and still sit in a buffered section.
import { FIELD_REGISTRY } from './fieldRegistry.js';

// Metadata-only fields that may NOT be written on their own, and why. Two kinds
// live here — a field whose CONTENT still reaches Fusion, and a field the write
// itself manages — because a caller needs the same answer for both: don't send it.
export const NOT_AUTOSAVABLE = {
  assemblies:
    'holder + OOH are baked into Fusion (geometry.LB, the holder object, assemblyGaugeLength) — '
    + 'writing them metadata-only leaves Fusion holding the old stickout',
  selected_holder_guid:
    'seeds a new assembly\'s holder, which is baked into the Fusion entry',
  tool_status:
    'withRetiredMarker rewrites the Fusion-native description on every write',
  tsc_capable:
    'defaults the Fusion preset coolant, and the TSC suffix in a generated description',
  pitch:
    'the thread designation derives thread_pitch (Fusion geometry.TP)',
  tap_thread_unit:
    'picks which thread list a designation resolves against, so it derives thread_pitch too',
  preset_name:
    'a flat mirror of preset 0 — presets are Fusion-native',
  no_fusion_link:
    'decides the write destination; only promote/detach may change it',
  merge_history:
    'appended by the merge flow, never by an ordinary edit',
  created_at:
    'set once, at creation',
  updated_at:
    'stamped by the write itself',
};

// Metadata keys that are not registry fields. Deliberately MINIMAL: a key is
// added here when something actually sends it, not in advance — an unused key on
// an allowlist is a permission nobody reviewed. Anything not listed is dropped
// (and reported), so adding one is a one-line change plus a test line.
export const AUTOSAVE_EXTRA_KEYS = new Set([
  'speed_feed_refs',        // SpeedFeedSection — per-CAM-preset SFM + chip load
  // ⚠️ The FK half of the preferred machine. `preferred_machine` is a registry
  // field and autosavable; its id is not a registry field, so without this line
  // the Notes autosave would store the display NAME and silently drop the LINK —
  // "store the id, render the name" broken in the one direction that looks fine
  // on screen until the machine is renamed.
  'preferred_machine_id',
]);

/** Every metadata-only registry field that may be written on its own. */
export const AUTOSAVE_FIELDS = new Set(
  Object.entries(FIELD_REGISTRY)
    .filter(([k, d]) => d.metadataOnly === true && !(k in NOT_AUTOSAVABLE))
    .map(([k]) => k),
);

/** May this key be written to metadata without a matching Fusion write? */
export function isAutosavableKey(key) {
  return AUTOSAVE_FIELDS.has(key) || AUTOSAVE_EXTRA_KEYS.has(key);
}

// Structural equality that survives a JSON round-trip, so an unchanged array or
// object never registers as an edit (the "second run reports nothing to do" rule).
const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Diff `updated` against the SAVED tool and keep only what may be written to
 * metadata alone.
 *
 * ⚠️ Diffing — rather than trusting a hand-built patch — is what catches the
 * §12 trap: a panel inside a buffered form hands over the whole DRAFT, so its
 * uncommitted geometry shows up here as changed keys and is dropped and
 * reported, instead of silently reaching metadata and inventing a false drift.
 *
 * Runtime `_`-prefixed keys are ignored outright: they are never persisted, so
 * reporting them as dropped would be noise on every call.
 *
 * @returns {{ patch: object, dropped: string[] }}
 */
export function metadataOnlyPatch(saved, updated) {
  const patch = {};
  const dropped = [];
  for (const key of Object.keys(updated || {})) {
    if (key.startsWith('_')) continue;
    if (same(saved?.[key], updated[key])) continue;
    if (isAutosavableKey(key)) patch[key] = updated[key];
    else dropped.push(key);
  }
  return { patch, dropped };
}
