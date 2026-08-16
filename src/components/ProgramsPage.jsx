import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, ChevronDown, ChevronRight, Pencil, Trash2,
  ArrowUp, ArrowDown, ArrowUpDown, LayoutGrid, Table2, Hash, UploadCloud, ExternalLink, Wrench,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  nextProgramNumber, formatProgramNumber, formatOperation, routingLabel,
  partsOf, operationsOf, routingsOf, routingsForPart, operationsForRouting, operationsForPart,
  operationMaterial, alloyLabel, machineOptions, customerNames,
  updatePartIn, updateOperationIn, deleteOperationIn, deletePartIn,
} from '../utils/parts.js';
import {
  CustomerBadge, TypePill, ProgramNumBadge,
  ProgramEditForm, PartEditForm, InlineConfirm,
  programDraftOf, programFieldsOf, partDraftOf, partFieldsOf,
} from './programsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';
import SequenceUploadModal from './SequenceUploadModal.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';
import { detailsOf } from '../utils/sequenceImport.js';

// The PROGRAM NUMBER registry — every number the shop has assigned, grouped by
// part and routing. It replaces the manually-managed Google Sheet.
//
// This is one VIEW of the parts module, not the container: the part page
// (/programs/part/:id) is where a part's work actually lives. See utils/parts.js
// for the model — Part → Routing → Operation, with the program number on the
// operation.

// ── Grouped view ─────────────────────────────────────────────────────────────

