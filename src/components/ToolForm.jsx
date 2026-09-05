import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Ruler, Layers, Save, X, AlertTriangle,
  StickyNote, Link2, Trash2, ScanLine,
} from 'lucide-react';
import {
  validateTool, validateGeometry, getNextMachineNumber, toolToExtractor,
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_OPTIONS_METRIC,
  TAP_LIMIT_TOLERANCE_DEFAULT_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
} from '../schema/toolSchema.js';
import { threadPitchValue } from '../schema/threads.js';
import InfoTip from './InfoTip.jsx';
import ToolLinkPicker from './ToolLinkPicker.jsx';
import {
  withBetaSuffix, hasBetaSuffix,
  withRetiredSuffix, stripRetiredSuffix, stripStatusSuffixes,
} from '../utils/toolStatus.js';
import { buildDesc } from '../utils/toolNaming.js';
import { useApp } from '../context/AppContext.jsx';
import ToolTypeDropdown from './ToolTypeDropdown.jsx';
import ToolFields from './ToolFields.jsx';
import ExtractUpdateModal from './ExtractUpdateModal.jsx';
import PurchasingSection, { normalizePurchasing, backfillUrls } from './PurchasingSection.jsx';
import Section from './tool/ToolSection.jsx';
import FieldInput from './tool/FieldInput.jsx';
import SpecSummary, { SpecPurchasingPanel } from './tool/SpecScanPanels.jsx';
import ToolIdentitySection from './tool/ToolIdentitySection.jsx';
import { applyPurchasingRows } from '../schema/extractionDiff.js';
import { getToolFieldSections, coatingOptions } from '../schema/toolFieldLayout.js';
import {
  INSERT_FAMILIES, INSERT_FAMILY_BY_ID, ALWAYS_INSERT_TYPES,
  defaultActivationFamily, newPairing, isCombinedProShopId,
} from '../schema/insertFamilies.js';

