// ─── Holder descriptions — compose (suggest) and heal (parse) ───────────────
//
// ⚠️ THE CASCADE RISK — holder descriptions are LOAD-BEARING.
// holderShortName() parses a description → that token feeds preset names and
// asm_number → and presetMatchesAssembly links presets back to assemblies by
// parsing the short name out of the preset name. A stale value there SILENTLY
// ORPHANS THE PRESET (CLAUDE.md is explicit about this).
//
// So the two functions here are deliberately both inert:
//   · composeHolderDescription is a SUGGESTION. Nothing calls it to rewrite a
//     stored description — the editor shows it next to the field and the user
//     applies it with an explicit click, then still has to save. A hand-typed
//     description is protected by `description_manual`, the same nameManual +
//     "↺ Auto" pattern the preset names use.
//   · healHolderDescription fills STRUCTURED FIELDS from a legacy free-text
//     name. It never rewrites the description itself, and it is surfaced as a
//     preview→commit action (the normalizeLibrary / NormalizeModal pattern),
//     never applied silently on load or import.
//
// Any change here that could alter a description must be previewed old → new
// with the affected presets listed. Confirm before any bulk description
// rewrite.

import { holderOptions, holderOptionLabel } from '../schema/holderOptions.js';
import {
  deriveExtensionOoh, deriveExtensionShankDia, segHeight,
  holderLenIn, trimHolderLen, formatHolderLen,
} from './holderGeometry.js';
import { convertLength } from './units.js';

// The practical description length. ⚠️ This comes from the shop's PHYSICAL TOOL
// TAGS, not from Fusion — it is a soft guide the shop already hand-shortens
// against, and it is expected to be revisited. One named constant so the number
// never gets scattered.
export const HOLDER_DESC_LIMIT = 64;

// Normalized label compare — "SK 13" / "sk13" / "SK13C" all reach the SK13
// option.
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function findHolderOptionByLabel(config, list, label) {
  if (!label) return null;
  const want = norm(label);
  return holderOptions(config, list).find(o => norm(o.label) === want) || null;
}

// ─── Auto-suggested description ─────────────────────────────────────────────
// Composed from the structured fields. Real targets from the shop's library:
//   NBT30-SK13C-60
//   NBT30-SK13C-60 w/ ER8 EXT 1.2OOH
//   NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75
//   NBT30SK13-90 -ER16 TAP C EX2.33OOH
// The last two are hand-shortened variants — which is exactly why this is a
// suggestion and not a normalizer.
//
// Two deliberate asymmetries:
//   · Extension OOH ALWAYS prints in inches, matching the real descriptions,
//     even on an mm-native holder.
//   · Shank diameter prints in the HOLDER'S OWN unit ("Shank 12mm" vs
//     "Shank .75") — if it's a 12mm shank that's what belongs on the tag.
export function composeHolderDescription(holder, config) {
  if (!holder) return '';
  const taper = holderOptionLabel(config, 'tapers', holder.taper_id);
  const collet = holderOptionLabel(config, 'collet_sizes', holder.collet_size_id);
  const bits = [];

  let head = taper || '';
  if (collet) head += `${head ? '-' : ''}${collet}C`;
  if (holder.length) head += `${head ? '-' : ''}${holder.length}`;
  if (head) bits.push(head);

  if (holder.has_extension) {
    const extCollet = holderOptionLabel(config, 'collet_sizes', holder.extension?.collet_size_id);
    const ooh = deriveExtensionOoh(holder.segments);
    const oohIn = ooh != null ? +holderLenIn(ooh, holder.unit).toFixed(3) : null;
    let e = 'w/';
    if (extCollet) e += ` ${extCollet}`;
    if (holder.is_tap_collet) e += ' TAP C';
    e += ' EXT';
    if (oohIn != null) e += ` ${oohIn}OOH`;
    bits.push(e);
  } else if (holder.is_tap_collet) {
    bits.push('TAP C');
  }

  const shank = deriveExtensionShankDia(holder.segments);
  if (holder.has_extension && shank != null) {
    const shown = trimHolderLen(shank, holder.unit);
    // Inches match the shop's convention: no unit suffix, no leading zero
    // ("Shank .75"). Metric gets an explicit "mm" to disambiguate.
    bits.push(holder.unit === 'millimeters' ? `Shank ${shown}mm` : `Shank ${String(shown).replace(/^0(?=\.)/, '')}`);
  }

  return bits.join(' ');
}

// Is the stored description still the one the composer would produce? Used only
// to decide whether to OFFER the suggestion — never to apply it.
export const descriptionMatchesAuto = (holder, config) =>
  (holder?.description || '').trim() === composeHolderDescription(holder, config).trim();

