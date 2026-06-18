import { useState } from 'react';
import { Gauge, Plus, X, Pencil } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { unitAbbr } from '../utils/units.js';

// Per-CAM-preset SFM + chip-load starting-point reference. Metadata-only —
// stored on the tool as speed_feed_refs[] = { preset_id, sfm, chip_load }. This
// is a manual lookup the programmer seeds speeds/feeds from per material; the
// derived RPM/feed shown per row turns it into a real starting point for THIS
// tool (uses its own diameter + flute count). The "% relative to stepdown /
// stepover" linkage is a deliberate later step (see TODO / Future Work).

// RPM from surface speed, generic over the tool's unit. SFM (surface feet/min)
// for inch tools, SMM (surface metres/min) for mm tools; diameter is in the
// tool's own unit. rpm = surfaceSpeed × factor / (π × Ø).
function deriveRPM(surfaceSpeed, diameter, unit) {
  if (!surfaceSpeed || !diameter) return 0;
  const factor = unit === 'millimeters' ? 1000 : 12;
  return (surfaceSpeed * factor) / (Math.PI * diameter);
}

export default function SpeedFeedSection({ tool, onSave, isSaving }) {
  const { materials } = useApp();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(() => tool.speed_feed_refs || []);

  const unit = tool.unit || 'inches';
  const isInch = unit !== 'millimeters';
  const surfaceLabel = isInch ? 'SFM' : 'SMM';
  const chipUnit = `${unitAbbr(unit)}/tooth`;

  const presets = materials?.presets || [];
  const groups = materials?.groups || [];
  const presetById = (id) => presets.find(p => p.id === id);
  const groupColor = (gid) => groups.find(g => g.id === gid)?.color || '#888';

  const startEditing = () => { setRows(tool.speed_feed_refs || []); setEditing(true); };
  const handleCancel = () => { setRows(tool.speed_feed_refs || []); setEditing(false); };
  const handleSave = async () => {
    // Drop blank rows (no material picked).
    const cleaned = rows.filter(r => r.preset_id);
    setRows(cleaned);
    setEditing(false);
    await onSave({ ...tool, speed_feed_refs: cleaned });
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { preset_id: '', sfm: null, chip_load: null }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i));

  // Derived RPM + feed for a row, using THIS tool's diameter + flute count.
  const derived = (sfm, chipLoad) => {
    const rpm = deriveRPM(sfm, tool.diameter, unit);
    const flutes = tool.number_of_flutes || 0;
    const feed = (chipLoad && rpm && flutes) ? chipLoad * rpm * flutes : 0;
    return { rpm, feed };
  };

  const viewRows = (tool.speed_feed_refs || []);

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Gauge size={15} className="panel-header-icon" />
        <span className="panel-header-title">Speeds &amp; Feeds Reference</span>
        {!editing && open && (
          <span className="icon-btn" title="Edit speeds & feeds reference" onClick={e => { e.stopPropagation(); startEditing(); }}>
            <Pencil size={12} />
          </span>
        )}
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="panel-body">
          {/* ── View mode ── */}
          {!editing && (
            viewRows.length === 0 ? (
              <div className="detail-field-empty text-sm">No SFM / chip-load reference yet.</div>
            ) : (
              <div className="sf-ref-table">
                <div className="sf-ref-head">
                  <span>Material (CAM Preset)</span>
                  <span className="sf-ref-num">{surfaceLabel}</span>
                  <span className="sf-ref-num">Chip Load</span>
                  <span className="sf-ref-derived">Starting point</span>
                </div>
                {viewRows.map((r, i) => {
                  const p = presetById(r.preset_id);
                  const { rpm, feed } = derived(r.sfm, r.chip_load);
                  return (
                    <div className="sf-ref-row" key={i}>
                      <span className="sf-ref-mat">
                        <span className="sf-ref-dot" style={{ background: groupColor(p?.group_id) }} />
                        {p ? p.name : <span className="text-sub">(unknown preset)</span>}
                      </span>
                      <span className="sf-ref-num font-mono">{r.sfm ?? '—'}</span>
                      <span className="sf-ref-num font-mono">{r.chip_load ?? '—'}</span>
                      <span className="sf-ref-derived text-sub text-xs">
                        {rpm ? `≈ ${Math.round(rpm).toLocaleString()} RPM` : '—'}
                        {feed ? ` · ${feed.toFixed(isInch ? 1 : 0)} ${unitAbbr(unit)}/min` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── Edit mode ── */}
          {editing && (
            <>
              <div className="sf-ref-table">
                <div className="sf-ref-head sf-ref-head--edit">
                  <span>Material (CAM Preset)</span>
                  <span className="sf-ref-num">{surfaceLabel}</span>
                  <span className="sf-ref-num">{chipUnit}</span>
                  <span />
                </div>
                {rows.map((r, i) => (
                  <div className="sf-ref-row sf-ref-row--edit" key={i}>
                    <select
                      className="field-input"
                      value={r.preset_id || ''}
                      onChange={e => setRow(i, { preset_id: e.target.value })}
                    >
                      <option value="">— material —</option>
                      {groups.map(g => {
                        const gp = presets.filter(p => p.group_id === g.id);
                        if (gp.length === 0) return null;
                        return (
                          <optgroup key={g.id} label={`${g.id} · ${g.label}`}>
                            {gp.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </optgroup>
                        );
                      })}
                    </select>
                    <input
                      className="field-input sf-ref-num font-mono"
                      type="number" step="1" min="0" placeholder={surfaceLabel}
                      value={r.sfm ?? ''}
                      onChange={e => setRow(i, { sfm: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    />
                    <input
                      className="field-input sf-ref-num font-mono"
                      type="number" step="0.0001" min="0" placeholder="0.000"
                      value={r.chip_load ?? ''}
                      onChange={e => setRow(i, { chip_load: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    />
                    <button type="button" className="icon-btn" title="Remove" onClick={() => removeRow(i)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
                <Plus size={13} /> Add material
              </button>

              <div className="purchasing-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancel} disabled={isSaving}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