function OperationRow({ operation, part, materials, machines, canEdit, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <ProgramEditForm
        draft={draft} setDraft={setDraft} machines={machines} materials={materials}
        onSave={() => { onUpdate(operation.id, programFieldsOf(draft, operation)); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const mat = operationMaterial(operation, part);
  return (
    <div className="pn-op-row">
      {operation.program_number != null
        ? <ProgramNumBadge n={operation.program_number} />
        : <span className="text-xs text-sub" title="This step has no program — inspection, deburr, an outside process">no program</span>}
      <span className="sd-op-label">{formatOperation(operation.op_number)}</span>
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
          <InlineConfirm
            message={`Delete ${operation.program_number != null ? formatProgramNumber(operation.program_number) : formatOperation(operation.op_number)}?`}
            onConfirm={() => onDelete(operation.id)}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <>
            <span className="icon-btn pn-op-edit-btn" title="Edit operation"
              onClick={() => { setDraft(programDraftOf(operation)); setEditing(true); }}>
              <Pencil size={12} />
            </span>
            <span className="icon-btn" title="Delete operation" style={{ color: 'var(--red)' }}
              onClick={() => setConfirmDelete(true)}>
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

  return (
    <div className="pn-part-header" onClick={onToggle}>
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <span className="pn-part-number">{part.part_number}</span>
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

function GroupedView({ partsFile, materials, machines, canEdit, customers, collapsed, detailByOperation, onToggle, onOpenPart, onUpdatePart, onDeletePart, onUpdateOperation, onDeleteOperation }) {
  const parts = partsOf(partsFile);
  if (parts.length === 0) {
    return <div className="pn-empty">No parts yet — click <strong>Add program</strong> to create the first one.</div>;
  }
  return (
    <div className="pn-grouped">
      {parts.map(part => {
        const routings = routingsForPart(partsFile, part.id);
        const allOps = operationsForPart(partsFile, part.id);
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
              <div className="pn-part-body">
                {routings.map((routing, i) => {
                  const ops = operationsForRouting(partsFile, routing.id);
                  return (
                    <div key={routing.id} className="pn-op-group">
                      <div className="pn-op-label">{routingLabel(routing, i)}</div>
                      {ops.map(op => (
                        <OperationRow key={op.id} operation={op} part={part} materials={materials}
                          machines={machines} canEdit={canEdit}
                          onUpdate={onUpdateOperation} onDelete={onDeleteOperation} />
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

function TableView({ partsFile, materials, machines, canEdit, onUpdateOperation, onDeleteOperation }) {
  const [filterText, setFilterText] = useState('');
  const [filterMachine, setFilterMachine] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [sortKey, setSortKey] = useState('program_number');
  const [sortDir, setSortDir] = useState('desc');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const rows = useMemo(() => {
    const partById = new Map(partsOf(partsFile).map(p => [p.id, p]));
    const routingById = new Map(routingsOf(partsFile).map(r => [r.id, r]));
    let r = operationsOf(partsFile).map(op => {
      const routing = routingById.get(op.routing_id) || null;
      const part = routing ? partById.get(routing.part_id) || null : null;
      const mat = operationMaterial(op, part);
      return { ...op, part, routing, materialLabel: alloyLabel(materials, mat.material_id, mat.material_custom) };
    });
    if (filterMachine !== 'All') r = r.filter(x => x.machine_label === filterMachine);
    if (filterType !== 'All') {
      r = r.filter(x => (filterType === 'Fixture' ? x.is_fixture : (!x.is_fixture && x.internal_external === filterType)));
    }
    const q = filterText.trim().toLowerCase();
    if (q) {
      r = r.filter(x =>
        formatProgramNumber(x.program_number).toLowerCase().includes(q) ||
        (x.part?.part_number || '').toLowerCase().includes(q) ||
        (x.part?.customer || '').toLowerCase().includes(q) ||
        (x.routing ? routingLabel(x.routing).toLowerCase().includes(q) : false) ||
        (x.op_number || '').toLowerCase().includes(q) ||
        (x.description || '').toLowerCase().includes(q) ||
        (x.fixturing || '').toLowerCase().includes(q) ||
        (x.machine_label || '').toLowerCase().includes(q) ||
        x.materialLabel.toLowerCase().includes(q)
      );
    }
    const val = (x) => {
      switch (sortKey) {
        case 'part': return x.part?.part_number || '';
        case 'customer': return x.part?.customer || '';
        case 'routing': return x.routing ? routingLabel(x.routing) : '';
        case 'machine': return x.machine_label || '';
        case 'type': return x.is_fixture ? 'Fixture' : x.internal_external;
        case 'material': return x.materialLabel;
        case 'program_number': return Number(x.program_number ?? -1);
        default: return x[sortKey] ?? '';
      }
    };
    r.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return r;
  }, [partsFile, materials, filterText, filterMachine, filterType, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  return (
    <div>
      <div className="pn-table-filters">
        <div className="pn-search">
          <Search size={14} />
          <input className="field-input" value={filterText} placeholder="Search programs…"
            onChange={e => setFilterText(e.target.value)} />
        </div>
        <select className="field-input" style={{ width: 'auto' }} value={filterMachine} onChange={e => setFilterMachine(e.target.value)}>
          <option>All</option>
          {machines.map(m => <option key={m.label}>{m.label}</option>)}
        </select>
        <select className="field-input" style={{ width: 'auto' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option>All</option>
          <option>External</option>
          <option>Internal</option>
          <option>Fixture</option>
        </select>
      </div>

      <div className="pn-table-wrap">
        <table className="pn-table">
          <thead>
            <tr>
              <th style={{ width: 56 }} />
              {COLUMNS.map(col => (
                <th key={col.key} onClick={() => onSort(col.key)}>
                  <span>
                    {col.label}
                    {sortKey === col.key
                      ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                      : <ArrowUpDown size={11} className="pn-sort-idle" />}
                  </span>
                </th>
              ))}
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
                <tr key={row.id}>
                  <td>
                    {canEdit && (
                      <span className="flex items-center" style={{ gap: 4 }}>
                        <span className="icon-btn" title="Edit row"
                          onClick={() => { setDraft(programDraftOf(row)); setEditingId(row.id); }}>
                          <Pencil size={12} />
                        </span>
                        <span className="icon-btn" title="Delete row" style={{ color: 'var(--red)' }}
                          onClick={() => setDeleteId(row.id)}><Trash2 size={12} /></span>
                      </span>
                    )}
                  </td>
                  <td>{row.program_number != null ? <ProgramNumBadge n={row.program_number} /> : <span className="text-sub">—</span>}</td>
                  <td><span className="pn-part-number">{row.part?.part_number || '—'}</span></td>
                  <td><CustomerBadge customer={row.part?.customer} /></td>
                  <td className="text-sub">{row.routing ? routingLabel(row.routing) : '—'}</td>
                  <td>{formatOperation(row.op_number)}</td>
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
              <tr><td colSpan={COLUMNS.length + 1} className="pn-empty">No programs match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const { parts: partsFile, saveParts, materials, shopSettings, programDetails, googleAuthenticated, demoMode } = useApp();
  const navigate = useNavigate();
  const canEdit = googleAuthenticated || demoMode;
  const [view, setView] = useState('grouped');
  const [showAdd, setShowAdd] = useState(false);
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
        <span className="detail-header-icon"><Hash size={22} /></span>
        <div>
          <div className="detail-header-type">{totalParts} parts · {totalOps} programs</div>
          <h1 className="detail-header-title">Program Numbers</h1>
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
        <div className="pn-readonly-note">Connect Google Drive to add or edit programs — this registry is stored in the shop's shared parts.json.</div>
      )}

      <div className="pn-view-tabs">
        <button className={`pn-view-tab${view === 'grouped' ? ' active' : ''}`} onClick={() => setView('grouped')}>
          <LayoutGrid size={13} /> Grouped
        </button>
        <button className={`pn-view-tab${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>
          <Table2 size={13} /> Table
        </button>
      </div>

      {view === 'grouped' ? (
        <GroupedView
          partsFile={partsFile} materials={materials} machines={machines}
          canEdit={canEdit} customers={customers}
          collapsed={collapsed} onToggle={toggleExpand}
          detailByOperation={detailByOperation}
          onOpenPart={(id) => navigate(`/programs/part/${id}`)}
          onUpdatePart={updatePart} onDeletePart={deletePart}
          onUpdateOperation={updateOperation} onDeleteOperation={deleteOperation}
        />
      ) : (
        <TableView
          partsFile={partsFile} materials={materials} machines={machines} canEdit={canEdit}
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
            if (part) navigate(`/programs/part/${part.id}`);
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
