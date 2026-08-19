import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, UploadCloud, Download, Printer, ListOrdered, Wrench, Plus, Pencil, Trash2,
  CheckCircle2, CircleDashed, ChevronDown, ChevronRight, Package, GitCompare,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  partsOf, formatProgramNumber, formatOperation, routingLabel, alloyLabel, machineOptions,
  operationMaterial, customerNames, routingsForPart, operationsForRouting, operationsForPart,
  updatePartIn, updateRoutingIn, updateOperationIn,
  deleteOperationIn, deleteRoutingIn, deletePartIn,
} from '../utils/parts.js';
import { detailsOf } from '../utils/sequenceImport.js';
import {
  CustomerBadge, TypePill, ProgramNumBadge, disclosureProps, PartEditForm, ProgramEditForm, RoutingEditForm, InlineConfirm,
  partDraftOf, partFieldsOf, programDraftOf, programFieldsOf, routingDraftOf, routingFieldsOf,
} from './partsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';
import ToolListTable from './ToolListTable.jsx';
import useRowSelection, { selScope } from './useRowSelection.js';
import SequenceDetailTable from './SequenceDetailTable.jsx';
import SequenceUploadModal from './SequenceUploadModal.jsx';
import useProgramFileSync from './useProgramFileSync.js';
import ProgramFileStatus, { AutoImportedMark } from './ProgramFileStatus.jsx';
import SequenceCompareModal from './SequenceCompareModal.jsx';
import { labelRows } from '../utils/toolLabels.js';
import { printToolTags } from '../utils/labelPrint.js';

// The PART page — one part number and everything about it in one place.
//
// Part → Routing → Operation (see utils/parts.js). A part can have more than one
// ROUTING — a different way of making it: different fixturing, machine or
// process revision — and the shop wants all of them on the one page for that
// part. This page is the parts module; the Program Numbers list is one view of
// the same data.
//
// It carries the SAME edit controls as the main list — edit the part, edit or
// delete any routing or operation, add a new one — by rendering the same shared
// forms (programsUi.jsx) through the same shared mutations (parts.js). There is
// deliberately no second implementation to drift.
//
// On top of that it has what the main list doesn't: the tool lists and label
// printing. The operator sets up OP50, OP60 and OP61M back to back and wants
// every label at once, which is why the all-tools list and the whole-part print
// live here rather than on a single operation.
//
// The Sequence Detail is per operation only — there is no part-level sequence.

const rowKeyOf = (r) => `${r.operation_id}:${r.t_num}`;
// The all-tools list's selection scope — an operation id can never collide.
const PART_SCOPE = 'part:all-tools';

function EditControls({ label, onEdit, onDelete }) {
  return (
    <>
      <span className="icon-btn" title={`Edit ${label}`} onClick={onEdit}><Pencil size={12} /></span>
      <span className="icon-btn" title={`Delete ${label}`} style={{ color: 'var(--red)' }} onClick={onDelete}>
        <Trash2 size={12} />
      </span>
    </>
  );
}

// ── One program ──────────────────────────────────────────────────────────────

