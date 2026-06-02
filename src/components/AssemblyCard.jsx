import { useState } from 'react';
import { Pencil, X, Tag } from 'lucide-react';

// Operator tag shown on each assembly card — matches the physical job tag.
function OperatorTag({ machineToolNumber, holderDescription, ooh }) {
  const hasNum = machineToolNumber !== null && machineToolNumber !== undefined && machineToolNumber !== '';
  return (
    <div style={{
      marginTop: 12,
      padding: '10px 12px',
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--orange)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--orange)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <Tag size={11} /> Operator Tag
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontFamily: 'var(--font-mono, monospace)' }}>
        <span className="text-sub" style={{ fontSize: 11 }}>Tool #</span>
        <span style={{ fontWeight: 700 }}>{hasNum ? `T${machineToolNumber}` : '—'}</span>
        <span className="text-sub" style={{ fontSize: 11 }}>Holder</span>
        <span>{holderDescription || '—'}</span>
        <span className="text-sub" style={{ fontSize: 11 }}>OOH</span>
        <span>{ooh != null ? `${ooh.toFixed(3)}"` : '—'}</span>
      </div>
    </div>
  );
}

export default function AssemblyCard({ assembly, tool, holders, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const holder = holders.find(h => h.guid === assembly.holder_guid);
  const holderDescription = assembly.holder_description || holder?.description || 'Unknown holder';

  // Find preset names linked to this assembly
  const linkedPresetNames = (assembly.linked_preset_guids || [])
    .map(guid => tool.presets?.find(p => p.guid === guid)?.name)
    .filter(Boolean);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px 14px',
      marginBottom: 10,
      background: 'var(--surface-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{holderDescription}</div>
          <div className="text-sub text-sm">
            OOH: {assembly.ooh != null ? `${assembly.ooh.toFixed(3)}"` : '—'}
          </div>
          {linkedPresetNames.length > 0 && (
            <div className="text-sub text-xs" style={{ marginTop: 4 }}>
              Presets: {linkedPresetNames.join(', ')}
            </div>
          )}
          {assembly.notes && (
            <div className="text-sub text-xs" style={{ marginTop: 4, fontStyle: 'italic' }}>
              {assembly.notes}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button className="icon-btn" title="Edit assembly" onClick={() => onEdit(assembly)}>
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn"
            title="Delete assembly"
            style={{ color: 'var(--red)' }}
            onClick={() => setConfirmDelete(true)}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <OperatorTag
        machineToolNumber={tool.machine_tool_number}
        holderDescription={holderDescription}
        ooh={assembly.ooh}
      />

      {confirmDelete && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)' }}>
          <div className="text-sm" style={{ marginBottom: 8 }}>
            Remove this assembly? The linked presets will not be deleted.
          </div>
          <div className="flex gap-8">
            <button className="btn btn-danger btn-sm" onClick={() => { setConfirmDelete(false); onDelete(assembly.assembly_id); }}>
              Remove
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
