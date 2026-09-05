// The tool editing brain — one draft, the spec-sheet scan, and the save.
//
// ⚠️ ONE IMPLEMENTATION, TWO CALLERS. The unified tool page (edit mode) and the
// new-tool form (ToolForm) are the same editor pointed at different jobs: an
// existing record versus one that does not exist yet. They were one file
// because the page used to NAVIGATE to the form; now that editing happens in
// place, the shared part is this hook and the difference is only layout.
//
// Everything here can do exactly one thing to the tool: write a value into the
// draft. It never constructs presets, assemblies or a Fusion entry, and nothing
// persists until `handleSave`.
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  validateTool, validateGeometry, getNextMachineNumber, toolToExtractor,
} from '../../schema/toolSchema.js';
import { threadPitchValue } from '../../schema/threads.js';
import { buildDesc } from '../../utils/toolNaming.js';
import { useApp } from '../../context/AppContext.jsx';
import { normalizePurchasing, backfillUrls } from '../PurchasingSection.jsx';
import { applyPurchasingRows } from '../../schema/extractionDiff.js';
import { getToolFieldSections, coatingOptions } from '../../schema/toolFieldLayout.js';
import { defaultActivationFamily, newPairing } from '../../schema/insertFamilies.js';
import { statusPatch } from './statusEdit.js';
import { pairingHasComponents } from './InsertStyleBlock.jsx';

