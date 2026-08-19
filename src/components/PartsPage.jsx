import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, ChevronDown, ChevronRight, Pencil, Trash2,
  LayoutGrid, Table2, Package, UploadCloud, ExternalLink, Wrench,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  nextProgramNumber, formatProgramNumber, formatOperation, routingLabel,
  partsOf, operationsOf, routingsOf, routingsForPart, operationsForRouting, operationsForPart,
  operationMaterial, alloyLabel, machineOptions, customerNames,
  applyPartsFilters, sortParts, sortOperations,
  updatePartIn, updateOperationIn, deleteOperationIn, deletePartIn,
} from '../utils/parts.js';
import {
  CustomerBadge, TypePill, ProgramNumBadge, disclosureProps,
  ProgramEditForm, PartEditForm, InlineConfirm, PartsFilterBar, DEFAULT_PARTS_FILTERS,
  programDraftOf, programFieldsOf, partDraftOf, partFieldsOf,
} from './partsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';
import SequenceUploadModal from './SequenceUploadModal.jsx';
import MachinePill from './MachinePill.jsx';
import OpPill from './OpPill.jsx';
import { machineColorFor } from '../utils/machineColors.js';
import { detailsOf } from '../utils/sequenceImport.js';

// The PARTS page — every part the shop makes, and with it every program number
// it has assigned. Replaces the manually-managed Google Sheet.
//
// Two renderings of ONE filtered, sorted set: a grouped list (Part → Routing →
// Operation) and a flat table. The search / filter / sort bar is shared, so a
// row you can find in one view is a row you can find in the other. The part page
// (/parts/:id) is where a part's work actually lives.
//
// See utils/parts.js for the model and for the filtering and sorting rules.

// ── Grouped view ─────────────────────────────────────────────────────────────

function OperationRow({ operation, part, materials, machines, canEdit, onUpdate, onDelete, onOpen }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      // ⚠️ Stops the body's navigate: a click on a field, a select, or Cancel
      // must not walk away from a half-finished edit.
      <div onClick={e => e.stopPropagation()}>
      <ProgramEditForm
        draft={draft} setDraft={setDraft} machines={machines} materials={materials}
        onSave={() => { onUpdate(operation.id, programFieldsOf(draft, operation)); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
      </div>
    );
  }

  const mat = operationMaterial(operation, part);
  return (
    // The row already opens the part (its container navigates); claiming the
    // click here just carries WHICH program was clicked, so the part page can
    // open straight to that program's tool list instead of the top of the page.
    <div
      className="pn-op-row"
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(operation.id); } : undefined}
    >
      <ProgramNumBadge n={operation.program_number} />
      <OpPill op={operation.op_number} />
      {operation.machine_label
        ? <MachinePill label={operation.machine_label} color={machineColorFor(operation.machine_id, operation.machine_label, machines)} />
        : <span className="text-sm">—</span>}
      <TypePill isFixture={operation.is_fixture} internalExternal={operation.internal_external} />
      {operation.pallet && <span className="text-xs text-sub">Pallet {operation.pallet}</span>}
      {operation.fixturing && <span className="text-xs text-sub">{operation.fixturing}</span>}
      {operation.is_fixture && (mat.material_id || mat.material_custom) && (
        <span className="text-xs text-sub">Fixture material: {alloyLabel(materials, mat.material_id, mat.material_custom)}</span>
      )}
      {operation.description && <span className="text-xs text-sub pn-op-desc">{operation.description}</span>}
      {canEdit && (
        confirmDelete ? (
          <span onClick={e => e.stopPropagation()}>
            <InlineConfirm
              message={`Delete ${operation.program_number != null ? formatProgramNumber(operation.program_number) : formatOperation(operation.op_number)}?`}
              onConfirm={() => onDelete(operation.id)}
              onCancel={() => setConfirmDelete(false)}
            />
          </span>
        ) : (
          <>
            <span className="icon-btn pn-op-edit-btn" title="Edit operation"
              onClick={e => { e.stopPropagation(); setDraft(programDraftOf(operation)); setEditing(true); }}>
              <Pencil size={12} />
            </span>
            <span className="icon-btn" title="Delete operation" style={{ color: 'var(--red)' }}
              onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}>
              <Trash2 size={12} />
            </span>
          </>
        )
      )}
    </div>
  );
}

