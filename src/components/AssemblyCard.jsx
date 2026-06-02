import { useState } from 'react';
import { Pencil, X } from 'lucide-react';

function proshotUrl(id) {
  if (!id) return null;
  const prefix = id.split('-')[0];
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${id}$`;
}

export default function AssemblyCard({ assembly, tool, holders, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const holder = holders.find(h => h.guid === assembly.holder_guid);
  const holderDescription = assembly.holder_description || holder?.description || '—';
  const proshotId = tool.proshot_id || '';
  const machineNum = tool.machine_tool_number;
  const hasNum = machineNum !== null && machineNum !== undefined && machineNum !== '';

  const linkedPresets = (assembly.linked_preset_guids || [])
    .map(guid => tool.presets?.find(p => p.guid === guid))
    .filter(Boolean);

  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>

      {/* ── Operator tag ── */}
      <div className="operator-tag">
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
            >{proshotId}</a>
          ) : (
            <span className="tag-proshot-oval empty">—</span>
          )}
          <span className="tag-label" style={{ marginLeft: 'auto' }}>RTA</span>
          <span className="tag-rta-blank">___________</span>
        </div>

        {/* Holder */}
        <div className="tag-row">
          <span className="tag-label">Holder</span>
          <span className="tag-bold">{holderDescription}</span>
        </div>

        {/* OOH + LC */}
        <div className="tag-row">
          <span className="tag-label">OOH</span>
          <span className="tag-bold" style={{ flex: 'none', marginRight: 16 }}>
            {assembly.ooh != null ? `${assembly.ooh.toFixed(3)}"` : '—'}
          </span>
          <span className="tag-label">LC</span>
          <span className="tag-box">{hasNum ? machineNum : '—'}</span>
        </div>

        <div className="tag-divider" />

        {/* T## + tool description */}
        <div className="tag-row">
          <span className="tag-box" style={{ fontSize: 12 }}>{hasNum ? `T${machineNum}` : '—'}</span>
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
        <div style={{ padding: '10px 12px', background: 'var(--surface)', borderTop: '1px solid var(--red)' }}>
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