export default function ToolForm({ tool, onSave, onCancel, isSaving, isNew, onDelete }) {
  const { tools, shopSettings, googleAuthenticated, vendorRegistry, saveVendorRegistry } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const [data, setData] = useState({ ...tool });
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
  const setStatus = (next) => setData(d => {
    const patch = { ...d, tool_status: next };
    if (next !== 'retired') patch.replaced_by = null;
    // RETIRED is applied and removed outright — the write path enforces the same
    // rule, so doing it here just means the form SHOWS what will be saved rather
    // than the marker appearing out of nowhere on the next load. Explicitly
    // granted exception to "descriptions are never silently renamed": Fusion has
    // nowhere else to carry the status, and a programmer picking tools for a new
    // job has to see it there.
    const desc = next === 'retired'
      ? withRetiredSuffix(d.description)
      : stripRetiredSuffix(d.description);
    if (desc !== d.description) patch.description = desc;
    // BETA stays OFFERED, not enforced: it rides along with a description this
    // form generated, and is never stripped on the app's say-so (the prompt
    // below asks). Different rule, deliberately — see utils/toolStatus.js.
    if (next === 'beta') {
      const base = patch.description ?? d.description;
      // ⚠️ Compare against the name with EVERY marker off both sides —
      // toolToExtractor carries the tool's CURRENT status, so buildDesc would
      // otherwise re-append the marker we are in the middle of changing and the
      // "did this form generate it?" test would never be true.
      const generated = stripStatusSuffixes(buildDesc(toolToExtractor(d)));
      if (base && !hasBetaSuffix(base) && stripStatusSuffixes(base) === generated) {
        patch.description = withBetaSuffix(base);
      }
    }
    return patch;
  });

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
    if (on) {
      setField('pairing', data.pairing || newPairing(defaultActivationFamily(data.tool_type)));
    } else {
      const linked = data.pairing && (data.pairing.holder_component_id || data.pairing.insert_component_id);
      if (linked && !window.confirm('Turn off insert-style? The holder body and insert records are kept, but they will be unlinked from this tool.')) return;
      setField('pairing', null);
    }
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

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(tool), [data, tool]);

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

  const handleSave = async () => {
    const { valid, errors: errs } = validateTool(data);
    if (!valid) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
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
    } catch (err) {
      setErrors([err.message]);
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

  // Keyboard: Ctrl/Cmd+S saves, Esc cancels
  useEffect(() => {
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

  return (
    <div className="tool-form">
      {errors.length > 0 && (
        <div className="error-banner mb-16">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Update an existing tool from a manufacturer spec sheet. Not offered
          when creating — the add flow has its own extraction step, and there is
          nothing to compare against yet. */}
      {!isNew && !hasProposals && (
        <div className="spec-scan-bar mb-16">
          <ScanLine size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span className="text-sm text-sub" style={{ flex: 1 }}>
            Update this tool from a manufacturer spec sheet or product page.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScanOpen(true)}>
            <ScanLine size={14} /> Scan spec sheet
          </button>
        </div>
      )}

      {hasProposals && (
        <SpecSummary
          pending={pendingCount}
          accepted={acceptedCount}
          typeNotice={typeNotice}
          sourceFile={sourceFile}
          keepSourceFile={keepSourceFile}
          onKeepSourceFile={setKeepSourceFile}
          canAttach={googleAuthenticated}
          onAcceptAll={acceptAllPending}
          onDiscard={discardProposals}
        />
      )}

      {/* Tool type — a dropdown of grouped icon cards (Milling / Hole Making / …). */}
      <div className="panel open mb-16" style={{ overflow: 'visible' }}>
        <div className="panel-header static">
          <Layers size={15} className="panel-header-icon" />
          <span className="panel-header-title">Tool Type *</span>
        </div>
        <div className="panel-body">
          <ToolTypeDropdown value={data.tool_type} onChange={(t) => setField('tool_type', t)} />
        </div>
      </div>

      {/* Two-column layout mirroring the read-only tool view, so edit feels like
          "view, unlocked": geometry/material on the left, identity/notes on the right. */}
      <div className="detail-layout">
        <div className="detail-layout-left">
          <Section className="mb-16" title="Geometry & Setup" icon={Ruler} forceOpen={inlineProposalMap.size > 0}>
            <ToolFields
              tool={data}
              mode="edit"
              setField={setField}
              geoIssueFields={geoIssueFields}
              proposals={inlineProposalMap}
              onResolveProposal={resolveProposal}
              listOptions={datalistOptions}
            />
            {geoIssues.length > 0 && (
              <div className="warn-banner" style={{ marginTop: 12 }}>
                {geoIssues.map((issue, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                    {issue.message}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="warn-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            Speeds &amp; feeds are managed per preset. {isNew ? 'Add presets from the tool page after saving.' : 'Edit them in the Speeds & Feeds section on the tool page.'}
          </div>

          {/* Insert-style activation. Always-insert types (face mill / turning /
              boring head) already open the paired view automatically, so the
              toggle is only offered on the other types (the ~5% opt-in case).
              A slash in the Fusion product-id makes a tool insert-style
              intrinsically — the toggle can't turn that off (it would just
              re-derive on the next load), so we show a read-only note instead. */}
          {!ALWAYS_INSERT_TYPES.has(data.tool_type) && (
            <Section className="mb-16" title="Insert-Style Tool" icon={Link2}>
              {isCombinedProShopId(data.tool_id) ? (
                <p className="text-sub text-sm" style={{ lineHeight: 1.5 }}>
                  Insert-style — detected from the Fusion product-id
                  {' '}(<span className="font-mono">{data.tool_id}</span>), which combines the
                  holder body and insert ProShop numbers with a “/”. Set the family and
                  link the components on the tool page; to change whether it's insert-style,
                  edit the product-id in Fusion.
                </p>
              ) : (
              <>
              <label className="checkbox-row">
                <input type="checkbox" checked={!!data.pairing} onChange={e => togglePairing(e.target.checked)} />
                <span className="text-sub text-sm">Insert-style tool — separate holder body + insert</span>
                <InfoTip text="Turn on when this tool is physically two pieces — a holder body and an insert tip — each with its own Tool ID, location and purchasing. The tool page then splits into Holder Body / Insert sections. Nothing changes in Fusion; the two components are tracked only in the app." />
              </label>
              {data.pairing && (
                <div className="field-group mt-12" style={{ maxWidth: 340 }}>
                  <label className="field-label">Insert-tool family</label>
                  <select
                    className="field-input"
                    value={data.pairing.family}
                    onChange={e => setField('pairing', { ...data.pairing, family: e.target.value })}
                  >
                    {INSERT_FAMILIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <p className="text-sub text-xs mt-6">
                    {INSERT_FAMILY_BY_ID[data.pairing.family]?.hasTier3Assembly === false
                      ? 'The pairing itself is the finished tool (no holder assembly).'
                      : 'Keeps its holder + OOH assembly.'}{' '}
                    Link the holder body and insert on the tool page after saving.
                  </p>
                </div>
              )}
              </>
              )}
            </Section>
          )}
        </div>

        <div className="detail-layout-right">
          {(purchRows.length > 0 || homelessProposals.length > 0) && (
            <SpecPurchasingPanel
              rows={purchRows}
              homeless={homelessProposals}
              unit={data.unit}
              newMfgAck={newMfgAck}
              onAck={setNewMfgAck}
              onResolveRow={resolvePurchRow}
              onResolveField={resolveProposal}
            />
          )}

          <ToolIdentitySection
            data={data} isNew={isNew} setField={setField} setStatus={setStatus}
            idMode={idMode} hasMachineNum={hasMachineNum} machineNum={machineNum}
            locEditable={locEditable} descSuggestion={descSuggestion} descStale={descStale}
            replacementTool={replacementTool}
            onPickReplacement={() => setPickReplacement(true)}
          />

          {/* Purchasing — edited in place in the draft (controlled mode), so it
              is committed by this form's Save like every other field. Mirrors
              the view page, which hides tool-level purchasing once components
              are linked: on an insert tool the purchasing lives on each
              component, not on the pairing. */}
          {/* ⚠️ Not while a scan's purchasing rows are outstanding. Those rows
              replay against a FROZEN base (see purchasingFor), so a hand-edit
              made alongside them would be silently wiped by the next row
              toggle. For that session SpecPurchasingPanel is the one editor —
              it already shows current → proposed for every purchasing change,
              and Discard scan brings this panel back. */}
          {!hasComponents && purchRows.length === 0 && (
            <PurchasingSection
              tool={data}
              value={data.purchasing}
              onChange={p => setField('purchasing', p)}
            />
          )}

          <Section className="mb-16" title="Notes & Tags" icon={StickyNote}>
            <div className="form-grid">
              {/* No "Last Used Job" free-text field: which programs a tool runs
                  in is DERIVED (ToolDetail's Where Used panel), and a preset's
                  proven-on link is stored per preset. */}
              <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
              {/* Preferred Machine — stores the machine's stable id (rename-proof);
                  the name is derived. A legacy free-text value with no matching
                  machine is kept and offered until re-picked. See machines.js. */}
              <div className="field-group">
                <label className="field-label">Preferred Machine</label>
                <select
                  className="field-input"
                  value={data.preferred_machine_id || ''}
                  onChange={e => {
                    const id = e.target.value || null;
                    const m = (shopSettings?.machines || []).find(x => x.id === id);
                    setField('preferred_machine_id', id);
                    setField('preferred_machine', m ? m.model : '');
                  }}
                >
                  <option value="">— none —</option>
                  {(shopSettings?.machines || []).map(m => (
                    <option key={m.id} value={m.id}>{m.model}</option>
                  ))}
                  {/* Legacy free-text value not in the machine list — keep it selectable. */}
                  {!data.preferred_machine_id && data.preferred_machine && (
                    <option value="__legacy__" disabled>{data.preferred_machine} (unlinked)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="field-group mt-12">
              <label className="checkbox-row">
                <input type="checkbox" checked={!!data.no_fusion_link} onChange={e => setField('no_fusion_link', e.target.checked)} />
                <span className="text-sub text-sm">No Fusion Link — needs Fusion setup</span>
                <InfoTip text={'Set automatically when this tool is added from a ProShop row with no Fusion match — its Fusion library entry is a placeholder. Uncheck once its Fusion entry has real geometry, presets, and holder/assembly setup.'} />
              </label>
            </div>

            {/* Tags */}
            <div className="field-group mt-12">
              <label className="field-label">Tags</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  className="field-input"
                  style={{ flex: 1 }}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="Add tag and press Enter"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && tagInput.trim()) {
                      const existing = data.tags || [];
                      if (!existing.includes(tagInput.trim())) {
                        setField('tags', [...existing, tagInput.trim()]);
                      }
                      setTagInput('');
                      e.preventDefault();
                    }
                  }}
                />
              </div>
              <div className="tag-list">
                {(data.tags || []).map(tag => (
                  <span key={tag} className="tag removable" onClick={() => setField('tags', (data.tags || []).filter(t => t !== tag))}>
                    {tag} <X size={11} />
                  </span>
                ))}
              </div>
            </div>

            <div className="field-group mt-12">
              <label className="field-label">Notes</label>
              <textarea className="field-input" value={data.notes || ''} onChange={e => setField('notes', e.target.value)} rows={3} />
            </div>
            <div className="field-group mt-12">
              <label className="field-label">Revision Notes</label>
              <input className="field-input" value={data.revision_notes || ''} onChange={e => setField('revision_notes', e.target.value)} placeholder="What changed and why" />
            </div>
          </Section>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="form-actions-bar">
        {/* Delete lives here — only while editing an existing tool. Kept apart
            from Save/Cancel (pushed left) so it's not fat-fingered. The heavy
            "are you sure" confirmation is handled by the parent (ToolDetail). */}
        {!isNew && onDelete && (
          <button
            className="btn btn-danger"
            onClick={onDelete}
            disabled={isSaving}
            title="Delete this tool permanently"
            style={{ marginRight: 'auto' }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
        <span className={`form-dirty ${dirty ? 'show' : ''}`}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
        <span className="form-hint text-xs text-sub">⌘/Ctrl+S to save · Esc to cancel</span>
        <button className="btn btn-secondary" onClick={handleCancel} disabled={isSaving}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Saving…</>
          ) : (
            <><Save size={15} /> {isNew ? 'Add to Library' : 'Save Changes'}</>
          )}
        </button>
      </div>

      <ExtractUpdateModal
        open={scanOpen}
        tool={data}
        onClose={() => setScanOpen(false)}
        onProposals={receiveProposals}
      />

      {/* Reuses the linked-tools picker — the same search the landing page runs,
          so a ProShop #, EDP# or retired ID finds the replacement exactly as it
          would anywhere else. Stores the tool's tracking id, never its name. */}
      {pickReplacement && (
        <ToolLinkPicker
          // ⚠️ Only the tool ITSELF is off-limits. The picker normally also hides
          // anything in `linked_tools` — right for that relationship, wrong for
          // this one: a tool related to this one (you link the old and the new,
          // then retire the old) is exactly the replacement you want to pick.
          tool={{ id: data.id }}
          onPick={(t) => { setField('replaced_by', t.id); setPickReplacement(false); }}
          onClose={() => setPickReplacement(false)}
        />
      )}
    </div>
  );
}
