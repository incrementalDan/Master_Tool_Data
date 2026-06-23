import { useState, useMemo } from 'react';
import { Gauge, Plus, X, Pencil, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { unitAbbr } from '../utils/units.js';
import { OP_TYPES, opTypeWord } from '../utils/presetNaming.js';
import CamPresetPicker from './CamPresetPicker.jsx';

// Per-CAM-preset SFM + chip-load starting-point reference. Metadata-only —
// stored on the tool as speed_feed_refs[] = { preset_id, operation_type, sfm,
// chip_load }. A manual lookup the programmer seeds speeds/feeds from per
// material + operation; the derived RPM/feed shown per row turns it into a real
// starting point for THIS tool (uses its own diameter + flute count). The "%
// relative to stepdown / stepover" linkage is a deliberate later step (TODO).

const tint = (color, alpha) => (color || '#888') + alpha;

// RPM from surface speed, generic over the tool's unit. SFM (surface feet/min)
// for inch tools, SMM (surface metres/min) for mm tools; diameter is in the
// tool's own unit. rpm = surfaceSpeed × factor / (π × Ø).
function deriveRPM(surfaceSpeed, diameter, unit) {
  if (!surfaceSpeed || !diameter) return 0;
  const factor = unit === 'millimeters' ? 1000 : 12;
  return (surfaceSpeed * factor) / (Math.PI * diameter);
}

export default function SpeedFeedSection({ tool, onSave }) {
  const { materials } = useApp();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState(() => tool.speed_feed_refs || []);
  const [pickingRow, setPickingRow] = useState(null);   // row index whose picker is open

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
    const cleaned = rows.filter(r => r.preset_id);   // drop blank rows
    setSaving(true);
    try {
      await onSave({ ...tool, speed_feed_refs: cleaned });
      setRows(cleaned);
      setEditing(false);
    } catch { /* toast handled in context */ }
    finally { setSaving(false); }
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { preset_id: '', operation_type: null, sfm: null, chip_load: null }]);
  const removeRow = (i) => setRows(rs => rs.filter((_, idx) => idx !== i));

  // Derived RPM + feed for a row, using THIS tool's diameter + flute count.
  const derived = (sfm, chipLoad) => {
    const rpm = deriveRPM(sfm, tool.diameter, unit);
    const flutes = tool.number_of_flutes || 0;
    const feed = (chipLoad && rpm && flutes) ? chipLoad * rpm * flutes : 0;
    return { rpm, feed };
  };

  const viewRows = (tool.speed_feed_refs || []);

  // Group view rows by ISO group for the card display.
  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const r of viewRows) {
      const p = presetById(r.preset_id);
      const gid = p?.group_id || '__unknown__';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid).push(r);
    }
    const ordered = [];
    for (const g of groups) {
      if (map.has(g.id)) ordered.push({ group: g, rows: map.get(g.id) });
    }
    if (map.has('__unknown__')) ordered.push({ group: null, rows: map.get('__unknown__') });
    return ordered;
  }, [viewRows, groups, presets]);

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
              <div className="sf-ref-groups">
                {groupedRows.map(({ group, rows: gRows }) => {
                  const c = group?.color || '#888';
                  return (
                    <div key={group?.id || '__unknown__'} className="sf-ref-group">
                      <div className="sf-ref-group-header">
                        <span className="mat-badge" style={{ background: tint(c, '22'), color: c, borderColor: tint(c, '44'), fontSize: 11 }}>
                          {group?.id || '?'}
                        </span>
                        <span style={{ color: c, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {group ? `${group.id} — ${group.label}` : 'Unknown'}
                        </span>
                      </div>
                      {gRows.map((r, i) => {
                        const p = presetById(r.preset_id);
                        const { rpm, feed } = derived(r.sfm, r.chip_load);
                        return (
                          <div key={i} className="sf-ref-card" style={{ borderLeftColor: c }}>
                            <span className="sf-ref-card-mat">
                              {p ? p.name : <span className="text-sub">(unknown preset)</span>}
                            </span>
                            <span className="sf-ref-card-op text-sub">{opTypeWord(r.operation_type) || <span style={{ opacity: 0.4 }}>—</span>}</span>
                            <span className="sf-ref-card-num font-mono">
                              {r.sfm ?? <span className="text-sub">—</span>}
                              {r.sfm != null && <span className="sf-ref-unit"> {surfaceLabel}</span>}
                            </span>
                            <span className="sf-ref-card-num font-mono">
                              {r.chip_load != null ? r.chip_load.toFixed(4) : <span className="text-sub">—</span>}
                              {r.chip_load != null && <span className="sf-ref-unit">/tooth</span>}
                            </span>
                            <span className="sf-ref-card-derived text-sub">
                              {rpm ? `≈ ${Math.round(rpm).toLocaleString()} RPM` : '—'}
                              {feed ? ` · ${feed.toFixed(isInch ? 1 : 0)} ${unitAbbr(unit)}/min` : ''}
                            </span>
                          </div>
                        );
                      })}
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
                  <span>Operation</span>
                  <span className="sf-ref-num">{surfaceLabel}</span>
                  <span className="sf-ref-num">{chipUnit}</span>
                  <span />
                </div>
                {rows.map((r, i) => {
                  const p = presetById(r.preset_id);
                  return (
                    <div className="sf-ref-row sf-ref-row--edit" key={i}>
                      <div
                        className="preset-mat-field"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPickingRow(i)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickingRow(i); } }}
                      >
                        {p ? (
                          <span className="preset-mat-sel">
                            <span className="cam-dot" style={{ background: groupColor(p.group_id) }} />
                            {p.name}
                          </span>
                        ) : (
                          <span className="text-sub">Choose material…</span>
                        )}
                        <ChevronDown size={14} className="text-sub" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                      </div>
                      <select
                        className="field-input"
                        value={r.operation_type || ''}
                        onChange={e => setRow(i, { operation_type: e.target.value || null })}
                      >
                        <option value="">— any —</option>
                        {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
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
                      <button type="button" className="icon-btn" title="Remove" onClick={() => removeRow(i)} disabled={saving}>
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button type="button" className="btn btn-ghost btn-sm" onClick={addRow} disabled={saving}>
                <Plus size={13} /> Add material
              </button>

              <div className="purchasing-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving
                    ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Saving…</>
                    : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {pickingRow !== null && (
        <CamPresetPicker
          materials={materials}
          currentQuery={presetById(rows[pickingRow]?.preset_id)?.name}
          onClose={() => setPickingRow(null)}
          onSelect={(cp) => setRow(pickingRow, { preset_id: cp.id })}
        />
      )}
    </div>
  );
}
