import { useState } from 'react';
import { X, Info } from 'lucide-react';
import { generateAssemblyId } from '../schema/toolSchema.js';
import { presetMatchesAssembly } from '../utils/presetNaming.js';
import { unitAbbr } from '../utils/units.js';
import HolderPicker from './HolderPicker.jsx';

export default function AssemblyForm({ tool, holders, assembly, onSave, onClose }) {
  const isNew = !assembly;

  const [holderGuid, setHolderGuid] = useState(assembly?.holder_guid || '');
  const [ooh, setOoh] = useState(assembly?.ooh != null ? String(assembly.ooh) : '');
  const [notes, setNotes] = useState(assembly?.notes || '');
  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [error, setError] = useState('');

  const selectedHolder = holders.find(h => h.guid === holderGuid);
  const presets = tool.presets || [];

  // Presets that belong to this assembly are derived from the preset name
  // (which encodes the holder short name + OOH), not stored links.
  const oohPreview = parseFloat(ooh);
  const previewAssembly = {
    holder_description: selectedHolder?.description || assembly?.holder_description || '',
    ooh: isNaN(oohPreview) ? null : oohPreview,
  };
  const matchedPresets = presets.filter(p => presetMatchesAssembly(p, previewAssembly, tool.unit));

  const minOoh = tool.min_ooh ?? null;
  const unit = unitAbbr(tool.unit);

  const handleSave = () => {
    const oohNum = parseFloat(ooh);
    if (!holderGuid) { setError('Please select a holder.'); return; }
    if (!ooh || isNaN(oohNum) || oohNum <= 0) { setError('OOH must be a positive number.'); return; }
    if (minOoh != null && oohNum < minOoh) {
      setError(`OOH cannot be less than the MIN OOH for this tool (${minOoh.toFixed(3)} ${unit})`);
      return;
    }

    const updatedAssembly = {
      assembly_id: assembly?.assembly_id || generateAssemblyId(),
      instance_guid: assembly?.instance_guid,   // preserved on edit; assigned on add
      holder_guid: holderGuid,
      holder_description: selectedHolder?.description || assembly?.holder_description || '',
      ooh: oohNum,
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
            OOH / Stick Out ({unit})
            <span title="Distance from collet nut face to tool tip" style={{ cursor: 'help', color: 'var(--text-sub)' }}>
              <Info size={12} />
            </span>
          </label>

          {/* Reference pills: OAL (info only) + MIN OOH (clickable to fill) */}
          {(tool.overall_length != null || minOoh != null) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {tool.overall_length != null && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '5px 14px', borderRadius: 999,
                  border: '1px solid var(--border)', background: 'var(--surface-2)',
                  minWidth: 72,
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1 }}>OAL</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                    {tool.overall_length.toFixed(3)}{tool.unit === 'millimeters' ? ' mm' : '"'}
                  </span>
                </div>
              )}
              {minOoh != null && (
                <button
                  type="button"
                  title="Click to use as OOH"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '5px 14px', borderRadius: 999,
                    border: '1px solid var(--blue)', background: 'var(--blue-tint)',
                    color: 'var(--blue)', cursor: 'pointer',
                    minWidth: 72, fontFamily: 'inherit',
                  }}
                  onClick={() => setOoh(String(minOoh))}
                >
                  <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1 }}>MIN OOH</span>
                  <span style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{minOoh.toFixed(3)} {unit}</span>
                </button>
              )}
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

        {/* Matched presets (read-only — derived from preset names) */}
        {presets.length > 0 && (
          <div className="field-group mb-16">
            <label className="field-label">Presets for this assembly</label>
            <div className="text-sub text-xs mb-8">
              Presets are linked automatically by name (holder + OOH). Set a preset's
              holder/OOH in Speeds &amp; Feeds to attach it here.
            </div>
            {matchedPresets.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {matchedPresets.map(p => (
                  <span key={p.guid} className="preset-tag">{p.name || 'Unnamed'}</span>
                ))}
              </div>
            ) : (
              <div className="text-sub text-xs">No presets match this holder + OOH yet.</div>
            )}
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
