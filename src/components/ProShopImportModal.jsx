import { useState, useRef } from 'react';
import { X, UploadCloud, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { parseCSV, matchProShopToTools } from './ImportFlow.jsx';
import { proShopRowsToObjects, detectProShopFormat, proShopFormatLabel } from '../utils/proShopHeaders.js';
import { getDefaultUnit, unitAbbr } from '../utils/units.js';

// Single-tool ProShop data import. Upload a ProShop CSV export (the whole
// library is fine) and this finds the row that matches THIS tool, previews the
// fields it would fill/overwrite, and applies them to the one tool on confirm.
// Reuses the exact matching + merge rules from the bulk importer
// (matchProShopToTools) so behavior is identical — it just scopes the tools
// array to a single tool.

// Human-readable labels for the addition keys matchProShopToTools can produce.
const FIELD_LABELS = {
  vendor: 'Manufacturer',
  tool_id: 'Tool ID',
  purchasing: 'Purchasing',
  tsc_capable: 'Through-spindle coolant',
  custom_grind: 'Custom grind',
  min_ooh: 'MIN OOH',
  coating: 'Coating',
  location: 'Location',
  pitch: 'Thread / pitch',
  is_sti: 'STI tap',
  tap_thread_unit: 'Thread unit',
  tip_to_first_thread: 'Tip to 1st full thread',
};

// Render one addition value for the preview.
function displayValue(key, val, unit) {
  if (key === 'purchasing') {
    const m = val?.manufacturers?.length || 0;
    const v = val?.vendors?.length || 0;
    return `${m} manufacturer${m === 1 ? '' : 's'}, ${v} vendor${v === 1 ? '' : 's'}`;
  }
  if (key === 'min_ooh' || key === 'tip_to_first_thread') {
    return `${Math.round(val * 10000) / 10000} ${unitAbbr(unit)}`;
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

export default function ProShopImportModal({ tool, onClose, onApply }) {
  const { components } = useApp();
  const [psUnit, setPsUnit] = useState(tool.unit || getDefaultUnit());
  const [additions, setAdditions] = useState(null);   // matched additions for this tool
  const [psFormat, setPsFormat] = useState(null);     // detected header format of the last CSV
  const [status, setStatus] = useState('');           // 'nomatch' once a file parsed with no hit
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    setStatus('');
    setAdditions(null);
    setPsFormat(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
        // Accept both header conventions (real ProShop export + this app's own
        // ProShop export) via header canonicalization — see proShopHeaders.js.
        setPsFormat(detectProShopFormat(rows[0]));
        const data = proShopRowsToObjects(rows);
        // Group rows by "Tool #" (a tool with several Approved Brands spans
        // multiple rows) exactly like the bulk importer, then match against
        // ONLY this tool.
        const groupMap = new Map();
        for (const row of data) {
          const key = row['Tool #'] || `__row_${groupMap.size}`;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key).push(row);
        }
        const result = matchProShopToTools([...groupMap.values()], [tool], psUnit, components?.components || []);
        const hit = result.matched.find(m => m.toolIdx === 0);
        if (hit && Object.keys(hit.additions).length) {
          setAdditions(hit.additions);
        } else {
          setStatus('nomatch');
        }
      } catch (err) {
        setError(`ProShop CSV parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const apply = async () => {
    if (!additions) return;
    setSaving(true);
    try {
      await onApply(additions);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to apply ProShop data');
      setSaving(false);
    }
  };

  const entries = additions ? Object.entries(additions) : [];

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 className="modal-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UploadCloud size={17} style={{ color: 'var(--orange)' }} /> Import ProShop Data
          </h3>
          {!saving && <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>}
        </div>

        <p className="text-sub text-sm mb-12">
          Upload a ProShop CSV export. The row matching this tool
          {tool.tool_id ? <> (<strong>Tool #{tool.tool_id}</strong>)</> : ' (by description + diameter)'} is
          found and its data merged into this one tool. No other tools are touched. Both a real ProShop
          export and this app's own ProShop export are accepted (auto-detected).
        </p>

        {psFormat && psFormat !== 'unknown' && (
          <div className="text-sub text-xs mb-12">Detected: <strong>{proShopFormatLabel(psFormat)}</strong></div>
        )}

        {error && <div className="error-banner mb-12">{error}</div>}

        {/* ProShop file unit — lengths (MIN OOH etc.) convert from this into the tool's unit. */}
        <label className="flex items-center gap-8 text-sm mb-12" style={{ flexWrap: 'wrap' }}>
          <span className="text-sub">ProShop file unit:</span>
          <select
            className="field-input"
            style={{ width: 'auto' }}
            value={psUnit}
            onChange={e => setPsUnit(e.target.value)}
          >
            <option value="inches">inches</option>
            <option value="millimeters">millimeters</option>
          </select>
        </label>

        {!additions && (
          <div
            className={`upload-zone ${drag ? 'drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />
            <UploadCloud size={22} style={{ color: 'var(--text-sub)' }} />
            <div className="text-sm mt-8">Drop ProShop CSV here or click to browse</div>
          </div>
        )}

        {status === 'nomatch' && (
          <div className="warn-banner mt-12">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              No matching row found for this tool in that file. Check the Tool # or that you
              exported the right library.
            </div>
          </div>
        )}

        {additions && (
          <>
            <div className="section-header mb-8">{entries.length} field{entries.length === 1 ? '' : 's'} to update</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <table className="match-table">
                <thead>
                  <tr><th>Field</th><th>New value</th></tr>
                </thead>
                <tbody>
                  {entries.map(([key, val]) => (
                    <tr key={key}>
                      <td className="text-sm">{FIELD_LABELS[key] || key}</td>
                      <td className="text-sm font-mono">{displayValue(key, val, tool.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-8 mt-16">
              <button className="btn btn-primary" onClick={apply} disabled={saving}>
                {saving ? 'Applying…' : 'Apply to This Tool'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setAdditions(null); setStatus(''); }} disabled={saving}>
                Choose Another File
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
