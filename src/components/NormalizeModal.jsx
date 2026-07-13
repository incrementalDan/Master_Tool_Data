import { useState, useMemo } from 'react';
import { X, AlertTriangle, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  OP_TYPES, HOLE_MAKING_TYPES, findMaterialInLibrary, presetMaterialColor,
  suggestCamPresetName,
} from '../utils/presetNaming.js';
import CamPresetPicker from './CamPresetPicker.jsx';

// Review-and-normalize modal. For every preset on a pre-migration (untracked)
// tool it lets the user (a) link the material to a CAM preset from the Materials
// library — via the same searchable picker used in the preset editor — and
// (b) assign an operation type when it couldn't be read from the name. Materials
// are pre-filled with a confident suggestion where one exists (e.g. AL → Al
// Wrought); ambiguous ones (Steel / ST / SS Austenitic 316 …) are left for the
// user to pick. The selections become the `opOverrides` / `matOverrides` maps
// passed to normalizeLibrary.
export default function NormalizeModal({ onClose }) {
  const { tools, materials, normalizeLibrary, isSaving, normalizeCount } = useApp();
  const [overrides, setOverrides] = useState({}); // presetGuid -> op value ('' = leave blank)
  const [matPicks, setMatPicks] = useState({});   // presetGuid -> CAM preset name (undefined = use suggestion)
  const [pickerFor, setPickerFor] = useState(null); // presetGuid whose material picker is open

  // Every preset on every un-normalized tool.
  const groups = useMemo(() => {
    const out = [];
    for (const t of tools) {
      if (t.tracking_id) continue; // already normalized
      const presets = t.presets || [];
      if (presets.length > 0) out.push({ tool: t, presets });
    }
    return out;
  }, [tools]);

  // Confident material suggestion per preset (CAM preset name, or '' when none).
  const suggested = useMemo(() => {
    const m = {};
    for (const g of groups) {
      for (const p of g.presets) m[p.guid] = suggestCamPresetName(p.material?.query, materials) || '';
    }
    return m;
  }, [groups, materials]);

  const presetCount = groups.reduce((n, g) => n + g.presets.length, 0);
  // The effective material for a preset: an explicit pick wins, else the suggestion.
  const matValue = (guid) => (matPicks[guid] !== undefined ? matPicks[guid] : (suggested[guid] || ''));

  const setOp = (guid, value) => setOverrides(prev => ({ ...prev, [guid]: value }));
  const setMat = (guid, value) => setMatPicks(prev => ({ ...prev, [guid]: value }));

  const handleNormalize = async () => {
    // Resolved (non-blank) operation selections.
    const opOverrides = {};
    for (const [guid, value] of Object.entries(overrides)) {
      if (value) opOverrides[guid] = value;
    }
    // Effective material links (suggestion or explicit pick); blank = leave as-is.
    const matOverrides = {};
    for (const g of groups) {
      for (const p of g.presets) {
        const v = matValue(p.guid);
        if (v) matOverrides[p.guid] = v;
      }
    }
    try {
      await normalizeLibrary(opOverrides, matOverrides);
    } finally {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
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
          <div className="text-sub text-sm" style={{ marginBottom: 12 }}>
            This will normalize <strong style={{ color: 'var(--text)' }}>{normalizeCount || 0} tool{(normalizeCount || 0) === 1 ? '' : 's'}</strong>.
            Already-migrated tools won't be touched.
          </div>
          {presetCount === 0 ? (
            <div className="text-sub text-sm" style={{ padding: '4px 0' }}>
              No presets to review. Click <strong style={{ color: 'var(--text)' }}>Normalize now</strong> to proceed.
            </div>
          ) : (
            <>
              <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
                Link each preset's material to a CAM preset (search or browse — just like the
                preset editor) and set its operation type. Confident materials are pre-filled;
                leave anything blank to keep it unchanged.
              </div>
              {groups.map(({ tool, presets }) => {
                const isHoleMaking = HOLE_MAKING_TYPES.has(tool.tool_type);
                return (
                  <div key={tool.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                      {tool.description || 'Untitled tool'}
                      {tool.tool_id ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{tool.tool_id}</span> : null}
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                      {presets.map(p => {
                        const q = matValue(p.guid);
                        const found = findMaterialInLibrary(q, materials);
                        const sel = found.preset || found.group;
                        const color = presetMaterialColor(q, materials);
                        return (
                          <div key={p.guid} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '7px 12px', borderBottom: '1px solid var(--border)',
                          }}>
                            <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name || 'Unnamed'}
                              {p.material?.query ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{p.material.query}</span> : null}
                            </span>

                            {/* Material — searchable CAM preset picker (same as preset editor) */}
                            <div
                              className="preset-mat-field"
                              style={{ width: 180, flexShrink: 0 }}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPickerFor(p.guid)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickerFor(p.guid); } }}
                            >
                              {sel ? (
                                <span className="preset-mat-sel">
                                  <span className="cam-dot" style={{ background: color || '#888' }} />
                                  {found.preset ? found.preset.name : found.group.label}
                                </span>
                              ) : (
                                <span className="text-sub">Choose material…</span>
                              )}
                              <span className="preset-mat-actions">
                                {sel && (
                                  <span className="preset-mat-clear" title="Clear" onClick={e => { e.stopPropagation(); setMat(p.guid, ''); }}>
                                    <X size={13} />
                                  </span>
                                )}
                                <ChevronDown size={14} className="text-sub" />
                              </span>
                            </div>

                            {/* Operation type — hidden for hole-making tools (no op type) */}
                            {isHoleMaking ? (
                              <span className="text-sub text-xs" style={{ width: 130, flexShrink: 0, textAlign: 'center' }} title="Hole-making tools have no operation type">—</span>
                            ) : (
                              <select
                                className="field-input"
                                style={{ width: 130, flexShrink: 0 }}
                                value={overrides[p.guid] || ''}
                                onChange={e => setOp(p.guid, e.target.value)}
                              >
                                <option value="">Op: leave blank</option>
                                {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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

      {pickerFor && (
        <CamPresetPicker
          materials={materials}
          currentQuery={matValue(pickerFor)}
          onClose={() => setPickerFor(null)}
          onSelect={(cp) => setMat(pickerFor, cp.name)}
        />
      )}
    </div>
  );
}
