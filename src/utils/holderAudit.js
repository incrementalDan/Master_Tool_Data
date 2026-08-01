// ─── Holder audit — the label-vs-geometry truth check ───────────────────────
//
// THE SAFETY INSIGHT THIS SERVES:
//
//     CAM reads the geometry. The operator reads the description.
//
// When those disagree, the machine and the human are working from different
// information. That is the failure mode that actually hurts. Consequences, and
// they are not obvious:
//
//   · Geometry drift ALONE is comparatively safe — a holder swapped for a
//     near-identical one gets proven out in CAM anyway.
//   · A description that no longer matches its geometry is DANGEROUS — the
//     operator sets up what the label says; CAM cut what the numbers said.
//
// Therefore matching is done on PARSED DESCRIPTION + GAUGE LENGTH, never
// segment-by-segment. If both of those agree, the odds the segments secretly
// differ are negligible, and segment diffing would bury the real signal in
// noise. Preserve that priority ordering.
//
// Everything here is pure scoring. Nothing writes; nothing auto-fixes.

import { holderOptionLabel, taperBase, taperLabelsLongestFirst } from '../schema/holderOptions.js';
import { deriveGaugeLength, holderLenIn } from './holderGeometry.js';

// Gauge-length tolerance, in inches. Beyond this is real drift, not noise.
export const HOLDER_GAUGE_TOL_IN = 0.005;

// Pull the comparable tokens out of a free-text description. DELIBERATELY
// NARROW — only the parts that identify WHICH holder this is.
export function parseForMatch(description, config) {
  const U = String(description || '').toUpperCase();
  const out = { taper: null, collet: null, length: null, hasExt: false, extCollet: null };

  for (const label of taperLabelsLongestFirst(config)) {
    if (U.replace(/[^A-Z0-9]/g, '').includes(label.replace(/[^A-Z0-9]/g, ''))) {
      out.taper = taperBase(label);
      break;
    }
  }

  const sk = U.match(/\bSK\s*(\d{1,2})C?\b/);
  if (sk) out.collet = `SK${sk[1]}`;

  const len = U.match(/SK\s*\d{1,2}C?\s*-?\s*(\d{2,3})\b/);
  if (len) out.length = parseInt(len[1], 10);

  const er = U.match(/\bER\s*(\d{1,2})\b/);
  const extWord = /\bEX(T|TENSION)?\b|\bEX\d|OOH/.test(U);
  if (er && (extWord || sk)) { out.hasExt = true; out.extCollet = `ER${er[1]}`; }
  else if (extWord) out.hasExt = true;

  return out;
}

// Score a tool's FROZEN description against the holder record it points at.
// Returns every component separately so the UI can report WHICH part failed —
// "75%" isn't actionable, "Length: 120 ≠ 60" is.
export function scoreDescription(description, holder, config, normalizeTaper = true) {
  const p = parseForMatch(description, config);
  const taperLabel = holderOptionLabel(config, 'tapers', holder?.taper_id) || '';
  const wantTaper = normalizeTaper ? taperBase(taperLabel) : taperLabel.toUpperCase();
  const gotTaper = normalizeTaper ? p.taper : (p.taper || '').toUpperCase();

  const parts = [
    { name: 'Taper', got: gotTaper || null, want: wantTaper || null },
    { name: 'Collet', got: p.collet, want: holderOptionLabel(config, 'collet_sizes', holder?.collet_size_id) },
    { name: 'Length', got: p.length, want: holder?.length ?? null },
    { name: 'Extension', got: p.hasExt, want: !!holder?.has_extension },
  ];
  if (holder?.has_extension || p.hasExt) {
    parts.push({
      name: 'Ext collet',
      got: p.extCollet,
      want: holderOptionLabel(config, 'collet_sizes', holder?.extension?.collet_size_id),
    });
  }

  const scored = parts.map(x => {
    // A component both sides leave blank is not a disagreement.
    const blank = (v) => v == null || v === '';
    if (blank(x.got) && blank(x.want)) return { ...x, ok: true, na: true };
    return { ...x, ok: String(x.got) === String(x.want) };
  });
  const applicable = scored.filter(x => !x.na);
  const pct = applicable.length
    ? Math.round((applicable.filter(x => x.ok).length / applicable.length) * 100)
    : 100;
  return { pct, parts: scored, failing: scored.filter(x => !x.ok) };
}

