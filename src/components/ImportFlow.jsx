import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { fusionToolToInternal, mergeFusionAndMetadata, generateId, newTool, generateMachineNumbers } from '../schema/toolSchema.js';
import { convertLength, getDefaultUnit, unitAbbr } from '../utils/units.js';
import { exportFullLibrary as exportProShop } from '../utils/proShopExport.js';
import { exportFullLibrary as exportFusion } from '../utils/fusionExport.js';

export default function ImportFlow() {
  const navigate = useNavigate();
  const { tools, saveFullLibrary, isSaving, markSetupStep } = useApp();
  const [step, setStep] = useState(1);
  const [fusionTools, setFusionTools] = useState(tools);
  const [parseError, setParseError] = useState('');
  const [fusionPreview, setFusionPreview] = useState(null);
  const [proShopMatches, setProShopMatches] = useState(null);
  const [psUnit, setPsUnit] = useState(getDefaultUnit());
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
        // ProShop exports one row per "Tool #" normally, but multiple rows
        // (sharing the same Tool #) when a tool has multiple purchasing/
        // Approved Brand options — group them before matching.
        const groupMap = new Map();
        for (const row of data) {
          const key = row['Tool #'] || `__row_${groupMap.size}`;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key).push(row);
        }
        const matches = matchProShopToTools([...groupMap.values()], fusionTools, psUnit);
        setProShopMatches(matches);
      } catch (err) {
        setParseError(`ProShop CSV parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyMerge = () => {
    if (!proShopMatches) return;
    markSetupStep('proshopMerged');
    const merged = [...fusionTools];

    proShopMatches.matched.forEach(({ toolIdx, additions }) => {
      merged[toolIdx] = { ...merged[toolIdx], ...additions };
    });

    proShopMatches.unmatched.forEach(({ psGroup, action }) => {
      if (action === 'add') {
        merged.push(psRowToTool(psGroup, psUnit));
      }
    });

    setFusionTools(merged);
    setStep(3);
  };

  const skipProShop = () => setStep(3);

  // ── Step 4: Assign machine numbers, then save ─────────────────────────
  // Numbers are assigned in current import (array) order, starting at #30 and
  // skipping the reserved numbers. The metadata file is the source of truth.
  const machineNumbers = generateMachineNumbers(fusionTools.length);

  const handleSaveToDrive = async () => {
    setSaving(true);
    try {
      const numbered = fusionTools.map((t, i) => ({ ...t, machine_tool_number: machineNumbers[i] }));
      await saveFullLibrary(numbered);
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
        {[1, 2, 3, 4].map(n => (
          <div key={n} className={`import-step ${step === n ? 'active' : step > n ? 'done' : ''}`}>
            <div className="import-step-num">{step > n ? '✓' : n}</div>
            <span>{n === 1 ? 'Import Fusion' : n === 2 ? 'Merge ProShop' : n === 3 ? 'Review' : 'Machine Numbers'}</span>
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
            Upload a ProShop CSV export. Rows are grouped by ProShop's "Tool #" (multiple rows per tool
            represent multiple Approved Brand / purchasing options) and matched to existing tools by
            ProShop ID (Tool #) → description similarity. ProShop wins for vendor, MIN OOH, through-coolant,
            and purchasing info; other fields fill gaps only.
          </p>

          <div className="field-group mb-16" style={{ maxWidth: 340 }}>
            <label className="field-label">ProShop file unit</label>
            <div className="text-sub text-xs mb-8">
              Unit of the length columns in this CSV (e.g. MIN OOH). Set this before uploading.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['inches', 'Inches (in)'], ['millimeters', 'Millimeters (mm)']].map(([val, label]) => (
                <button
                  key={val}
                  className={`btn btn-sm ${psUnit === val ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setPsUnit(val)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

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
                        <th>Tool #</th>
                        <th>Diameter</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proShopMatches.unmatched.map((item, i) => (
                        <tr key={i}>
                          <td className="truncate" style={{ maxWidth: 200 }}>{item.psGroup[0]['Description'] || '—'}</td>
                          <td className="font-mono text-xs">{item.psGroup[0]['Tool #'] || '—'}</td>
                          <td>{item.psGroup[0]['Cut Dia'] || '—'}</td>
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
            <button className="btn btn-secondary" onClick={() => { markSetupStep('proshopExported'); exportProShop(fusionTools); }}>
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
                    <td>{t.diameter ? `${t.diameter} ${unitAbbr(t.unit)}` : '—'}</td>
                    <td className="text-xs">{t.vendor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-8 mt-16">
            <button className="btn btn-primary btn-lg" onClick={() => setStep(4)}>
              Continue → Assign Machine Numbers
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4 ──────────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Assign Machine Tool Numbers</h3>
          <p className="text-sub text-sm mb-16">
            This will number all {fusionTools.length} tools starting at <strong>#30</strong> in import order,
            skipping <strong>98, 99, and 100</strong> (reserved for machine-specific use). The same value is
            written to the tool number, length offset, and diameter offset so the machine reads them as locked.
          </p>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
            <table className="match-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Current</th>
                  <th>New Machine #</th>
                </tr>
              </thead>
              <tbody>
                {fusionTools.map((t, i) => (
                  <tr key={t.id}>
                    <td className="text-sub text-xs">{i + 1}</td>
                    <td className="truncate" style={{ maxWidth: 220 }}>{t.description || '—'}</td>
                    <td className="text-xs text-sub">{t.tool_type}</td>
                    <td className="text-xs text-sub">
                      {(t.machine_tool_number ?? null) === null ? '—' : `T${t.machine_tool_number}`}
                    </td>
                    <td className="font-mono" style={{ color: 'var(--green)' }}>T{machineNumbers[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-8 mt-16">
            <button className="btn btn-primary btn-lg" onClick={handleSaveToDrive} disabled={saving || isSaving}>
              {saving || isSaving ? 'Saving to Drive…' : `Assign & Save ${fusionTools.length} Tools →`}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep(3)} disabled={saving || isSaving}>
              Back
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
// `group` is every CSV row sharing one "Tool #" (ProShop's primary key — see
// buildPurchasingFromGroup for the multi-row purchasing case). Geometry/spec
// columns are read from the first row using ProShop's real UI/display column
// headers. psUnit is the unit of the ProShop file; a tool created from a
// ProShop row adopts that unit, so its lengths are taken as-is (no conversion).
const PS_MATERIAL_MAP = {
  carbide: 'carbide', CARB: 'carbide', HSS: 'hss', 'HSS/CARB': 'hss', COBALT: 'cobalt', CERAMIC: 'ceramic',
};
function psMaterial(v) {
  if (!v) return 'carbide';
  return PS_MATERIAL_MAP[v] || v.toLowerCase();
}
function psNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function psRowToTool(group, psUnit = 'inches') {
  const r = group[0];
  return {
    ...newTool('flat end mill'),
    unit: psUnit,
    proshot_id: r['Tool #'] || '',
    grouping: r['Tool Group'] || '',
    description: r['Description'] || '',
    diameter: psNum(r['Cut Dia']),
    flute_length: psNum(r['LOC']),
    overall_length: psNum(r['Overall Length']),
    number_of_flutes: parseInt(r['No.ofFlutes']) || null,
    shank_diameter: psNum(r['Shank Diameter']),
    corner_radius: psNum(r['CornerRad']),
    tip_angle: psNum(r['Tip Angle']),
    tip_diameter: psNum(r['Tip Diameter']),
    helix_angle: psNum(r['HelixAngle']),
    taper_angle: psNum(r['Taper']),
    coating: r['Coating'] || '',
    material: psMaterial(r['Tool Material']),
    pitch: r['Pitch'] || '',
    tap_class: r['Tap class'] || '',
    point_type: r['Point Type'] || '',
    stub_jobber: r['(S)tub / (J)obber'] || '',
    full_profile: r['Full Profile'] === 'true',
    backside_capable: r['Backside Capable'] === 'true',
    double_ended: r['Double Ended'] === 'Y',
    tsc_capable: r['Through Coolant'] === 'true',
    material_suitability: r['Recommended Workpiece Material']
      ? r['Recommended Workpiece Material'].split(',').map(s => s.trim()).filter(Boolean)
      : [],
    min_ooh: psNum(r['Length Below Holder - MIN OOH']),
    tip_to_first_thread: psNum(r['Tip to 1st Full Thread']),
    location: r['Location'] || '',
    vendor: r['Approved Brand'] || '',
    purchasing: buildPurchasingFromGroup(group),
  };
}

// One purchasing entry ("Approved Brand" sub-table row in ProShop) per CSV row
// in the group that carries purchasing data — multiple rows share a Tool # but
// differ only in manufacturer/distributor/part#/cost/lead time.
function buildPurchasingFromGroup(group) {
  return group
    .filter(r => r['Approved Brand'] || r['Vendor'] || r['EDP#'] || r['Cost'] || r['Lead time'])
    .map(r => ({
      manufacturer: r['Approved Brand'] || '',
      distributor: r['Vendor'] || '',
      distributor_part_number: r['EDP#'] || '',
      cost: r['Cost'] || '',
      lead_time: r['Lead time'] || '',
    }));
}

// ── Match ProShop row-groups to existing tools ────────────────────────────
// psUnit is the unit of the ProShop file; lengths merged onto an existing tool
// (min_ooh, tip_to_first_thread) are converted from it into the matched tool's
// own unit.
function matchProShopToTools(groups, tools, psUnit = 'inches') {
  const matched = [];
  const usedToolIdxs = new Set();

  for (const group of groups) {
    const r = group[0];
    const toolNum = (r['Tool #'] || '').trim();
    const desc = (r['Description'] || '').toLowerCase().trim();
    const diam = psNum(r['Cut Dia']);

    let toolIdx = -1;

    // Primary match: ProShop "Tool #" is the Primary Key === our proshot_id
    if (toolNum) {
      toolIdx = tools.findIndex((t, i) => !usedToolIdxs.has(i) && t.proshot_id === toolNum);
    }

    // Fall back: match by description similarity + diameter (tools not yet ProShop-linked)
    if (toolIdx < 0 && desc) {
      toolIdx = tools.findIndex((t, i) => {
        if (usedToolIdxs.has(i)) return false;
        const tDesc = (t.description || '').toLowerCase();
        const descMatch = tDesc.includes(desc.slice(0, 20)) || desc.includes(tDesc.slice(0, 20));
        const diamMatch = diam == null || !t.diameter || Math.abs(parseFloat(t.diameter) - diam) < 0.001;
        return descMatch && diamMatch;
      });
    }

    if (toolIdx >= 0) {
      usedToolIdxs.add(toolIdx);
      const tool = tools[toolIdx];
      const additions = {};

      // ProShop wins
      if (r['Approved Brand']) additions.vendor = r['Approved Brand'];
      if (toolNum && !tool.proshot_id) additions.proshot_id = toolNum;
      const purchasing = buildPurchasingFromGroup(group);
      if (purchasing.length) additions.purchasing = purchasing;
      if (r['Through Coolant'] === 'true' || r['Through Coolant'] === 'false') {
        additions.tsc_capable = r['Through Coolant'] === 'true';
      }
      // min_ooh: ProShop is authoritative — always overwrite when present, after
      // converting from the ProShop file unit into the matched tool's own unit.
      const psMinOoh = psNum(r['Length Below Holder - MIN OOH']);
      if (psMinOoh != null) additions.min_ooh = convertLength(psMinOoh, psUnit, tool.unit);

      // Fill gaps only — don't overwrite existing values
      if (!tool.coating && r['Coating']) additions.coating = r['Coating'];
      if (!tool.location && r['Location']) additions.location = r['Location'];
      if (tool.tip_to_first_thread == null) {
        const psTip = psNum(r['Tip to 1st Full Thread']);
        if (psTip != null) additions.tip_to_first_thread = convertLength(psTip, psUnit, tool.unit);
      }

      matched.push({ toolIdx, psGroup: group, additions });
    }
  }

  const matchedGroups = new Set(matched.map(m => m.psGroup));
  const unmatched = groups
    .filter(g => !matchedGroups.has(g))
    .map(g => ({ psGroup: g, action: 'skip' }));

  return { matched, unmatched };
}
