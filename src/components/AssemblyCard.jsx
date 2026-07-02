import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { presetMatchesAssembly, presetMaterialColor } from '../utils/presetNaming.js';
import { unitAbbr } from '../utils/units.js';
import { useApp } from '../context/AppContext.jsx';

// ── Holder color system ───────────────────────────────────────────────────────
// Every holder SIZE carries its own color (the --holder-* design tokens). The
// .holder-pill class derives its fill/border/text from a single --badge-color,
// so holderColor() returns just that base color. Unknown holders get a stable
// hash-assigned color, falling back to the teal --holder-default.
const NAMED_COLORS = {
  'NBT30-SK13C-60':  '#06b6d4',  /* 30-SK13-60 · cyan */
  'NBT30-SK13C-90':  '#ec4899',  /* 30-SK13-90 · pink */
  'NBT30-SK13C-120': '#65a30d',  /* 30-SK13-120 · lime */
  'NBT30-SK13C-150': '#8b5cf6',  /* 30-SK13-150 · violet */
  'NBT30-SK20C-60':  '#eab308',  /* 30-SK20-60 · yellow */
  'NBT30-SK20C-90':  '#ef4444',  /* 30-SK20-90 · red */
  'DRILL CHUCK':     '#10b981',  /* drill chuck · green */
};

const HOLDER_DEFAULT = '#2dd4bf';  // teal — unknown / no holder
const FALLBACK = ['#ec4899', '#a855f7', '#14b8a6', '#fbbf24', '#ef4444', '#10b981'];

export function holderColor(description) {
  if (!description) return HOLDER_DEFAULT;
  const norm = description.trim().toUpperCase();
  if (NAMED_COLORS[norm]) return NAMED_COLORS[norm];
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0;
  }
  return FALLBACK[Math.abs(hash) % FALLBACK.length];
}

function fmtMeasured(v) {
  try { return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return v; }
}

export default function AssemblyCard({ assembly, tool, holders, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { materials, shopSettings } = useApp();
  // Retired assembly numbers are hidden by default (parallel to Tool ID's
  // show_legacy; a search match still surfaces one on the result card).
  const showLegacyAsm = shopSettings?.assembly_id_system?.show_legacy ?? false;
  const legacyAsm = Array.isArray(assembly.legacy_asm_numbers) ? assembly.legacy_asm_numbers : [];

  const holder = holders.find(h => h.guid === assembly.holder_guid);
  const holderDescription = assembly.holder_description || holder?.description || '—';
  const color = holderColor(holderDescription === '—' ? null : holderDescription);

  const linkedPresets = (tool.presets || []).filter(p => presetMatchesAssembly(p, assembly, tool.unit));

  return (
    <div style={{ border: '1px solid rgba(100, 116, 139, 0.30)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface-2)' }}>

      {/* Header: assembly ID (predominant) + holder pill + OOH + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
        {assembly.asm_number && (
          <span className="font-mono" title="Assembly ID" style={{
            fontSize: 13, fontWeight: 700, color: 'var(--blue)',
            background: 'color-mix(in srgb, var(--blue) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)',
            borderRadius: 6, padding: '2px 8px',
          }}>{assembly.asm_number}</span>
        )}
        <span className="holder-pill" style={{ '--badge-color': color }}>
          {holderDescription}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 'none', color: 'var(--text)' }}>
          {assembly.ooh != null ? `OOH: ${assembly.ooh.toFixed(3)} ${unitAbbr(tool.unit)}` : '—'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, flexShrink: 0 }}>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Edit assembly" onClick={() => onEdit(assembly)}>
            <Pencil size={11} />
          </button>
          <button className="icon-btn" style={{ width: 22, height: 22, color: 'var(--red)' }} title="Delete assembly" onClick={() => setConfirmDelete(true)}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Linked presets */}
      {linkedPresets.length > 0 && (
        <div className="assembly-presets">
          {linkedPresets.map((p) => (
            <span key={p.guid} className="preset-tag" style={{ '--badge-color': presetMaterialColor(p.material?.query, materials) || undefined }}>{p.name || 'Unnamed'}</span>
          ))}
        </div>
      )}

      {/* Former (retired) assembly numbers — e.g. an old ProShop RTA# after a
          renumber to Auto. Muted, gated on the Assembly ID System's show_legacy
          toggle (default off); a search match reveals it regardless. */}
      {showLegacyAsm && legacyAsm.length > 0 && (
        <div className="text-sub text-xs" style={{ padding: '2px 10px' }}>
          Formerly: <span className="font-mono">{legacyAsm.join(', ')}</span>
        </div>
      )}

      {/* Measured gauge length — the pre-setter reading, distinct from OOH and
          from Fusion's assemblyGaugeLength. Read-only; entry is future presetter
          work. target_gauge_length / measured_serial are data-only (no UI). */}
      <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
        <span className="text-sub">Measured gauge length: </span>
        {assembly.measured_gauge_length != null ? (
          <span className="font-mono" style={{ color: 'var(--text)' }}>
            {assembly.measured_gauge_length} {unitAbbr(tool.unit)}
            {assembly.measured_at && <span className="text-sub" style={{ fontWeight: 400 }}> · {fmtMeasured(assembly.measured_at)}</span>}
            {assembly.measured_by && <span className="text-sub" style={{ fontWeight: 400 }}> · {assembly.measured_by}</span>}
          </span>
        ) : (
          <span className="text-sub">Not yet measured</span>
        )}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ padding: '8px 10px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div className="text-sm" style={{ marginBottom: 6 }}>Remove this assembly? Linked presets will not be deleted.</div>
          <div className="flex gap-8">
            <button className="btn btn-danger btn-sm" onClick={() => { setConfirmDelete(false); onDelete(assembly.assembly_id); }}>Remove</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
