import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { fusionToolToInternal, mergeFusionAndMetadata, generateId, newTool } from '../schema/toolSchema.js';
import { exportFullLibrary as exportProShop } from '../utils/proShopExport.js';
import { exportFullLibrary as exportFusion } from '../utils/fusionExport.js';

export default function ImportFlow() {
  const navigate = useNavigate();
  const { tools, saveFullLibrary, isSaving } = useApp();
  const [step, setStep] = useState(1);
  const [fusionTools, setFusionTools] = useState(tools);
  const [parseError, setParseError] = useState('');
  const [fusionPreview, setFusionPreview] = useState(null);
  const [proShopMatches, setProShopMatches] = useState(null);
  const [saving, setSaving] = useState(false);
  const fusionFileRef = useRef(null);
  const proShopFileRef = useRef(null);

  // ── Step 1: Import Fusion Library ───────────────────────────────────────
  const handleFusionFile = (file) => {
    if (!file) return;
    setParseError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : null);
        if (!list) throw new Error('Expected { data: [...] } or an array at the top level');
        setFusionPreview({ count: list.length, raw: list });
      } catch (err) {
        setParseError(`Fusion JSON parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadFusion = () => {
    if (!fusionPreview) return;
    const imported = fusionPreview.raw.map(fTool => {
      const internal = fusionToolToInternal({
        ...fTool,
        guid: fTool.guid || generateId(),
      });
      return mergeFusionAndMetadata(internal, null);
    });
    setFusionTools(imported);
    setStep(2);
  };

  // ── Step 2: Merge ProShop CSV ─────────────────────────────────────────
  const handleProShopFile = (file) => {
    if (!file) return;
    setParseError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
        const header = rows[0];
        const data = rows.slice(1).map(row => {
          const obj = {};
          header.forEach((h, i) => { obj[h.trim()] = (row[i] || '').trim(); });
          return obj;
        });
        const matches = matchProShopToTools(data, fusionTools);
        setProShopMatches(matches);
      } catch (err) {
        setParseError(`ProShop CSV parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyMerge = () => {
    if (!proShopMatches) return;
    const merged = [...fusionTools];

    proShopMatches.matched.forEach(({ toolIdx, psRow, additions }) => {
      merged[toolIdx] = { ...merged[toolIdx], ...additions };
    });

    proShopMatches.unmatched.forEach(({ psRow, action }) => {
      if (action === 'add') {
        merged.push(psRowToTool(psRow));
      }
    });

    setFusionTools(merged);
    setStep(3);
  };

  const skipProShop = () => setStep(3);

  // ── Step 3: Review & Export ───────────────────────────────────────────
  const handleSaveToDrive = async () => {
    setSaving(true);
    try {
      await saveFullLibrary(fusionTools);
      navigate('/');
    } catch (err) {
      setParseError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>← Back</button>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Import Library</h2>
      </div>

      {/* Step indicators */}
      <div className="import-steps mb-20">
        {[1, 2, 3].map(n => (
          <div key={n} className={`import-step ${step === n ? 'active' : step > n ? 'done' : ''}`}>
            <div className="import-step-num">{step > n ? '✓' : n}</div>
            <span>{n === 1 ? 'Import Fusion' : n === 2 ? 'Merge ProShop' : 'Review & Save'}</span>
          </div>
        ))}
      </div>

      {parseError && <div className="error-banner mb-16">{parseError}</div>}

      {/* ── Step 1 ──────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Import Fusion Tool Library</h3>
          <p className="text-sub text-sm mb-16">
            Upload your <code>fusion_tool_library.json</code> file. The app will parse all tools and assign stable IDs.
            {tools.length > 0 && <strong style={{ color: 'var(--amber)', display: 'block', marginTop: 6 }}>
              ⚠ This will replace your current library ({tools.length} tools). Save first if needed.
            </strong>}
          </p>

          <DropZone
            label="Drop fusion_tool_library.json or click to browse"
            accept=".json,application/json"
            fileRef={fusionFileRef}
            onFile={handleFusionFile}
          />

          {fusionPreview && (
            <div style={{ marginTop: 16, padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>✓ Parsed successfully</div>
              <div className="text-sub text-sm">{fusionPreview.count} tools found</div>
              <div className="flex gap-8 mt-12">
                <button className="btn btn-primary" onClick={handleLoadFusion}>
                  Load into Library →
                </button>
                <button className="btn btn-secondary" onClick={skipProShop} style={{ fontSize: 12 }}>
                  Skip (use current library)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2 ──────────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Merge ProShop Library</h3>
          <p className="text-sub text-sm mb-16">
            Upload a ProShop CSV export. The app matches rows to existing tools by Part Number → description similarity.
            Matched fields fill gaps — they don't overwrite existing values.
          </p>

          <DropZone
            label="Drop ProShop CSV export or click to browse"
            accept=".csv,text/csv"
            fileRef={proShopFileRef}
            onFile={handleProShopFile}
          />

          {proShopMatches && (
            <div style={{ marginTop: 16 }}>
              <div className="flex gap-12 mb-12" style={{ flexWrap: 'wrap' }}>
                <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                  <strong style={{ color: 'var(--green)' }}>{proShopMatches.matched.length}</strong> matched
                </div>
                <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                  <strong style={{ color: 'var(--amber)' }}>{proShopMatches.unmatched.length}</strong> unmatched ProShop rows
                </div>
                <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                  <strong style={{ color: 'var(--text-sub)' }}>{fusionTools.length - proShopMatches.matched.length}</strong> library tools without ProShop match
                </div>
              </div>

              {proShopMatches.unmatched.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-header mb-8">Unmatched ProShop Rows</div>
                  <table className="match-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Part #</th>
                        <th>Diameter</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proShopMatches.unmatched.map((item, i) => (
                        <tr key={i}>
                          <td className="truncate" style={{ maxWidth: 200 }}>{item.psRow.description || item.psRow['Tool Description'] || '—'}</td>
                          <td className="font-mono text-xs">{item.psRow['Part Number'] || item.psRow['EDP#'] || '—'}</td>
                          <td>{item.psRow.Diameter || item.psRow.cutDiameter || '—'}</td>
                          <td>
                            <select
                              className="field-input"
                              style={{ padding: '2px 6px', fontSize: 12 }}
                              value={item.action || 'skip'}
                              onChange={e => {
                                const updated = { ...proShopMatches };
                                updated.unmatched[i] = { ...item, action: e.target.value };
                                setProShopMatches(updated);
                              }}
                            >
                              <option value="skip">Skip</option>
                              <option value="add">Add as New Tool</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-8">
                <button className="btn btn-primary" onClick={handleApplyMerge}>
                  Apply Merge →
                </button>
                <button className="btn btn-secondary" onClick={skipProShop}>
                  Skip Merge
                </button>
              </div>
            </div>
          )}

          {!proShopMatches && (
            <div className="flex gap-8 mt-12">
              <button className="btn btn-secondary" onClick={skipProShop}>
                Skip — No ProShop CSV
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3 ──────────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Review & Save</h3>
          <p className="text-sub text-sm mb-16">
            {fusionTools.length} tools ready to save. Export as needed, then save to Drive.
          </p>

          <div className="flex gap-8 mb-20" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => exportProShop(fusionTools)}>
              ↓ Export Full ProShop CSV
            </button>
            <button className="btn btn-secondary" onClick={() => exportFusion(fusionTools)}>
              ↓ Export Fusion JSON
            </button>
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
            <table className="match-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Diameter</th>
                  <th>Vendor</th>
                </tr>
              </thead>
              <tbody>
                {fusionTools.map((t, i) => (
                  <tr key={t.id}>
                    <td className="text-sub text-xs">{i + 1}</td>
                    <td className="truncate" style={{ maxWidth: 220 }}>{t.description || '—'}</td>
                    <td className="text-xs text-sub">{t.tool_type}</td>
                    <td>{t.diameter ? `${t.diameter}"` : '—'}</td>
                    <td className="text-xs">{t.vendor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-8 mt-16">
            <button className="btn btn-primary btn-lg" onClick={handleSaveToDrive} disabled={saving || isSaving}>
              {saving || isSaving ? 'Saving to Drive…' : `Save ${fusionTools.length} Tools to Drive →`}
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Drop zone component ─────────────────────────────────────────────────────
function DropZone({ label, accept, fileRef, onFile }) {
  const [drag, setDrag] = useState(false);
  const [filename, setFilename] = useState('');

  const handleFile = (file) => {
    if (file) { setFilename(file.name); onFile(file); }
  };

  return (
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
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files[0])}
      />
      <UploadCloud size={28} style={{ color: filename ? 'var(--green)' : 'var(--text-sub)', marginBottom: 8 }} />
      <div style={{ fontSize: 13, color: filename ? 'var(--green)' : 'var(--text-sub)' }}>
        {filename || label}
      </div>
    </div>
  );
}

// ── CSV parser ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// ── ProShop row → internal tool ────────────────────────────────────────────
function psRowToTool(row) {
  const desc = row['Tool Description'] || row.description || '';
  const diam = parseFloat(row.Diameter || row.cutDiameter || '0') || null;
  return {
    ...newTool('flat end mill'),
    description: desc,
    diameter: diam,
    flute_length: parseFloat(row['Flute Length'] || row.lengthOfCut || '') || null,
    overall_length: parseFloat(row['Overall Length'] || row.overallLength || '') || null,
    number_of_flutes: parseInt(row['# Flutes'] || row['no. of flutes'] || '') || null,
    vendor: row.Manufacturer || row.approvedBrand || '',
    product_id: row['Part Number'] || row['EDP#'] || '',
    coating: row.coating || '',
    material: row.toolMaterial || row.material || 'carbide',
  };
}

// ── Match ProShop rows to existing tools ──────────────────────────────────
function matchProShopToTools(psRows, tools) {
  const matched = [];
  const usedToolIdxs = new Set();

  for (const psRow of psRows) {
    const partNum = (psRow['Part Number'] || psRow['EDP#'] || '').trim();
    const desc = (psRow['Tool Description'] || psRow.description || '').toLowerCase().trim();
    const diam = parseFloat(psRow.Diameter || psRow.cutDiameter || '') || null;

    let toolIdx = -1;

    // Match by product_id
    if (partNum) {
      toolIdx = tools.findIndex((t, i) => !usedToolIdxs.has(i) && (t.product_id === partNum || t.proshot_id === partNum));
    }

    // Fall back: match by description similarity + diameter
    if (toolIdx < 0 && desc) {
      toolIdx = tools.findIndex((t, i) => {
        if (usedToolIdxs.has(i)) return false;
        const tDesc = (t.description || '').toLowerCase();
        const descMatch = tDesc.includes(desc.slice(0, 20)) || desc.includes(tDesc.slice(0, 20));
        const diamMatch = !diam || !t.diameter || Math.abs(parseFloat(t.diameter) - diam) < 0.001;
        return descMatch && diamMatch;
      });
    }

    if (toolIdx >= 0) {
      usedToolIdxs.add(toolIdx);
      const additions = {};
      const tool = tools[toolIdx];
      // Fill gaps — don't overwrite existing values
      if (!tool.vendor && (psRow.Manufacturer || psRow.approvedBrand)) additions.vendor = psRow.Manufacturer || psRow.approvedBrand;
      if (!tool.product_id && partNum) additions.product_id = partNum;
      if (!tool.coating && psRow.coating) additions.coating = psRow.coating;
      matched.push({ toolIdx, psRow, additions });
    }
  }

  const unmatchedRows = psRows.filter((_, i) => !matched.find(m => m.psRow === psRows[i]) && !matched.some(m => m.psRow === psRows[i]));
  // Rebuild properly
  const matchedPsRows = new Set(matched.map(m => m.psRow));
  const unmatched = psRows
    .filter(r => !matchedPsRows.has(r))
    .map(r => ({ psRow: r, action: 'skip' }));

  return { matched, unmatched };
}
