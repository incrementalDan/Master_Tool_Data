import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, AlertTriangle, Hash, Package, Trash2, Wand2, Ruler, HardDrive, ExternalLink, FileJson, Download, X, FolderOpen, LogOut, User, CheckCircle2, Circle, AlertCircle, Image as ImageIcon, Cpu, GripVertical, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp, SETUP_STEPS } from '../context/AppContext.jsx';
import { generateMachineNumbers, generateId, duplicateIdClusters } from '../schema/toolSchema.js';
import { composeToolId, nextSequential, isCounterMode, previewToolId } from '../utils/toolIdSystem.js';
import { ASM_MODES, previewAsmNumber } from '../utils/assemblyIdSystem.js';
import { useDragReorder } from './useDragReorder.js';
import { getDefaultUnit, setDefaultUnit } from '../utils/units.js';
import { FilePicker } from './LibrarySetup.jsx';
import LocationSystemSettings from './LocationSystemSettings.jsx';
import DescRenameModal from './DescRenameModal.jsx';
import InfoTip from './InfoTip.jsx';
import ImportPhotosModal from './ImportPhotosModal.jsx';
import ProgramsImportModal from './ProgramsImportModal.jsx';
import { exportFullLibrary } from '../utils/proShopExport.js';

const ID_MODES = [
  { id: 'proshop', label: 'ProShop', desc: 'ID comes from ProShop (today’s behavior). Shows a working link to the ProShop tool page.' },
  { id: 'location', label: 'Location-based', desc: 'The tool ID is its physical-location string from the Location System, e.g. LC-1405.' },
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
    addToolLibrary, removeToolLibrary, setDefaultToolLibrary,
    addHolderLibrary, removeHolderLibrary, notify,
    googleAuthenticated, metadataSkipped, user: googleUser,
    fetchMetadataLocation, reconnectMetadata, disconnectMetadata,
    shopSettings, saveShopSettings, signOutAll, fusionEnabled,
    setupProgress, demoMode,
    registerNavGuard, maybeBlockNav,
  } = useApp();

  // Multi-library registry (from shop_settings). Tool + holder libraries are
  // lists; new tools write to default_tool_library_id (falls back to the first).
  const toolLibraries = shopSettings?.tool_libraries || [];
  const holderLibraries = shopSettings?.holder_libraries || [];
  const defaultLibId = shopSettings?.default_tool_library_id || toolLibraries[0]?.id || null;
  const linkedItemIds = new Set([...toolLibraries, ...holderLibraries].map(l => l.id));

  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [showDescRename, setShowDescRename] = useState(false);
  const [showProgramsImport, setShowProgramsImport] = useState(false);
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

  // Buffered: update the local draft only; the actual default-unit (localStorage)
  // is written by Save (saveAll), reverted by Cancel.
  const changeDefaultUnit = (unit) => setDefaultUnitState(unit);

  // ── Shop settings (shop_settings.json) ─────────────────────────────────────
  const [shopName, setShopName] = useState(shopSettings?.shop_name || '');
  const [machineStart, setMachineStart] = useState(shopSettings?.machine_number?.start ?? 30);
  const [skipList, setSkipList] = useState(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
  const [skipInput, setSkipInput] = useState('');
  const [hideUnusedTypes, setHideUnusedTypes] = useState(shopSettings?.hide_unused_tool_types ?? true);

  useEffect(() => {
    setShopName(shopSettings?.shop_name || '');
    setMachineStart(shopSettings?.machine_number?.start ?? 30);
    setSkipList(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
    setHideUnusedTypes(shopSettings?.hide_unused_tool_types ?? true);
  }, [shopSettings]);

  // ── Tool ID system (shop_settings.tool_id_system) ──────────────────────────
  const idsDefault = { mode: 'proshop', separator: '-', start: 1000, skip: [], digits: 4, show_legacy: true };
  const [idCfg, setIdCfg] = useState({ ...idsDefault, ...(shopSettings?.tool_id_system || {}) });
  const [idSkipInput, setIdSkipInput] = useState('');
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

  // ── Assembly ID system (shop_settings.assembly_id_system) ──────────────────
  const asmDefault = { mode: 'auto', separator: null, serial_start: 10000, show_legacy: false };
  const [asmCfg, setAsmCfg] = useState({ ...asmDefault, ...(shopSettings?.assembly_id_system || {}) });
  useEffect(() => { setAsmCfg({ ...asmDefault, ...(shopSettings?.assembly_id_system || {}) }); }, [shopSettings]);
  const setAsmField = (patch) => setAsmCfg(c => ({ ...c, ...patch }));
  const machineLinked = idCfg.mode === 'machine_linked';

  const addIdSkip = () => {
    const n = parseInt(idSkipInput, 10);
    if (!isNaN(n) && !(idCfg.skip || []).includes(n)) setIdField({ skip: [...(idCfg.skip || []), n].sort((a, b) => a - b) });
    setIdSkipInput('');
  };
  const removeIdSkip = (n) => setIdField({ skip: (idCfg.skip || []).filter(x => x !== n) });

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

  // Keep local machine state in sync when shopSettings loads from Drive.
  useEffect(() => {
    setMachines(shopSettings?.machines || []);
    setDefaultMachineId(shopSettings?.default_machine_id || null);
  }, [shopSettings]);

  // ── Location System config draft ───────────────────────────────────────────
  // The Location editor is buffered into the page draft like every other section
  // (it no longer auto-saves while Settings owns an edit session). Synced from
  // shopSettings on load / Save / Cancel.
  const [locDraft, setLocDraft] = useState(shopSettings?.location_config || null);
  useEffect(() => { setLocDraft(shopSettings?.location_config || null); }, [shopSettings]);

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

  // ── Unified edit mode (one draft, one Save/Cancel) ─────────────────────────
  // Every section writes to local draft state; nothing persists until Save.
  // `dirty` (any managed field differs from the saved shopSettings) is what puts
  // the page into edit mode and enables Save/Cancel + the leave guards. Actions
  // that operate on already-saved data (imports/exports/renumbers) are locked
  // while dirty.
  const [savingAll, setSavingAll] = useState(false);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [idleKick, setIdleKick] = useState(0); // bump to restart the idle timer ("Keep editing")
  const [leaveTo, setLeaveTo] = useState(null); // pending navigation (proceed fn) while the leave prompt is open

  const buildDraft = () => ({
    ...(shopSettings || {}),
    shop_name: shopName,
    default_units: defaultUnit,
    machine_number: { start: Number(machineStart) || 30, skip: skipList },
    hide_unused_tool_types: hideUnusedTypes,
    machines,
    default_machine_id: defaultMachineId,
    location_config: locDraft,
    tool_id_system: {
      mode: idCfg.mode,
      separator: idCfg.separator,
      start: Number(idCfg.start) || 1000,
      skip: idCfg.skip || [],
      digits: Number(idCfg.digits) || 4,
      location: idCfg.location || idsDefault.location,
      show_legacy: idCfg.show_legacy ?? true,
    },
    assembly_id_system: {
      mode: asmCfg.mode,
      separator: asmCfg.separator ?? null,
      serial_start: Number(asmCfg.serial_start) || 10000,
      show_legacy: asmCfg.show_legacy ?? false,
    },
  });

  // Normalized projection of the managed fields, for a stable dirty comparison.
  const managedSig = (ss) => JSON.stringify({
    shop_name: ss?.shop_name || '',
    default_units: ss?.default_units || 'inches',
    machine_number: { start: ss?.machine_number?.start ?? 30, skip: ss?.machine_number?.skip ?? [98, 99, 100] },
    hide_unused_tool_types: ss?.hide_unused_tool_types ?? true,
    machines: ss?.machines || [],
    default_machine_id: ss?.default_machine_id || null,
    location_config: ss?.location_config || null,
    tool_id_system: { ...idsDefault, ...(ss?.tool_id_system || {}) },
    assembly_id_system: { ...asmDefault, ...(ss?.assembly_id_system || {}) },
  });
  const draftSig = managedSig(buildDraft());
  const dirty = draftSig !== managedSig(shopSettings);

  const cancelAll = () => {
    setShopName(shopSettings?.shop_name || '');
    setMachineStart(shopSettings?.machine_number?.start ?? 30);
    setSkipList(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
    setHideUnusedTypes(shopSettings?.hide_unused_tool_types ?? true);
    setIdCfg({ ...idsDefault, ...(shopSettings?.tool_id_system || {}) });
    setAsmCfg({ ...asmDefault, ...(shopSettings?.assembly_id_system || {}) });
    setMachines(shopSettings?.machines || []);
    setDefaultMachineId(shopSettings?.default_machine_id || null);
    setLocDraft(shopSettings?.location_config || null);
    setDefaultUnitState(shopSettings?.default_units || getDefaultUnit());
    setExpandedMachineId(null); setAddingMachine(false); setMachineDeleteId(null);
    setIdlePrompt(false);
  };

  const saveAll = async () => {
    if (!dirty) return;
    setSavingAll(true);
    try {
      // In machine_linked ID mode, the Machine Numbers section IS the source of
      // the ID start/skip — buildDraft already carries machine_number, so no extra
      // sync is needed here.
      const next = buildDraft();
      await saveShopSettings(next);
      setDefaultUnit(defaultUnit);
      markSetupStepInSettings?.('toolIdConfigured');
      markSetupStepInSettings?.('assemblyIdConfigured');
      if ((next.location_config?.systems || []).length > 0) markSetupStepInSettings?.('locationConfigured');
      if (next.machine_number?.start) markSetupStepInSettings?.('machineNumbers');
      setIdlePrompt(false);
      notify('Settings saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingAll(false); }
  };

  // Idle auto-exit: while dirty, a quiet period flags the user; if still no
  // response it cancels (discards) so an abandoned edit session doesn't sit open.
  const IDLE_MS = 3 * 60 * 1000;   // 3 min of no edits → prompt
  const IDLE_GRACE_MS = 60 * 1000; // then 60s to respond → auto-cancel
  useEffect(() => {
    if (!dirty) { setIdlePrompt(false); return; }
    setIdlePrompt(false);
    const t = setTimeout(() => setIdlePrompt(true), IDLE_MS);
    return () => clearTimeout(t);
  }, [draftSig, dirty, idleKick]);
  useEffect(() => {
    if (!idlePrompt) return;
    const t = setTimeout(() => { setIdlePrompt(false); cancelAll(); }, IDLE_GRACE_MS);
    return () => clearTimeout(t);
  }, [idlePrompt]);

  // Close/refresh guard: native browser prompt while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // In-app navigation guard: while dirty, leaving (top-bar tabs, internal links)
  // opens the Save / Discard / Stay prompt instead of navigating away.
  useEffect(() => {
    registerNavGuard?.({ shouldBlock: () => dirty, onBlocked: (proceed) => setLeaveTo(() => proceed) });
    return () => registerNavGuard?.(null);
  }, [registerNavGuard, dirty]);
  // Guarded version of navigate for this page's own links (Open Import/Library).
  const guardedNavigate = (to) => { if (!maybeBlockNav(() => navigate(to))) navigate(to); };

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
      {/* Fusion sync master switch (Fusion-decoupling). Off = the app runs
          independently of Fusion — tools live in the app + Drive metadata only and
          nothing syncs to/from the Fusion library. Persisted in shop_settings
          (integrations.fusion.enabled); managedSig excludes it, so it doesn't
          collide with the page's draft/dirty state. */}
      <label className="flex items-center gap-8" style={{ marginBottom: 14, cursor: googleAuthenticated ? 'pointer' : 'not-allowed', opacity: googleAuthenticated ? 1 : 0.6 }}>
        <input
          type="checkbox"
          checked={fusionEnabled}
          disabled={!googleAuthenticated}
          onChange={e => {
            const enabled = e.target.checked;
            saveShopSettings({
              ...(shopSettings || {}),
              integrations: {
                ...(shopSettings?.integrations || {}),
                fusion: { ...(shopSettings?.integrations?.fusion || {}), enabled },
              },
            });
            notify(
              enabled
                ? 'Fusion sync ON — reload to load tools from the Fusion library'
                : 'Fusion sync OFF — tools now save to metadata only; reload to view in no-Fusion mode',
              'info', 6000,
            );
          }}
        />
        <span className="text-sm" style={{ fontWeight: 600 }}>Sync with Fusion 360</span>
        <InfoTip text="On: tools read from and write to your Fusion tool library (the normal mode). Off: the app runs independently of Fusion — tools live in the app + Google Drive metadata only, nothing is written to Fusion, and no-match ProShop rows / new tools stay app-only. Use this when moving to another CAM or working without Fusion. You can switch back any time; it takes full effect on the next reload." />
      </label>
      {!fusionEnabled && (
        <div className="text-xs" style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', color: 'var(--orange)' }}>
          Fusion sync is off — the libraries below are kept but not read or written until you turn it back on.
        </div>
      )}

      {/* D2 — default winner when a tool's app record and its live Fusion entry
          disagree. Only pre-selects the choice in the always-shown drift review
          (D3); it never resolves silently, so switching it is safe. */}
      {fusionEnabled && (
        <div style={{ marginBottom: 14, paddingLeft: 2 }}>
          <div className="flex items-center gap-6" style={{ marginBottom: 6 }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>On a Fusion vs. app conflict, default to</span>
            <InfoTip text="When someone edits a tool directly in Fusion 360, the difference is always shown on the tool page for you to confirm — nothing is overwritten silently. This setting only pre-selects which side wins by default in that review. 'Fusion' matches today's behavior; switch to 'App' once ToolDex is your source of truth." />
          </div>
          {[['fusion', 'Fusion (Fusion 360 wins)'], ['app', 'App (ToolDex wins)']].map(([val, label]) => (
            <label key={val} className="flex items-center gap-6 text-sm" style={{ paddingLeft: 4, marginBottom: 3, cursor: 'pointer' }}>
              <input
                type="radio"
                name="fusionAuthority"
                checked={(shopSettings?.integrations?.fusion?.authority || 'fusion') === val}
                onChange={() => saveShopSettings({
                  ...(shopSettings || {}),
                  integrations: {
                    ...(shopSettings?.integrations || {}),
                    fusion: { ...(shopSettings?.integrations?.fusion || {}), authority: val },
                  },
                })}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <p className="text-sub text-xs" style={{ marginBottom: 12 }}>
        Link one or more <strong>tool libraries</strong> (read &amp; written — each tool writes back to the one it came from)
        and one or more <strong>holder libraries</strong> (read-only, shared across all tools). A file can be linked only
        once, and the same file can&apos;t be both a tool and a holder library.
      </p>

      {/* Tool libraries */}
      <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
          <FileJson size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span className="text-sm" style={{ fontWeight: 600 }}>Tool libraries ({toolLibraries.length})</span>
        </div>
        {toolLibraries.length === 0
          ? <div className="text-sub text-xs" style={{ paddingLeft: 22, marginBottom: 8 }}>None linked yet.</div>
          : toolLibraries.map(lib => (
            <div key={lib.id} className="flex items-center gap-8"
              style={{ paddingLeft: 22, marginBottom: 6 }}>
              <span className="font-mono text-xs" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lib.fileName}</span>
              <label className="flex items-center gap-4 text-xs text-sub" style={{ cursor: 'pointer', flexShrink: 0 }} title="New tools are written to this library">
                <input type="radio" name="defaultToolLib" checked={defaultLibId === lib.id} onChange={() => setDefaultToolLibrary(lib.id)} />
                Default
              </label>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', padding: '0 6px', flexShrink: 0 }}
                title="Unlink this library"
                onClick={() => { removeToolLibrary(lib.id); notify(`Unlinked ${lib.fileName}`, 'info'); }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        <div style={{ paddingLeft: 22, marginTop: 4 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowToolPicker(p => !p)}>
            <FolderOpen size={14} /> {showToolPicker ? 'Cancel' : 'Add Tool Library…'}
          </button>
        </div>
        {showToolPicker && (
          <div style={{ marginTop: 16, paddingLeft: 22 }}>
            <FilePicker
              onSelect={(loc) => {
                if (linkedItemIds.has(loc.itemId)) {
                  notify('That file is already linked as a tool or holder library.', 'error', 7000);
                  return;
                }
                addToolLibrary(loc);
                setShowToolPicker(false);
                notify(`Linked tool library ${loc.fileName}`, 'success');
              }}
            />
          </div>
        )}
      </div>

      {/* Holder libraries */}
      <div>
        <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
          <Package size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span className="text-sm" style={{ fontWeight: 600 }}>Holder libraries ({holderLibraries.length})</span>
        </div>
        <div className="text-sub text-xs" style={{ marginBottom: 8, paddingLeft: 22 }}>
          Read-only. Holders from every library are available on every tool (grouped by library in the picker).
        </div>
        {holderLibraries.map(lib => (
          <div key={lib.id} className="flex items-center gap-8" style={{ paddingLeft: 22, marginBottom: 6 }}>
            <span className="font-mono text-xs" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lib.fileName}</span>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', padding: '0 6px', flexShrink: 0 }}
              title="Unlink this holder library"
              onClick={() => { removeHolderLibrary(lib.id); notify(`Unlinked ${lib.fileName}`, 'info'); }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div style={{ paddingLeft: 22, marginTop: 4 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(p => !p)}>
            {showHolderPicker ? 'Cancel' : 'Add Holder Library…'}
          </button>
        </div>
        {showHolderPicker && (
          <div style={{ marginTop: 16, paddingLeft: 22 }}>
            <FilePicker
              onSelect={async (loc) => {
                if (linkedItemIds.has(loc.itemId)) {
                  notify('That file is already linked as a tool or holder library.', 'error', 7000);
                  return;
                }
                await addHolderLibrary(loc);
                setShowHolderPicker(false);
                notify(`Linked holder library ${loc.fileName}`, 'success');
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
      {/* Frozen header — title + one Save/Cancel for the whole page. Buttons are
          active only when there are unsaved edits (edit mode). */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'var(--bg)', borderBottom: '1px solid var(--border)',
        padding: '12px 0', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <SettingsIcon size={16} /> <span className="tab-wordmark">Settings</span>
        </h2>
        {dirty && (
          <span className="chip" style={{ gap: 6, color: 'var(--orange)', borderColor: 'color-mix(in srgb, var(--orange) 40%, transparent)' }}>
            <AlertTriangle size={12} /> Editing — unsaved changes
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={cancelAll} disabled={!dirty || savingAll}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={saveAll} disabled={!dirty || savingAll}>
          {savingAll ? 'Saving…' : 'Save'}
        </button>
      </div>

      {dirty && (
        <div className="text-sub text-xs" style={{ marginTop: -8, marginBottom: 16 }}>
          Imports, exports, and renumber actions are paused until you <strong>Save</strong> or <strong>Cancel</strong>.
        </div>
      )}

      {/* Leave prompt — when navigating away (top-bar tab / internal link) with
          unsaved edits. Save & leave / Discard & leave / Stay. */}
      {leaveTo && (
        <div className="modal-backdrop" onClick={() => setLeaveTo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 className="modal-title">Unsaved settings changes</h3>
            <div className="modal-body">
              You have unsaved changes. Save them before leaving, or discard them?
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setLeaveTo(null)}>Stay</button>
              <button className="btn btn-secondary" onClick={() => { const go = leaveTo; cancelAll(); setLeaveTo(null); go?.(); }}>Discard &amp; leave</button>
              <button className="btn btn-primary" disabled={savingAll} onClick={async () => { const go = leaveTo; await saveAll(); setLeaveTo(null); go?.(); }}>
                {savingAll ? 'Saving…' : 'Save & leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idle prompt — fired after a quiet period in edit mode; if unanswered it
          auto-cancels (discards) so an abandoned session doesn't linger. */}
      {idlePrompt && (
        <div className="modal-backdrop" onClick={() => { setIdlePrompt(false); setIdleKick(k => k + 1); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 className="modal-title">Still editing your settings?</h3>
            <div className="modal-body">
              You have unsaved changes and haven’t edited anything in a few minutes. If you don’t
              respond, your changes will be discarded so they don’t sit open.
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={cancelAll}>Discard changes</button>
              <button className="btn btn-primary" onClick={() => { setIdlePrompt(false); setIdleKick(k => k + 1); }}>Keep editing</button>
            </div>
          </div>
        </div>
      )}

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
              opacity: step.disabled ? 0.6 : 1,
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
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShowPhotos(true)} disabled={dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
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
                    onImport={() => guardedNavigate('/import')}
                    onGoToLanding={() => guardedNavigate('/')}
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
                        }}>Delete</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setMachineDeleteId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!m.model}
                          onClick={() => setExpandedMachineId(null)}
                        >
                          Done
                        </button>
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
        <button className="btn btn-secondary btn-sm" onClick={handleExportProShop} disabled={tools.length === 0 || dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
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
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDescRename(true)} disabled={tools.length === 0 || dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
          <Wand2 size={13} /> Review &amp; rename descriptions…
        </button>
        {showDescRename && <DescRenameModal onClose={() => setShowDescRename(false)} />}
      </div>

      {/* Program list import — one-time CSV load into the Program Number
          Manager (/programs). Writes to jobs.json, so it needs Drive/demo. */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Import Program List</h3>
          <InfoTip text="One-time CSV import of your existing program-number list into the Programs page. Columns: Program #, Machine, Fixturing, Internal or external, internal Part #, Rev, Customer, Description, OP #, Fixture Y/N. Existing numbers are skipped; the app assigns the next available number to any blank." alignRight />
        </div>
        <p className="text-sub text-sm mb-16">
          Bulk-load the shop's current program list (from the Google Sheet) into the
          Program Numbers page. Rows sharing a Part # + Rev group into one part;
          program numbers already in the app are skipped.
        </p>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowProgramsImport(true)}
          disabled={(!googleAuthenticated && !demoMode) || dirty}
          title={dirty ? 'Save or cancel your changes first' : (!googleAuthenticated && !demoMode ? 'Connect Google Drive first' : undefined)}
        >
          <Hash size={13} /> Import program list CSV…
        </button>
        {showProgramsImport && <ProgramsImportModal onClose={() => setShowProgramsImport(false)} />}
      </div>

      {/* Tool ID System — how each tool's displayed ID is generated/labelled.
          The value is stored in one field (Fusion product-id / tool_id); the
          mode only changes how it's produced and shown. */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
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
              <div className="text-sub text-sm" style={{ marginBottom: 14, padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)', background: 'var(--surface-2)' }}>
                In <strong>Location</strong> mode each tool's ID is its composed physical-location string from the <strong>Location System</strong> (configured below — it owns the segment format and bin numbering). Assigning or normalizing locations there doesn't write IDs by itself; use <strong>Assign IDs</strong> / <strong>Re-number</strong> here to generate them from each tool's location.
              </div>
            )}
          </>
        )}

        {/* Show retired IDs — shared toggle across the three ID systems. Tool ID
            defaults ON; a search match always surfaces a legacy value regardless. */}
        <label className="radio-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={idCfg.show_legacy ?? true}
            onChange={e => setIdField({ show_legacy: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Show former (retired) IDs</strong>
            <div className="text-sub text-xs">Display a muted “Formerly:” line on each tool that has retired IDs. A search that matches an old ID still finds the tool either way.</div>
          </span>
        </label>

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
              <button className="btn btn-primary" onClick={() => setIdStage('preview')} disabled={idPreviewRows.length === 0 || isSaving || dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
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
              <button className="btn btn-secondary" onClick={() => setRenumStage('preview')} disabled={renumPreviewRows.length === 0 || isSaving || dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
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

      {/* Location System — adjacent to Tool ID System (it drives the ID in
          location mode). Self-contained: configures systems, normalizes, and
          shows the library-wide unmatched panel. */}
      <LocationSystemSettings configOverride={locDraft} onConfigChange={setLocDraft} />

      {/* Assembly ID System — third of the three parallel ID systems. Generates a
          human-readable number per tool+holder assembly (asm_number). */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Assembly ID System</h3>
          <InfoTip text="How each tool+holder assembly's human-readable number (asm_number) is generated. Auto composes it from the holder short-name + Tool ID + OOH and is immutable once set. ProShop RTA# is entered by hand per assembly. Sequential is a plain serial. The number shows on each assembly." alignRight />
        </div>
        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>Assembly ID scheme</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {ASM_MODES.map(m => (
            <label key={m.id} className="radio-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: m.disabled ? 0.5 : 1, cursor: m.disabled ? 'not-allowed' : 'pointer' }}>
              <input
                type="radio"
                name="asm-mode"
                checked={asmCfg.mode === m.id}
                disabled={m.disabled}
                onChange={() => setAsmField({ mode: m.id })}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>{m.label}</strong>{m.disabled && <span className="text-sub text-xs"> · coming soon</span>}
                <div className="text-sub text-xs">{m.desc}</div>
              </span>
            </label>
          ))}
        </div>

        {asmCfg.mode === 'auto' && (
          <div className="flex items-center gap-16 flex-wrap" style={{ marginBottom: 14 }}>
            <div>
              <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Separator</label>
              <select className="field-input" style={{ maxWidth: 200 }} value={asmCfg.separator ?? '__inherit'} onChange={e => setAsmField({ separator: e.target.value === '__inherit' ? null : e.target.value })}>
                <option value="__inherit">Inherit from Tool ID ({idCfg.separator || 'none'})</option>
                <option value="-">- (dash)</option>
                <option value=".">. (dot)</option>
                <option value="/">/ (slash)</option>
                <option value="_">_ (underscore)</option>
                <option value="">none</option>
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <span className="text-sub text-sm">Preview: </span>
              <span className="font-mono" style={{ color: 'var(--green)' }}>{previewAsmNumber(asmCfg, idCfg) || '—'}</span>
            </div>
          </div>
        )}

        {asmCfg.mode === 'sequential' && (
          <div className="flex items-center gap-16 flex-wrap" style={{ marginBottom: 14 }}>
            <div>
              <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Start number</label>
              <input className="field-input" type="number" style={{ maxWidth: 140 }} value={asmCfg.serial_start ?? 10000} onChange={e => setAsmField({ serial_start: e.target.value })} />
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <span className="text-sub text-sm">Preview: </span>
              <span className="font-mono" style={{ color: 'var(--green)' }}>{previewAsmNumber(asmCfg, idCfg)}</span>
            </div>
          </div>
        )}

        {asmCfg.mode === 'proshop_rta' && (
          <div className="text-sub text-sm" style={{ marginBottom: 14, padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', borderLeft: '3px solid var(--blue)', background: 'var(--surface-2)' }}>
            Each assembly gets a text field to enter its ProShop <strong>RTA#</strong>. ProShop CSV import/export for RTA# is not wired yet.
          </div>
        )}

        {/* Show retired assembly numbers — shared toggle across the three ID
            systems. Assembly defaults OFF (like Location). A search match always
            surfaces a retired number regardless. */}
        <label className="radio-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={asmCfg.show_legacy ?? false}
            onChange={e => setAsmField({ show_legacy: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Show former (retired) assembly numbers</strong>
            <div className="text-sub text-xs">Display a muted “Formerly:” line on assemblies whose number was reassigned (e.g. an old ProShop RTA# after switching to Auto). A search that matches an old number still finds the tool either way.</div>
          </span>
        </label>
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
              <button className="btn btn-danger" onClick={startPreview} disabled={tools.length === 0 || loadingPreview || dirty} title={dirty ? 'Save or cancel your changes first' : undefined}>
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
    case 'toolIdConfigured':
      return (
        <span className="text-sub" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          See Tool ID System ↓
        </span>
      );
    case 'locationConfigured':
      return (
        <span className="text-sub" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          See Location System ↓
        </span>
      );
    case 'assemblyIdConfigured':
      return (
        <span className="text-sub" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          See Assembly ID System ↓
        </span>
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
