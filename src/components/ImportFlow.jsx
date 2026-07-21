import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { UploadCloud, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import ImportPhotosModal from './ImportPhotosModal.jsx';
import { fusionToolToInternal, mergeFusionAndMetadata, generateId, newTool, generateMachineNumbers, getNextMachineNumber, typeFromProShopGroup, resolveThreadSize } from '../schema/toolSchema.js';
import { machineNumberArgs } from '../context/appState.js';
import { insertComponentIndex, newComponent, normProShopId } from '../schema/insertFamilies.js';
import { vendorHasOwnCatalogNumber, resolveVendorName } from '../schema/vendorRegistry.js';
import { generateManufacturerUrl, generateVendorUrl } from '../utils/urlGenerators.js';
import { convertLength, getDefaultUnit, unitAbbr } from '../utils/units.js';
import { proShopRowsToObjects, detectProShopFormat, proShopFormatLabel } from '../utils/proShopHeaders.js';
import { locationNumber, composeLocationString } from '../utils/locationSystem.js';
import { exportFullLibrary as exportProShop } from '../utils/proShopExport.js';
import { exportFullLibrary as exportFusion } from '../utils/fusionExport.js';

// Merge an uploaded Fusion JSON's tools into the already-loaded library —
// tools sharing an `id` (Fusion guid) are updated in place; new ids are
// appended. Used by the "Add to Current Library" path so an upload doesn't
// discard the library already loaded via APS.
function mergeImportedTools(current, imported) {
  const byId = new Map(current.map(t => [t.id, t]));
  for (const t of imported) {
    byId.set(t.id, byId.has(t.id) ? { ...byId.get(t.id), ...t } : t);
  }
  return [...byId.values()];
}

export default function ImportFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tools, saveFullLibrary, isSaving, markSetupStepInSettings, shopSettings, components, saveComponents } = useApp();
  const toolLibraries = shopSettings?.tool_libraries || [];
  const defaultLibId = shopSettings?.default_tool_library_id || toolLibraries[0]?.id || null;
  const [targetLibraryId, setTargetLibraryId] = useState(defaultLibId);
  // Settings' "Open Import" (ProShop merge step) deep-links straight to step 2
  // via navigation state so the user isn't dropped at the Fusion upload step.
  const [step, setStep] = useState(location.state?.startStep || 1);
  const [fusionTools, setFusionTools] = useState(tools);
  const [parseError, setParseError] = useState('');
  // Soft "this looks like the other kind of file" flag — set when a file dropped
  // on the Fusion step looks like a ProShop CSV, or vice versa.
  const [mismatchWarn, setMismatchWarn] = useState('');
  const [fusionPreview, setFusionPreview] = useState(null);
  const [proShopMatches, setProShopMatches] = useState(null);
  const [psFormat, setPsFormat] = useState(null); // detected header format of the last CSV
  const [psUnit, setPsUnit] = useState(getDefaultUnit());
  // Component records (holder body / insert) filled from ProShop rows that
  // matched one side of an insert tool's combined id — saved to
  // tool_components.json on commit (the pairings re-link them by number on the
  // next load via derivePairings).
  const [psComponents, setPsComponents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const fusionFileRef = useRef(null);
  const proShopFileRef = useRef(null);

  // ── Step 1: Import Fusion Library ───────────────────────────────────────
  const handleFusionFile = (file) => {
    if (!file) return;
    setParseError('');
    setMismatchWarn('');
    const reader = new FileReader();
    reader.onload = (e) => {
      // Flag a ProShop CSV dropped on the Fusion (JSON) step.
      if (detectFileKind(e.target.result, file.name) === 'proshop') {
        setMismatchWarn('This looks like ProShop CSV data, not a Fusion tool library (JSON). Upload it in the "Merge ProShop" step instead.');
        return;
      }
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

  // Merge the uploaded JSON's tools into the already-loaded library instead
  // of replacing it (e.g. adding a handful of tools from a job file on top
  // of the full library already synced via APS).
  const handleAddFusion = () => {
    if (!fusionPreview) return;
    const imported = fusionPreview.raw.map(fTool => {
      const internal = fusionToolToInternal({
        ...fTool,
        guid: fTool.guid || generateId(),
      });
      return mergeFusionAndMetadata(internal, null);
    });
    setFusionTools(current => mergeImportedTools(current, imported));
    setStep(2);
  };

  // Skip the Fusion JSON upload entirely — `fusionTools` already starts as
  // the library currently loaded in the app (e.g. via the APS sync), so just
  // move on to the ProShop merge step.
  const useLoadedLibrary = () => {
    setFusionTools(tools);
    setStep(2);
  };

  // ── Step 2: Merge ProShop CSV ─────────────────────────────────────────
  const handleProShopFile = (file) => {
    if (!file) return;
    setParseError('');
    setMismatchWarn('');
    const reader = new FileReader();
    reader.onload = (e) => {
      // Flag a Fusion JSON library dropped on the ProShop (CSV) step.
      if (detectFileKind(e.target.result, file.name) === 'fusion') {
        setMismatchWarn('This looks like Fusion tool library data (JSON), not a ProShop CSV export. Upload it in the "Import Fusion" step instead.');
        return;
      }
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');
        // Canonicalize headers so BOTH a real ProShop export (display-name
        // headers) and this app's own ProShop export (API-id headers) import
        // identically — see proShopHeaders.js.
        setPsFormat(detectProShopFormat(rows[0]));
        const data = proShopRowsToObjects(rows);
        // ProShop exports one row per "Tool #" normally, but multiple rows
        // (sharing the same Tool #) when a tool has multiple purchasing/
        // Approved Brand options — group them before matching.
        const groupMap = new Map();
        for (const row of data) {
          const key = row['Tool #'] || `__row_${groupMap.size}`;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key).push(row);
        }
        const matches = matchProShopToTools([...groupMap.values()], fusionTools, psUnit, components?.components || [], shopSettings?.location_config?.systems || []);
        setProShopMatches(matches);
      } catch (err) {
        setParseError(`ProShop CSV parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyMerge = () => {
    if (!proShopMatches) return;
    markSetupStepInSettings('proshopMerged');
    const merged = [...fusionTools];

    proShopMatches.matched.forEach(({ toolIdx, additions, conflicts }) => {
      merged[toolIdx] = { ...merged[toolIdx], ...additions };
      // Differences the app couldn't auto-resolve ride along as flagged conflicts
      // (persisted via buildMetadataTool → mergeToolConflicts, deduped by field),
      // surfaced on the tool page — never silently overwritten.
      if (conflicts && conflicts.length) {
        merged[toolIdx]._combineConflicts = [...(merged[toolIdx]._combineConflicts || []), ...conflicts];
      }
    });

    proShopMatches.unmatched.forEach(({ psGroup, action }) => {
      if (action === 'add') {
        merged.push(psRowToTool(psGroup, psUnit, shopSettings?.location_config?.systems || []));
      }
    });

    // Insert-tool component records (holder body / insert) filled from their
    // ProShop rows — carried to the save step. They link back to their pairing
    // by ProShop number on the next load (derivePairings).
    setPsComponents((proShopMatches.components || []).map(c => c.record));

    setFusionTools(merged);
    setStep(3);
  };

  const skipProShop = () => setStep(3);

  // Tools added from unmatched ProShop rows (no_fusion_link) are saved as
  // metadata-only "no-Fusion" tools — they do NOT create a Fusion library entry
  // (Fusion-decoupling Phase B). Surfaced on the Review step so it's clear they
  // won't appear in Fusion until promoted.
  const newNoFusionCount = fusionTools.filter(t => t.no_fusion_link).length;

  // Total fill-gap fields where the app + ProShop disagreed — flagged (not
  // overwritten) for the user to resolve on each tool page after save.
  const proShopConflictCount = (proShopMatches?.matched || [])
    .reduce((n, m) => n + (m.conflicts?.length || 0), 0);

  // ── Step 4: Assign machine numbers (optional), then save ──────────────
  // The machine-number step is only needed to (re)number tools in bulk. It is
  // NOT required to save — the Review step has a direct "Save to Drive" that
  // never touches machine numbers, so an incremental import (adding one tool's
  // ProShop data) leaves every existing tool's number alone.
  const [mnStart, mnSkip] = machineNumberArgs(shopSettings);
  const startDisplay = mnStart ?? 30;
  const skipDisplay = mnSkip ?? [98, 99, 100];

  // 'fill'  — only tools WITHOUT a number get one (threaded from the next free
  //           number), so existing numbers are preserved. This is the default.
  // 'all'   — the original bulk-first-import behavior: renumber the whole
  //           library in import order starting at #30 (overwrites existing).
  const [assignMode, setAssignMode] = useState('fill');

  const hasMachineNumber = (t) =>
    t.machine_tool_number != null && t.machine_tool_number !== '' && !isNaN(Number(t.machine_tool_number));

  // Returns a copy of the list with machine numbers applied per the chosen mode.
  // In 'fill' mode a tool that already has a number is returned unchanged.
  const assignMachineNumbers = (list, mode) => {
    if (mode === 'all') {
      const nums = generateMachineNumbers(list.length, mnStart, mnSkip);
      return list.map((t, i) => ({ ...t, machine_tool_number: nums[i] }));
    }
    const used = new Set(list.filter(hasMachineNumber).map(t => Number(t.machine_tool_number)));
    return list.map(t => {
      if (hasMachineNumber(t)) return t;
      const num = getNextMachineNumber([...used], mnStart, mnSkip);
      used.add(num);
      return { ...t, machine_tool_number: num };
    });
  };

  const numberedPreview = assignMachineNumbers(fusionTools, assignMode);
  const missingNumberCount = fusionTools.filter(t => !hasMachineNumber(t)).length;

  // Persist the given list to Drive. Tools that don't already belong to a
  // library (newly imported ones) are tagged with the chosen destination
  // library; existing tools keep their own library_id so saveFullLibrary
  // writes each back to its own file.
  const handleSaveToDrive = async (list) => {
    setSaving(true);
    try {
      const finalList = list.map(t => ({ ...t, library_id: t.library_id || targetLibraryId }));
      await saveFullLibrary(finalList);
      // Persist any insert-tool component records filled from ProShop rows
      // (metadata-only, tool_components.json). Upsert by id so a re-import
      // updates rather than duplicates.
      if (psComponents.length) {
        const existing = components?.components || [];
        const byId = new Map(existing.map(c => [c.id, c]));
        for (const rec of psComponents) byId.set(rec.id, rec);
        await saveComponents({ ...(components || { version: 1 }), components: [...byId.values()] });
      }
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

      {showPhotos && <ImportPhotosModal onClose={() => setShowPhotos(false)} />}

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

      {mismatchWarn && (
        <div className="warn-banner mb-16">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            {mismatchWarn}
          </div>
        </div>
      )}

      {/* ── Step 1 ──────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Import Fusion Tool Library</h3>

          {tools.length > 0 && (
            <div style={{ marginBottom: 16, padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Use the library already loaded</div>
              <p className="text-sub text-sm mb-12">
                {tools.length} tools are already loaded in the app (e.g. from your APS sync). Skip the
                upload below and go straight to merging ProShop data into this library.
              </p>
              <button className="btn btn-primary" onClick={useLoadedLibrary}>
                Continue with Loaded Library →
              </button>
            </div>
          )}

          <p className="text-sub text-sm mb-16">
            {tools.length > 0
              ? <>Or upload a different <code>fusion_tool_library.json</code> file below.</>
              : <>Upload your <code>fusion_tool_library.json</code> file. The app will parse all tools and assign stable IDs.</>}
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
              <div className="text-sub text-sm mb-12">{fusionPreview.count} tools found</div>
              <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={handleLoadFusion}>
                  {tools.length > 0 ? 'Replace Library →' : 'Load into Library →'}
                </button>
                {tools.length > 0 && (
                  <button className="btn btn-secondary" onClick={handleAddFusion}>
                    Add to Current Library →
                  </button>
                )}
              </div>
              {tools.length > 0 && (
                <p className="text-sub text-xs mt-8">
                  <strong>Replace</strong> discards the {tools.length} currently loaded tools and continues with only
                  this file's {fusionPreview.count} tools. <strong>Add</strong> keeps your current library and adds or
                  updates tools from this file (matched by tool ID).
                </p>
              )}
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
            and purchasing info; other fields fill gaps only. Both a real ProShop export and this app's own
            ProShop export are accepted — the format is detected automatically.
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

          {psFormat && psFormat !== 'unknown' && (
            <div className="text-sub text-xs mt-8">
              Detected: <strong>{proShopFormatLabel(psFormat)}</strong>
            </div>
          )}

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
                {(proShopMatches.components?.length > 0) && (
                  <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--blue)' }}>{proShopMatches.components.length}</strong> insert-tool component{proShopMatches.components.length === 1 ? '' : 's'} (holder / insert)
                  </div>
                )}
                {proShopConflictCount > 0 && (
                  <div style={{ padding: '8px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                    <strong style={{ color: 'var(--orange)' }}>{proShopConflictCount}</strong> flagged difference{proShopConflictCount === 1 ? '' : 's'} (kept app value — resolve on the tool page)
                  </div>
                )}
              </div>

              {proShopMatches.unmatched.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-header mb-8" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span>Unmatched ProShop Rows</span>
                    <div className="flex gap-8">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setProShopMatches({
                          ...proShopMatches,
                          unmatched: proShopMatches.unmatched.map(item => ({ ...item, action: 'add' })),
                        })}
                      >Add All as New Tools</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setProShopMatches({
                          ...proShopMatches,
                          unmatched: proShopMatches.unmatched.map(item => ({ ...item, action: 'skip' })),
                        })}
                      >Skip All</button>
                    </div>
                  </div>
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

          {/* Photo import sub-step — one-time bulk copy of ProShop tool photos */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>Import ProShop Photos (optional)</div>
            <p className="text-sub text-sm mb-12">
              One-time: copy existing ProShop tool photos from a Google Drive folder into the tool library.
              Each top-level photo must be named <code>tools_&#123;ProShopID&#125;_….png/jpg</code>.
            </p>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPhotos(true)}>
              <ImageIcon size={14} /> Import ProShop Photos…
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ──────────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Review & Save</h3>
          <p className="text-sub text-sm mb-16">
            {fusionTools.length} tools ready to save. Export as needed, then save to Drive.
          </p>

          {psComponents.length > 0 && (
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
              <strong style={{ color: 'var(--blue)' }}>{psComponents.length}</strong> insert-tool
              component record{psComponents.length === 1 ? '' : 's'} (holder&nbsp;body / insert) will be
              saved with their own location &amp; purchasing. They link to their combined tool by ProShop
              number on the next load.
            </div>
          )}

          {newNoFusionCount > 0 && (
            <div className="warn-banner mb-16">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                {newNoFusionCount} {newNoFusionCount === 1 ? 'tool has' : 'tools have'} no matching
                Fusion entry ("No Fusion Link"). {newNoFusionCount === 1 ? 'It' : 'They'} will be saved as
                no-Fusion tools (in the app + metadata only) — no entry is created in your Fusion library.
                Connect Google Drive to save them, and promote them to Fusion later if needed.
              </div>
            </div>
          )}

          <div className="flex gap-8 mb-20" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => { markSetupStepInSettings('proshopExported'); exportProShop(fusionTools); }}>
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

          {toolLibraries.length > 1 && (
            <label className="flex items-center gap-8 text-sm mb-12" style={{ flexWrap: 'wrap' }}>
              <span className="text-sub">Import new tools into library:</span>
              <select
                className="field-input"
                style={{ width: 'auto' }}
                value={targetLibraryId || ''}
                onChange={e => setTargetLibraryId(e.target.value)}
              >
                {toolLibraries.map(lib => <option key={lib.id} value={lib.id}>{lib.fileName}</option>)}
              </select>
            </label>
          )}

          <div className="flex gap-8 mt-16" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => handleSaveToDrive(fusionTools)}
              disabled={saving || isSaving}
            >
              {saving || isSaving ? 'Saving to Drive…' : `Save ${fusionTools.length} Tools to Drive`}
            </button>
            <button className="btn btn-secondary" onClick={() => setStep(4)} disabled={saving || isSaving}>
              Assign Machine Numbers →
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')} disabled={saving || isSaving}>
              Cancel
            </button>
          </div>
          <p className="text-sub text-xs mt-8">
            <strong>Save</strong> keeps every tool's existing machine number untouched — use this when adding
            or updating a few tools. <strong>Assign Machine Numbers</strong> is only for (re)numbering tools in
            bulk (e.g. a first import); it never has to be run to save.
          </p>
        </div>
      )}

      {/* ── Step 4 ──────────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Assign Machine Tool Numbers</h3>

          <div className="flex flex-col gap-8 mb-12">
            <label className="flex items-start gap-8 text-sm" style={{ cursor: 'pointer' }}>
              <input type="radio" name="assignMode" checked={assignMode === 'fill'} onChange={() => setAssignMode('fill')} style={{ marginTop: 3 }} />
              <span>
                <strong>Only number tools that don't have one yet</strong> (recommended).
                {' '}Existing machine numbers are kept as-is; {missingNumberCount} tool{missingNumberCount === 1 ? '' : 's'}
                {' '}will get the next free number{missingNumberCount === 0 ? ' (none need one)' : ''}.
              </span>
            </label>
            <label className="flex items-start gap-8 text-sm" style={{ cursor: 'pointer' }}>
              <input type="radio" name="assignMode" checked={assignMode === 'all'} onChange={() => setAssignMode('all')} style={{ marginTop: 3 }} />
              <span>
                <strong>Renumber the entire library</strong> starting at <strong>#{startDisplay}</strong> in import order
                (skips {skipDisplay.join(', ')}). <em>Overwrites every existing number</em> — for a first/bulk import only.
              </span>
            </label>
          </div>

          <p className="text-sub text-xs mb-16">
            The same value is written to the tool number, length offset, and diameter offset so the machine reads them as locked.
          </p>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
            <table className="match-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Current</th>
                  <th>Machine #</th>
                </tr>
              </thead>
              <tbody>
                {fusionTools.map((t, i) => {
                  const newNum = numberedPreview[i].machine_tool_number;
                  const kept = assignMode === 'fill' && hasMachineNumber(t);
                  return (
                    <tr key={t.id}>
                      <td className="text-sub text-xs">{i + 1}</td>
                      <td className="truncate" style={{ maxWidth: 220 }}>{t.description || '—'}</td>
                      <td className="text-xs text-sub">{t.tool_type}</td>
                      <td className="text-xs text-sub">
                        {hasMachineNumber(t) ? `T${t.machine_tool_number}` : '—'}
                      </td>
                      <td className="font-mono" style={{ color: kept ? 'var(--text-sub)' : 'var(--green)' }}>
                        {newNum == null ? '—' : `T${newNum}`}{kept ? ' (kept)' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {toolLibraries.length > 1 && (
            <label className="flex items-center gap-8 text-sm mt-16" style={{ flexWrap: 'wrap' }}>
              <span className="text-sub">Import new tools into library:</span>
              <select
                className="field-input"
                style={{ width: 'auto' }}
                value={targetLibraryId || ''}
                onChange={e => setTargetLibraryId(e.target.value)}
              >
                {toolLibraries.map(lib => <option key={lib.id} value={lib.id}>{lib.fileName}</option>)}
              </select>
            </label>
          )}

          <div className="flex gap-8 mt-16">
            <button
              className="btn btn-primary btn-lg"
              onClick={() => handleSaveToDrive(assignMachineNumbers(fusionTools, assignMode))}
              disabled={saving || isSaving}
            >
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

// ── File-kind sniffer ───────────────────────────────────────────────────────
// Lightweight guess at whether a dropped file is a Fusion tool library (JSON)
// or a ProShop export (CSV), so the wrong file on the wrong step gets flagged
// rather than failing with a cryptic parse error. Content wins over extension.
function detectFileKind(text, filename = '') {
  const trimmed = (text || '').trim();
  // Fusion library: a JSON object/array (usually { data: [...] }).
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'fusion';
  // ProShop export: CSV whose header carries the Tool #/Description columns.
  const firstLine = trimmed.split('\n')[0] || '';
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'csv' || firstLine.includes(',')) {
    if (/tool\s*#|description|cut\s*dia|approved\s*brand/i.test(firstLine)) return 'proshop';
    return 'csv';
  }
  return 'unknown';
}

// ── CSV parser ──────────────────────────────────────────────────────────────
export function parseCSV(text) {
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

// Equality used when deciding fill-gap vs. flag on a ProShop merge. Strings are
// compared case/space-insensitively (so "AlTiN" vs "altin" isn't a false flag);
// lengths within a small tolerance are equal (float noise / unit conversion).
const psStrEq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const psNumEq = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-4;

// A system whose only per-tool variable is the BIN — zone/station/drawer are off
// or a fixed custom prefix (e.g. "LC"). Only then can a bare ProShop bin number
// fully determine a structured location (a system with selectable level options
// can't be derived from a number alone).
function isBinOnlySystem(sys) {
  const L = sys?.levels || {};
  const ok = (lv) => !lv || !lv.on || lv.identFormat === 'custom';
  return ok(L.zone) && ok(L.station) && ok(L.drawer);
}

// Map a bare ProShop bin number to a STRUCTURED tool_location so the app owns the
// location: it composes to "LC-140" via the Location System AND persists in
// metadata (the only place a no-Fusion tool can keep a location — a free-text
// string has nowhere to live for it). Requires exactly one bin-only Location
// System; otherwise returns null and the caller falls back to free-text.
function proShopStructuredLocation(psLoc, systems) {
  const num = locationNumber(psLoc);
  if (num == null) return null;
  const usable = (systems || []).filter(isBinOnlySystem);
  if (usable.length !== 1) return null;
  const sys = usable[0];
  const loc = { system_id: sys.id, zone_id: null, station_id: null, drawer_id: null, bin: num };
  return { tool_location: loc, location: composeLocationString(loc, sys) };
}

function psRowToTool(group, psUnit = 'inches', locationSystems = []) {
  const r = group[0];
  const structuredLoc = proShopStructuredLocation(r['Location'], locationSystems);
  const grouping = r['Tool Group'] || '';
  const cornerRadius = psNum(r['CornerRad']);
  const toolType = typeFromProShopGroup(grouping, { description: r['Description'], cornerRadius }) || 'flat end mill';
  return {
    ...newTool(toolType),
    unit: psUnit,
    tool_id: r['Tool #'] || '',
    grouping,
    description: r['Description'] || '',
    diameter: psNum(r['Cut Dia']),
    flute_length: psNum(r['LOC']),
    overall_length: psNum(r['Overall Length']),
    number_of_flutes: parseInt(r['No.ofFlutes']) || null,
    shank_diameter: psNum(r['Shank Diameter']),
    corner_radius: cornerRadius,
    tip_angle: psNum(r['Tip Angle']),
    tip_diameter: psNum(r['Tip Diameter']),
    helix_angle: psNum(r['HelixAngle']),
    taper_angle: psNum(r['Taper']),
    coating: r['Coating'] || '',
    material: psMaterial(r['Tool Material']),
    ...resolveThreadSize(r['Thread'] || r['Pitch'] || ''),
    tap_class: r['Tap class'] || '',
    point_type: r['Point Type'] || '',
    stub_jobber: r['(S)tub / (J)obber'] || '',
    full_profile: r['Full Profile'] === 'true',
    backside_capable: r['Backside Capable'] === 'true',
    double_ended: r['Double Ended'] === 'Y',
    tsc_capable: r['Through Coolant'] === 'true',
    custom_grind: r['Custom Grind'] === 'true',
    material_suitability: r['Recommended Workpiece Material']
      ? r['Recommended Workpiece Material'].split(',').map(s => s.trim()).filter(Boolean)
      : [],
    min_ooh: psNum(r['Length Below Holder - MIN OOH']),
    tip_to_first_thread: psNum(r['Tip to 1st Full Thread']),
    // Structured location when a bin-only Location System exists (so a no-Fusion
    // tool's location persists in metadata and composes "LC-140"); else free-text.
    ...(structuredLoc
      ? { tool_location: structuredLoc.tool_location, location: structuredLoc.location }
      : { location: r['Location'] || '' }),
    vendor: resolveVendorName(r['Approved Brand'] || ''),
    purchasing: buildPurchasingFromGroup(group),
    // No Fusion entry exists yet — flags this as a placeholder needing Fusion
    // setup (geometry refinement, presets, holder/assembly) before use.
    no_fusion_link: true,
  };
}

// Build the normalized { manufacturers: [], vendors: [] } purchasing shape from
// a group of ProShop CSV rows sharing a Tool #. ProShop exports multiple Approved
// Brands two different ways: as multiple ROWS sharing a Tool #, OR as suffixed
// COLUMNS in one row (`Approved Brand`, `Approved Brand_2`, `EDP#_2`, …). Both are
// normalized via `brandTuples` into a flat list of {brand, vendor, edp, cost}.
// ProShop's single "EDP#" column is ambiguous — it's either the manufacturer's
// part number or the vendor's own catalog number depending on the vendor. Route
// it to vendors[].vendor_num when the vendor is known to assign its own catalog
// numbers (VENDORS_WITH_OWN_NUMBERS), otherwise to manufacturers[].edp.
function brandTuples(r) {
  // Case-insensitive, punctuation-insensitive key lookup so both the canonical
  // base columns ("Approved Brand") and the raw suffixed ones ("approvedBrand_2")
  // resolve regardless of casing/spacing.
  const byNorm = {};
  for (const k of Object.keys(r)) byNorm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = r[k];
  const tuples = [];
  for (let i = 1; i <= 8; i++) {
    const sfx = i === 1 ? '' : String(i);
    const brand = byNorm['approvedbrand' + sfx] || '';
    const vendor = byNorm['vendor' + sfx] || '';
    const edp = byNorm['edp' + sfx] || '';
    const cost = byNorm['cost' + sfx] || '';
    if (brand || vendor || edp || cost) tuples.push({ brand, vendor, edp, cost });
  }
  return tuples;
}
function buildPurchasingFromGroup(group) {
  const manufacturers = [];
  const vendors = [];
  const mfgByName = new Map();

  group
    .flatMap(brandTuples)
    .forEach(t => {
      const mfgName = resolveVendorName(t.brand || '');
      const vendorName = resolveVendorName(t.vendor || '');
      const edp = t.edp || '';
      const cost = t.cost || '';

      let mfg = mfgByName.get(mfgName);
      if (!mfg) {
        mfg = { id: generateId(), name: mfgName, edp: '', edp_url: '', mfg_num: '', mfg_num_url: '', order: manufacturers.length };
        manufacturers.push(mfg);
        mfgByName.set(mfgName, mfg);
      }

      const vendorHasOwnNum = vendorHasOwnCatalogNumber(vendorName);
      if (edp && !vendorHasOwnNum && !mfg.edp) mfg.edp = edp;

      if (vendorName || edp || cost) {
        vendors.push({
          id: generateId(),
          manufacturer_id: mfg.id,
          name: vendorName,
          vendor_num: vendorHasOwnNum ? edp : '',
          vendor_num_url: '',
          price: cost ? psNum(cost) : null,
          order: vendors.length,
        });
      }
    });

  // ProShop doesn't export links — backfill from EDP#/Vendor# using known
  // URL patterns wherever a generator matches.
  manufacturers.forEach(mfg => {
    if (!mfg.edp_url && mfg.edp) {
      const generated = generateManufacturerUrl(mfg.name, mfg.edp);
      if (generated) mfg.edp_url = generated;
    }
  });
  vendors.forEach(vendor => {
    if (!vendor.vendor_num_url && vendor.vendor_num) {
      const generated = generateVendorUrl(vendor.name, vendor.vendor_num);
      if (generated) vendor.vendor_num_url = generated;
    }
  });

  return { manufacturers, vendors };
}

// ── Match ProShop row-groups to existing tools ────────────────────────────
// psUnit is the unit of the ProShop file; lengths merged onto an existing tool
// (min_ooh, tip_to_first_thread) are converted from it into the matched tool's
// own unit.
export function matchProShopToTools(groups, tools, psUnit = 'inches', existingComponents = [], locationSystems = [], forceSingleMatch = false) {
  const matched = [];
  const usedToolIdxs = new Set();

  // Insert tools carry a combined "holder/insert" tool_id; each side's ProShop
  // number identifies a COMPONENT record, not a tool. Index them so a component
  // row fills/creates its component instead of matching a tool or minting a
  // placeholder. Existing components are looked up so a re-import updates rather
  // than duplicates.
  const componentIndex = insertComponentIndex(tools);
  const existingCompByNum = new Map((existingComponents || []).map(c => [normProShopId(c.tool_id), c]));
  const components = [];

  for (const group of groups) {
    const r = group[0];
    const toolNum = (r['Tool #'] || '').trim();
    const desc = (r['Description'] || '').toLowerCase().trim();
    const diam = psNum(r['Cut Dia']);

    // Insert-tool component row → route to its component record (never a tool /
    // placeholder). Purchasing is built the same way as for a tool; the free-
    // text location fills only until a structured location is assigned. A row
    // matches a component when EITHER (a) its number is one side of a combined-id
    // tool in the library (componentIndex), OR (b) an existing component record
    // already carries this number (existingCompByNum) — the latter covers
    // components whose parent pairing has no combined tool_id (a generic_insert,
    // or one where "Apply as Tool ID" was never run), which componentIndex misses
    // and which would otherwise fall through and mint a Fusion-only placeholder.
    const normNum = toolNum ? normProShopId(toolNum) : '';
    const existing = normNum ? existingCompByNum.get(normNum) : null;
    const compMeta = normNum
      ? (componentIndex.get(normNum)
          || (existing ? { role: existing.role, family: existing.family } : null))
      : null;
    if (compMeta) {
      const base = existing || newComponent(compMeta.role, compMeta.family, { tool_id: toolNum });
      const purchasing = buildPurchasingFromGroup(group);
      const psLoc = (r['Location'] || '').trim();
      const record = {
        ...base,
        role: compMeta.role,
        family: compMeta.family,
        tool_id: toolNum,
        description: existing?.description || r['Description'] || base.description || '',
        unit: existing?.unit || psUnit,
      };
      if (purchasing.manufacturers.length || purchasing.vendors.length) record.purchasing = purchasing;
      if (!base.tool_location && psLoc) record.location = psLoc;
      components.push({ record, isNew: !existing, psGroup: group });
      continue;
    }

    let toolIdx = -1;

    // Primary match: ProShop "Tool #" is the Primary Key === our tool_id
    if (toolNum) {
      toolIdx = tools.findIndex((t, i) => !usedToolIdxs.has(i) && t.tool_id === toolNum);
    }

    // Legacy-ID match: an old ProShop "Tool #" that this tool used to carry before
    // a bulk re-number still resolves to the right tool.
    if (toolIdx < 0 && toolNum) {
      toolIdx = tools.findIndex((t, i) =>
        !usedToolIdxs.has(i) && Array.isArray(t.legacy_ids) && t.legacy_ids.includes(toolNum));
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

    // Single-tool import (ProShopImportModal): the user already picked BOTH the
    // tool and the file, and a per-tool ProShop export often has no "Tool #"
    // column and a description that won't fuzzy-match. Force the one group onto
    // the one tool so it always imports (the modal previews the changes first).
    if (toolIdx < 0 && forceSingleMatch && tools.length === 1 && !usedToolIdxs.has(0)) {
      toolIdx = 0;
    }

    if (toolIdx >= 0) {
      usedToolIdxs.add(toolIdx);
      const tool = tools[toolIdx];
      const additions = {};
      // Fields where the app already has a DIFFERENT value than ProShop are not
      // silently overwritten NOR silently ignored — they're flagged as conflicts
      // ("informed, not blocked"), surfaced on the tool page for the user to pick
      // Keep vs. Use. Only the fill-gap fields flag; the ProShop-authoritative
      // fields below (vendor, purchasing, MIN OOH, through-coolant, custom grind)
      // still auto-win by design.
      const conflicts = [];
      // Set the field when the app has no value; flag when it differs; no-op when equal.
      const fillOrFlag = (field, appVal, psVal, eq = psStrEq) => {
        if (psVal == null || psVal === '') return;
        if (appVal == null || appVal === '') { additions[field] = psVal; return; }
        if (!eq(appVal, psVal)) conflicts.push({ field, values: [appVal, psVal] });
      };

      // ProShop wins (authoritative — auto-overwrite, never flagged)
      if (r['Approved Brand']) additions.vendor = resolveVendorName(r['Approved Brand']);
      const purchasing = buildPurchasingFromGroup(group);
      if (purchasing.manufacturers.length || purchasing.vendors.length) additions.purchasing = purchasing;
      if (r['Through Coolant'] === 'true' || r['Through Coolant'] === 'false') {
        additions.tsc_capable = r['Through Coolant'] === 'true';
      }
      if (r['Custom Grind'] === 'true' || r['Custom Grind'] === 'false') {
        additions.custom_grind = r['Custom Grind'] === 'true';
      }
      // min_ooh: ProShop is authoritative — always overwrite when present, after
      // converting from the ProShop file unit into the matched tool's own unit.
      const psMinOoh = psNum(r['Length Below Holder - MIN OOH']);
      if (psMinOoh != null) additions.min_ooh = convertLength(psMinOoh, psUnit, tool.unit);

      // Fill gaps, else flag a difference — don't silently overwrite or ignore.
      // tool_id: a match by exact tool_id is equal (no flag); a legacy-id match is
      // an expected re-number (the ProShop # is a known legacy id) so it's not a
      // conflict either — only a genuinely different id (e.g. a description match)
      // flags.
      if (toolNum) {
        if (!tool.tool_id) additions.tool_id = toolNum;
        else if (!psStrEq(tool.tool_id, toolNum)
          && !(tool.legacy_ids || []).some(l => psStrEq(l, toolNum))) {
          conflicts.push({ field: 'tool_id', values: [tool.tool_id, toolNum] });
        }
      }
      fillOrFlag('coating', tool.coating, r['Coating']);
      fillOrFlag('point_type', tool.point_type, r['Point Type']);
      // Location. ProShop's Location is a bare bin NUMBER (no "LC-" prefix); the
      // app's location string carries the Location System prefix (e.g. "LC-1405").
      // Compare on the NUMBER only so "LC-1405" and "1405" are the same bin. Same
      // ProShop # ⇒ same tool ⇒ the bin should match. Rules:
      //  • App owns a STRUCTURED location (tool_location.bin): a number mismatch is
      //    FLAGGED for the user to reconcile — never silently overwritten. (Once the
      //    app auto-names locations, ProShop imports are rare; this catches drift.)
      //  • No app-owned location (legacy Fusion free-text or empty): ProShop wins
      //    over Fusion — fill when empty, overwrite when the number differs, keep the
      //    app's prefixed string when the number already matches.
      const psLoc = (r['Location'] || '').trim();
      const psLocNum = locationNumber(psLoc);
      if (psLoc && psLocNum != null) {
        if (tool.tool_location && tool.tool_location.bin != null) {
          // App already owns a STRUCTURED location — a bin-number mismatch is
          // flagged for review, never silently overwritten.
          if (Number(tool.tool_location.bin) !== psLocNum) {
            conflicts.push({ field: 'location', values: [tool.location, psLoc] });
          }
        } else {
          const retired = (tool.legacy_locations || []).some(l => locationNumber(l) === psLocNum);
          if (!retired) {
            const structured = proShopStructuredLocation(psLoc, locationSystems);
            if (structured) {
              // Take over: store the ProShop number as a structured location so it
              // composes "LC-140" and persists in metadata (incl. no-Fusion tools).
              additions.tool_location = structured.tool_location;
              additions.location = structured.location;
            } else if (locationNumber(tool.location) !== psLocNum) {
              // No single bin-only Location System — fall back to free-text (ProShop
              // wins over a legacy Fusion location when the number differs).
              additions.location = psLoc;
            }
          }
        }
      }
      if (r['Thread'] || r['Pitch']) {
        const resolved = resolveThreadSize(r['Thread'] || r['Pitch'] || '');
        if (resolved.pitch) {
          if (!tool.pitch) {
            additions.pitch = resolved.pitch;
            // STI / thread-unit ride along only when we're actually filling pitch.
            if (resolved.is_sti && !tool.is_sti) additions.is_sti = true;
            if (resolved.thread_unit && !tool.tap_thread_unit) additions.tap_thread_unit = resolved.thread_unit;
          } else if (!psStrEq(tool.pitch, resolved.pitch)) {
            conflicts.push({ field: 'pitch', values: [tool.pitch, resolved.pitch] });
          }
        }
      }
      const psTip = psNum(r['Tip to 1st Full Thread']);
      if (psTip != null) {
        const psTipConv = convertLength(psTip, psUnit, tool.unit);
        if (tool.tip_to_first_thread == null) additions.tip_to_first_thread = psTipConv;
        else if (!psNumEq(tool.tip_to_first_thread, psTipConv)) {
          conflicts.push({ field: 'tip_to_first_thread', values: [tool.tip_to_first_thread, psTipConv] });
        }
      }

      matched.push({ toolIdx, psGroup: group, additions, conflicts });
    }
  }

  const routedGroups = new Set([...matched.map(m => m.psGroup), ...components.map(c => c.psGroup)]);
  const unmatched = groups
    .filter(g => !routedGroups.has(g))
    .map(g => ({ psGroup: g, action: 'skip' }));

  return { matched, unmatched, components };
}