// Gauge comparison is always done in INCHES so an mm-native holder record and
// an inch-native frozen snapshot compare correctly against one tolerance.
export function scoreGauge(snapshotGauge, snapshotUnit, holder, tol = HOLDER_GAUGE_TOL_IN) {
  const currentIn = holderLenIn(deriveGaugeLength(holder?.segments), holder?.unit);
  const snapshotIn = snapshotGauge == null ? null : holderLenIn(snapshotGauge, snapshotUnit);
  if (snapshotIn == null || currentIn == null) {
    return { currentIn, snapshotIn: null, delta: null, within: false, unknown: true };
  }
  const delta = snapshotIn - currentIn;
  return { currentIn, snapshotIn, delta, within: Math.abs(delta) <= tol, unknown: false };
}

// The verdicts, ORDERED BY RISK — not by size of difference. A 100%-description
// tool whose geometry drifted is safe to bulk-fix. A tool whose description
// disagrees with its holder is dangerous no matter how small the number,
// because the operator and CAM are reading two different things.
export const HOLDER_VERDICTS = {
  ok: {
    key: 'ok', label: 'OK', tone: 'green', rank: 3, bulkFixable: false,
    note: null,
  },
  stale: {
    key: 'stale', label: 'Stale geometry', tone: 'amber', rank: 2, bulkFixable: true,
    note: 'Description matches; the holder was refined since this tool was made. Safe to re-stamp.',
  },
  conflict: {
    key: 'conflict', label: 'Description conflict', tone: 'red', rank: 0, bulkFixable: false,
    note: 'Geometry matches this holder but the description does not. The operator would read something different from what CAM cut.',
  },
  unmatched: {
    key: 'unmatched', label: 'Unmatched', tone: 'red', rank: 1, bulkFixable: false,
    note: 'Neither description nor gauge length matches. This is probably a different holder — relink by hand.',
  },
};

export function verdictOf(descScore, gaugeScore) {
  if (descScore.pct < 100) {
    return gaugeScore.within ? HOLDER_VERDICTS.conflict : HOLDER_VERDICTS.unmatched;
  }
  if (!gaugeScore.within) return HOLDER_VERDICTS.stale;
  return HOLDER_VERDICTS.ok;
}

// Score one tool snapshot against a holder record.
// `snapshot` = { description, gauge, unit } — the holder description and gauge
// length FROZEN into the tool by Fusion at copy time.
export function auditToolAgainstHolder(snapshot, holder, config, { normalizeTaper = true, tol } = {}) {
  const desc = scoreDescription(snapshot?.description, holder, config, normalizeTaper);
  const gauge = scoreGauge(snapshot?.gauge, snapshot?.unit, holder, tol);
  return { desc, gauge, verdict: verdictOf(desc, gauge) };
}

// Group scored rows by holder so a whole group can be corrected at once — the
// same stale holder is usually referenced in many places. Groups are ordered
// worst-first, and so are the rows inside them.
//
// ⚠️ Re-stamping must structurally EXCLUDE conflicts even when they sit in the
// same group: `group.restampable` is the only list a bulk fix may act on.
export function groupAuditByHolder(rows) {
  const byHolder = new Map();
  for (const row of rows || []) {
    const key = row.holder?.id;
    if (!key) continue;
    if (!byHolder.has(key)) byHolder.set(key, { holder: row.holder, tools: [] });
    byHolder.get(key).tools.push(row);
  }
  return [...byHolder.values()].map(g => {
    g.tools.sort((a, b) => a.verdict.rank - b.verdict.rank);
    g.counts = g.tools.reduce((a, t) => { a[t.verdict.key] = (a[t.verdict.key] || 0) + 1; return a; }, {});
    g.worst = Math.min(...g.tools.map(t => t.verdict.rank));
    g.restampable = g.tools.filter(t => t.verdict.bulkFixable);
    return g;
  }).sort((a, b) => a.worst - b.worst);
}
