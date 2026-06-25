import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, AlertTriangle, Hash, Package, Trash2, Wand2, Ruler, HardDrive, ExternalLink, FileJson, Download, X, FolderOpen, LogOut, User, CheckCircle2, Circle, AlertCircle, Image as ImageIcon, Cpu, GripVertical, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp, SETUP_STEPS } from '../context/AppContext.jsx';
import { generateMachineNumbers, generateId, duplicateIdClusters } from '../schema/toolSchema.js';
import { composeToolId, nextSequential, isCounterMode, previewToolId } from '../utils/toolIdSystem.js';
import { useDragReorder } from './useDragReorder.js';
import { getDefaultUnit, setDefaultUnit } from '../utils/units.js';
import { FilePicker } from './LibrarySetup.jsx';
import DescRenameModal from './DescRenameModal.jsx';
import InfoTip from './InfoTip.jsx';
import ImportPhotosModal from './ImportPhotosModal.jsx';
import { exportFullLibrary } from '../utils/proShopExport.js';

const ID_MODES = [
  { id: 'proshop', label: 'ProShop', desc: 'ID comes from ProShop (today’s behavior). Shows a working link to the ProShop tool page.' },
  { id: 'location', label: 'Location-based', desc: 'Cabinet + drawer + number, e.g. 2C-1405. Cabinet/drawer also fill the Location field.' },
  { id: 'sequential', label: 'Sequential', desc: 'A plain running number, e.g. 1042.' },
  { id: 'type_prefix', label: 'Type prefix', desc: 'Tool-type code + number, e.g. EM-1042.' },
  { id: 'size_first', label: 'Size first', desc: 'Diameter + type code + number, e.g. 0500-EM-1042.' },
  { id: 'machine_linked', label: 'Machine-linked', desc: 'Follows the machine tool number, e.g. T42.' },
  { id: 'other_erp', label: 'Other ERP', desc: 'Reserved for a future in-house ERP ID source.', disabled: true },
];

