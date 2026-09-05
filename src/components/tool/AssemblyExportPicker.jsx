// Which assembly (holder + OOH) to embed in a Fusion JSON export. Lifted
// verbatim out of ToolDetail — see docs/TOOL_PAGE_UNIFICATION_PLAN.md, Phase 2.
import { useState } from 'react';
import { HolderTag, holderForDisplay } from '../HolderPill.jsx';
import { holderDisplayColor } from '../../utils/holderColors.js';
import { unitAbbr } from '../../utils/units.js';
import { useApp } from '../../context/AppContext.jsx';

export default function AssemblyExportPicker({ tool, holders, onConfirm, onCancel }) {
  // The selected row's tint must be the SAME color the pill shows, so resolve
  // it the same way rather than always falling back to the legacy list.
  const { holderLibrary } = useApp();
  // ⚠️ Resolve the record and colour it the SAME way the pill does. Reading
  // `?.color` and falling back to a bare description hash re-derived the chain
  // here, so once the pill keyed its hash on the record id the two disagreed —
  // the same holder in two colours on one screen.
  const rowColor = (a) => {
    const rec = holderForDisplay({
      records: holderLibrary?.holders, holderId: a.holder_id,
      holderGuid: a.holder_guid, description: a.holder_description,
    });
    return holderDisplayColor(rec || { description: a.holder_description || null });
  };
  const assemblies = tool.assemblies || [];
  const [selected, setSelected] = useState('none'); // 'none' | assembly_id | 'new'
  const [newHolderGuid, setNewHolderGuid] = useState('');
  const [newOoh, setNewOoh] = useState('');

  const canConfirm = selected !== 'new' || (newHolderGuid && newOoh && parseFloat(newOoh) > 0);

  const handleConfirm = () => {
    if (selected === 'none') { onConfirm(null); return; }
    if (selected === 'new') {
      const holder = holders.find(h => h.guid === newHolderGuid);
      onConfirm({
        assembly_id: 'temp',
        holder_guid: newHolderGuid,
        holder_description: holder?.description || '',
        ooh: parseFloat(newOoh),
        linked_preset_guids: [],
        notes: '',
      });
      return;
    }
    onConfirm(assemblies.find(a => a.assembly_id === selected) || null);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Select Assembly for Export</h3>
        <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 14 }}>
          Embed a holder and OOH (out-of-holder length) in the Fusion JSON. One-time assemblies are not saved.
        </p>

        <div
          className={`assembly-picker-option${selected === 'none' ? ' selected' : ''}`}
          onClick={() => setSelected('none')}
        >
          <span style={{ fontWeight: 600 }}>No assembly</span>
          <span className="text-sub" style={{ fontSize: 12 }}> — geometry only</span>
        </div>

        {assemblies.length > 0 && (
          <>
            <div className="text-sub" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>Saved assemblies</div>
            {assemblies.map(a => {
              const c = rowColor(a);
              const isSel = selected === a.assembly_id;
              return (
                <div
                  key={a.assembly_id}
                  className={`assembly-picker-option${isSel ? ' selected' : ''}`}
                  style={isSel ? { borderColor: c, background: `color-mix(in srgb, ${c} 12%, var(--input-bg))` } : {}}
                  onClick={() => setSelected(a.assembly_id)}
                >
                  <HolderTag
                    holderId={a.holder_id} holderGuid={a.holder_guid}
                    description={a.holder_description}
                  />
                  <span style={{ fontSize: 13 }}>OOH: {a.ooh?.toFixed(3)} {unitAbbr(tool.unit)}</span>
                  {(a.linked_preset_guids?.length > 0) && (
                    <span className="text-sub" style={{ fontSize: 11, marginLeft: 'auto' }}>
                      {a.linked_preset_guids.length} preset{a.linked_preset_guids.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}

        <div className="text-sub" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>One-time (not saved)</div>
        <div
          className={`assembly-picker-option${selected === 'new' ? ' selected' : ''}`}
          onClick={() => setSelected('new')}
        >
          <span style={{ fontWeight: 600 }}>Custom assembly</span>
          <span className="text-sub" style={{ fontSize: 12 }}> — specify holder + OOH</span>
        </div>

        {selected === 'new' && (
          <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}>
            <div style={{ marginBottom: 10 }}>
              <label className="field-label">Holder</label>
              <select className="field-input" value={newHolderGuid} onChange={e => setNewHolderGuid(e.target.value)}>
                <option value="">— select holder —</option>
                {holders.map(h => <option key={h.guid} value={h.guid}>{h.description}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">OOH ({unitAbbr(tool.unit)})</label>
              <input
                className="field-input"
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g. 2.300"
                value={newOoh}
                onChange={e => setNewOoh(e.target.value)}
                style={{ maxWidth: 130 }}
              />
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={`btn ${canConfirm ? 'btn-primary' : 'btn-secondary'}`} disabled={!canConfirm} onClick={handleConfirm}>
            Confirm &amp; Export
          </button>
        </div>
      </div>
    </div>
  );
}
