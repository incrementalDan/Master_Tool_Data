import { useState, useMemo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { OP_TYPES } from '../utils/presetNaming.js';

// Review-and-normalize modal. Lists every preset on a pre-migration (untracked)
// tool whose operation type couldn't be parsed from its name, and lets the user
// assign one. The selections become the `opOverrides` map passed to
// normalizeLibrary so those presets get a proper convention name.
export default function NormalizeModal({ onClose }) {
  const { tools, normalizeLibrary, isSaving } = useApp();
  const [overrides, setOverrides] = useState({}); // presetGuid -> op value ('' = leave blank)

  // Group presets needing review by their (untracked) tool.
  const groups = useMemo(() => {
    const out = [];
    for (const t of tools) {
      if (t.tracking_id) continue; // already normalized
      const presets = (t.presets || []).filter(p => !p.operation_type);
      if (presets.length > 0) out.push({ tool: t, presets });
    }
    return out;
  }, [tools]);

  const reviewCount = groups.reduce((n, g) => n + g.presets.length, 0);

  const setOp = (guid, value) => setOverrides(prev => ({ ...prev, [guid]: value }));

  const handleNormalize = async () => {
    // Only pass through resolved (non-blank) selections.
    const opOverrides = {};
    for (const [guid, value] of Object.entries(overrides)) {
      if (value) opOverrides[guid] = value;
    }
    try {
      await normalizeLibrary(opOverrides);
    } finally {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Normalize library</h3>
          <button className="icon-btn" onClick={onClose} disabled={isSaving}><X size={16} /></button>
        </div>

        <div className="banner-warn mb-12">
          <AlertTriangle size={16} />
          <span>
            This assigns tracking IDs, splits each tool into per-assembly instances, and
            renames presets to the standard convention. <strong>Back up your Fusion library
            and metadata file first.</strong>
          </span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {reviewCount === 0 ? (
            <div className="text-sub text-sm" style={{ padding: '12px 0' }}>
              All preset names were recognized — nothing to review. You're ready to normalize.
            </div>
          ) : (
            <>
              <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
                {reviewCount} preset{reviewCount === 1 ? '' : 's'} on {groups.length} tool
                {groups.length === 1 ? '' : 's'} have an operation type that couldn't be read
                from the name. Set it now, or leave blank to keep the name unchanged.
              </div>
              {groups.map(({ tool, presets }) => (
                <div key={tool.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                    {tool.description || 'Untitled tool'}
                    {tool.proshot_id ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{tool.proshot_id}</span> : null}
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    {presets.map(p => (
                      <div key={p.guid} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 12px', borderBottom: '1px solid var(--border)',
                      }}>
                        <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name || 'Unnamed'}
                          {p.material?.query ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{p.material.query}</span> : null}
                        </span>
                        <select
                          className="field-input"
                          style={{ width: 150, flexShrink: 0 }}
                          value={overrides[p.guid] || ''}
                          onChange={e => setOp(p.guid, e.target.value)}
                        >
                          <option value="">Leave blank</option>
                          {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleNormalize} disabled={isSaving}>
            {isSaving ? 'Normalizing…' : 'Normalize now'}
          </button>
        </div>
      </div>
    </div>
  );
}