// ─── The holder name healer ─────────────────────────────────────────────────
// Parses a legacy free-text description into structured fields. The real names
// are regular enough that most resolve cleanly; the rest are FLAGGED rather
// than guessed. Returns option IDS (resolved against the shared lookups) so the
// caller can commit them straight onto a record.
//
// Confidence grades the whole parse: high = everything identifying resolved,
// medium = resolved but something needs a human (e.g. an extension whose
// segments still need flagging), low = a core component didn't resolve at all.
export function healHolderDescription(description, config) {
  const out = { matched: {}, labels: {}, confidence: 'high', flags: [] };
  const U = String(description || '').toUpperCase();
  const lower = (level) => {
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[level] > rank[out.confidence]) out.confidence = level;
  };

  const setOpt = (field, list, label) => {
    const opt = findHolderOptionByLabel(config, list, label);
    if (opt) { out.matched[field] = opt.id; out.labels[field] = opt.label; return true; }
    return false;
  };

  // ── Taper — longest first so NBT30/BBT30 beat BT30. ⚠️ The ordering must be
  //    by the DUAL-CONTACT-STRIPPED label ("BT30 Dual Contact" matches on
  //    "BT30", 4 chars), not the full one — sorting by the full label let the
  //    17-character "BT30 Dual Contact" test its 4-character stem before
  //    "NBT30" and swallow every NBT30 holder. ──
  const taperCandidates = holderOptions(config, 'tapers')
    .map(t => ({ label: t.label, plain: String(t.label).replace(/\s*dual\s*contact/i, '').trim() }))
    .filter(t => t.plain)
    .sort((a, b) => norm(b.plain).length - norm(a.plain).length);
  let taperHit = null;
  for (const t of taperCandidates) {
    if (norm(U).includes(norm(t.plain))) { taperHit = t.label; break; }
  }
  // "DC" / "Dual Contact" written as a standalone marker upgrades a plain taper
  // to its dual-contact variant when the lookup has one.
  if (taperHit && /\bDC\b|DUAL\s*CONTACT/.test(U)) {
    const dc = holderOptions(config, 'tapers')
      .find(t => t.dual_contact && norm(t.label).startsWith(norm(taperHit)));
    if (dc) taperHit = dc.label;
  }
  if (taperHit) setOpt('taper_id', 'tapers', taperHit);
  else { lower('low'); out.flags.push('No taper recognized'); }

  // ── Collet — SK<n> or ER<n>, optional trailing C ──
  const sk = U.match(/\bSK\s*(\d{1,2})C?\b/);
  if (sk) {
    setOpt('collet_family_id', 'collet_families', 'SK');
    if (!setOpt('collet_size_id', 'collet_sizes', `SK${sk[1]}`)) {
      lower('medium');
      out.flags.push(`Collet size SK${sk[1]} is not in the shared list — add it as a custom option`);
    }
    setOpt('type_id', 'types', 'Collet');
  }

  // ── Extension collet — an ER token, usually alongside EX/EXT/EXTENSION ──
  const er = U.match(/\bER\s*(\d{1,2})\b/);
  const hasExtWord = /\bEX(T|TENSION)?\b|\bEX\d/.test(U);
  if (er && (hasExtWord || sk)) {
    out.matched.has_extension = true;
    const extOpt = findHolderOptionByLabel(config, 'collet_sizes', `ER${er[1]}`);
    if (extOpt) { out.matched.ext_collet_size_id = extOpt.id; out.labels.ext_collet_size_id = extOpt.label; }
    if (!sk) {
      setOpt('collet_family_id', 'collet_families', 'ER');
      setOpt('collet_size_id', 'collet_sizes', `ER${er[1]}`);
      setOpt('type_id', 'types', 'Collet');
    }
  }

  // ── Holder length — the number right after the collet token ──
  const len = U.match(/SK\s*\d{1,2}C?\s*-?\s*(\d{2,3})\b/);
  if (len) out.matched.length = parseInt(len[1], 10);

  // ── Extension OOH — a number adjacent to "OOH" in any of the orders seen:
  //    "OOH1.22" | "OOH 2.2" | "EXT 2.5 OOH" | "EX2.33OOH" | "1.2OOH" ──
  const ooh = U.match(/OOH\s*([\d.]+)/) || U.match(/([\d.]+)\s*OOH/) || U.match(/EX\s*([\d.]+)\s*OOH/);
  if (ooh) {
    out.matched.ext_ooh_in = parseFloat(ooh[1]);
    out.matched.has_extension = true;
  }
  if (out.matched.has_extension && out.matched.ext_ooh_in == null) {
    lower('medium');
    out.flags.push('Extension found but no OOH — flag the extension segments by hand');
  }

  // ── Tap collet ──
  if (/\bTAP\b/.test(U)) out.matched.is_tap_collet = true;

  // ── Shank — a HINT ONLY, never a committable field. The shank diameter comes
  //    from marking a segment (shank_seg), which text can't decide: which of
  //    possibly several extension segments is the mating shank? Surface the
  //    number as a pointer for the human. ──
  const shank = U.match(/SHANK\s*\.?([\d.]+)/);
  const mmShank = U.match(/\b(\d{1,2})\s*MM\b/);
  if (shank) {
    lower('medium');
    out.flags.push(`Name mentions "Shank ${shank[1]}" — mark the matching segment as the shank`);
  } else if (mmShank) {
    lower('medium');
    out.flags.push(`Name mentions "${mmShank[0]}" — may be a shank dimension, mark the matching segment`);
  }

  // ── Non-collet types by keyword ──
  if (/DRILL\s*CHUCK/.test(U)) { setOpt('type_id', 'types', 'Drill Chuck'); delete out.matched.collet_size_id; }
  if (/SHELL\s*MILL|FACE\s*MILL/.test(U)) { setOpt('type_id', 'types', 'Shell Mill'); delete out.matched.collet_size_id; }
  if (/BORING|EWN|CKB/.test(U)) { setOpt('type_id', 'types', 'Boring Head'); delete out.matched.collet_size_id; }

  if (!out.matched.type_id) { lower('low'); out.flags.push('No holder type recognized'); }
  // Free-text prose = a hand-written name, not a spec string.
  if (/HOLDER FOR|FOR\s+\w+\s+\d/.test(U)) {
    lower('low');
    out.flags.push('Descriptive prose — needs manual classification');
  }
  return out;
}

