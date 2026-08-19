// Comparing two versions of a program's Sequence Detail, row by row.
//
// Pure (no React, no Drive). The caller fetches two posted CSVs, parses each
// with parseSequenceCsv, and hands the row arrays here; this decides which row
// on the left is which row on the right, and which cells differ.
//
// ⚠️ THIS IS REFERENCE ONLY. It never blocks, never corrects, and never feeds
// the import. The CSV is still a pass-through of proven job data (see
// sequenceDetail.js) — comparing two of them changes neither.
//
// ── Why not a plain LCS ──────────────────────────────────────────────────────
// ⚠️ ORDER IS THE POINT. The order of operations is what the machine does, so a
// toolpath that moved is a CHANGE, not a match found somewhere else. A textbook
// LCS is order-preserving but will happily pair a row with its twin far down the
// file, quietly reporting a move as "unchanged" and everything between it as
// inserted. So the alignment walks both files FORWARD ONLY and will only resync
// within a bounded LOOKAHEAD (`MATCH_WINDOW`): past that, the rows are reported
// as removed and added where they actually are. Cheap, and it says the true
// thing.
//
// ── Why Seq# is not the key ──────────────────────────────────────────────────
// ⚠️ A sequence number is emitted on tool change, so inserting ONE operation
// shifts every number after it. Keying on Seq# would make a single insertion
// light up the whole rest of the program — the exact failure a compare exists to
// prevent. Seq# is therefore DISPLAYED but never COMPARED: its changing is the
// symptom of an added/removed row, which the alignment reports directly.
import { proShopIdKey } from './sequenceDetail.js';

// How far ahead to look for a resync before giving up and calling the rows
// added/removed in place. Small on purpose — see the order note above.
export const MATCH_WINDOW = 8;

// The fields actually compared, in the order the table shows them.
// Deliberately NOT compared: `seq` (see above), and cut_dia / tip / lc / rta /
// gage, which the shop doesn't read on a version compare.
export const COMPARE_FIELDS = [
  { key: 'description',   label: 'Sequence Description' },
  { key: 'tool_id',       label: 'ProShop Tool #' },
  { key: 't',             label: 'G-Code T#' },
  { key: 't_description', label: 'Description' },
  { key: 'holder',        label: 'Holder' },
  { key: 'ooh',           label: 'OOH' },
];

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

// ⚠️ A number is compared as a NUMBER. The post writes `0.70` where an older one
// wrote `0.7`; those are the same stick-out, and treating them as a difference
// would light up every row in the file from a formatting change alone. Storage
// and display still keep the CSV's own string — this is comparison only.
export function valuesEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (String(a ?? '').trim() !== '' && String(b ?? '').trim() !== ''
      && Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb;
  }
  return norm(a) === norm(b);
}

// ── Identity ─────────────────────────────────────────────────────────────────
// What makes two rows THE SAME OPERATION across two posts: the toolpath's name
// plus the tool it runs. Deliberately excludes holder and OOH — those are the
// changes most worth SEEING, so they must not break the match and turn an edit
// into a remove+add pair.
export const rowIdentity = (r) => `${norm(r?.description)}|${proShopIdKey(r?.tool_id)}`;

export const rowsMatch = (a, b) => rowIdentity(a) === rowIdentity(b);

// Half an identity. Used only inside a replace block, to decide whether two rows
// sitting opposite each other are one operation that was edited (a refined
// toolpath name, or the same name moved to a different tool) or two unrelated
// operations that happen to be in the same place. Pairing unrelated rows would
// claim an edit that never happened.
export function rowsRelated(a, b) {
  if (!a || !b) return false;
  const sameName = norm(a.description) !== '' && norm(a.description) === norm(b.description);
  const sameTool = proShopIdKey(a.tool_id) !== '' && proShopIdKey(a.tool_id) === proShopIdKey(b.tool_id);
  return sameName || sameTool;
}

// Which compared cells differ between two rows.
export function changedFields(a, b) {
  const out = [];
  for (const f of COMPARE_FIELDS) {
    if (!valuesEqual(a?.[f.key], b?.[f.key])) out.push(f.key);
  }
  return out;
}

// ── Alignment ────────────────────────────────────────────────────────────────
// Returns one entry per displayed table row, IN FILE ORDER:
//   { status: 'same' | 'changed' | 'added' | 'removed', left, right, changes[] }
// `left` is the old version's row (null for 'added'), `right` the new one (null
// for 'removed') — so a blank cell in the table is a genuinely absent row.
export function alignSequenceRows(oldRows = [], newRows = [], { window = MATCH_WINDOW } = {}) {
  const out = [];
  let i = 0;
  let j = 0;

  // Pair rows across a replace block positionally, but only where they are
  // plausibly the same operation; anything else is a real remove and a real add.
  const emitBlock = (di, dj) => {
    const k = Math.min(di, dj);
    let paired = 0;
    for (let t = 0; t < k; t++) {
      const l = oldRows[i + t];
      const r = newRows[j + t];
      if (rowsRelated(l, r)) { out.push({ status: 'changed', left: l, right: r, changes: changedFields(l, r) }); paired++; }
      else break;   // once they stop lining up, stop guessing
    }
    for (let t = paired; t < di; t++) out.push({ status: 'removed', left: oldRows[i + t], right: null, changes: [] });
    for (let t = paired; t < dj; t++) out.push({ status: 'added', left: null, right: newRows[j + t], changes: [] });
    i += di;
    j += dj;
  };

  while (i < oldRows.length || j < newRows.length) {
    if (i >= oldRows.length) { out.push({ status: 'added', left: null, right: newRows[j++], changes: [] }); continue; }
    if (j >= newRows.length) { out.push({ status: 'removed', left: oldRows[i++], right: null, changes: [] }); continue; }

    if (rowsMatch(oldRows[i], newRows[j])) {
      const changes = changedFields(oldRows[i], newRows[j]);
      out.push({ status: changes.length ? 'changed' : 'same', left: oldRows[i], right: newRows[j], changes });
      i++; j++;
      continue;
    }

    // Mismatch — look for the nearest resync point, preferring the smallest
    // total skip and then the most balanced one (a same-length run is an edit;
    // a lopsided one is a genuine insertion or deletion).
    let best = null;
    for (let total = 1; total <= window * 2 && !best; total++) {
      for (let di = Math.max(0, total - window); di <= Math.min(total, window); di++) {
        const dj = total - di;
        if (dj > window) continue;
        if (i + di >= oldRows.length || j + dj >= newRows.length) continue;
        if (rowsMatch(oldRows[i + di], newRows[j + dj])) {
          if (!best || Math.abs(di - dj) < Math.abs(best.di - best.dj)) best = { di, dj };
        }
      }
    }

    // No resync inside the window: the tails have diverged, so align what is
    // left of each and stop looking. Reaching further would be exactly the
    // far-apart match this design refuses to make.
    if (!best) best = { di: oldRows.length - i, dj: newRows.length - j };
    emitBlock(best.di, best.dj);
  }

  return out;
}

// A one-line headline for the dialog: how much actually moved.
export function compareSummary(pairs = []) {
  const s = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const p of pairs) s[p.status]++;
  s.total = pairs.length;
  s.identical = s.changed === 0 && s.added === 0 && s.removed === 0;
  return s;
}
