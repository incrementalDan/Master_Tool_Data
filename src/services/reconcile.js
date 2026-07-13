// Reconcile a logical tool against the actual Fusion library.
//
// A logical tool is meant to have exactly one Fusion entry per registered
// assembly (holder + OOH). When someone copies a tool inside Fusion and dumps
// it straight into the master library — bypassing the app's Sync Job flow —
// extra entries appear that share the tool's tracking ID and/or ProShop number.
// This module classifies those stray entries so the app can prompt the user:
//
//   • duplicate    — identical to a registered assembly (same holder/OOH and no
//                    other differences) → offer to delete the redundant entry.
//   • newAssembly  — same tool, only holder/OOH differs → offer add or delete.
//   • conflict     — differs beyond holder/OOH (speeds, geometry, presets, …)
//                    → flag for manual review (Sync Job diff).
//
// Identity is matched on tracking ID OR ProShop number. The shared signature
// deliberately excludes the per-instance dimensions (holder + geometry.LB/OOH)
// and assemblyGaugeLength, which legitimately vary between assemblies.

import { readOohFromFusion } from '../schema/toolSchema.js';

const r4 = (n) => { const v = Number(n); return isNaN(v) ? null : Math.round(v * 1e4) / 1e4; };
const r6 = (n) => { const v = Number(n); return isNaN(v) ? null : Math.round(v * 1e6) / 1e6; };

function presetSig(p) {
  return {
    name: String(p?.name || ''),
    n: r4(p?.n), n_ramp: r4(p?.n_ramp), v_c: r4(p?.v_c),
    v_f: r4(p?.v_f), f_z: r6(p?.f_z), f_n: r6(p?.f_n),
    v_f_plunge: r4(p?.v_f_plunge), v_f_ramp: r4(p?.v_f_ramp),
    v_f_leadIn: r4(p?.v_f_leadIn), v_f_leadOut: r4(p?.v_f_leadOut),
    v_f_transition: r4(p?.v_f_transition),
  };
}

// A normalized, comparable fingerprint of everything that is SHARED across a
// logical tool's instances (i.e. everything except holder + OOH).
// Deliberately EXCLUDES the loosely-controlled fields that resolve by rule rather
// than flag (see the per-field merge policy): `description` (may differ across
// copies, e.g. a " (copy)" suffix), `overall-length` (biggest wins), and
// `shoulder-length` (smallest wins; ProShop MIN OOH locks it later). A difference
// in only those must classify as a new assembly, never a conflict.
export function sharedSignature(raw) {
  const geo = raw.geometry || {};
  const presets = (raw['start-values']?.presets || [])
    .map(presetSig)
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({
    type: raw.type || '',
    dc: r4(geo.DC), lcf: r4(geo.LCF),
    nof: geo.NOF ?? null, re: r4(geo.RE), sfdm: r4(geo.SFDM),
    ta: r4(geo.TA),
    sig: r4(geo.SIG), tp: r6(geo.TP),
    material: raw.BMC || '',
    pid: raw['product-id'] || '', presets,
  });
}

// Per-instance signature: which holder + OOH this entry represents.
export function instanceSig(raw) {
  const ooh = readOohFromFusion(raw);
  return `${raw.holder?.guid || ''}|${r4(ooh ?? 0)}`;
}

const EMPTY = { duplicates: [], newAssemblies: [], conflicts: [] };

// Classify every stray entry (matching the tool but not a registered instance).
//   matchingRaws         — raw Fusion entries sharing the tool's tracking ID or ProShop #
//   registeredAssemblies — the tool's metadata assemblies [{ instance_guid, holder_guid, ooh }]
//   canonicalRaw         — the tool's primary raw entry (shared-field reference)
export function classifyStrays({ matchingRaws = [], registeredAssemblies = [], canonicalRaw = null }) {
  if (matchingRaws.length <= 1 && !canonicalRaw) return { ...EMPTY };

  const registeredGuids = new Set(registeredAssemblies.map(a => a.instance_guid).filter(Boolean));
  const registeredRaws = matchingRaws.filter(r => registeredGuids.has(r.guid));
  const refRaw = canonicalRaw || registeredRaws[0] || matchingRaws[0] || null;
  const refSig = refRaw ? sharedSignature(refRaw) : null;

  // Is there a metadata registry to compare against? Without one (e.g. Google
  // Drive not connected) we can't tell a legitimate extra assembly from a newly
  // dumped one, so "new assembly" detection is disabled — only true duplicates
  // and conflicts surface, and distinct holder/OOH instances are kept silently.
  const hasRegistry = registeredGuids.size > 0;

  // Known (holder, OOH) combinations already accounted for.
  const keptSigs = new Set();
  if (registeredRaws.length) registeredRaws.forEach(r => keptSigs.add(instanceSig(r)));
  else if (hasRegistry) registeredAssemblies.forEach(a => keptSigs.add(`${a.holder_guid || ''}|${r4(a.ooh ?? 0)}`));
  if (refRaw) keptSigs.add(instanceSig(refRaw));

  const duplicates = [], newAssemblies = [], conflicts = [];
  for (const raw of matchingRaws) {
    if (registeredGuids.has(raw.guid)) continue;        // a known instance — leave it
    if (refRaw && raw.guid === refRaw.guid) continue;   // the canonical entry itself

    const item = {
      raw,
      guid: raw.guid,
      holderGuid: raw.holder?.guid || null,
      holderDescription: raw.holder?.description || '',
      ooh: readOohFromFusion(raw),
    };

    if (refSig && sharedSignature(raw) !== refSig) {
      conflicts.push(item);
      continue;
    }
    const isig = instanceSig(raw);
    if (keptSigs.has(isig)) {
      duplicates.push(item);            // a second entry for a known holder/OOH
    } else if (hasRegistry) {
      newAssemblies.push(item);         // unregistered holder/OOH → new assembly
      keptSigs.add(isig);               // later identical entries count as duplicates
    } else {
      keptSigs.add(isig);               // no registry → treat as a legit instance
    }
  }
  return { duplicates, newAssemblies, conflicts };
}

export function hasReconcileWork(results) {
  return !!results && (
    results.duplicates.length > 0 ||
    results.newAssemblies.length > 0 ||
    results.conflicts.length > 0
  );
}