// Apply a heal result onto a record. Only the fields the parse actually
// resolved are written; the DESCRIPTION IS NEVER TOUCHED. Committing this is
// the user's explicit action from the preview.
export function applyHealToRecord(record, heal) {
  if (!record || !heal) return record;
  const m = heal.matched || {};
  const next = { ...record };
  if (m.type_id) next.type_id = m.type_id;
  if (m.taper_id) next.taper_id = m.taper_id;
  if (m.collet_family_id) next.collet_family_id = m.collet_family_id;
  if (m.collet_size_id) next.collet_size_id = m.collet_size_id;
  if (m.length != null) next.length = m.length;
  if (m.is_tap_collet) next.is_tap_collet = true;
  if (m.has_extension) {
    next.has_extension = true;
    next.extension = { ...(record.extension || {}) };
    if (m.ext_collet_size_id) next.extension.collet_size_id = m.ext_collet_size_id;
  }
  next.updated_at = new Date().toISOString();
  return next;
}

// ─── Extension-segment suggestion ───────────────────────────────────────────
// The verified insight: an extension is one (or a few) extra segments at the
// TIP, and their heights sum to the OOH printed in the description. So when the
// healer read an OOH out of the name, the tip segments that add up to it can be
// proposed. Returns the segment indices to flag, or null when no run matches —
// suggestion only, shown in the preview for the user to accept.
// ⚠️ The tolerance is DELIBERATELY LOOSE (0.02" ≈ 0.5mm), because the OOH in a
// description is a hand-written, hand-rounded number, not a measurement. Real
// case: "NBT30-SK13C-120 er16 12mm shank ext OOH2.5" has a 3-segment extension
// summing to 63.8mm = 2.512", so a tight tolerance proposes nothing on exactly
// the holders that most need the help. A wrong run is unlikely to sneak in —
// segment heights are ≥1mm, well outside the band — and the closest run wins
// rather than the first one that fits.
export function suggestExtensionSegments(holder, oohIn, tolIn = 0.02) {
  const segs = holder?.segments || [];
  if (!segs.length || oohIn == null) return null;
  const tol = convertLength(tolIn, 'inches', holder.unit);
  const target = convertLength(oohIn, 'inches', holder.unit);
  let sum = 0;
  let best = null;
  // The array is bottom-up, so the tip is index 0 — walk forward from it.
  for (let i = 0; i < segs.length; i++) {
    sum += segHeight(segs[i]);
    const err = Math.abs(sum - target);
    if (err <= tol && (best == null || err < best.err)) best = { i, err };
    if (sum - target > tol) break;   // past the target — nothing longer can fit
  }
  return best ? Array.from({ length: best.i + 1 }, (_, k) => k) : null;
}

export { formatHolderLen };
