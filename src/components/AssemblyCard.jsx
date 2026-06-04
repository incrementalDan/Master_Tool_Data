import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { presetMatchesAssembly } from '../utils/presetNaming.js';

// ── Holder color system ───────────────────────────────────────────────────────
const NAMED_COLORS = {
  'NBT30-SK13C-60':  { bg: 'rgba(6,182,212,0.20)',   border: '#06b6d4', text: '#22d3ee' },
  'NBT30-SK13C-90':  { bg: 'rgba(236,72,153,0.20)',  border: '#ec4899', text: '#f472b6' },
  'NBT30-SK13C-120': { bg: 'rgba(101,163,13,0.20)',  border: '#65a30d', text: '#a3e635' },
  'NBT30-SK13C-150': { bg: 'rgba(139,92,246,0.20)',  border: '#8b5cf6', text: '#a78bfa' },
  'NBT30-SK20C-60':  { bg: 'rgba(234,179,8,0.20)',   border: '#eab308', text: '#fde047' },
  'NBT30-SK20C-90':  { bg: 'rgba(239,68,68,0.20)',   border: '#ef4444', text: '#f87171' },
  'DRILL CHUCK':     { bg: 'rgba(16,185,129,0.20)',  border: '#10b981', text: '#34d399' },
};

const FALLBACK = [
  { bg: 'rgba(236,72,153,0.20)',  border: '#ec4899', text: '#f472b6' },
  { bg: 'rgba(168,85,247,0.20)',  border: '#a855f7', text: '#c084fc' },
  { bg: 'rgba(20,184,166,0.20)',  border: '#14b8a6', text: '#2dd4bf' },
  { bg: 'rgba(251,191,36,0.20)',  border: '#fbbf24', text: '#fde68a' },
  { bg: 'rgba(239,68,68,0.20)',   border: '#ef4444', text: '#f87171' },
  { bg: 'rgba(16,185,129,0.20)',  border: '#10b981', text: '#34d399' },
];

export function holderColor(description) {
  if (!description) return FALLBACK[0];
  const norm = description.trim().toUpperCase();
  if (NAMED_COLORS[norm]) return NAMED_COLORS[norm];
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0;
  }
  return FALLBACK[Math.abs(hash) % 6];
}

export default function AssemblyCard({ assembly, tool, holders, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const holder = holders.find(h => h.guid === assembly.holder_guid);
  const holderDescription = assembly.holder_description || holder?.description || '—';
  const color = holderColor(holderDescription === '—' ? null : holderDescription);

  const linkedPresets = (tool.presets || []).filter(p => presetMatchesAssembly(p, assembly));

  return (
    <div style={{ border: '1px solid rgba(100, 116, 139, 0.30)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface-2)' }}>

      {/* Header: holder pill + OOH + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
        <span className="holder-pill" style={{ background: color.bg, borderColor: color.border, color: color.text, fontSize: 11 }}>
          {holderDescription}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 'none', color: 'var(--text)' }}>
          {assembly.ooh != null ? `${assembly.ooh.toFixed(3)}"` : '—'}
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
            <span key={p.guid} className="preset-tag">{p.name || 'Unnamed'}</span>
          ))}
        </div>
      )}

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