export default function useToolEditor({ tool, isNew, onSave, onCancel, isSaving, frozen = true }) {
  const { tools, shopSettings, googleAuthenticated, vendorRegistry, saveVendorRegistry } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const [data, setData] = useState({ ...tool });

  // ⚠️ WHILE THE PAGE IS NOT IN EDIT MODE THE DRAFT TRACKS THE RECORD. Other
  // panels on the tool page (presets, assemblies, purchasing, location) save on
  // their own, so a draft seeded once at mount would go stale the moment one of
  // them wrote — and the next page Save would push those stale values back over
  // the top. `frozen` is the page's edit mode: false = follow the record, true =
  // hold what the user is typing. (ToolForm is always frozen — it IS the edit.)
  // ⚠️ AND IT REMEMBERS WHAT THE RECORD LOOKED LIKE when the freeze began. That
  // snapshot is what "dirty" and the save's patch are both measured against —
  // see the dirty comment below for the bug that comes of measuring against the
  // live record instead.
  const baseRef = useRef(tool);
  // ⚠️ AND IT SEEDS ONCE PER RECORD, EVEN WHILE FROZEN. The page can mount
  // already in edit mode (Duplicate lands on ?edit=1) before the library has
  // finished loading, so the first `tool` is an empty stand-in — and a
  // freeze-only rule would hold that empty draft for good, leaving every field
  // on the page blank with no way to fill them. Seeding on a CHANGE OF RECORD
  // cannot clobber a live edit: mid-edit the id is the same one.
  const seededIdRef = useRef(tool?.id);
  useEffect(() => {
    const newRecord = seededIdRef.current !== tool?.id;
    if (!frozen || newRecord) {
      seededIdRef.current = tool?.id;
      setData({ ...tool });
      baseRef.current = tool;
    }
  }, [tool, frozen]);
  // The location field is only an INPUT when there is no better place to set
  // it: no location system configured at all, or an existing free-text value
  // that the picker can't currently edit. A structured location, or a blank
  // one in a shop that has systems, is read-only here — see the field below.
  const hasLocSystems = (shopSettings?.location_config?.systems || []).length > 0;
  const locEditable = !data.tool_location
    && (!hasLocSystems || !!(data.location || '').trim());
  const [errors, setErrors] = useState([]);
  const [tagInput, setTagInput] = useState('');

  // Machine tool number is read-only here. For a new tool, preview the number
  // that will be assigned at save time (the real assignment happens on save —
  // another user could add a tool in between). For an existing tool, show the
  // number it already holds.
  const previewMachineNumber = useMemo(() => {
    if (!isNew) return null;
    const existing = tools
      .map(t => t.machine_tool_number)
      .filter(n => n !== null && n !== undefined && n !== '')
      .map(Number);
    return getNextMachineNumber(existing);
  }, [isNew, tools]);

  const [pickReplacement, setPickReplacement] = useState(false);
  const replacementTool = data.replaced_by ? tools.find(t => t.id === data.replaced_by) : null;

  // Changing the status. Two things ride along, and both are deliberate:
  //  • Leaving `retired` CLEARS the replacement — "replaced by X" is only
  //    meaningful for a tool that is actually out of service, and a stale one
  //    left behind would sit on a tool nobody retired.
  //  • Turning Beta ON adds the marker to a description this form GENERATED
  //    (i.e. one that still equals what buildDesc would produce). A description
  //    the USER typed is never touched; turning Beta OFF only ever raises the
  //    prompt below, it never edits anything.
  // ⚠️ The status rules live in statusEdit.js, shared with the unified tool
  // page — two copies of "what happens when a tool is retired" would drift, and
  // each of the three rules in there is load-bearing.
  const setStatus = (next) => setData(d => ({ ...d, ...statusPatch(d, next) }));

  const setField = (field, value) => setData(d => {
    const next = { ...d, [field]: value };
    // thread_pitch is DERIVED from the thread designation (the field is
    // read-only in the UI, so there is no hand-entered value to protect) —
    // recomputed here so a live edit updates it without waiting for a reload.
    // ⚠️ A designation that no longer parses CLEARS it: the old number belonged
    // to the old thread, and a stale pitch is a wrong one.
    if (field === 'pitch' && (d.tool_type === 'tap' || d.tool_type === 'thread mill') && typeof value === 'string') {
      next.thread_pitch = threadPitchValue(value, d.unit);
    }
    return next;
  });

  // Insert-style activation (holder body + insert). Available on any tool type
  // that isn't already always-insert — turning it on sets a pairing (default
  // family from the tool type, refinable in the dropdown); the tool page then
  // splits into Holder Body / Insert sections. Nothing changes in Fusion.
  // ≥1 component actually linked — not the mere presence of a pairing, so an
  // insert tool mid-setup keeps its tool-level purchasing visible until data
  // has really moved onto a component.
  const hasComponents = !!(data.pairing
    && (data.pairing.holder_component_id || data.pairing.insert_component_id));

  const togglePairing = (on) => {
    if (!on && pairingHasComponents(data.pairing)
      && !window.confirm('Turn off insert-style? The holder body and insert records are kept, but they will be unlinked from this tool.')) return;
    setField('pairing', on ? (data.pairing || newPairing(defaultActivationFamily(data.tool_type))) : null);
  };

  // ── Spec-sheet extraction onto an EXISTING tool ────────────────────────────
  // An update is not a create. Everything here can do exactly one thing: write
  // an accepted scalar into the draft (or rebuild `purchasing` from the
  // accepted rows). It never constructs presets, assemblies or a new tool, and
  // it never touches Tool ID, location or machine number — those aren't in the
  // proposal set at all. Nothing persists until the normal Save.
  const [scanOpen, setScanOpen] = useState(false);
  const [specProposals, setSpecProposals] = useState([]);   // [{field,…,status}]
  const [purchRows, setPurchRows] = useState([]);           // [{key,…,status}]
  const [specExtracted, setSpecExtracted] = useState(null); // sparse payload
  const [typeNotice, setTypeNotice] = useState(null);
  const [newMfgAck, setNewMfgAck] = useState(false);
  // The screenshot/PDF the scan read, held until the tool is actually saved.
  // ⚠️ Uploaded AFTER the save, never before: uploadToolAttachment writes the
  // whole tool it is handed, so attaching from the unsaved draft would persist
  // edits the user hasn't committed — and attaching from the pre-edit `tool`
  // prop would silently revert the ones they just made.
  const [sourceFile, setSourceFile] = useState(null);
  const [keepSourceFile, setKeepSourceFile] = useState(true);
  // The purchasing object as it was when the sheet was read. Rows are replayed
  // against THIS, never against the running draft — otherwise un-ticking a row
  // could not undo its effect.
  const basePurchasingRef = useRef(null);

  // Replay the accepted purchasing rows against the FROZEN base. Never against
  // the running draft — replaying a mutated object could not undo a row.
  const purchasingFor = (rows, extracted) => applyPurchasingRows(
    basePurchasingRef.current || { manufacturers: [], vendors: [] },
    extracted,
    rows.filter(r => r.status === 'accepted').map(r => r.key),
  );

  // `tool.vendor` is the manufacturer's display name; purchasing is where the
  // manufacturer actually lives. So vendor FOLLOWS the accepted purchasing
  // rather than being a second, separately-decidable proposal for the same
  // fact — and only when it is blank, because adding a second supplier must
  // not restamp a tool that is still primarily the first one's.
  const withVendorFollow = (draft, purchasing) => {
    const first = purchasing?.manufacturers?.[0]?.name || '';
    const wasBlank = !(basePurchasingRef.current?.manufacturers?.[0]?.name) && !tool.vendor;
    return { ...draft, purchasing, vendor: (wasBlank && first) ? first : draft.vendor };
  };

  const receiveProposals = ({ extracted, proposals, purchasingRows, typeNotice: notice, sourceFile: src }) => {
    basePurchasingRef.current = data.purchasing || { manufacturers: [], vendors: [] };
    setSourceFile(src || null);
    setKeepSourceFile(true);

    // Blank fields are filled automatically — but every fill is still a visible
    // row with an Undo, per "filling in blanks is fine, but must be visible".
    // A real value is only ever replaced by an explicit decision.
    const withStatus = proposals.map(p => ({ ...p, status: p.kind === 'fill' ? 'accepted' : 'pending' }));
    // Same rule for purchasing, except a row needing acknowledgement (a
    // genuinely different manufacturer) always waits for the user.
    const rows = purchasingRows.map(r => ({
      ...r,
      status: (r.kind === 'fill' && !r.requiresAck) ? 'accepted' : 'pending',
    }));

    setSpecExtracted(extracted);
    setTypeNotice(notice || null);
    setNewMfgAck(false);
    setSpecProposals(withStatus);
    setPurchRows(rows);
    setData(d => {
      const next = { ...d };
      for (const p of withStatus) if (p.status === 'accepted') next[p.field] = p.proposed;
      return withVendorFollow(next, purchasingFor(rows, extracted));
    });
  };

  const resolveProposal = (field, action) => {
    const p = specProposals.find(x => x.field === field);
    if (!p) return;
    const status = action === 'accept' ? 'accepted' : 'rejected';
    setSpecProposals(prev => prev.map(x => (x.field === field ? { ...x, status } : x)));
    setData(d => ({ ...d, [field]: status === 'accepted' ? p.proposed : p.current }));
  };

  const resolvePurchRow = (key, action) => {
    const next = purchRows.map(r => (r.key === key ? { ...r, status: action === 'accept' ? 'accepted' : 'rejected' } : r));
    setPurchRows(next);
    setData(d => withVendorFollow(d, purchasingFor(next, specExtracted)));
  };

  // Discarding puts EVERYTHING back — including the auto-accepted fills. There
  // is deliberately no "hide but keep" option: a change that stayed in the
  // draft with its row hidden would be exactly the invisible edit this whole
  // feature exists to prevent.
  const discardProposals = () => {
    setData(d => {
      const next = { ...d };
      for (const p of specProposals) next[p.field] = p.current;
      if (basePurchasingRef.current) next.purchasing = basePurchasingRef.current;
      next.vendor = tool.vendor;   // vendor follows purchasing, so put it back too
      return next;
    });
    setSpecProposals([]); setPurchRows([]); setSpecExtracted(null);
    setTypeNotice(null); setNewMfgAck(false); basePurchasingRef.current = null;
    setSourceFile(null);
  };

  const acceptAllPending = () => {
    const pend = specProposals.filter(p => p.status === 'pending');
    setSpecProposals(prev => prev.map(p => (p.status === 'pending' ? { ...p, status: 'accepted' } : p)));
    const nextRows = purchRows.map(r => (
      r.status === 'pending' && (!r.requiresAck || newMfgAck) ? { ...r, status: 'accepted' } : r
    ));
    setPurchRows(nextRows);
    setData(d => {
      const next = { ...d };
      for (const p of pend) next[p.field] = p.proposed;
      return withVendorFollow(next, purchasingFor(nextRows, specExtracted));
    });
  };

  // Any proposal whose field ToolFields does not render for this tool type has
  // no box to sit under. Rather than drop it silently (which would break "all
  // changes are visible"), route it into the spec panel.
  const homelessProposals = useMemo(() => {
    if (!specProposals.length) return [];
    const s = getToolFieldSections(data.tool_type);
    const rendered = new Set([
      ...s.geometry, ...s.setup, 'material_suitability',
      // The tap/thread cluster — including the two controls ThreadBlock draws
      // itself — only exists when that block is on screen.
      ...(s.showThreadBlock ? [...s.thread, 'tap_sub_type', 'is_sti'] : []),
    ]);
    return specProposals.filter(p => !rendered.has(p.field));
  }, [specProposals, data.tool_type]);
  const homelessFields = useMemo(() => new Set(homelessProposals.map(p => p.field)), [homelessProposals]);
  const inlineProposalMap = useMemo(() => {
    const m = new Map();
    for (const p of specProposals) if (!homelessFields.has(p.field)) m.set(p.field, p);
    return m;
  }, [specProposals, homelessFields]);

  const pendingCount = specProposals.filter(p => p.status === 'pending').length
    + purchRows.filter(r => r.status === 'pending').length;
  const acceptedCount = specProposals.filter(p => p.status === 'accepted').length
    + purchRows.filter(r => r.status === 'accepted').length;
  const hasProposals = specProposals.length > 0 || purchRows.length > 0;

  // What "Suggest" would put in the box, recomputed live as the geometry is
  // edited.
  //
  // ⚠️ SHOWN, not just offered. The generated name is composed from a dozen
  // fields, so "Suggest" was a button you had to press to find out what it
  // even was — and pressing it overwrites the description you already have.
  // Reading it first is the whole decision, so the value is on screen and the
  // click is only the commitment.
  //
  // Deliberately EDIT-ONLY (`!isNew`): the add flow already opens with a
  // generated description in the box (extractorToTool pre-fills it), so a line
  // underneath repeating it word for word would say nothing.
  const suggestedDesc = useMemo(
    () => (isNew ? '' : (buildDesc(toolToExtractor(data)) || '').trim()),
    [isNew, data],
  );
  // Nothing to show when it agrees with what is already there — the box IS the
  // preview in that case, and a line restating it is noise on every tool.
  const descSuggestion = suggestedDesc && suggestedDesc !== (data.description || '').trim()
    ? suggestedDesc : '';

  // The description is composed from geometry, so accepting a geometry change
  // can leave it stale. Surfaced as a hint next to the field — never applied on
  // the user's behalf.
  const descStale = !!(hasProposals && data.description && descSuggestion);

  // Coating suggestions grow with the library — a manufacturer's own name for a
  // coating must always be storable, so this is a hint list, not a gate.
  const datalistOptions = useMemo(() => ({ coating: coatingOptions(tools) }), [tools]);

  // ⚠️ MEASURED AGAINST THE SNAPSHOT, NOT THE LIVE RECORD. The other panels on
  // the tool page save while edit mode is open, so comparing the draft to the
  // current record made the page report "Unsaved changes" — and prompt on the
  // way out, and warn on tab close — because somebody saved a PRESET. Changes
  // the user never made, on a Save that would then write nothing.
  const dirty = useMemo(
    () => JSON.stringify(data) !== JSON.stringify(frozen ? baseRef.current : tool),
    [data, tool, frozen],
  );

  // New taps default to HSS — taps are rarely carbide.
  useEffect(() => {
    if (isNew && data.tool_type === 'tap' && (!data.material || data.material === 'carbide')) {
      setData(d => ({ ...d, material: 'hss' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tool_type]);

  // A learned URL pattern is the one accepted row that doesn't land on the tool —
  // it belongs to the manufacturer, in the shared vendor registry. ⚠️ Written
  // BEFORE the tool: saveVendorRegistry refreshes the active registry
  // synchronously, so backfillUrls below then composes this tool's link from the
  // pattern it just learned instead of a stale one. A failed registry write must
  // not cost the user their tool edit, so it is reported and stepped over.
  const savePatternRows = async () => {
    const rows = purchRows.filter(r => r.status === 'accepted' && r.key === 'mfg:url_pattern' && r.registryId);
    if (!rows.length) return;
    const entities = (vendorRegistry?.entities || []).map(e => {
      const row = rows.find(r => r.registryId === e.id);
      return row ? { ...e, [row.patternField]: row.proposed } : e;
    });
    try {
      await saveVendorRegistry({ ...vendorRegistry, entities });
    } catch (err) {
      setErrors([`Saved the tool, but the manufacturer's link format wasn't stored: ${err.message}`]);
    }
  };

  // ⚠️ RETURNS WHETHER THE SAVE LANDED. It swallows the error on purpose (the
  // message goes to the error banner and the draft stays on screen), so a caller
  // awaiting it cannot tell success from failure — and the tool page's "Save &
  // leave" did exactly that, navigating away on a failed write and taking the
  // draft with it. Anything that acts AFTER a save has to read this.
  const handleSave = async () => {
    const { valid, errors: errs } = validateTool(data);
    if (!valid) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
    setErrors([]);
    await savePatternRows();
    // Purchasing is edited in place in the draft, so the re-sequencing and
    // generated-link backfill the standalone panel does on its own Save has to
    // happen here instead. Only when the tool actually has purchasing — a tool
    // that never had any must not gain an empty object.
    const payload = data.purchasing
      ? { ...data, purchasing: normalizePurchasing(backfillUrls(data.purchasing)) }
      : data;
    try {
      await onSave(payload, (sourceFile && keepSourceFile) ? sourceFile : null);
      return true;
    } catch (err) {
      setErrors([err.message]);
      return false;
    }
  };

  const handleCancel = () => {
    // An undecided spec-sheet difference is worth naming — it is the one thing
    // in the draft the user was asked a question about and hasn't answered.
    if (pendingCount > 0 && !window.confirm(
      `${pendingCount} spec-sheet difference${pendingCount !== 1 ? 's' : ''} ${pendingCount !== 1 ? 'are' : 'is'} still undecided. `
      + 'Leaving now discards the scan and every change from it. Continue?'
    )) return;
    if (pendingCount === 0 && dirty && !window.confirm('Discard unsaved changes?')) return;
    onCancel();
  };

  // Keyboard: Ctrl/Cmd+S saves, Esc cancels.
  // ⚠️ ONLY WHILE THE EDITOR IS ACTUALLY OPEN. On the unified page this hook is
  // mounted the whole time the tool is on screen, so an ungated handler would
  // swallow Ctrl+S (and answer Escape) while merely VIEWING a tool — hijacking
  // a browser shortcut for a save nobody asked for.
  useEffect(() => {
    if (!frozen) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSaving) handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warn on browser/tab close while dirty
  useEffect(() => {
    const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const geoIssues = useMemo(
    () => validateGeometry(data),
    [data.tool_type, data.diameter, data.flute_length, data.shoulder_length, data.min_ooh, data.overall_length, data.corner_radius]
  );
  const geoIssueFields = useMemo(() => new Set(geoIssues.flatMap(i => i.fields)), [geoIssues]);

  const machineNum = isNew ? previewMachineNumber : data.machine_tool_number;
  const hasMachineNum = machineNum !== null && machineNum !== undefined && machineNum !== '';

  return {
    data, setData, setField, setStatus, errors, setErrors,
    base: baseRef,
    dirty, geoIssues, geoIssueFields,
    machineNum, hasMachineNum, locEditable, hasComponents, togglePairing,
    tagInput, setTagInput,
    pickReplacement, setPickReplacement, replacementTool,
    descSuggestion, descStale, datalistOptions,
    handleSave, handleCancel,
    scan: {
      open: scanOpen, setOpen: setScanOpen,
      receiveProposals, resolveProposal, resolvePurchRow,
      discardProposals, acceptAllPending,
      specProposals, purchRows, typeNotice,
      newMfgAck, setNewMfgAck,
      sourceFile, keepSourceFile, setKeepSourceFile,
      homelessProposals, inlineProposalMap,
      pendingCount, acceptedCount, hasProposals,
    },
  };
}
