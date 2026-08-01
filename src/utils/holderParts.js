// ─── Holder parts — the body and the extension as their own records ─────────
//
// A BT-taper holder and an extension are TWO SEPARATE PARTS. You buy them
// separately, they live in separate drawers, they have their own part numbers
// and prices — and the shop assembles them at more than one stickout. Modelling
// each as its own record puts that information in ONE place instead of copying
// it onto every holder built from it.
//
// This is the same idea as an insert tool's holder body + insert (see
// schema/insertFamilies.js), with ONE deliberate difference: an insert tool's
// pairing keeps its geometry in Fusion, so its components carry only specs.
// Here the geometry is the shared thing — but a holder still STORES its own
// segments. The part is the source of truth for what the PART is (purchasing,
// location, part number) and a reference copy of its geometry; when a holder's
// geometry drifts from the part it points at, that is SURFACED, never
// auto-applied.
//
// Same shape as every other link in the app: store the id, derive what's shown,
// tolerate a dangling reference, and never silently overwrite.

import { generateId } from '../schema/identity.js';
import { normalizeUnit } from './units.js';
import {
  segmentsSignature, roleSegments, bodySignature, extensionSignature, baseHolderKey,
} from './holderBody.js';
import { holderOptionLabel } from '../schema/holderOptions.js';

export const HOLDER_PART_ROLES = ['body', 'extension'];
export const holderPartRoleLabel = (role) => (role === 'extension' ? 'Extension' : 'Holder body');