function PartHeader({ part, routingCount, opCount, detailCount, expanded, onToggle, materials, canEdit, customers, onOpenPart, onUpdatePart, onDeletePart }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <PartEditForm
        draft={draft} setDraft={setDraft} materials={materials} customers={customers}
        onSave={() => { onUpdatePart(part.id, partFieldsOf(draft, part)); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // ONE PRIMARY ACTION PER ROW. The part number is the row's identity, so it is
  // a real <Link> — clicking it opens the part, and cmd/middle-click opens it in
  // a new tab like any other link. Everything ELSE in the row (chevron, badges,
  // counts, empty space) is the secondary action: expand. Before this both did
  // the same thing (expand) and the only way to the page was the small "Open"
  // button, so the obvious target gave the non-obvious result.
  return (
    <div className="pn-part-header" {...disclosureProps(expanded, onToggle)}>
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <Link
        to={`/parts/${part.id}`}
        className="pn-part-number pn-part-link"
        onClick={e => e.stopPropagation()}
        title="Open this part — routings, tool lists, sequence detail and labels"
      >{part.part_number}</Link>
      <CustomerBadge customer={part.customer} />
      {(part.material_id || part.material_custom) && (
        <span className="text-xs text-sub">{alloyLabel(materials, part.material_id, part.material_custom)}</span>
      )}
      <span className="pn-part-count text-xs text-sub">
        {routingCount} routing{routingCount !== 1 ? 's' : ''} · {opCount} operation{opCount !== 1 ? 's' : ''}
      </span>
      {detailCount > 0 && (
        <span className="sd-count-chip" title={`${detailCount} of this part's operations have a Sequence Detail uploaded`}>
          <Wrench size={11} /> {detailCount}
        </span>
      )}
      <button type="button" className="btn btn-ghost btn-sm"
        title="Open this part — routings, tool lists, sequence detail and labels"
        onClick={e => { e.stopPropagation(); onOpenPart(part.id); }}>
        Open <ExternalLink size={11} />
      </button>
      {canEdit && (
        confirmDelete ? (
          <InlineConfirm
            message={`Delete ${part.part_number} and everything under it?`}
            onConfirm={() => onDeletePart(part.id)}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <>
            <span className="icon-btn" title="Edit part"
              onClick={e => { e.stopPropagation(); setDraft(partDraftOf(part)); setEditing(true); }}>
              <Pencil size={12} />
            </span>
            <span className="icon-btn" title="Delete part" style={{ color: 'var(--red)' }}
              onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}>
              <Trash2 size={12} />
            </span>
          </>
        )
      )}
    </div>
  );
}

function GroupedView({ parts, partsFile, materials, machines, canEdit, customers, collapsed, detailByOperation, visibleOps, filtered, onToggle, onOpenPart, onUpdatePart, onDeletePart, onUpdateOperation, onDeleteOperation }) {
  if (parts.length === 0) {
    return (
      <div className="pn-empty">
        {filtered
          ? 'No parts match your search.'
          : <>No parts yet — click <strong>Add program</strong> to create the first one.</>}
      </div>
    );
  }
  return (
    <div className="pn-grouped">
      {parts.map(part => {
        const allOps = operationsForPart(partsFile, part.id).filter(o => visibleOps.has(o.id));
        // Only routings with something left to show — a search that matches one
        // routing shouldn't leave the others as empty headers.
        const routings = routingsForPart(partsFile, part.id)
          .filter(r => !filtered || allOps.some(o => o.routing_id === r.id));
        // Parts render EXPANDED by default — the program numbers are the main
        // thing the page exists to show. `collapsed` tracks the exceptions.
        const isOpen = !collapsed.has(part.id);
        return (
          <div key={part.id} className="pn-part-card">
            <PartHeader
              part={part} routingCount={routings.length} opCount={allOps.length}
              detailCount={allOps.filter(o => detailByOperation.has(o.id)).length}
              expanded={isOpen} onToggle={() => onToggle(part.id)} onOpenPart={onOpenPart}
              materials={materials} canEdit={canEdit} customers={customers}
              onUpdatePart={onUpdatePart} onDeletePart={onDeletePart}
            />
            {isOpen && (
              // The body reads as a stack of rows, and a row in the TABLE view
              // opens the part — so these do too. The header keeps expand as its
              // own action; the body has nothing to expand, so like the table it
              // has no secondary action competing for the click.
              <div
                className="pn-part-body pn-body-link"
                onClick={() => onOpenPart(part.id)}
              >
                {routings.map((routing, i) => {
                  const ops = operationsForRouting(partsFile, routing.id).filter(o => visibleOps.has(o.id));
                  return (
                    <div key={routing.id} className="pn-op-group">
                      <div className="pn-op-label">{routingLabel(routing, i)}</div>
                      {ops.map(op => (
                        <OperationRow key={op.id} operation={op} part={part} materials={materials}
                          machines={machines} canEdit={canEdit}
                          onUpdate={onUpdateOperation} onDelete={onDeleteOperation}
                          onOpen={(opId) => onOpenPart(part.id, opId)} />
                      ))}
                      {ops.length === 0 && (
                        <div className="text-xs text-sub" style={{ padding: '4px 0' }}>No operations yet.</div>
                      )}
                    </div>
                  );
                })}
                {routings.length === 0 && (
                  <div className="pn-empty" style={{ padding: '10px 0' }}>No routings yet.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Table view ───────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'program_number', label: 'Program #' },
  { key: 'part', label: 'Part' },
  { key: 'customer', label: 'Customer' },
  { key: 'routing', label: 'Routing' },
  { key: 'op_number', label: 'OP' },
  { key: 'description', label: 'Description' },
  { key: 'machine', label: 'Machine' },
  { key: 'type', label: 'Type' },
  { key: 'fixturing', label: 'Fixturing' },
  { key: 'material', label: 'Material' },
  { key: 'pallet', label: 'Pallet' },
];

function TableView({ rows, materials, machines, canEdit, onOpenPart, onUpdateOperation, onDeleteOperation }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  return (
    <div className="pn-table-wrap">
      <table className="pn-table">
        <thead>
          <tr>
            <th style={{ width: 56 }} />
            {COLUMNS.map(col => <th key={col.key} style={{ cursor: 'default' }}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            editingId === row.id ? (
              <tr key={row.id} className="pn-row-editing">
                <td colSpan={COLUMNS.length + 1}>
                  <ProgramEditForm
                    draft={draft} setDraft={setDraft} machines={machines} materials={materials}
                    onSave={() => { onUpdateOperation(row.id, programFieldsOf(draft, row)); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                </td>
              </tr>
            ) : deleteId === row.id ? (
              <tr key={row.id} className="pn-row-editing">
                <td colSpan={COLUMNS.length + 1}>
                  <InlineConfirm
                    message={`Delete ${formatProgramNumber(row.program_number)}? This can't be undone.`}
                    onConfirm={() => { onDeleteOperation(row.id); setDeleteId(null); }}
                    onCancel={() => setDeleteId(null)}
                  />
                </td>
              </tr>
            ) : (
              // A flat table row has no dropdown to open, so it has no secondary
              // action competing for the click — the WHOLE row opens the part,
              // and the part number stays a real link so cmd-click still works.
              <tr
                key={row.id}
                className={row.part ? 'pn-row-link' : undefined}
                onClick={row.part ? () => onOpenPart?.(row.part.id, row.id) : undefined}
              >
                <td>
                  {canEdit && (
                    <span className="flex items-center" style={{ gap: 4 }}>
                      <span className="icon-btn" title="Edit row"
                        onClick={e => { e.stopPropagation(); setDraft(programDraftOf(row)); setEditingId(row.id); }}>
                        <Pencil size={12} />
                      </span>
                      <span className="icon-btn" title="Delete row" style={{ color: 'var(--red)' }}
                        onClick={e => { e.stopPropagation(); setDeleteId(row.id); }}><Trash2 size={12} /></span>
                    </span>
                  )}
                </td>
                <td><ProgramNumBadge n={row.program_number} /></td>
                <td>
                  {row.part
                    ? <Link to={`/parts/${row.part.id}`} className="pn-part-number pn-part-link"
                        onClick={e => e.stopPropagation()}>{row.part.part_number}</Link>
                    : <span className="pn-part-number">—</span>}
                </td>
                <td><CustomerBadge customer={row.part?.customer} /></td>
                <td className="text-sub">{row.routing ? routingLabel(row.routing) : '—'}</td>
                <td><OpPill op={row.op_number} /></td>
                <td className="text-sub">{row.description || '—'}</td>
                <td>
                  {row.machine_label
                    ? <MachinePill label={row.machine_label} color={machineColorFor(row.machine_id, row.machine_label, machines)} />
                    : '—'}
                </td>
                <td><TypePill isFixture={row.is_fixture} internalExternal={row.internal_external} /></td>
                <td className="text-sub">{row.fixturing || '—'}</td>
                <td className="text-sub">{row.materialLabel || '—'}</td>
                <td>{row.pallet || '—'}</td>
              </tr>
            )
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={COLUMNS.length + 1} className="pn-empty">No programs match your search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PartsPage() {
  const { parts: partsFile, saveParts, materials, shopSettings, programDetails, googleAuthenticated, demoMode } = useApp();
  const navigate = useNavigate();
  const canEdit = googleAuthenticated || demoMode;
  const [view, setView] = useState('grouped');
  const [showAdd, setShowAdd] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_PARTS_FILTERS);
  // Parts are expanded by default; this tracks the ones explicitly collapsed.
  const [collapsed, setCollapsed] = useState(() => new Set());
  // A CSV dropped anywhere on the page opens the upload dialog already holding
  // it — the whole point of the feature is fewer clicks than ProShop, so
  // "drag the file in" has to be the shortest path there is.
  const [dropped, setDropped] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const machines = machineOptions(shopSettings);
  const customers = customerNames(partsFile);
  const nextNum = nextProgramNumber(partsFile);

  const detailByOperation = useMemo(() => {
    const m = new Map();
    for (const d of detailsOf(programDetails)) m.set(d.operation_id, d);
    return m;
  }, [programDetails]);

  // ⚠️ ONE filtered set, both views. The grouped list and the table read the
  // same result, so they can never disagree about what matches.
  const { operationIds, partIds } = useMemo(
    () => applyPartsFilters(partsFile, materials, filters),
    [partsFile, materials, filters],
  );
  const isFiltered = filters.text.trim() !== '' || filters.machine !== 'All' || filters.type !== 'All';

  const visibleParts = useMemo(
    () => sortParts(partsFile, partsOf(partsFile).filter(p => partIds.has(p.id)), filters.sort, filters.dir),
    [partsFile, partIds, filters.sort, filters.dir],
  );

  const tableRows = useMemo(() => {
    const partById = new Map(partsOf(partsFile).map(p => [p.id, p]));
    const routingById = new Map(routingsOf(partsFile).map(r => [r.id, r]));
    const rows = operationsOf(partsFile)
      .filter(op => operationIds.has(op.id))
      .map(op => {
        const routing = routingById.get(op.routing_id) || null;
        const part = routing ? partById.get(routing.part_id) || null : null;
        const mat = operationMaterial(op, part);
        return { ...op, part, routing, materialLabel: alloyLabel(materials, mat.material_id, mat.material_custom) };
      });
    return sortOperations(rows, filters.sort, filters.dir);
  }, [partsFile, materials, operationIds, filters.sort, filters.dir]);

  const toggleExpand = (id) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // All mutations go through the shared pure helpers (parts.js) and write the
  // whole parts.json through the shared-file layer: optimistic state update +
  // debounced Drive write. The part page uses the same helpers.
  const updatePart = (id, patch) => saveParts(updatePartIn(partsFile, id, patch));
  const updateOperation = (id, patch) => saveParts(updateOperationIn(partsFile, id, patch));
  const deleteOperation = (id) => saveParts(deleteOperationIn(partsFile, id));
  const deletePart = (id) => saveParts(deletePartIn(partsFile, id));

  const onDrop = (e) => {
    const file = [...(e.dataTransfer?.files || [])].find(f => /\.csv$/i.test(f.name));
    e.preventDefault();
    setDragOver(false);
    if (!file || !canEdit) return;
    setDropped(file);
    setUploading(true);
  };

  const totalParts = partsOf(partsFile).length;
  const totalOps = operationsOf(partsFile).length;

  return (
    <div
      className={`pn-page${dragOver ? ' sd-drag' : ''}`}
      onDragOver={e => { if (canEdit) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
    >
      <div className="detail-header mb-16">
        <span className="detail-header-icon"><Package size={22} /></span>
        <div>
          <div className="detail-header-type">
            {isFiltered
              ? `${visibleParts.length} of ${totalParts} parts · ${tableRows.length} of ${totalOps} programs`
              : `${totalParts} parts · ${totalOps} programs`}
          </div>
          <h1 className="detail-header-title">Parts</h1>
        </div>
        <div className="pn-header-right">
          <div className="pn-next">
            <span className="pn-next-label">Next #</span>
            <span className="pn-next-num">{formatProgramNumber(nextNum)}</span>
          </div>
          {canEdit && (
            <>
              <button className="btn btn-secondary" onClick={() => { setDropped(null); setUploading(true); }}>
                <UploadCloud size={15} /> Upload Sequence Detail
              </button>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                <Plus size={15} /> Add program
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="pn-readonly-note">Connect Google Drive to add or edit — this registry is stored in the shop's shared parts.json.</div>
      )}

      <div className="pn-view-tabs">
        <button className={`pn-view-tab${view === 'grouped' ? ' active' : ''}`} onClick={() => setView('grouped')}>
          <LayoutGrid size={13} /> Grouped
        </button>
        <button className={`pn-view-tab${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>
          <Table2 size={13} /> Table
        </button>
      </div>

      {/* One control for both views — see PartsFilterBar. */}
      <PartsFilterBar value={filters} onChange={setFilters} machines={machines} />

      {view === 'grouped' ? (
        <GroupedView
          parts={visibleParts} partsFile={partsFile} materials={materials} machines={machines}
          canEdit={canEdit} customers={customers}
          collapsed={collapsed} onToggle={toggleExpand}
          detailByOperation={detailByOperation}
          visibleOps={operationIds} filtered={isFiltered}
          onOpenPart={(id, opId) => navigate(`/parts/${id}`, opId ? { state: { focusOperationId: opId } } : undefined)}
          onUpdatePart={updatePart} onDeletePart={deletePart}
          onUpdateOperation={updateOperation} onDeleteOperation={deleteOperation}
        />
      ) : (
        <TableView
          rows={tableRows} materials={materials} machines={machines} canEdit={canEdit}
          onOpenPart={(id, opId) => navigate(`/parts/${id}`, opId ? { state: { focusOperationId: opId } } : undefined)}
          onUpdateOperation={updateOperation} onDeleteOperation={deleteOperation}
        />
      )}

      {uploading && (
        <SequenceUploadModal
          presetFile={dropped}
          onClose={() => { setUploading(false); setDropped(null); }}
          onImported={(_stored, _op, _routing, part) => {
            setUploading(false);
            setDropped(null);
            // Straight to the part it belongs to — the reason you uploaded it.
            if (part) navigate(`/parts/${part.id}`);
          }}
        />
      )}

      {showAdd && (
        <AddProgramModal
          onCreated={(_op, _routing, part) => {
            // Make sure the part the new program landed in is open.
            if (part) setCollapsed(prev => { const next = new Set(prev); next.delete(part.id); return next; });
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
