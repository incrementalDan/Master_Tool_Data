import { useState } from 'react';
import { Pencil, X } from 'lucide-react';

function proshotUrl(id) {
  if (!id) return null;
  const prefix = id.split('-')[0];
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${id}$`;
}

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

  const proshotId = tool.proshot_id || '';
  const machineNum = tool.machine_tool_number;
  const hasNum = machineNum !== null && machineNum !== undefined && machineNum !== '';
  const location = tool.location || '';
  const hasLocation = location.trim() !== '';

  const linkedPresets = (assembly.linked_preset_guids || [])
    .map(guid => tool.presets?.find(p => p.guid === guid))
    .filter(Boolean);

  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: color.bg }}>

      {/* ── Operator tag ── */}
      <div className="operator-tag" style={{ background: 'transparent', border: 'none' }}>
        <div className="tag-actions">
          <button className="icon-btn" style={{ width: 24, height: 24 }} title="Edit assembly" onClick={() => onEdit(assembly)}>
            <Pencil size={11} />
          </button>
          <button className="icon-btn" style={{ width: 24, height: 24, color: 'var(--red)' }} title="Delete assembly" onClick={() => setConfirmDelete(true)}>
            <X size={11} />
          </button>
        </div>

        {/* Tool ID + RTA */}
        <div className="tag-row">
          <span className="tag-label">Tool</span>
          {proshotId ? (
            <a
              className="tag-proshot-oval"
              href={proshotUrl(proshotId)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in ProShop"
              style={{ borderColor: color.text, color: color.text }}
            >{proshotId}</a>
          ) : (
            <span className="tag-proshot-oval empty">—</span>
          )}
          <span className="tag-label" style={{ marginLeft: 'auto' }}>RTA</span>
          <span className="tag-rta-blank">___________</span>
        </div>

        {/* Holder — as colored pill */}
        <div className="tag-row">
          <span className="tag-label">Holder</span>
          <span className="holder-pill" style={{ background: color.bg, borderColor: color.border, color: color.text }}>
            {holderDescription}
          </span>
        </div>

        {/* OOH + LC */}
        <div className="tag-row">
          <span className="tag-label">OOH</span>
          <span style={{ fontWeight: 700, flex: 'none', marginRight: 16, color: color.text }}>
            {assembly.ooh != null ? `${assembly.ooh.toFixed(3)}"` : '—'}
          </span>
          <span className="tag-label">LC</span>
          <span className="tag-box" style={{ borderColor: color.text, color: color.text }}>
            {hasLocation ? location : '—'}
          </span>
        </div>

        <div className="tag-divider" style={{ background: color.border, opacity: 0.4 }} />

        {/* T## + tool description */}
        <div className="tag-row">
          <span className="tag-box" style={{ fontSize: 12, borderColor: color.text, color: color.text }}>
            {hasNum ? `T${machineNum}` : '—'}
          </span>
          <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tool.description || '—'}
          </span>
        </div>
      </div>

      {/* ── Linked presets (outside tag, inside card) ── */}
      {linkedPresets.length > 0 && (
        <div className="assembly-presets">
          <span style={{ fontWeight: 600, color: 'var(--text-label)', marginRight: 6 }}>Presets:</span>
          {linkedPresets.map((p, i) => (
            <span key={p.guid}>
              {p.name}{i < linkedPresets.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

      {/* ── Notes ── */}
      {assembly.notes && (
        <div className="assembly-notes">{assembly.notes}</div>
      )}

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <div style={{ padding: '10px 12px', background: 'var(--surface)', borderTop: `1px solid ${color.border}` }}>
          <div className="text-sm" style={{ marginBottom: 8 }}>Remove this assembly? Linked presets will not be deleted.</div>
          <div className="flex gap-8">
            <button className="btn btn-danger btn-sm" onClick={() => { setConfirmDelete(false); onDelete(assembly.assembly_id); }}>Remove</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