export default function Settings() {
  const navigate = useNavigate();
  const {
    tools, needsNormalize, fetchRawLibrary, renumberLibrary, assignToolIds, renumberAllToolIds, isSaving,
    markSetupStepInSettings,
    libraryLocation, holderLibraryLocation, holderLibrarySetupComplete,
    setLibraryLocation, setHolderLibraryLocation, clearHolderLibraryLocation, notify,
    googleAuthenticated, metadataSkipped, user: googleUser,
    fetchMetadataLocation, reconnectMetadata, disconnectMetadata,
    shopSettings, saveShopSettings, signOutAll,
    setupProgress, demoMode,
  } = useApp();

  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [showDescRename, setShowDescRename] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [defaultUnit, setDefaultUnitState] = useState(getDefaultUnit());

  // Metadata file location — fetched lazily so Settings doesn't add a Drive
  // round-trip to every page load; only resolved while this page is open.
  const [metaLocation, setMetaLocation] = useState(null);
  const [metaLocLoading, setMetaLocLoading] = useState(false);
  const [metaLocError, setMetaLocError] = useState('');

  useEffect(() => {
    if (!googleAuthenticated) return;
    let cancelled = false;
    setMetaLocLoading(true);
    setMetaLocError('');
    fetchMetadataLocation()
      .then(loc => { if (!cancelled) setMetaLocation(loc); })
      .catch(err => { if (!cancelled) setMetaLocError(err.message); })
      .finally(() => { if (!cancelled) setMetaLocLoading(false); });
    return () => { cancelled = true; };
  }, [googleAuthenticated, fetchMetadataLocation]);

  const changeDefaultUnit = (unit) => {
    setDefaultUnit(unit);
    setDefaultUnitState(unit);
  };

  // ── Shop settings (shop_settings.json) ─────────────────────────────────────
  const [shopName, setShopName] = useState(shopSettings?.shop_name || '');
  const [machineStart, setMachineStart] = useState(shopSettings?.machine_number?.start ?? 30);
  const [skipList, setSkipList] = useState(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
  const [skipInput, setSkipInput] = useState('');
  const [hideUnusedTypes, setHideUnusedTypes] = useState(shopSettings?.hide_unused_tool_types ?? true);
  const [savingShop, setSavingShop] = useState(false);

  useEffect(() => {
    setShopName(shopSettings?.shop_name || '');
    setMachineStart(shopSettings?.machine_number?.start ?? 30);
    setSkipList(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
    setHideUnusedTypes(shopSettings?.hide_unused_tool_types ?? true);
  }, [shopSettings]);

  // ── Tool ID system (shop_settings.tool_id_system) ──────────────────────────
  const idsDefault = { mode: 'proshop', separator: '-', start: 1000, skip: [], digits: 4, location: { cabinet_identifier: 'number', drawer_identifier: 'letter' } };
  const [idCfg, setIdCfg] = useState({ ...idsDefault, ...(shopSettings?.tool_id_system || {}) });
  const [idSkipInput, setIdSkipInput] = useState('');
  const [savingIds, setSavingIds] = useState(false);
  // Assign-IDs flow: 'idle' | 'preview' | 'done'
  const [idStage, setIdStage] = useState('idle');
  const [idResultCount, setIdResultCount] = useState(0);
  // Re-number-all flow (overwrites every ID, retires old ones into legacy_ids):
  // 'idle' | 'preview' | 'done'
  const [renumStage, setRenumStage] = useState('idle');
  const [renumResultCount, setRenumResultCount] = useState(0);
  // Per-duplicate-cluster decision: tool_id -> 'merge' | 'split' (default 'merge').
  const [renumDecisions, setRenumDecisions] = useState({});

  useEffect(() => {
    setIdCfg({ ...idsDefault, ...(shopSettings?.tool_id_system || {}) });
  }, [shopSettings]);

  const setIdField = (patch) => setIdCfg(c => ({ ...c, ...patch }));
  const machineLinked = idCfg.mode === 'machine_linked';

  const addIdSkip = () => {
    const n = parseInt(idSkipInput, 10);
    if (!isNaN(n) && !(idCfg.skip || []).includes(n)) setIdField({ skip: [...(idCfg.skip || []), n].sort((a, b) => a - b) });
    setIdSkipInput('');
  };
  const removeIdSkip = (n) => setIdField({ skip: (idCfg.skip || []).filter(x => x !== n) });

  const saveIdSystem = async () => {
    setSavingIds(true);
    try {
      const next = {
        ...(shopSettings || {}),
        tool_id_system: {
          mode: idCfg.mode,
          separator: idCfg.separator,
          start: Number(idCfg.start) || 1000,
          skip: idCfg.skip || [],
          digits: Number(idCfg.digits) || 4,
          location: idCfg.location || idsDefault.location,
        },
      };
      // machine_linked drives machine numbering off the same start/skip.
      if (idCfg.mode === 'machine_linked') {
        next.machine_number = { start: Number(idCfg.start) || 30, skip: idCfg.skip || [] };
      }
      await saveShopSettings(next);
      notify('Tool ID system saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingIds(false); }
  };

  // Tools that will get an ID, with the value they'd get — used for the preview.
  // Demo mode reassigns ALL tools (repeatable sandbox); a live library assigns
  // only the unassigned ones.
  const idPreviewRows = (() => {
    if (idCfg.mode === 'proshop' || idCfg.mode === 'other_erp') return [];
    let counter = isCounterMode(idCfg.mode) ? nextSequential(idCfg.start, idCfg.skip) : null;
    const rows = [];
    for (const t of tools) {
      if (!demoMode && t.tool_id) continue;
      const value = composeToolId(idCfg, t, counter);
      if (!value) continue;
      rows.push({ id: t.id, description: t.description, tool_type: t.tool_type, value });
      if (counter !== null) counter = nextSequential(counter + 1, idCfg.skip);
    }
    return rows;
  })();

  const handleAssignIds = async () => {
    try {
      const count = await assignToolIds();
      setIdResultCount(count);
      setIdStage('done');
    } catch { /* notify handled in assignToolIds */ }
  };

  // Re-number ALL tools: every tool gets a fresh ID under the current scheme; its
  // old ID is retired into legacy_ids. Preview shows old → new for every tool.
  const renumPreviewRows = (() => {
    if (idCfg.mode === 'proshop' || idCfg.mode === 'other_erp') return [];
    let counter = isCounterMode(idCfg.mode) ? nextSequential(idCfg.start, idCfg.skip) : null;
    const rows = [];
    for (const t of tools) {
      const value = composeToolId(idCfg, t, counter);
      if (!value) continue;
      if (counter !== null) counter = nextSequential(counter + 1, idCfg.skip);
      rows.push({ id: t.id, description: t.description, oldId: t.tool_id || '—', value });
    }
    return rows;
  })();

  // Duplicate clusters: tools that show as one entry but are several Fusion
  // tracking-ID groups sharing a tool_id (human-error dupes). Re-number would
  // split them into separate IDs unless the user chooses to merge.
  const renumClusters = duplicateIdClusters(tools);
  const decisionFor = (toolId) => renumDecisions[toolId] || 'merge';
  const setDecision = (toolId, d) => setRenumDecisions(prev => ({ ...prev, [toolId]: d }));
  const setAllDecisions = (d) => setRenumDecisions(
    Object.fromEntries(renumClusters.map(c => [c.tool_id, d]))
  );

  const handleRenumberAll = async () => {
    try {
      const consolidateIds = renumClusters
        .filter(c => decisionFor(c.tool_id) === 'merge')
        .map(c => c.tool_id);
      const count = await renumberAllToolIds(consolidateIds);
      setRenumResultCount(count);
      setRenumStage('done');
    } catch { /* notify handled in renumberAllToolIds */ }
  };

  const addSkip = () => {
    const n = parseInt(skipInput, 10);
    if (!isNaN(n) && !skipList.includes(n)) setSkipList([...skipList, n].sort((a, b) => a - b));
    setSkipInput('');
  };
  const removeSkip = (n) => setSkipList(skipList.filter(x => x !== n));

  const saveShop = async () => {
    setSavingShop(true);
    try {
      await saveShopSettings({
        ...(shopSettings || {}),
        shop_name: shopName,
        default_units: defaultUnit,
        machine_number: { start: Number(machineStart) || 30, skip: skipList },
        hide_unused_tool_types: hideUnusedTypes,
      });
      setDefaultUnit(defaultUnit);
      notify('Shop settings saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingShop(false); }
  };

  // Persist just the machine-number config (start + skip), preserving the rest
  // of shop settings. Lives next to its inputs in the Renumber section.
  const saveMachineNumbers = async () => {
    setSavingShop(true);
    try {
      await saveShopSettings({
        ...(shopSettings || {}),
        machine_number: { start: Number(machineStart) || 30, skip: skipList },
      });
      notify('Machine numbers saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingShop(false); }
  };

  const fmtDate = (v) => {
    if (!v) return null;
    try { return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return null; }
  };

  // ── Machines ───────────────────────────────────────────────────────────────
  const [machines, setMachines] = useState(shopSettings?.machines || []);
  const [defaultMachineId, setDefaultMachineId] = useState(shopSettings?.default_machine_id || null);
  const [expandedMachineId, setExpandedMachineId] = useState(null);
  const [addingMachine, setAddingMachine] = useState(false);
  const [machineDeleteId, setMachineDeleteId] = useState(null);
  const [savingMachines, setSavingMachines] = useState(false);

  // Keep local machine state in sync when shopSettings loads from Drive.
  useEffect(() => {
    setMachines(shopSettings?.machines || []);
    setDefaultMachineId(shopSettings?.default_machine_id || null);
  }, [shopSettings]);

  const blankMachine = () => ({
    id: generateId(),
    model: '',
    machine_type: 'Machining Center',
    taper: '',
    max_rpm: null,
    horsepower: null,
    through_coolant: false,
    through_coolant_psi: null,
    order: machines.length,
  });

  const saveMachines = async (updatedMachines, updatedDefaultId) => {
    setSavingMachines(true);
    try {
      await saveShopSettings({
        ...(shopSettings || {}),
        machines: updatedMachines,
        default_machine_id: updatedDefaultId,
      });
      notify('Machines saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingMachines(false); }
  };

  const updateMachine = (id, patch) =>
    setMachines(ms => ms.map(m => m.id === id ? { ...m, ...patch } : m));

  const { handlers: machDragHandlers } = useDragReorder(machines, (reordered) => {
    setMachines(reordered);
  });

  const MACHINE_TYPES = ['Machining Center', '5-Axis', 'Mill-Turn', 'Lathe / Turret', 'Other'];
  const TAPER_TYPES = [
    'NBT30', 'BT30', 'BT40', 'BT50',
    'CAT40', 'CAT40 Dual Contact', 'CAT50', 'CAT50 Dual Contact',
    'HSK-A63', 'HSK-A100', 'HSK-E32', 'HSK-E40', 'Other',
  ];

  // ── Renumber ───────────────────────────────────────────────────────────────
  const [stage, setStage] = useState('idle');
  const [previewRows, setPreviewRows] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(0);

  const startPreview = async () => {
    setError('');
    setLoadingPreview(true);
    try {
      const list = await fetchRawLibrary();
      const numbers = generateMachineNumbers(list.length, Number(machineStart) || 30, skipList);
      setPreviewRows(list.map((f, i) => ({
        id: f.guid,
        description: f.description || '—',
        tool_type: f.type || '—',
        current: f['post-process']?.number ?? null,
        next: numbers[i],
      })));
      setStage('preview');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDisconnectMetadata = () => {
    if (!window.confirm(
      "Disconnect this metadata file and set up a new one?\n\n" +
      "This only changes which Drive file the app links to — nothing in Drive gets deleted. " +
      "You'll be sent back through the connect screen to sign in and pick a folder for a " +
      "brand-new tool_metadata.json. None of the old file's notes, tags, or assemblies carry over."
    )) return;
    disconnectMetadata();
  };

  const handleRenumber = async () => {
    setError('');
    try {
      const count = await renumberLibrary();
      setResultCount(count);
      setStage('done');
      markSetupStepInSettings('machineNumbers');
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelPreview = () => {
    setStage('idle');
    setConfirmText('');
    setError('');
  };

  const handleExportProShop = () => {
    exportFullLibrary(tools);
    markSetupStepInSettings('proshopExported');
    notify(`Exported ${tools.length} tools to ProShop CSV`, 'success');
  };

  // ── Setup step derivation (live-data warnings) ─────────────────────────────
  // Returns a warning string if the step's stored flag says "done" but the
  // current live data suggests it may not actually be complete.
  const stepWarning = (key) => {
    if (!setupProgress[key]) return null; // not done — no warning
    switch (key) {
      case 'fusionConnected': return tools.length === 0 ? 'Library appears empty — re-check the connected file.' : null;
      case 'normalized': return needsNormalize ? 'Some tools are not yet normalized.' : null;
      case 'proshopMerged': return !tools.some(t => t.min_ooh != null && t.min_ooh > 0) ? 'No tools have MIN OOH data — ProShop CSV may not have merged.' : null;
      default: return null;
    }
  };

  // Drive timestamps for each step (ISO string or null)
  const stepTimestamp = (key) => shopSettings?.setup_steps?.[key] ?? null;

  // ── Embedded setup-step panels ─────────────────────────────────────────────
  // These are folded into the Setup & Import checklist (under their step), not
  // rendered as separate cards. Plain functions returning JSX (NOT components),
  // so the FilePicker's internal navigation state survives re-renders.
  const renderFusionLibrariesPanel = () => (
    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
      <p className="text-sub text-xs" style={{ marginBottom: 12 }}>
        Two distinct Autodesk cloud files — the <strong>tool library</strong> (read &amp; written) and the
        <strong> holder library</strong> (read-only). Never point both at the same file, or saving tools overwrites the holder file.
      </p>

      {/* Tool library */}
      <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
          <FileJson size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span className="text-sm" style={{ fontWeight: 600, minWidth: 96 }}>Tool library</span>
          {libraryLocation?.fileName
            ? <span className="font-mono text-xs">{libraryLocation.fileName}</span>
            : <span className="text-sub text-xs">Not linked</span>}
        </div>
        <div className="text-sub text-xs" style={{ marginBottom: 8, paddingLeft: 22 }}>
          Read &amp; written by the app. This must be the tool library, not the holder library.
        </div>
        <div style={{ paddingLeft: 22 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowToolPicker(p => !p)}>
            <FolderOpen size={14} /> {showToolPicker ? 'Cancel' : libraryLocation ? 'Change Tool Library…' : 'Link Tool Library…'}
          </button>
        </div>
        {showToolPicker && (
          <div style={{ marginTop: 16, paddingLeft: 22 }}>
            <FilePicker
              onSelect={(loc) => {
                if (holderLibraryLocation && loc.itemId === holderLibraryLocation.itemId) {
                  notify('That is the holder library file — pick the separate tool library file instead.', 'error', 7000);
                  return;
                }
                setLibraryLocation(loc);
                setShowToolPicker(false);
                notify(`Tool library set to ${loc.fileName}`, 'success');
              }}
            />
          </div>
        )}
      </div>

      {/* Holder library */}
      <div>
        <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
          <Package size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span className="text-sm" style={{ fontWeight: 600, minWidth: 96 }}>Holder library</span>
          {holderLibrarySetupComplete
            ? <span className="font-mono text-xs">{holderLibraryLocation?.fileName}</span>
            : <span className="text-sub text-xs">Not linked (optional)</span>}
        </div>
        <div className="text-sub text-xs" style={{ marginBottom: 8, paddingLeft: 22 }}>
          Read-only. Enables browsing and assigning holders to each tool.
        </div>
        <div className="flex gap-8" style={{ paddingLeft: 22 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(p => !p)}>
            {showHolderPicker ? 'Cancel' : holderLibrarySetupComplete ? 'Change Holder Library…' : 'Set Up Holder Library…'}
          </button>
          {holderLibrarySetupComplete && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
              onClick={() => { clearHolderLibraryLocation(); setShowHolderPicker(false); notify('Holder library removed', 'info'); }}>
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
        {showHolderPicker && (
          <div style={{ marginTop: 16, paddingLeft: 22 }}>
            <FilePicker
              onSelect={async (loc) => {
                // Guard: the holder library must be a different file than the tool
                // library. Pointing both at the same item makes tool saves overwrite
                // the holder file (the "holders disappear in Fusion" symptom).
                if (libraryLocation && loc.itemId === libraryLocation.itemId) {
                  notify('That is the tool library file — pick the separate holder library file instead.', 'error', 7000);
                  return;
                }
                await setHolderLibraryLocation(loc);
                setShowHolderPicker(false);
                notify(`Holder library set to ${loc.fileName}`, 'success');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderToolMetadataPanel = () => (
    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
      <p className="text-sub text-xs" style={{ marginBottom: 12 }}>
        Notes, tags, ProShop IDs, assemblies, and other fields Fusion can&apos;t store live in one
        <code> tool_metadata.json</code> file on Google Drive, linked one-to-one with this Fusion tool library.
      </p>

      <div className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {googleAuthenticated ? (
          <>
            <div className="flex items-center gap-8">
              <HardDrive size={14} className="text-sub" style={{ flexShrink: 0 }} />
              <span className="text-sub" style={{ minWidth: 100 }}>Metadata file</span>
              {metaLocLoading ? (
                <span className="text-sub text-xs">Loading…</span>
              ) : metaLocation ? (
                <span className="flex items-center gap-8">
                  <span className="font-mono text-xs">{metaLocation.fileName}</span>
                  {metaLocation.webViewLink && (
                    <a href={metaLocation.webViewLink} target="_blank" rel="noreferrer"
                      className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--blue)' }}>
                      <ExternalLink size={11} /> Open in Drive
                    </a>
                  )}
                </span>
              ) : (
                <span className="text-sub text-xs">{metaLocError || '✓ Connected'}</span>
              )}
            </div>

            {metaLocation && (
              <div className="flex items-center gap-8">
                <span style={{ width: 14, flexShrink: 0 }} />
                <span className="text-sub flex items-center" style={{ minWidth: 100, gap: 4 }}>
                  Location
                  <InfoTip text="The app always re-reads this exact file by its Drive ID, so this isn't an in-app setting — it's just informational. To actually relocate the file, drag it to a new folder in Google Drive's own UI; Drive keeps the file's ID, so the app keeps working with no reconfiguration needed." />
                </span>
                <span className="text-xs">
                  {[metaLocation.driveName, metaLocation.folderName].filter(Boolean).join(' / ') || 'My Drive (root)'}
                </span>
              </div>
            )}

            <div className="flex items-center gap-8">
              <span style={{ width: 14, flexShrink: 0 }} />
              <span className="text-sub" style={{ minWidth: 100 }}>Signed in as</span>
              <span className="text-xs">{googleUser?.email || googleUser?.name || '—'}</span>
            </div>

            <div className="flex items-center gap-8">
              <span style={{ width: 14, flexShrink: 0 }} />
              <button className="btn btn-secondary btn-sm" onClick={handleDisconnectMetadata}>
                Disconnect &amp; set up a new file…
              </button>
              <InfoTip text="Use this if the linked file was deleted in Drive (or you just want a fresh start). It only changes which file the app links to — nothing in Drive is deleted by this. You'll go back through the connect screen, sign in, and pick a folder for a brand-new tool_metadata.json; none of the old file's notes, tags, or assemblies carry over." />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-8">
              <HardDrive size={14} className="text-sub" style={{ flexShrink: 0 }} />
              <span className="text-sub" style={{ minWidth: 100 }}>Metadata file</span>
              <span className="text-sub text-xs">
                {metadataSkipped ? 'Not connected — metadata is being skipped' : 'Not connected'}
              </span>
            </div>
            <div className="flex items-center gap-8">
              <span style={{ width: 14, flexShrink: 0 }} />
              <button className="btn btn-secondary btn-sm" onClick={reconnectMetadata}>
                Connect Google Drive…
              </button>
              <InfoTip text="This opens the setup flow, where you pick the Drive folder tool_metadata.json is created in. Choose carefully — once the file exists, the app always re-reads that exact file by its Drive ID, so this isn't something you change in-app afterward (though you can still drag the file to a new folder in Drive's own UI later; Drive keeps the ID, so the app keeps working)." />
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon size={16} /> Settings
        </h2>
      </div>

      {/* Account */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <User size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Account</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="text-sm" style={{ fontWeight: 500 }}>Autodesk authentication active</div>
            {googleAuthenticated && googleUser?.email && (
              <div className="text-sub text-sm" style={{ marginTop: 2 }}>Google: {googleUser.email}</div>
            )}
            {!googleAuthenticated && (
              <div className="text-sub text-sm" style={{ marginTop: 2 }}>Google Drive not connected (metadata off)</div>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={signOutAll}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      {/* Setup & Import — unified initial-workflow tracker */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <CheckCircle2 size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Setup &amp; Import</h3>
          <InfoTip text="The one-time initial workflow: connect the Fusion library, normalize it, merge in ProShop data, configure machine numbers, then export back. Each step checks off automatically when you complete it. Warnings appear here if the stored flag says 'done' but the live library suggests otherwise — you can re-run a step or ignore the warning." />
        </div>
        <p className="text-sub text-sm" style={{ marginBottom: 16 }}>
          One-time setup checklist. Use the action buttons to run or re-run each step.
        </p>

        {SETUP_STEPS.map((step, i) => {
          const done = !!setupProgress[step.key];
          const warn = stepWarning(step.key);
          const ts = fmtDate(stepTimestamp(step.key));
          const hasPanel = step.key === 'fusionConnected' || step.key === 'metadataConnected';
          return (
            <div key={step.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0',
              borderBottom: i < SETUP_STEPS.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ paddingTop: 1, flexShrink: 0 }}>
                {warn
                  ? <AlertCircle size={16} style={{ color: 'var(--orange)' }} />
                  : done
                    ? <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />
                    : <Circle size={16} style={{ color: 'var(--text-sub)' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{step.label}</div>
                {done && ts && <div className="text-sub" style={{ fontSize: 11, marginTop: 2 }}>Done {ts}</div>}
                {warn && (
                  <div style={{ color: 'var(--orange)', fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={12} /> {warn}
                  </div>
                )}
                {/* Fusion tool + holder library pickers, embedded under their step */}
                {step.key === 'fusionConnected' && renderFusionLibrariesPanel()}

                {/* Google Drive metadata connection, embedded under its step */}
                {step.key === 'metadataConnected' && renderToolMetadataPanel()}

                {/* ProShop photos sub-step under proshopMerged */}
                {step.key === 'proshopMerged' && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {setupProgress.proshopPhotos
                      ? <CheckCircle2 size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
                      : <Circle size={13} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />}
                    <span className="text-sub" style={{ fontSize: 12 }}>
                      Import ProShop photos
                      {setupProgress.proshopPhotos && fmtDate(stepTimestamp('proshopPhotos'))
                        ? ` — done ${fmtDate(stepTimestamp('proshopPhotos'))}`
                        : ''}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShowPhotos(true)}>
                      <ImageIcon size={11} /> {setupProgress.proshopPhotos ? 'Re-import' : 'Import photos…'}
                    </button>
                  </div>
                )}
              </div>
              {/* Steps with an embedded config panel handle their own actions inline */}
              {!hasPanel && (
                <div style={{ flexShrink: 0 }}>
                  <StepAction stepKey={step.key} done={done} warn={warn}
                    onExport={handleExportProShop}
                    onImport={() => navigate('/import')}
                    onGoToLanding={() => navigate('/')}
                    tools={tools}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showPhotos && <ImportPhotosModal onClose={() => setShowPhotos(false)} />}

      {/* Shop — name, default unit, and machines (all saved to shop_settings.json) */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Ruler size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Shop</h3>
          {!googleAuthenticated && <InfoTip text="Connect Google Drive to persist these shop-wide settings." alignRight />}
        </div>
        <p className="text-sub text-sm mb-16">Shop-wide settings shared by everyone (stored in <code>shop_settings.json</code> on Drive).</p>

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Shop name</label>
        <input className="field-input" style={{ maxWidth: 360, marginBottom: 16 }} value={shopName} placeholder="e.g. Acme Machining" onChange={e => setShopName(e.target.value)} />

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>
          Default unit <span style={{ opacity: 0.7 }}>— for new tools; existing tools keep their own unit</span>
        </label>
        <div className="btn-toggle" style={{ marginBottom: 16 }}>
          {[['inches', 'Inch (in)'], ['millimeters', 'Metric (mm)']].map(([val, label]) => (
            <button key={val} className={defaultUnit === val ? 'active' : ''} onClick={() => changeDefaultUnit(val)}>{label}</button>
          ))}
        </div>

        {/* ── Library display ───────────────────────────────────────────── */}
        <div style={{ marginTop: 20, paddingTop: 16, marginBottom: 20, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>Library display</span>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ marginTop: 2, flexShrink: 0 }}
              checked={hideUnusedTypes}
              onChange={e => setHideUnusedTypes(e.target.checked)}
            />
            <div>
              <span className="text-sm">Hide unused tool types on the library page</span>
              <div className="text-sub text-xs" style={{ marginTop: 3 }}>
                Only shows tool type tiles for types that have at least one tool in the library.
                All 26 types remain available when adding a new tool. Off in demo mode.
              </div>
            </div>
          </label>
        </div>

        <button className="btn btn-primary" onClick={saveShop} disabled={savingShop || !googleAuthenticated}>
          {savingShop ? 'Saving…' : 'Save Shop Settings'}
        </button>

        {/* ── Machines subsection ────────────────────────────────────────── */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Cpu size={15} style={{ color: 'var(--blue)' }} />
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Machines</h4>
          </div>
          <p className="text-sub text-sm mb-16">
            Configure the shop&apos;s CNC machines. Presets can be linked to a machine to document which
            machine they were proven on, and the landing page gains a machine filter.
          </p>

        {/* Default machine picker */}
        {machines.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Default machine</label>
            <select
              className="field-input"
              style={{ maxWidth: 320 }}
              value={defaultMachineId || ''}
              onChange={e => setDefaultMachineId(e.target.value || null)}
            >
              <option value="">None</option>
              {machines.map(m => <option key={m.id} value={m.id}>{m.model || 'Unnamed'}</option>)}
            </select>
            <div className="text-sub text-xs" style={{ marginTop: 4 }}>
              Pre-selected in the machine filter and preset editor.
            </div>
          </div>
        )}

        {/* Machine list */}
        {machines.map((m, idx) => {
          const isExpanded = expandedMachineId === m.id;
          const isDeleting = machineDeleteId === m.id;
          return (
            <div
              key={m.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 8,
                background: 'var(--surface)',
              }}
            >
              {/* Row header */}
              <div
                className="flex items-center gap-8"
                style={{ padding: '8px 10px', cursor: 'pointer' }}
                onClick={() => setExpandedMachineId(isExpanded ? null : m.id)}
                {...machDragHandlers(idx)}
              >
                <GripVertical size={14} style={{ color: 'var(--text-sub)', flexShrink: 0, cursor: 'grab' }} />
                <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{m.model || <span className="text-sub">Unnamed machine</span>}</span>
                {m.taper && <span className="chip" style={{ fontSize: 11, padding: '2px 7px' }}>{m.taper}</span>}
                {m.machine_type && <span className="text-sub text-xs">{m.machine_type}</span>}
                {isExpanded ? <ChevronDown size={14} className="text-sub" /> : <ChevronRight size={14} className="text-sub" />}
              </div>

              {/* Expanded inline editor */}
              {isExpanded && (
                <div style={{ padding: '0 12px 12px 12px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginTop: 12 }}>
                    <div>
                      <label className="field-label">Model *</label>
                      <input
                        className="field-input"
                        value={m.model}
                        placeholder="e.g. Brother Speedio M300X3"
                        onChange={e => updateMachine(m.id, { model: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Machine type</label>
                      <select className="field-input" value={m.machine_type || ''} onChange={e => updateMachine(m.id, { machine_type: e.target.value })}>
                        <option value="">—</option>
                        {MACHINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Taper</label>
                      <select className="field-input" value={m.taper || ''} onChange={e => updateMachine(m.id, { taper: e.target.value })}>
                        <option value="">—</option>
                        {TAPER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Max RPM</label>
                      <input
                        className="field-input"
                        type="number"
                        value={m.max_rpm ?? ''}
                        placeholder="e.g. 16000"
                        onChange={e => updateMachine(m.id, { max_rpm: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Horsepower</label>
                      <input
                        className="field-input"
                        type="number"
                        value={m.horsepower ?? ''}
                        placeholder="e.g. 12"
                        onChange={e => updateMachine(m.id, { horsepower: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="field-label">Through-spindle coolant</label>
                      <div className="btn-toggle" style={{ marginTop: 4 }}>
                        <button className={m.through_coolant ? 'active' : ''} onClick={() => updateMachine(m.id, { through_coolant: true })}>Yes</button>
                        <button className={!m.through_coolant ? 'active' : ''} onClick={() => updateMachine(m.id, { through_coolant: false, through_coolant_psi: null })}>No</button>
                      </div>
                    </div>
                    {m.through_coolant && (
                      <div>
                        <label className="field-label">Coolant pressure (PSI)</label>
                        <input
                          className="field-input"
                          type="number"
                          value={m.through_coolant_psi ?? ''}
                          placeholder="e.g. 1000"
                          onChange={e => updateMachine(m.id, { through_coolant_psi: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-8" style={{ marginTop: 14 }}>
                    {isDeleting ? (
                      <>
                        <span className="text-sm" style={{ color: 'var(--red)' }}>Delete this machine?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          const updated = machines.filter(x => x.id !== m.id).map((x, i) => ({ ...x, order: i }));
                          const newDefault = defaultMachineId === m.id ? null : defaultMachineId;
                          setMachines(updated);
                          setDefaultMachineId(newDefault);
                          setMachineDeleteId(null);
                          setExpandedMachineId(null);
                          saveMachines(updated, newDefault);
                        }}>Delete</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setMachineDeleteId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!m.model || savingMachines}
                          onClick={() => { setExpandedMachineId(null); saveMachines(machines, defaultMachineId); }}
                        >
                          {savingMachines ? 'Saving…' : 'Save'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setExpandedMachineId(null)}>Cancel</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginLeft: 'auto', color: 'var(--red)' }}
                          onClick={() => setMachineDeleteId(m.id)}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add machine */}
        {addingMachine ? (
          <AddMachineForm
            machineTypes={MACHINE_TYPES}
            taperTypes={TAPER_TYPES}
            onSave={(m) => {
              const updated = [...machines, { ...m, order: machines.length }];
              setMachines(updated);
              setAddingMachine(false);
              saveMachines(updated, defaultMachineId);
            }}
            onCancel={() => setAddingMachine(false)}
          />
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: machines.length > 0 ? 8 : 0 }}
            onClick={() => setAddingMachine(true)}
          >
            <Plus size={14} /> Add Machine
          </button>
        )}

        {/* Save default machine when changed without opening a row editor */}
        {machines.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={savingMachines || !googleAuthenticated}
              onClick={() => saveMachines(machines, defaultMachineId)}
            >
              {savingMachines ? 'Saving…' : 'Save Machines'}
            </button>
          </div>
        )}
        </div>{/* end Machines subsection */}
      </div>{/* end Shop card */}

      {/* ProShop export */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Download size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>ProShop Export</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Export the full tool library as a ProShop-compatible CSV — for the initial bulk
          import, or anytime afterward to re-sync ProShop with the current library.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={handleExportProShop} disabled={tools.length === 0}>
          ↓ Export Full ProShop CSV ({tools.length} tools)
        </button>
      </div>

      {/* Description rename */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Wand2 size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Rename Tool Descriptions</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Preview and apply geometry-based description suggestions across the whole library.
          Each tool shows its current description next to the generated suggestion — uncheck
          any you want to skip or edit the text before applying.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDescRename(true)} disabled={tools.length === 0}>
          <Wand2 size={13} /> Review &amp; rename descriptions…
        </button>
        {showDescRename && <DescRenameModal onClose={() => setShowDescRename(false)} />}
      </div>

      {/* Tool ID System — how each tool's displayed ID is generated/labelled.
          The value is stored in one field (Fusion product-id / tool_id); the
          mode only changes how it's produced and shown. */}
      <div className="card" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Tool ID System</h3>
          <InfoTip text="Controls how each tool's ID is generated and shown. The ID lives in one field shared with the ProShop number — switching modes only changes how the value is produced and displayed, never the storage. ProShop mode keeps today's behavior (ID from ProShop, with a working link)." alignRight />
        </div>

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>ID scheme</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {ID_MODES.map(m => (
            <label key={m.id} className="radio-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: m.disabled ? 0.5 : 1, cursor: m.disabled ? 'not-allowed' : 'pointer' }}>
              <input
                type="radio"
                name="id-mode"
                checked={idCfg.mode === m.id}
                disabled={m.disabled}
                onChange={() => setIdField({ mode: m.id })}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>{m.label}</strong>{m.disabled && <span className="text-sub text-xs"> · coming soon</span>}
                <div className="text-sub text-xs">{m.desc}</div>
              </span>
            </label>
          ))}
        </div>

        {idCfg.mode !== 'proshop' && idCfg.mode !== 'other_erp' && (
          <>
            <div className="flex items-center gap-16 flex-wrap" style={{ marginBottom: 14 }}>
              <div>
                <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Separator</label>
                <select className="field-input" style={{ maxWidth: 120 }} value={idCfg.separator} onChange={e => setIdField({ separator: e.target.value })}>
                  <option value="-">- (dash)</option>
                  <option value=".">. (dot)</option>
                  <option value="/">/ (slash)</option>
                  <option value="_">_ (underscore)</option>
                  <option value="">none</option>
                </select>
              </div>
              {isCounterMode(idCfg.mode) && (
                <div>
                  <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Number digits</label>
                  <input className="field-input" type="number" style={{ maxWidth: 90 }} value={idCfg.digits} onChange={e => setIdField({ digits: e.target.value })} />
                </div>
              )}
              <div style={{ alignSelf: 'flex-end' }}>
                <span className="text-sub text-sm">Preview: </span>
                <span className="font-mono" style={{ color: 'var(--green)' }}>{previewToolId(idCfg) || '—'}</span>
              </div>
            </div>

            {machineLinked ? (
              <div className="text-sub text-sm" style={{ marginBottom: 14 }}>
                IDs follow each tool's machine tool number (e.g. <span className="font-mono">T42</span>). Set the start/skip in <strong>Machine Numbers</strong> below.
              </div>
            ) : (
              <>
                <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Start number</label>
                <input className="field-input" type="number" style={{ maxWidth: 140, marginBottom: 14 }} value={idCfg.start} onChange={e => setIdField({ start: e.target.value })} />

                <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>Skip / reserved numbers</label>
                <div className="flex items-center gap-6 flex-wrap" style={{ marginBottom: 8 }}>
                  {(idCfg.skip || []).map(n => (
                    <span key={n} className="chip" style={{ gap: 6 }}>
                      {n}
                      <button className="icon-btn" style={{ width: 16, height: 16 }} title="Remove" onClick={() => removeIdSkip(n)}><X size={12} /></button>
                    </span>
                  ))}
                  {(idCfg.skip || []).length === 0 && <span className="text-sub text-sm">None</span>}
                </div>
                <div className="flex items-center gap-6" style={{ marginBottom: 14 }}>
                  <input className="field-input" type="number" style={{ maxWidth: 110 }} placeholder="Add #" value={idSkipInput}
                    onChange={e => setIdSkipInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addIdSkip()} />
                  <button className="btn btn-secondary btn-sm" onClick={addIdSkip}>Add</button>
                </div>
              </>
            )}

            {idCfg.mode === 'location' && (
              <div className="flex items-center gap-16" style={{ marginBottom: 14 }}>
                <div>
                  <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Cabinet format</label>
                  <select className="field-input" style={{ maxWidth: 130 }} value={idCfg.location?.cabinet_identifier || 'number'}
                    onChange={e => setIdField({ location: { ...idCfg.location, cabinet_identifier: e.target.value } })}>
                    <option value="number">Number</option>
                    <option value="letter">Letter</option>
                  </select>
                </div>
                <div>
                  <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Drawer format</label>
                  <select className="field-input" style={{ maxWidth: 130 }} value={idCfg.location?.drawer_identifier || 'letter'}
                    onChange={e => setIdField({ location: { ...idCfg.location, drawer_identifier: e.target.value } })}>
                    <option value="number">Number</option>
                    <option value="letter">Letter</option>
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        <button className="btn btn-primary btn-sm" onClick={saveIdSystem} disabled={savingIds} style={{ marginBottom: 16 }}>
          {savingIds ? 'Saving…' : 'Save ID System'}
        </button>

        {/* Assign IDs to unassigned tools */}
        {idCfg.mode !== 'proshop' && idCfg.mode !== 'other_erp' && (
          <div style={{
            marginTop: 4, padding: 16, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)',
            background: 'var(--surface-2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Hash size={16} style={{ color: 'var(--blue)' }} />
              <strong>Assign IDs to unassigned tools</strong>
            </div>
            <p className="text-sub text-sm mb-12">
              Generates an ID for every tool that doesn't already have one, using the scheme above. Tools that already have an ID are left untouched.
            </p>

            {idStage === 'idle' && (
              <button className="btn btn-primary" onClick={() => setIdStage('preview')} disabled={idPreviewRows.length === 0 || isSaving}>
                {idPreviewRows.length === 0 ? 'No unassigned tools' : `Assign IDs to ${idPreviewRows.length} tool${idPreviewRows.length === 1 ? '' : 's'}…`}
              </button>
            )}

            {idStage === 'preview' && (
              <>
                <p className="text-sub text-sm mb-12">Review the IDs that will be written ({idPreviewRows.length} tools). Save the ID system first if you changed it above.</p>
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
                  <table className="match-table">
                    <thead><tr><th>#</th><th>Description</th><th>Type</th><th>New ID</th></tr></thead>
                    <tbody>
                      {idPreviewRows.map((row, i) => (
                        <tr key={`${row.id}-${i}`}>
                          <td className="text-sub text-xs">{i + 1}</td>
                          <td className="truncate" style={{ maxWidth: 260 }}>{row.description}</td>
                          <td className="text-xs text-sub">{row.tool_type}</td>
                          <td className="font-mono" style={{ color: 'var(--green)' }}>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-8">
                  <button className="btn btn-primary" onClick={handleAssignIds} disabled={isSaving}>
                    {isSaving ? 'Assigning…' : 'Assign IDs'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setIdStage('idle')} disabled={isSaving}>Cancel</button>
                </div>
              </>
            )}

            {idStage === 'done' && (
              <div style={{ color: 'var(--green)' }}>
                ✓ Assigned IDs to {idResultCount} tool{idResultCount === 1 ? '' : 's'}.
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={() => setIdStage('idle')}>Done</button>
              </div>
            )}
          </div>
        )}

        {/* Re-number ALL tools — overwrites every ID; old IDs are kept as legacy. */}
        {idCfg.mode !== 'proshop' && idCfg.mode !== 'other_erp' && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', borderLeft: '3px solid var(--amber, #f59e0b)',
            background: 'var(--surface-2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Hash size={16} style={{ color: 'var(--amber, #f59e0b)' }} />
              <strong>Re-number all tools (new scheme)</strong>
              <InfoTip text="Use after switching ID schemes. Overwrites EVERY tool's ID using the scheme above. Each tool's previous ID is saved as a former ID (shown on the tool page, and still matched on import/search) — nothing is lost." alignRight />
            </div>
            <p className="text-sub text-sm mb-12">
              Overwrites every tool's ID with a freshly generated one. Each old ID is retired into the tool's former IDs, so old job files and searches still find it.
            </p>

            {renumStage === 'idle' && (
              <button className="btn btn-secondary" onClick={() => setRenumStage('preview')} disabled={renumPreviewRows.length === 0 || isSaving}>
                {renumPreviewRows.length === 0 ? 'No tools to re-number' : `Re-number all ${renumPreviewRows.length} tool${renumPreviewRows.length === 1 ? '' : 's'}…`}
              </button>
            )}

            {renumStage === 'preview' && (
              <>
                {renumClusters.length > 0 && (
                  <div style={{
                    marginBottom: 14, padding: 12, borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--amber, #f59e0b)', background: 'rgba(245,158,11,0.08)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <AlertTriangle size={15} style={{ color: 'var(--amber, #f59e0b)' }} />
                      <strong>{renumClusters.length} duplicate ID{renumClusters.length === 1 ? '' : 's'} found</strong>
                      <InfoTip text="These show as one tool but are several Fusion entries that share a tool_id (usually a duplicate from legacy/Fusion data). Merge = give the whole group one new ID (keeps it as one tool). Split = give each entry its own new ID (treats them as separate tools)." alignRight />
                    </div>
                    <p className="text-sub text-xs mb-12">Choose how to re-number each. Default is Merge (keep as one tool).</p>
                    <div className="flex gap-8" style={{ marginBottom: 10 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setAllDecisions('merge')}>Merge all</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setAllDecisions('split')}>Split all</button>
                    </div>
                    {renumClusters.map(c => (
                      <div key={c.tool_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <span className="font-mono text-xs tool-id-pill" style={{ fontSize: 10, padding: '1px 7px' }}>{c.tool_id}</span>
                        <span className="truncate text-sm" style={{ flex: 1, minWidth: 0 }}>{c.description} <span className="text-sub text-xs">({c.count} entries)</span></span>
                        <div className="flex gap-4">
                          <button
                            className={`btn btn-sm ${decisionFor(c.tool_id) === 'merge' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setDecision(c.tool_id, 'merge')}
                          >Merge</button>
                          <button
                            className={`btn btn-sm ${decisionFor(c.tool_id) === 'split' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setDecision(c.tool_id, 'split')}
                          >Split</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-sub text-sm mb-12">Review old → new IDs ({renumPreviewRows.length} tools). Save the ID system first if you changed it above.{renumClusters.length > 0 ? ' Split duplicates get extra IDs not shown below.' : ''}</p>
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
                  <table className="match-table">
                    <thead><tr><th>#</th><th>Description</th><th>Old ID</th><th>New ID</th></tr></thead>
                    <tbody>
                      {renumPreviewRows.map((row, i) => (
                        <tr key={`${row.id}-${i}`}>
                          <td className="text-sub text-xs">{i + 1}</td>
                          <td className="truncate" style={{ maxWidth: 240 }}>{row.description}</td>
                          <td className="font-mono text-xs text-sub">{row.oldId}</td>
                          <td className="font-mono" style={{ color: 'var(--green)' }}>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-8">
                  <button className="btn btn-primary" onClick={handleRenumberAll} disabled={isSaving}>
                    {isSaving ? 'Re-numbering…' : 'Re-number all'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setRenumStage('idle')} disabled={isSaving}>Cancel</button>
                </div>
              </>
            )}

            {renumStage === 'done' && (
              <div style={{ color: 'var(--green)' }}>
                ✓ Re-numbered {renumResultCount} tool{renumResultCount === 1 ? '' : 's'}.
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={() => setRenumStage('idle')}>Done</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Machine Numbers + Renumber — grouped because the numbers drive the
          renumber (and adding a tool). Set/save the numbering here, then renumber. */}
      <div className="card" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Machine Numbers</h3>
          <InfoTip text="Machine tool numbers are assigned starting at this number, skipping the reserved list. Used by Renumber Library and when adding a new tool." alignRight />
        </div>
        {machineLinked && (
          <div className="text-sub text-sm" style={{ marginBottom: 12, padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            Tool IDs are linked to machine numbers — start/skip below also drive the generated IDs.
          </div>
        )}
        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Start number</label>
        <input className="field-input" type="number" style={{ maxWidth: 140, marginBottom: 16 }} value={machineStart} onChange={e => setMachineStart(e.target.value)} />

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>Skip / reserved numbers</label>
        <div className="flex items-center gap-6 flex-wrap" style={{ marginBottom: 8 }}>
          {skipList.map(n => (
            <span key={n} className="chip" style={{ gap: 6 }}>
              {n}
              <button className="icon-btn" style={{ width: 16, height: 16 }} title="Remove" onClick={() => removeSkip(n)}><X size={12} /></button>
            </span>
          ))}
          {skipList.length === 0 && <span className="text-sub text-sm">None</span>}
        </div>
        <div className="flex items-center gap-6" style={{ marginBottom: 16 }}>
          <input className="field-input" type="number" style={{ maxWidth: 110 }} placeholder="Add #" value={skipInput}
            onChange={e => setSkipInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkip()} />
          <button className="btn btn-secondary btn-sm" onClick={addSkip}>Add</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={saveMachineNumbers} disabled={savingShop}>
          {savingShop ? 'Saving…' : 'Save Machine Numbers'}
        </button>

        <div style={{
          marginTop: 20,
          padding: 16, borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)', borderLeft: '3px solid var(--red)',
          background: 'var(--surface-2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Hash size={16} style={{ color: 'var(--orange)' }} />
            <strong>Renumber Tool Library</strong>
          </div>

          {stage === 'idle' && (
            <>
              <div className="error-banner mb-12" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  This will reassign machine tool numbers to all tools in the library starting at
                  <strong> #{Number(machineStart) || 30}</strong>, in their current import order. Tools currently referenced in saved
                  programs will have stale tool numbers after this. This should only be done once during
                  initial setup.
                </span>
              </div>
              {error && <div className="error-banner mb-12">{error}</div>}
              <button className="btn btn-danger" onClick={startPreview} disabled={tools.length === 0 || loadingPreview}>
                {loadingPreview ? 'Loading library…' : `Renumber ${tools.length} Tools…`}
              </button>
            </>
          )}

          {stage === 'preview' && (
            <>
              <p className="text-sub text-sm mb-12">
                Review the change below ({previewRows.length} tools, fresh from the library).
                {skipList.length > 0 && <> Numbers <strong>{skipList.join(', ')}</strong> are skipped (reserved).</>}
              </p>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
                <table className="match-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Current</th>
                      <th>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={`${row.id}-${i}`}>
                        <td className="text-sub text-xs">{i + 1}</td>
                        <td className="truncate" style={{ maxWidth: 240 }}>{row.description}</td>
                        <td className="text-xs text-sub">{row.tool_type}</td>
                        <td className="text-xs text-sub">
                          {(row.current ?? null) === null ? '—' : `T${row.current}`}
                        </td>
                        <td className="font-mono" style={{ color: 'var(--green)' }}>T{row.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <div className="error-banner mb-12">{error}</div>}

              <label className="field-label">Type <code>RENUMBER</code> to confirm</label>
              <input
                className="field-input"
                style={{ maxWidth: 240, marginTop: 4, marginBottom: 12 }}
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="RENUMBER"
                autoFocus
              />
              <div className="flex gap-8">
                <button className="btn btn-danger" onClick={handleRenumber} disabled={confirmText !== 'RENUMBER' || isSaving}>
                  {isSaving ? 'Renumbering…' : 'Renumber Library'}
                </button>
                <button className="btn btn-secondary" onClick={cancelPreview} disabled={isSaving}>Cancel</button>
              </div>
            </>
          )}

          {stage === 'done' && (
            <div style={{ color: 'var(--green)' }}>
              ✓ Renumbered {resultCount} tools starting at #{Number(machineStart) || 30}. Both the Fusion library and metadata have been updated.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMachineForm({ machineTypes, taperTypes, onSave, onCancel }) {
  const [draft, setDraft] = useState({
    model: '',
    machine_type: 'Machining Center',
    taper: '',
    max_rpm: null,
    horsepower: null,
    through_coolant: false,
    through_coolant_psi: null,
  });
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  return (
    <div style={{
      border: '1px solid var(--blue)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px',
      marginTop: 8,
      background: 'var(--surface)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>New Machine</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
        <div>
          <label className="field-label">Model *</label>
          <input
            className="field-input"
            value={draft.model}
            placeholder="e.g. Brother Speedio M300X3"
            autoFocus
            onChange={e => set({ model: e.target.value })}
          />
        </div>
        <div>
          <label className="field-label">Machine type</label>
          <select className="field-input" value={draft.machine_type} onChange={e => set({ machine_type: e.target.value })}>
            {machineTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Taper</label>
          <select className="field-input" value={draft.taper} onChange={e => set({ taper: e.target.value })}>
            <option value="">—</option>
            {taperTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Max RPM</label>
          <input
            className="field-input"
            type="number"
            value={draft.max_rpm ?? ''}
            placeholder="e.g. 16000"
            onChange={e => set({ max_rpm: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">Horsepower</label>
          <input
            className="field-input"
            type="number"
            value={draft.horsepower ?? ''}
            placeholder="e.g. 12"
            onChange={e => set({ horsepower: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">Through-spindle coolant</label>
          <div className="btn-toggle" style={{ marginTop: 4 }}>
            <button className={draft.through_coolant ? 'active' : ''} onClick={() => set({ through_coolant: true })}>Yes</button>
            <button className={!draft.through_coolant ? 'active' : ''} onClick={() => set({ through_coolant: false, through_coolant_psi: null })}>No</button>
          </div>
        </div>
        {draft.through_coolant && (
          <div>
            <label className="field-label">Coolant pressure (PSI)</label>
            <input
              className="field-input"
              type="number"
              value={draft.through_coolant_psi ?? ''}
              placeholder="e.g. 1000"
              onChange={e => set({ through_coolant_psi: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-8" style={{ marginTop: 14 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={!draft.model.trim()}
          onClick={() => onSave({ ...draft, id: generateId() })}
        >
          Add Machine
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Action button for each setup step — shows the right CTA depending on step state.
// fusionConnected and metadataConnected render their own embedded config panels
// (see renderFusionLibrariesPanel / renderToolMetadataPanel) instead of a button.
function StepAction({ stepKey, done, warn, onExport, onImport, onGoToLanding, tools }) {
  switch (stepKey) {
    case 'normalized':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onGoToLanding}>
          {warn ? 'Go to Library' : done ? 'View Library' : 'Open Library'}
        </button>
      );
    case 'proshopMerged':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onImport}>
          {done && !warn ? 'Re-run Import' : 'Open Import'}
        </button>
      );
    case 'machineNumbers':
      return (
        <span className="text-sub" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          See Machine Numbers ↓
        </span>
      );
    case 'proshopExported':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onExport} disabled={tools.length === 0}>
          ↓ Export CSV
        </button>
      );
    default:
      return null;
  }
}