export function newHolderPart(role, overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    role: role === 'extension' ? 'extension' : 'body',
    description: '',
    unit: normalizeUnit(undefined),
    segments: [],

    // Classification, scoped to the role. A body is identified by its taper +
    // collet + engraved nominal; an extension by its collet size.
    taper_id: null,
    collet_size_id: null,
    length: null,

    // WHY THIS EXISTS: one place per physical part for the things you buy it by.
    manufacturer: '',
    part_number: '',
    vendor: '',
    purchasing: { manufacturers: [], vendors: [] },
    location: '',
    notes: '',

    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export const holderPartsOf = (file, role) =>
  (file?.parts || []).filter(p => !role || p.role === role);

export const findHolderPart = (file, id) =>
  (id ? (file?.parts || []).find(p => p.id === id) : null) || null;

// A holder's link for one role. Dangling ids are tolerated — the referenced
// part may have been deleted — and read as "not linked".
export const holderPartIdFor = (holder, role) =>
  (role === 'extension' ? holder?.extension_part_id : holder?.body_part_id) || null;

export const holderPartFor = (holder, role, file) =>
  findHolderPart(file, holderPartIdFor(holder, role));

// ─── Drift ──────────────────────────────────────────────────────────────────
// Does this holder's geometry still match the part it points at? Compared on
// the normalized signature, so an mm-native part and an inch-native holder of
// the same physical part agree.
//
// Returns null when there's nothing to say: not linked, the part is gone, or
// the holder's segments for that role aren't resolvable yet (an extension whose
// segments aren't flagged). Never "no drift" by assumption.
export function holderPartDrift(holder, role, file) {
  const part = holderPartFor(holder, role, file);
  if (!part) return null;
  const mine = roleSegments(holder, role);
  if (!mine) return null;
  const holderSig = segmentsSignature(mine, holder.unit);
  const partSig = segmentsSignature(part.segments, part.unit);
  if (holderSig == null || partSig == null) return null;
  if (holderSig === partSig) return null;
  return { role, part, holderSig, partSig };
}

// Every holder that has drifted from a part it points at (list-page filter).
export function holdersWithPartDrift(records, file) {
  const ids = new Set();
  for (const h of records || []) {
    for (const role of HOLDER_PART_ROLES) {
      if (holderPartDrift(h, role, file)) { ids.add(h.id); break; }
    }
  }
  return ids;
}

// Which holders point at a given part — "used by N holders", and the guard
// before deleting one.
export const holdersUsingPart = (part, records) =>
  (records || []).filter(h => holderPartIdFor(h, part?.role) === part?.id);

// ─── Adopting a holder's geometry into a part / vice versa ──────────────────
// Both directions are explicit user actions. Nothing here runs on its own.

// Copy the holder's current geometry for a role INTO the part (the holder is
// right, the part is stale).
export function adoptHolderGeometryIntoPart(part, holder, role) {
  const segs = roleSegments(holder, role);
  if (!segs) return part;
  return {
    ...part,
    unit: holder.unit,
    segments: segs.map(s => ({ ...s })),
    updated_at: new Date().toISOString(),
  };
}

// ─── Migration: propose parts from the existing records ─────────────────────
// Groups the library's holders by the physical base holder they're built on and
// proposes ONE body part per group, plus one extension part per distinct
// extension.
//
// ⚠️ A group whose records DISAGREE about the body still gets ONE part — seeded
// from the most common variant — and the odd records out are reported in
// `willDrift`. That is the point of this model: the disagreement stops being
// invisible duplication and becomes a drift flag on a named holder, which you
// fix when you get to it. The proposal picks a starting point for the LINK; it
// does not decide which geometry is correct, and it changes no holder's
// segments.
export function proposeHolderParts(records, config) {
  const bodies = new Map();      // baseKey → proposal
  const extensions = new Map();  // colletId|signature → proposal

  for (const h of records || []) {
    // ── body ──
    const key = baseHolderKey(h, config);
    const bodySig = bodySignature(h);
    if (key && bodySig != null) {
      if (!bodies.has(key)) bodies.set(key, { key, holders: [], sigs: new Map() });
      const g = bodies.get(key);
      g.holders.push(h);
      if (!g.sigs.has(bodySig)) g.sigs.set(bodySig, []);
      g.sigs.get(bodySig).push(h);
    }

    // ── extension ──
    const extSig = extensionSignature(h);
    const extCollet = h.extension?.collet_size_id || null;
    if (extSig != null) {
      const ekey = `${extCollet || '~'}|${extSig}`;
      if (!extensions.has(ekey)) extensions.set(ekey, { key: ekey, collet_size_id: extCollet, signature: extSig, holders: [] });
      extensions.get(ekey).holders.push(h);
    }
  }

  const bodyProposals = [...bodies.values()].map(g => {
    // Which variant seeds the part: most records first, then — when that ties,
    // which it does whenever two records simply disagree one-to-one — prefer a
    // variant containing a holder with NO extension. That isn't arbitrary: a
    // bare holder's segments ARE the body, with nothing subtracted, so it
    // doesn't depend on the extension flags being right. Deterministic either
    // way, so the preview always shows what commit will do.
    const variants = [...g.sigs.entries()]
      .map(([signature, hs]) => ({
        signature,
        holders: hs,
        bare: hs.some(h => !h.has_extension),
      }))
      .sort((a, b) => (b.holders.length - a.holders.length) || (Number(b.bare) - Number(a.bare)));
    const seed = variants[0].holders.find(h => !h.has_extension) || variants[0].holders[0];
    const [taper, collet, length] = g.key.split('|');
    return {
      role: 'body',
      key: g.key,
      label: `${holderOptionLabel(config, 'tapers', seed.taper_id) || taper}-${collet}-${length}`,
      seed,
      holders: g.holders,
      // Holders that will immediately show drift against this part, because
      // their body geometry differs from the seeded one.
      willDrift: variants.slice(1).flatMap(v => v.holders),
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const extProposals = [...extensions.values()].map(g => {
    const seed = g.holders[0];
    const colletLabel = holderOptionLabel(config, 'collet_sizes', g.collet_size_id) || 'Extension';
    const ooh = seed.segments.filter(s => s.ext).reduce((a, s) => a + (Number(s.height) || 0), 0);
    const oohIn = normalizeUnit(seed.unit) === 'millimeters' ? ooh / 25.4 : ooh;
    return {
      role: 'extension',
      key: g.key,
      label: `${colletLabel} EXT ${+oohIn.toFixed(3)}OOH`,
      collet_size_id: g.collet_size_id,
      seed,
      holders: g.holders,
      willDrift: [],
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  return { bodies: bodyProposals, extensions: extProposals };
}

// Turn an accepted proposal into a part record + the holder links it implies.
// Returns { part, links: [{ holderId, role, partId }] } — the caller commits
// both in one write.
export function buildPartFromProposal(proposal, config) {
  const seed = proposal.seed;
  const role = proposal.role;
  const segs = roleSegments(seed, role) || [];
  const part = newHolderPart(role, {
    description: proposal.label,
    unit: seed.unit,
    segments: segs.map(s => ({ ...s })),
    taper_id: role === 'body' ? seed.taper_id : null,
    collet_size_id: role === 'body' ? seed.collet_size_id : proposal.collet_size_id,
    length: role === 'body' ? seed.length : null,
    // Carry the sourcing off the seed record — it described this part, not the
    // assembly, so it belongs on the part from here on.
    manufacturer: seed.manufacturer || '',
    part_number: role === 'body' ? (seed.part_number || '') : (seed.extension?.part_number || ''),
    vendor: role === 'body' ? (seed.vendor || '') : (seed.extension?.vendor || ''),
    location: role === 'body' ? (seed.location || '') : '',
  });
  return {
    part,
    links: proposal.holders.map(h => ({ holderId: h.id, role, partId: part.id })),
  };
}

// Apply accepted proposals to the whole file in one pass: append the new parts
// and stamp the links onto their holders. Nothing else on a holder is touched —
// in particular no holder's segments change.
export function applyPartProposals(file, proposals, config) {
  const parts = [...(file?.parts || [])];
  const linkByHolder = new Map();
  for (const p of proposals || []) {
    const { part, links } = buildPartFromProposal(p, config);
    parts.push(part);
    for (const l of links) {
      if (!linkByHolder.has(l.holderId)) linkByHolder.set(l.holderId, {});
      linkByHolder.get(l.holderId)[l.role === 'extension' ? 'extension_part_id' : 'body_part_id'] = l.partId;
    }
  }
  const holders = (file?.holders || []).map(h =>
    linkByHolder.has(h.id) ? { ...h, ...linkByHolder.get(h.id) } : h);
  return { ...(file || { version: 1 }), holders, parts };
}
