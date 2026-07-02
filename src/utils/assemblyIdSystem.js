// Assembly ID system — generates an assembly's human-readable number from the
// shop-wide scheme in shop_settings.assembly_id_system. This is the third of the
// three parallel identification systems (see THREE SYSTEM CONTEXT PROMPT.md); it
// follows the same shape as the Tool ID system: an explicit `mode` and a composed
// string stored on the assembly record (`asm_number`).
//
// `asm_number` is the assembly's DIGITAL reference and is MUTABLE — it can be
// reassigned/renumbered (a ProShop RTA#, an ERP id, or switching the shop to Auto)
// — so retired values are kept in legacy_asm_numbers[] exactly like tool_id →
// legacy_ids. BUT: Auto is a pure product of other fields (holder + tool_id + OOH),
// so an Auto value is always re-derivable and is NEVER retired. Legacy retention
// matters only when replacing a NON-derived external value (RTA / ERP / sequential
// serial) with a new one — e.g. renumbering from ProShop to Auto (see
// shouldRetireAsmNumber). The IMMUTABLE serialized ID is the separate physical
// measured_* layer (the presetter reading), not this digital reference.
//
// Modes:
//   auto         — {holderShort}{sep}{tool_id}{sep}{ooh}, generated once at
//                  assembly creation, immutable. e.g. "30-SK13-60-1001-2.125"
//   proshop_rta  — user-entered ProShop RTA# (Rotating Tool Assembly number);
//                  not auto-generated. CSV import/export format TBD.
//   sequential   — a plain incrementing integer from `serial_start`.
//   erp_external — reserved placeholder; not selectable yet.

import { holderShortName } from './holderNaming.js';

export const ASM_MODES = [
  { id: 'auto', label: 'Auto', desc: 'Composed from holder + Tool ID + OOH, e.g. 30-SK13-60-1001-2.125. Generated once, immutable.' },
  { id: 'proshop_rta', label: 'ProShop RTA#', desc: 'You enter the ProShop Rotating Tool Assembly number on each assembly.' },
  { id: 'sequential', label: 'Sequential', desc: 'A plain incrementing serial number — handy for presetter integration.' },
  { id: 'erp_external', label: 'Other ERP', desc: 'Reserved for a future in-house ERP source.', disabled: true },
];

// The separator for the auto format. The assembly system inherits the Tool ID
// system's separator when its own is null (per the prompt).
export function resolveAsmSeparator(asmConfig, toolIdConfig) {
  const s = asmConfig?.separator;
  if (s !== null && s !== undefined) return s;
  const t = toolIdConfig?.separator;
  return (t !== null && t !== undefined) ? t : '-';
}

// OOH as a token with no trailing zeros, in the tool's own unit (no conversion).
//   2.125 → "2.125", 2.5 → "2.5", 2.0 → "2", null → ""
export function trimOoh(ooh) {
  if (ooh === null || ooh === undefined || ooh === '') return '';
  const n = Number(ooh);
  if (Number.isNaN(n)) return '';
  return String(n);
}

// Last 6 chars of a UUID — the auto-mode fallback when a tool has no tool_id yet.
function last6(id) {
  const s = String(id || '').replace(/-/g, '');
  return s.slice(-6);
}

// The label shown next to the asm-number field for a given mode.
export function asmIdLabel(mode) {
  return mode === 'proshop_rta' ? 'RTA#' : 'Assembly ID';
}

// Whether the asm-number is a user-entered text field (ProShop RTA) vs generated.
export function isManualAsmMode(mode) {
  return mode === 'proshop_rta';
}

// Compose one assembly's number. `seqNumber` is the pre-computed serial for
// sequential mode. Returns '' when the mode doesn't auto-generate (RTA / ERP).
export function composeAsmNumber(asmConfig, toolIdConfig, asm, seqNumber) {
  const mode = asmConfig?.mode || 'auto';
  switch (mode) {
    case 'auto': {
      const sep = resolveAsmSeparator(asmConfig, toolIdConfig);
      const holderShort = holderShortName(asm?.holderDescription || '');
      const idPart = asm?.tool_id || last6(asm?.assembly_id);
      const oohPart = trimOoh(asm?.ooh);
      return [holderShort, idPart, oohPart].filter(p => p !== '' && p != null).join(sep);
    }
    case 'sequential':
      return seqNumber != null ? String(seqNumber) : '';
    case 'proshop_rta':
    case 'erp_external':
    default:
      return '';
  }
}

// The value Auto WOULD compose for an assembly, regardless of the active mode.
// Used to decide whether an old asm_number is a re-derivable Auto value (skip
// retirement) or an externally-assigned one (retire it).
export function autoAsmNumber(asmConfig, toolIdConfig, asm) {
  return composeAsmNumber({ ...asmConfig, mode: 'auto' }, toolIdConfig, asm);
}

// Whether an old asm_number should be retired into legacy_asm_numbers when it's
// being replaced. Only NON-derived external values (RTA / ERP / sequential) are
// worth keeping — an Auto value equals what Auto composes, so it's dropped
// (re-derivable). Empty old values are never retired.
export function shouldRetireAsmNumber(oldValue, autoComposed) {
  return !!oldValue && oldValue !== autoComposed;
}

// Serial numbers already taken across the library (plain integers only — that's
// what sequential mode emits). Used to pick the next free serial.
export function usedAsmSerials(tools) {
  const used = new Set();
  for (const t of tools || []) {
    for (const a of t.assemblies || []) {
      if (/^\d+$/.test(String(a.asm_number || ''))) used.add(Number(a.asm_number));
    }
  }
  return used;
}

// Next serial ≥ start not already used. Mirrors nextSequential (toolIdSystem.js).
export function nextAsmSerial(start, used = new Set()) {
  let n = Number(start) || 1;
  while (used.has(n)) n++;
  return n;
}

// A live preview for the Settings editor, using sample values.
export function previewAsmNumber(asmConfig, toolIdConfig) {
  const mode = asmConfig?.mode || 'auto';
  if (mode === 'sequential') return String(Number(asmConfig?.serial_start) || 10000);
  if (mode === 'proshop_rta') return 'RTA-1234 (entered per assembly)';
  if (mode === 'erp_external') return '—';
  return composeAsmNumber(asmConfig, toolIdConfig, {
    holderDescription: 'NBT30-SK13C-60', tool_id: '1001', ooh: 2.125,
  });
}

// Backfill auto-mode asm_number in-memory for assemblies missing one. Auto is
// deterministic (composed from holder/tool_id/ooh) so it's stable across loads;
// sequential/RTA are NOT backfilled here (they need stored state / user input —
// they get their number at assembly creation / entry). Returns a new tools array.
export function backfillAsmNumbers(tools, shopSettings) {
  const asmConfig = shopSettings?.assembly_id_system;
  if (!asmConfig || asmConfig.mode !== 'auto') return tools;
  const toolIdConfig = shopSettings?.tool_id_system;
  let changed = false;
  const next = (tools || []).map(t => {
    let touched = false;
    const assemblies = (t.assemblies || []).map(a => {
      if (a.asm_number) return a;
      const asm_number = composeAsmNumber(asmConfig, toolIdConfig, {
        holderDescription: a.holder_description, tool_id: t.tool_id, ooh: a.ooh, assembly_id: a.assembly_id,
      });
      if (!asm_number) return a;
      touched = true;
      return { ...a, asm_number };
    });
    if (!touched) return t;
    changed = true;
    return { ...t, assemblies };
  });
  return changed ? next : tools;
}