function OperationCard({
  operation, part, detail, machines, materials, canEdit, selection,
  fileStatus, syncing, onSync, onCompare, autoOpen = false,
  onPrint, onUpload, onProven, onUpdateOperation, onDeleteOperation,
}) {
  // ⚠️ Seeded from `autoOpen` rather than opened in an effect: arriving from a
  // program row on the parts list, the card must render open on its FIRST paint.
  // Opening it afterwards shows a collapsed card for a frame and, worse, means
  // the scroll below measures a card that is still the wrong height.
  const [open, setOpen] = useState(autoOpen);
  const [tab, setTab] = useState('tools');
  const cardRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { fetchSequenceCsv, notify } = useApp();

  // Arrived here by clicking THIS program on the parts list: open it, show the
  // tool list, and bring it up the page so the table is what you are looking at
  // — the point of the shortcut is to land on the tools, not at the top of a
  // part with a dozen operations to scroll past.
  //
  // ⚠️ Two frames of delay, not one: the first commits the expanded body, the
  // second lets it lay out. Measuring before that puts the card wherever it sat
  // while collapsed, which on a long part is nowhere near right.
  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    setTab('tools');
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = cardRef.current;
        if (!el) return;
        const target = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.2;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        window.scrollTo({ top: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' });
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [autoOpen]);

  const rows = useMemo(
    () => (detail?.tools || []).map(t => ({ ...t, operation_id: operation.id })),
    [detail, operation.id],
  );
  const keys = rows.map(rowKeyOf);
  // Only this table's selection — see useRowSelection on why it can't be shared.
  const selectedHere = selection.keysIn(operation.id);

  // "Download the current file" means the un-renamed one — the current version
  // always keeps its original filename, which is exactly why it's kept that way.
  const download = async () => {
    try {
      const text = await fetchSequenceCsv(detail);
      if (!text) { notify('The raw file for this version is no longer in Drive', 'error'); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = detail.file_name || `${formatProgramNumber(operation.program_number)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      notify(`Download failed: ${err.message}`, 'error', 6000);
    }
  };

  // The same inline form the Parts page uses — one implementation, so a
  // field added there shows up here too.
  if (editing) {
    return (
      <div className="pn-part-card sd-program">
        <div className="sd-program-head" style={{ cursor: 'default' }}>
          <ProgramNumBadge n={operation.program_number} />
          <span className="text-xs text-sub">Editing</span>
        </div>
        <ProgramEditForm
          draft={draft} setDraft={setDraft} machines={machines} materials={materials}
          onSave={() => { onUpdateOperation(operation.id, programFieldsOf(draft, operation)); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const mat = operationMaterial(operation, part);

  return (
    <div className="pn-part-card sd-program" ref={cardRef} {...selScope(operation.id)}>
      <div className="sd-program-head" {...disclosureProps(open, () => setOpen(o => !o))}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ProgramNumBadge n={operation.program_number} />
        {operation.op_number && <span className="sd-op-label">{formatOperation(operation.op_number)}</span>}
        {operation.machine_label && (
          <MachinePill label={operation.machine_label}
            color={machineColorFor(operation.machine_id, operation.machine_label, machines)} />
        )}
        <TypePill isFixture={operation.is_fixture} internalExternal={operation.internal_external} />
        {operation.pallet && <span className="text-xs text-sub">Pallet {operation.pallet}</span>}
        {operation.fixturing && <span className="text-xs text-sub">{operation.fixturing}</span>}
        {operation.is_fixture && (mat.material_id || mat.material_custom) && (
          <span className="text-xs text-sub">Fixture material: {alloyLabel(materials, mat.material_id, mat.material_custom)}</span>
        )}
        {operation.description && <span className="text-xs text-sub pn-op-desc">{operation.description}</span>}

        {confirmDelete ? (
          <span className="sd-head-right" onClick={e => e.stopPropagation()}>
            <InlineConfirm
              message={`Delete ${operation.program_number != null ? formatProgramNumber(operation.program_number) : formatOperation(operation.op_number)}?`}
              onConfirm={() => onDeleteOperation(operation.id)}
              onCancel={() => setConfirmDelete(false)}
            />
          </span>
        ) : detail ? (
          <span className="sd-head-right" onClick={e => e.stopPropagation()}>
            <ProgramFileStatus status={fileStatus} syncing={syncing} onSync={onSync} />
            <AutoImportedMark detail={detail} />
            <span className="text-xs text-sub">{detail.tools.length} tools</span>
            {/* Proven = "it ran on the machine and did not crash". Never implied
                by an upload; a person sets it, and it belongs to this version. */}
            <button
              type="button"
              className={`sd-proven${detail.proven ? ' on' : ''}`}
              disabled={!canEdit}
              title={detail.proven
                ? `Proven${detail.proven_by ? ` by ${detail.proven_by}` : ''} — this version ran without crashing`
                : 'Not yet proven — this version has not been confirmed to run'}
              onClick={() => onProven(operation.id, !detail.proven)}
            >
              {detail.proven ? <CheckCircle2 size={12} /> : <CircleDashed size={12} />}
              {detail.proven ? 'Proven' : 'Unproven'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={download} title="Download the current posted CSV">
              <Download size={12} />
            </button>
            {/* Deliberately its own button, never part of the update. Taking an
                update stays one click that asks nothing; this is the separate
                "what actually changed?" look, and it only writes nothing. */}
            <button className="btn btn-ghost btn-sm" onClick={onCompare}
              title="Compare this version against another posted version — reference only, nothing is changed">
              <GitCompare size={12} />
            </button>
            {/* Appears only with a selection, to the LEFT of Print all, so
                "print all" never quietly changes meaning under the cursor. */}
            {selectedHere.length > 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => onPrint(selectedHere)}>
                <Printer size={12} /> Print selected <span className="sd-sel-count">{selectedHere.length}</span>
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => onPrint(keys)}>
              <Printer size={12} /> Print all
            </button>
            {canEdit && <EditControls label="operation"
              onEdit={() => { setDraft(programDraftOf(operation)); setEditing(true); }}
              onDelete={() => setConfirmDelete(true)} />}
          </span>
        ) : (
          <span className="sd-head-right" onClick={e => e.stopPropagation()}>
            <ProgramFileStatus status={fileStatus} syncing={syncing} onSync={onSync} />
            <span className="text-xs text-sub">No sequence detail</span>
            {canEdit && (
              <button className="btn btn-ghost btn-sm" onClick={onUpload}>
                <UploadCloud size={12} /> Upload CSV
              </button>
            )}
            {canEdit && <EditControls label="operation"
              onEdit={() => { setDraft(programDraftOf(operation)); setEditing(true); }}
              onDelete={() => setConfirmDelete(true)} />}
          </span>
        )}
      </div>

      {open && detail && (
        <div className="pn-part-body">
          <div className="pn-view-tabs sd-tabs">
            <button className={`pn-view-tab${tab === 'tools' ? ' active' : ''}`} onClick={() => setTab('tools')}>
              <Wrench size={13} /> Tool List
            </button>
            <button className={`pn-view-tab${tab === 'seq' ? ' active' : ''}`} onClick={() => setTab('seq')}>
              <ListOrdered size={13} /> Sequence Detail
            </button>
            <span className="sd-tab-meta text-xs text-sub">
              {detail.posted ? `Posted ${detail.posted}` : 'No posted stamp'} · {detail.file_name}
            </span>
          </div>

          {tab === 'tools' ? (
            <ToolListTable
              rows={rows}
              selected={selection.keys}
              rowKey={rowKeyOf}
              onRowClick={(k, e) => selection.selectRow(operation.id, keys, k, e)}
            />
          ) : (
            <SequenceDetailTable detail={detail} />
          )}
        </div>
      )}

      {open && !detail && (
        <div className="pn-part-body">
          <div className="pn-empty">
            No Sequence Detail uploaded for this program yet.
          </div>
        </div>
      )}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function PartDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Set by a program row on the parts list — which program to open on arrival.
  // Read from navigation state rather than the URL: it is a one-off hint about
  // how you got here, not part of the page's address.
  const location = useLocation();
  const focusOperationId = location.state?.focusOperationId || null;
  const {
    parts: partsFile, saveParts, materials, shopSettings, programDetails, tools,
    setProgramProven, googleAuthenticated, demoMode, user, notify,
    importProgramFileFromDrive,
  } = useApp();

  const canEdit = googleAuthenticated || demoMode;
  const machines = machineOptions(shopSettings);
  const customers = customerNames(partsFile);
  const part = partsOf(partsFile).find(p => p.id === id) || null;
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingPart, setEditingPart] = useState(false);
  const [partDraft, setPartDraft] = useState(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState(false);
  const selection = useRowSelection();
  const [showJobList, setShowJobList] = useState(true);
  const [addRoutingId, setAddRoutingId] = useState(null);
  const [editingRoutingId, setEditingRoutingId] = useState(null);
  const [routingDraft, setRoutingDraft] = useState(null);
  const [confirmDeleteRouting, setConfirmDeleteRouting] = useState(null);
  // Which operation is mid-pull, so its indicator spins rather than the page.
  const [syncingOp, setSyncingOp] = useState(null);
  // The operation whose version compare is open, if any.
  const [comparing, setComparing] = useState(null);

  // ONE listing per posted-files folder, shared by every operation on this page
  // — see useProgramFileSync. Polls only while the tab is visible.
  const fileSync = useProgramFileSync();

  // Pull the posted file in. It runs the SAME buildSequenceImport the manual
  // upload runs and honours the SAME blockers, so a file with a tool the library
  // doesn't have is reported and skipped rather than half-stored.
  const syncProgram = async (operation, status) => {
    if (!status?.file) return;
    setSyncingOp(operation.id);
    try {
      const res = await importProgramFileFromDrive(status.file);
      if (!res.ok) {
        notify(`${formatProgramNumber(operation.program_number)} not pulled in — ${res.blockers[0].message}`, 'error', 9000);
        return;
      }
      notify(
        res.unchanged
          // Drive's copy was re-saved (or merely synced) without being
          // re-posted, so the POSTED stamp — the version key — is unchanged.
          // Saying so is what stops the indicator reading as a nag.
          ? `${formatProgramNumber(operation.program_number)} was already the current version — nothing changed`
          : `${formatProgramNumber(operation.program_number)} updated from Drive — ${res.stored.tools.length} tools`,
        'success',
      );
    } catch (err) {
      notify(`Couldn't pull in the posted file: ${err.message}`, 'error', 8000);
    } finally {
      setSyncingOp(null);
    }
  };

  // The same shared mutations the Parts page uses — see parts.js.
  const updatePart = (pid, patch) => saveParts(updatePartIn(partsFile, pid, patch));
  const updateRouting = (rid, patch) => saveParts(updateRoutingIn(partsFile, rid, patch));
  const updateOperation = (oid, patch) => saveParts(updateOperationIn(partsFile, oid, patch));
  const deleteOperation = (oid) => saveParts(deleteOperationIn(partsFile, oid));
  const deleteRouting = (rid) => { saveParts(deleteRoutingIn(partsFile, rid)); setConfirmDeleteRouting(null); };
  const deletePart = (pid) => {
    saveParts(deletePartIn(partsFile, pid));
    navigate('/parts');   // the page's subject is gone
  };

  const routings = useMemo(() => routingsForPart(partsFile, id), [partsFile, id]);
  const allOperations = useMemo(() => operationsForPart(partsFile, id), [partsFile, id]);

  const detailByOperation = useMemo(() => {
    const m = new Map();
    for (const d of detailsOf(programDetails)) m.set(d.operation_id, d);
    return m;
  }, [programDetails]);

  // The part-level all-tools list: every operation's tools across every
  // routing, so a whole part can be pulled and labelled in one pass.
  const partRows = useMemo(
    () => allOperations.flatMap(op => {
      const d = detailByOperation.get(op.id);
      if (!d) return [];
      const opLabel = formatOperation(op.op_number);
      return d.tools.map(t => ({ ...t, operation_id: op.id, op_label: opLabel }));
    }),
    [allOperations, detailByOperation],
  );

  // The label's location comes from the app, not the posted file — see
  // resolveRowLocation. Resolved live, so a corrected location reaches the next
  // label with no re-upload.
  const toolsById = useMemo(() => new Map((tools || []).map(t => [t.id, t])), [tools]);

  if (!part) {
    return (
      <div className="pn-page">
        <div className="pn-empty">
          That part isn't in the registry. <Link to="/parts">Back to parts</Link>
        </div>
      </div>
    );
  }

  const print = (keys) => {
    const wanted = new Set(keys);
    const rows = partRows.filter(r => wanted.has(rowKeyOf(r)));
    if (rows.length === 0) { notify('Nothing selected to print', 'error'); return; }
    const labels = labelRows(rows, part, toolsById);
    // Deliberately reported: a blocked popup looks exactly like a broken button.
    if (!printToolTags(labels)) {
      notify('Your browser blocked the print window — allow popups for this site', 'error', 7000);
    }
  };

  const printProgram = (keys) => print(keys);

  const partKeys = partRows.map(rowKeyOf);
  const selectedPartRows = selection.keysIn(PART_SCOPE);
  const withDetail = allOperations.filter(op => detailByOperation.has(op.id)).length;

  return (
    <div className="pn-page">
      <div className="detail-header mb-16">
        <button className="icon-btn" onClick={() => navigate('/parts')} title="Back to parts">
          <ArrowLeft size={18} />
        </button>
        <span className="detail-header-icon"><Package size={22} /></span>
        <div>
          <div className="detail-header-type">
            {routings.length} routing{routings.length !== 1 ? 's' : ''} · {allOperations.length} operation{allOperations.length !== 1 ? 's' : ''} · {withDetail} with sequence detail
          </div>
          <h1 className="detail-header-title">{part.part_number}</h1>
        </div>
        <div className="pn-header-right">
          <CustomerBadge customer={part.customer} />
          {(part.material_id || part.material_custom) && (
            <span className="text-xs text-sub">{alloyLabel(materials, part.material_id, part.material_custom)}</span>
          )}
          {canEdit && !editingPart && (
            <>
              <span className="icon-btn" title="Edit part"
                onClick={() => { setPartDraft(partDraftOf(part)); setEditingPart(true); }}>
                <Pencil size={14} />
              </span>
              <span className="icon-btn" title="Delete part" style={{ color: 'var(--red)' }}
                onClick={() => setConfirmDeletePart(true)}>
                <Trash2 size={14} />
              </span>
              <button className="btn btn-secondary" onClick={() => { setAddRoutingId(null); setAdding(true); }}>
                <Plus size={15} /> Add program
              </button>
              <button className="btn btn-primary" onClick={() => setUploading(true)}>
                <UploadCloud size={15} /> Upload Sequence Detail
              </button>
            </>
          )}
        </div>
      </div>

      {confirmDeletePart && (
        <div className="pn-part-card" style={{ padding: '10px 14px', marginBottom: 12 }}>
          <InlineConfirm
            message={`Delete ${part.part_number}${allOperations.length > 0 ? ` and its ${routings.length} routing${routings.length !== 1 ? 's' : ''} / ${allOperations.length} operation${allOperations.length !== 1 ? 's' : ''}` : ''}? This can't be undone.`}
            onConfirm={() => deletePart(part.id)}
            onCancel={() => setConfirmDeletePart(false)}
          />
        </div>
      )}

      {editingPart && (
        <div className="pn-part-card" style={{ marginBottom: 12 }}>
          <PartEditForm
            draft={partDraft} setDraft={setPartDraft} materials={materials} customers={customers}
            onSave={() => { updatePart(part.id, partFieldsOf(partDraft, part)); setEditingPart(false); }}
            onCancel={() => setEditingPart(false)}
          />
        </div>
      )}

      {partRows.length > 0 && (
        <div className="pn-part-card sd-all-tools" {...selScope(PART_SCOPE)}>
          <div className="sd-program-head" {...disclosureProps(showJobList, () => setShowJobList(o => !o))}>
            {showJobList ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Wrench size={14} style={{ color: 'var(--blue)' }} />
            <span className="sd-alltools-title">All tools for this part</span>
            <span className="text-xs text-sub">
              every tool across all {withDetail} operation{withDetail !== 1 ? 's' : ''} — {partRows.length} rows
            </span>
            <span className="sd-head-right" onClick={e => e.stopPropagation()}>
              {selectedPartRows.length > 0 && (
                <button className="btn btn-primary btn-sm" onClick={() => print(selectedPartRows)}>
                  <Printer size={13} /> Print selected <span className="sd-sel-count">{selectedPartRows.length}</span>
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => print(partKeys)}>
                <Printer size={13} /> Print all labels
              </button>
            </span>
          </div>
          {showJobList && (
            <div className="pn-part-body">
              <ToolListTable
                rows={partRows}
                showOp
                selected={selection.keys}
                rowKey={rowKeyOf}
                onRowClick={(k, e) => selection.selectRow(PART_SCOPE, partKeys, k, e)}
              />
            </div>
          )}
        </div>
      )}

      <div className="pn-grouped" style={{ marginTop: 12 }}>
        {routings.map((routing, i) => {
          const ops = operationsForRouting(partsFile, routing.id);
          return (
            <div key={routing.id} className="sd-routing">
              {editingRoutingId === routing.id ? (
                <RoutingEditForm
                  draft={routingDraft} setDraft={setRoutingDraft}
                  onSave={() => { updateRouting(routing.id, routingFieldsOf(routingDraft)); setEditingRoutingId(null); }}
                  onCancel={() => setEditingRoutingId(null)}
                />
              ) : (
                <div className="sd-routing-head">
                  <span className="sd-routing-name">{routingLabel(routing, i)}</span>
                  {routing.rev && routing.name && <span className="text-xs text-sub">Rev {routing.rev}</span>}
                  <span className="text-xs text-sub">
                    {ops.length} operation{ops.length !== 1 ? 's' : ''}
                  </span>
                  {routing.notes && <span className="text-xs text-sub pn-op-desc">{routing.notes}</span>}
                  {canEdit && (
                    <span className="sd-head-right">
                      {confirmDeleteRouting === routing.id ? (
                        <InlineConfirm
                          message={`Delete ${routingLabel(routing, i)}${ops.length ? ` and its ${ops.length} operation${ops.length !== 1 ? 's' : ''}` : ''}?`}
                          onConfirm={() => deleteRouting(routing.id)}
                          onCancel={() => setConfirmDeleteRouting(null)}
                        />
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => { setAddRoutingId(routing.id); setAdding(true); }}>
                            <Plus size={12} /> Operation
                          </button>
                          <EditControls label="routing"
                            onEdit={() => { setRoutingDraft(routingDraftOf(routing)); setEditingRoutingId(routing.id); }}
                            onDelete={() => setConfirmDeleteRouting(routing.id)} />
                        </>
                      )}
                    </span>
                  )}
                </div>
              )}

              {ops.map(op => (
                <OperationCard
                  key={op.id}
                  operation={op}
                  part={part}
                  detail={detailByOperation.get(op.id) || null}
                  machines={machines}
                  materials={materials}
                  canEdit={canEdit}
                  selection={selection}
                  autoOpen={op.id === focusOperationId}
                  fileStatus={fileSync.statusFor(op)}
                  syncing={syncingOp === op.id}
                  onSync={() => syncProgram(op, fileSync.statusFor(op))}
                  onCompare={() => setComparing(op.id)}
                  onPrint={printProgram}
                  onUpload={() => setUploading(true)}
                  onUpdateOperation={updateOperation}
                  onDeleteOperation={deleteOperation}
                  onProven={async (operationId, proven) => {
                    try {
                      await setProgramProven(operationId, proven, user?.email || user?.name || '');
                    } catch (err) {
                      notify(`Couldn't save: ${err.message}`, 'error', 6000);
                    }
                  }}
                />
              ))}
              {ops.length === 0 && (
                <div className="pn-empty" style={{ padding: '10px 0' }}>No operations in this routing yet.</div>
              )}
            </div>
          );
        })}
        {routings.length === 0 && (
          <div className="pn-empty">
            No routings on this part yet.
            {canEdit && <> <button className="btn btn-ghost btn-sm" onClick={() => { setAddRoutingId(null); setAdding(true); }}>
              <Plus size={12} /> Add the first program
            </button></>}
          </div>
        )}
      </div>

      {adding && (
        // Scoped to this part: the modal skips the part search and hides
        // "Change part", because adding a program to a different part from
        // this page is never what was meant.
        <AddProgramModal partId={part.id} routingId={addRoutingId}
          onClose={() => { setAdding(false); setAddRoutingId(null); }} />
      )}

      {comparing && (() => {
        const op = allOperations.find(o => o.id === comparing);
        const status = op ? fileSync.statusFor(op) : null;
        if (!op) return null;
        return (
          <SequenceCompareModal
            operation={op}
            detail={detailByOperation.get(op.id) || null}
            // A newer file sitting in Drive that hasn't been taken yet is
            // offerable as a side, so "it says it's out of date — what changed?"
            // is answerable BEFORE the update rather than only after it.
            pendingFile={status?.state === 'stale' ? status.file : null}
            onClose={() => setComparing(null)}
          />
        );
      })()}

      {uploading && (
        <SequenceUploadModal
          onClose={() => setUploading(false)}
          onImported={(_stored, _op, _routing, importedPart) => {
            setUploading(false);
            // A CSV for a different PART navigates there — the upload is the
            // reason you're looking at a part page at all.
            if (importedPart && importedPart.id !== id) navigate(`/parts/${importedPart.id}`);
          }}
        />
      )}
    </div>
  );
}
