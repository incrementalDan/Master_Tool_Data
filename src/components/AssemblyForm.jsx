import { useState } from 'react';
import { X, Info } from 'lucide-react';
import { generateAssemblyId } from '../schema/toolSchema.js';
import HolderPicker from './HolderPicker.jsx';

export default function AssemblyForm({ tool, holders, assembly, onSave, onClose }) {
  const isNew = !assembly;

  const [holderGuid, setHolderGuid] = useState(assembly?.holder_guid || '');
  const [ooh, setOoh] = useState(assembly?.ooh != null ? String(assembly.ooh) : '');
  const [linkedGuids, setLinkedGuids] = useState(new Set(assembly?.linked_preset_guids || []));
  const [notes, setNotes] = useState(assembly?.notes || '');
  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [error, setError] = useState('');

  const selectedHolder = holders.find(h => h.guid === holderGuid);
  const presets = tool.presets || [];

  const togglePreset = (guid) => {
    setLinkedGuids(prev => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid); else next.add(guid);
      return next;
    });
  };

  const minOoh = tool.min_ooh ?? null;

  const handleSave = () => {
    const oohNum = parseFloat(ooh);
    if (!holderGuid) { setError('Please select a holder.'); return; }
    if (!ooh || isNaN(oohNum) || oohNum <= 0) { setError('OOH must be a positive number.'); return; }
    if (minOoh != null && oohNum < minOoh) {
      setError(`OOH cannot be less than the MIN OOH for this tool (${minOoh.toFixed(3)}")`);
      return;
    }

    const updatedAssembly = {
      assembly_id: assembly?.assembly_id || generateAssemblyId(),
      holder_guid: holderGuid,
      holder_description: selectedHolder?.description || assembly?.holder_description || '',
      ooh: oohNum,
      linked_preset_guids: [...linkedGuids],
      notes,
      created_at: assembly?.created_at || new Date().toISOString(),
      source: assembly?.source || 'manual',
    };

    const assemblies = [...(tool.assemblies || [])];
    if (isNew) {
      assemblies.push(updatedAssembly);
    } else {
      const idx = assemblies.findIndex(a => a.assembly_id === assembly.assembly_id);
      if (idx >= 0) assemblies[idx] = updatedAssembly;
      else assemblies.push(updatedAssembly);
    }
    onSave({ ...tool, assemblies });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>
            {isNew ? 'Add Assembly' : 'Edit Assembly'}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Holder */}
        <div className="field-group mb-16">
          <label className="field-label">Holder</label>
          {selectedHolder ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{selectedHolder.description}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowHolderPicker(true)}>
                Change
              </button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(true)}>
              Select Holder
            </button>
          )}
        </div>

        {/* OOH */}
        <div className="field-group mb-16">
          <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            OOH / Stick Out (inches)
            <span title="Distance from collet nut face to tool tip" style={{ cursor: 'help', color: 'var(--text-sub)' }}>
              <Info size={12} />
            </span>
          </label>
          {minOoh != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="text-sub text-xs">
                Length Below Holder - MIN OOH: <strong>{minOoh.toFixed(3)}"</strong>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => setOoh(String(minOoh))}
              >
                Use
              </button>
            </div>
          )}
          <input
            className="field-input"
            style={{ maxWidth: 160 }}
            type="number"
            step="0.001"
            min={minOoh != null ? minOoh : 0}
            placeholder="e.g. 1.375"
            value={ooh}
            onChange={e => setOoh(e.target.value)}
          />
        </div>

        {/* Linked presets */}
        {presets.length > 0 && (
          <div className="field-group mb-16">
            <label className="field-label">Linked Presets</label>
            <div className="text-sub text-xs mb-8">
              Check which Speeds &amp; Feeds presets have been proven at this assembly.
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {presets.map(p => (
                <label
                  key={p.guid}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: linkedGuids.has(p.guid) ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={linkedGuids.has(p.guid)}
                    onChange={() => togglePreset(p.guid)}
                  />
                  <span style={{ fontSize: 13 }}>{p.name || 'Unnamed'}</span>
                  {p.material?.query && (
                    <span className="text-sub text-xs">{p.material.query}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="field-group mb-16">
          <label className="field-label">Notes (optional)</label>
          <input
            className="field-input"
            placeholder="e.g. Use for aluminum only"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {error && <div className="error-banner mb-12">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>
            {isNew ? 'Add Assembly' : 'Save Changes'}
          </button>
        </div>
      </div>

      {showHolderPicker && (
        <HolderPicker
          currentGuid={holderGuid || null}
          onSelect={(guid) => { setHolderGuid(guid || ''); setShowHolderPicker(false); }}
          onClose={() => setShowHolderPicker(false)}
        />
      )}
    </div>
  );
}
