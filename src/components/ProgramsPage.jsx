import { useMemo, useState } from 'react';
import {
  Plus, X, Check, Search, ChevronDown, ChevronRight, Pencil, Trash2,
  ArrowUp, ArrowDown, ArrowUpDown, LayoutGrid, Table2, Hash,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  INT_EXT, FIXTURING_OPTIONS, nextProgramNumber, formatProgramNumber, formatOperation,
  partsOf, programsOf, programMaterial, alloyLabel,
  machineOptions, isPalletMachine, customerNames,
} from '../utils/programs.js';
import {
  CustomerBadge, TypePill, ProgramNumBadge, FixtureSwitch, SelectWithCustom,
  MaterialSelect, MachineSelect, materialSelOf, materialFieldsOf,
  fixturingSelOf, fixturingValueOf,
} from './programsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';

// Program Number Manager — replaces the manually-managed Google Sheet that
// assigns unique CNC program numbers per part / operation / machine.
// UX ported from docs/ProgramNumberManager.tsx (main branch prototype);
// visuals follow the ToolDex design system. Data lives in jobs.json (v2)
// parts[]/programs[] — see src/utils/programs.js for the model + rules.

// ── Grouped view ──────────────────────────────────────────────────────────────

function PartHeader({ part, programCount, expanded, onToggle, materials, canEdit, customers, onUpdatePart }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  const startEdit = (e) => {
    e.stopPropagation();
    setDraft({
      part_number: part.part_number,
      rev: part.rev,
      customer: part.customer || '',
      material: materialSelOf(part.material_id, part.material_custom),
    });
    setEditing(true);
  };

  const save = () => {
    onUpdatePart(part.id, {
      part_number: draft.part_number.trim() || part.part_number,
      rev: draft.rev.trim() || part.rev,
      customer: draft.customer.trim(),
      ...materialFieldsOf(draft.material),
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="pn-part-edit">
        <div className="pn-edit-row">
          <input className="field-input" style={{ flex: 1 }} value={draft.part_number} placeholder="Part number"
            onChange={e => setDraft({ ...draft, part_number: e.target.value })} />
          <input className="field-input" style={{ width: 64 }} value={draft.rev} maxLength={4} placeholder="Rev"
            onChange={e => setDraft({ ...draft, rev: e.target.value })} />
        </div>
        <input className="field-input" list="pn-customers" value={draft.customer} placeholder="Customer"
          onChange={e => setDraft({ ...draft, customer: e.target.value })} />
        <datalist id="pn-customers">{customers.map(c => <option key={c} value={c} />)}</datalist>
        <MaterialSelect value={draft.material} onChange={v => setDraft({ ...draft, material: v })} materials={materials} />
        <div className="pn-edit-actions">
          <button className="btn btn-primary btn-sm" onClick={save}><Check size={13} /> Save</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}><X size={13} /> Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pn-part-header" onClick={onToggle}>
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <span className="pn-part-number">{part.part_number}</span>
      <span className="text-xs text-sub">Rev {part.rev}</span>
      <CustomerBadge customer={part.customer} />
      {(part.material_id || part.material_custom) && (
        <span className="text-xs text-sub">{alloyLabel(materials, part.material_id, part.material_custom)}</span>
      )}
      <span className="pn-part-count text-xs text-sub">
        {programCount} program{programCount !== 1 ? 's' : ''}
      </span>
      {canEdit && (
        <span className="icon-btn" title="Edit part" onClick={startEdit}><Pencil size={12} /></span>
      )}
    </div>
  );
}

// Draft shape for a program's editable fields (shared by grouped + table edit).
function programDraftOf(program) {
  return {
    operation: program.operation,
    description: program.description || '',
    machine_id: program.machine_id || null,
    machine_label: program.machine_label || '',
    is_fixture: !!program.is_fixture,
    internal_external: program.internal_external || 'External',
    fixturing: fixturingSelOf(program.fixturing),
    material: materialSelOf(program.material_id, program.material_custom),
    pallet: program.pallet || '1',
  };
}

function programFieldsOf(draft, fallback) {
  return {
    operation: draft.operation.trim() || fallback.operation,
    description: draft.description.trim(),
    machine_id: draft.machine_id,
    machine_label: draft.machine_label,
    is_fixture: draft.is_fixture,
    internal_external: draft.is_fixture ? 'Internal' : draft.internal_external,
    fixturing: fixturingValueOf(draft.fixturing),
    ...(draft.is_fixture ? materialFieldsOf(draft.material) : { material_id: null, material_custom: '' }),
    pallet: isPalletMachine(draft.machine_label) ? draft.pallet : '',
  };
}

// The inline edit form for a program (grouped view + table view share it).
function ProgramEditForm({ draft, setDraft, machines, materials, onSave, onCancel }) {
  return (
    <div className="pn-op-edit">
      <div className="pn-edit-row">
        <input className="field-input" style={{ width: 110 }} value={draft.operation} placeholder="Operation"
          onChange={e => setDraft({ ...draft, operation: e.target.value })} />
        <div style={{ flex: 1 }}>
          <MachineSelect value={draft.machine_label} machines={machines}
            onChange={m => setDraft({ ...draft, ...m })} />
        </div>
      </div>
      <input className="field-input" value={draft.description} placeholder="Description (optional)"
        onChange={e => setDraft({ ...draft, description: e.target.value })} />
      <div className="pn-edit-row" style={{ flexWrap: 'wrap' }}>
        <FixtureSwitch checked={draft.is_fixture}
          onChange={v => setDraft({ ...draft, is_fixture: v, internal_external: v ? 'Internal' : 'External' })} />
        {!draft.is_fixture && (
          <select className="field-input" style={{ width: 110 }} value={draft.internal_external}
            onChange={e => setDraft({ ...draft, internal_external: e.target.value })}>
            {INT_EXT.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {isPalletMachine(draft.machine_label) && (
          <select className="field-input" style={{ width: 100 }} value={draft.pallet}
            onChange={e => setDraft({ ...draft, pallet: e.target.value })}>
            <option value="1">Pallet 1</option>
            <option value="2">Pallet 2</option>
          </select>
        )}
      </div>
      <SelectWithCustom
        value={draft.fixturing}
        onChange={v => setDraft({ ...draft, fixturing: v })}
        options={FIXTURING_OPTIONS.map(f => ({ value: f, label: f }))}
        placeholder="— Select fixturing —"
        customPlaceholder="Describe the fixturing"
      />
      {draft.is_fixture && (
        <MaterialSelect value={draft.material} onChange={v => setDraft({ ...draft, material: v })}
          materials={materials} placeholder="— Select fixture material —" />
      )}
      <div className="pn-edit-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave}><Check size={13} /> Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><X size={13} /> Cancel</button>
      </div>
    </div>
  );
}

function OperationRow({ program, part, materials, machines, canEdit, onUpdateProgram, onDeleteProgram }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <ProgramEditForm
        draft={draft} setDraft={setDraft} machines={machines} materials={materials}
        onSave={() => { onUpdateProgram(program.id, programFieldsOf(draft, program)); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const mat = programMaterial(program, part);
  return (
    <div className="pn-op-row">
      <ProgramNumBadge n={program.program_number} />
      <span className="text-sm">{program.machine_label || '—'}</span>
      <TypePill isFixture={program.is_fixture} internalExternal={program.internal_external} />
      {program.pallet && <span className="text-xs text-sub">Pallet {program.pallet}</span>}
      {program.fixturing && <span className="text-xs text-sub">{program.fixturing}</span>}
      {program.is_fixture && (mat.material_id || mat.material_custom) && (
        <span className="text-xs text-sub">Fixture material: {alloyLabel(materials, mat.material_id, mat.material_custom)}</span>
      )}
      {program.description && <span className="text-xs text-sub pn-op-desc">{program.description}</span>}
      {canEdit && (
        confirmDelete ? (
          <span className="pn-op-delete-confirm">
            <span className="text-xs" style={{ color: 'var(--red)' }}>Delete {formatProgramNumber(program.program_number)}?</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onDeleteProgram(program.id)}>Delete</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <>
            <span className="icon-btn pn-op-edit-btn" title="Edit operation" onClick={() => { setDraft(programDraftOf(program)); setEditing(true); }}>
              <Pencil size={12} />
            </span>
            <span className="icon-btn" title="Delete program" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={12} />
            </span>
          </>
        )
      )}
    </div>
  );
}

function GroupedView({ jobsFile, materials, machines, canEdit, customers, expanded, onToggle, onUpdatePart, onUpdateProgram, onDeleteProgram }) {
  const parts = partsOf(jobsFile);
  if (parts.length === 0) {
    return <div className="pn-empty">No parts yet — click <strong>Add program</strong> to create the first one.</div>;
  }
  return (
    <div className="pn-grouped">
      {parts.map(part => {
        const progs = programsOf(jobsFile).filter(p => p.part_id === part.id);
        const isOpen = expanded.has(part.id);
        const byOp = new Map();
        for (const p of progs) {
          if (!byOp.has(p.operation)) byOp.set(p.operation, []);
          byOp.get(p.operation).push(p);
        }
        return (
          <div key={part.id} className="pn-part-card">
            <PartHeader
              part={part} programCount={progs.length} expanded={isOpen}
              onToggle={() => onToggle(part.id)}
              materials={materials} canEdit={canEdit} customers={customers}
              onUpdatePart={onUpdatePart}
            />
            {isOpen && progs.length > 0 && (
              <div className="pn-part-body">
                {[...byOp.entries()].map(([op, ps]) => (
                  <div key={op} className="pn-op-group">
                    <div className="pn-op-label">{formatOperation(op)}</div>
                    {ps.map(p => (
                      <OperationRow key={p.id} program={p} part={part} materials={materials}
                        machines={machines} canEdit={canEdit} onUpdateProgram={onUpdateProgram}
                        onDeleteProgram={onDeleteProgram} />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {isOpen && progs.length === 0 && (
              <div className="pn-part-body"><div className="pn-empty" style={{ padding: '10px 0' }}>No operations yet.</div></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'program_number', label: 'Program #' },
  { key: 'part', label: 'Part' },
  { key: 'customer', label: 'Customer' },
  { key: 'operation', label: 'Operation' },
  { key: 'description', label: 'Description' },
  { key: 'machine', label: 'Machine' },
  { key: 'type', label: 'Type' },
  { key: 'fixturing', label: 'Fixturing' },
  { key: 'material', label: 'Material' },
  { key: 'pallet', label: 'Pallet' },
];

function TableView({ jobsFile, materials, machines, canEdit, customers, onUpdatePart, onUpdateProgram, onDeleteProgram }) {
  const [filterText, setFilterText] = useState('');
  const [filterMachine, setFilterMachine] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [sortKey, setSortKey] = useState('program_number');
  const [sortDir, setSortDir] = useState('desc');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const rows = useMemo(() => {
    const byId = new Map(partsOf(jobsFile).map(p => [p.id, p]));
    let r = programsOf(jobsFile).map(p => {
      const part = byId.get(p.part_id) || null;
      const mat = programMaterial(p, part);
      return { ...p, part, materialLabel: alloyLabel(materials, mat.material_id, mat.material_custom) };
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
        (x.operation || '').toLowerCase().includes(q) ||
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
        case 'machine': return x.machine_label || '';
        case 'type': return x.is_fixture ? 'Fixture' : x.internal_external;
        case 'material': return x.materialLabel;
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
  }, [jobsFile, materials, filterText, filterMachine, filterType, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const startEdit = (row) => {
    setDraft({
      ...programDraftOf(row),
      part_number: row.part?.part_number || '',
      rev: row.part?.rev || '',
      customer: row.part?.customer || '',
      part_material: materialSelOf(row.part?.material_id, row.part?.material_custom),
    });
    setEditingId(row.id);
  };

  const saveRow = (row) => {
    if (row.part) {
      onUpdatePart(row.part.id, {
        part_number: draft.part_number.trim() || row.part.part_number,
        rev: draft.rev.trim() || row.part.rev,
        customer: draft.customer.trim(),
        ...materialFieldsOf(draft.part_material),
      });
    }
    onUpdateProgram(row.id, programFieldsOf(draft, row));
    setEditingId(null);
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
                    <div className="pn-edit-row" style={{ marginBottom: 8 }}>
                      <ProgramNumBadge n={row.program_number} />
                      <input className="field-input" style={{ flex: 1 }} value={draft.part_number} placeholder="Part #"
                        onChange={e => setDraft({ ...draft, part_number: e.target.value })} />
                      <input className="field-input" style={{ width: 60 }} value={draft.rev} maxLength={4} placeholder="Rev"
                        onChange={e => setDraft({ ...draft, rev: e.target.value })} />
                      <input className="field-input" list="pn-customers" style={{ flex: 1 }} value={draft.customer} placeholder="Customer"
                        onChange={e => setDraft({ ...draft, customer: e.target.value })} />
                    </div>
                    {!draft.is_fixture && (
                      <div style={{ marginBottom: 8, maxWidth: 320 }}>
                        <MaterialSelect value={draft.part_material}
                          onChange={v => setDraft({ ...draft, part_material: v })}
                          materials={materials} placeholder="— Part material —" />
                      </div>
                    )}
                    <ProgramEditForm
                      draft={draft} setDraft={setDraft} machines={machines} materials={materials}
                      onSave={() => saveRow(row)} onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : deleteId === row.id ? (
                <tr key={row.id} className="pn-row-editing">
                  <td colSpan={COLUMNS.length + 1}>
                    <div className="flex items-center gap-8">
                      <span className="text-sm" style={{ color: 'var(--red)' }}>
                        Delete program {formatProgramNumber(row.program_number)}? This can't be undone.
                      </span>
                      <button className="btn btn-danger btn-sm" onClick={() => { onDeleteProgram(row.id); setDeleteId(null); }}>Delete</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDeleteId(null)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td>
                    {canEdit && (
                      <span className="flex items-center" style={{ gap: 4 }}>
                        <span className="icon-btn" title="Edit row" onClick={() => startEdit(row)}><Pencil size={12} /></span>
                        <span className="icon-btn" title="Delete row" style={{ color: 'var(--red)' }} onClick={() => setDeleteId(row.id)}><Trash2 size={12} /></span>
                      </span>
                    )}
                  </td>
                  <td><ProgramNumBadge n={row.program_number} /></td>
                  <td>
                    <span className="pn-part-number">{row.part?.part_number || '—'}</span>
                    {row.part && <span className="text-xs text-sub" style={{ marginLeft: 5 }}>Rev {row.part.rev}</span>}
                  </td>
                  <td><CustomerBadge customer={row.part?.customer} /></td>
                  <td>{formatOperation(row.operation)}</td>
                  <td className="text-sub">{row.description || '—'}</td>
                  <td>{row.machine_label || '—'}</td>
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
      <datalist id="pn-customers">{customers.map(c => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const { jobs: jobsFile, saveJobs, materials, shopSettings, user, googleAuthenticated, demoMode } = useApp();
  const canEdit = googleAuthenticated || demoMode;
  const [view, setView] = useState('grouped');
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const machines = machineOptions(shopSettings);
  const customers = customerNames(jobsFile);
  const nextNum = nextProgramNumber(jobsFile);
  const userName = user?.email || user?.name || '';

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // All mutations write the whole jobs.json (v2) through the shared-file layer:
  // optimistic state update + debounced Drive write (demo stays in-memory).
  const updatePart = (id, patch) => {
    saveJobs({
      ...jobsFile, version: 2,
      parts: partsOf(jobsFile).map(p => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  // program_number is deliberately not patchable — permanent once reserved.
  const updateProgram = (id, patch) => {
    const { program_number, ...rest } = patch;
    saveJobs({
      ...jobsFile, version: 2,
      programs: programsOf(jobsFile).map(p => (p.id === id ? { ...p, ...rest } : p)),
    });
  };

  // Deleting a program never renumbers anything else — "next #" is always
  // computed live as max(existing) + 1 (nextProgramNumber), never stored. So
  // removing a non-max entry leaves the max (and "next") untouched; removing
  // the current highest entry naturally recomputes "next" down to reclaim it.
  const deleteProgram = (id) => {
    saveJobs({
      ...jobsFile, version: 2,
      programs: programsOf(jobsFile).filter(p => p.id !== id),
    });
  };

  const totalParts = partsOf(jobsFile).length;
  const totalPrograms = programsOf(jobsFile).length;

  return (
    <div className="pn-page">
      <div className="detail-header mb-16">
        <span className="detail-header-icon"><Hash size={22} /></span>
        <div>
          <div className="detail-header-type">{totalParts} parts · {totalPrograms} programs</div>
          <h1 className="detail-header-title">Program Numbers</h1>
        </div>
        <div className="pn-header-right">
          <div className="pn-next">
            <span className="pn-next-label">Next #</span>
            <span className="pn-next-num">{formatProgramNumber(nextNum)}</span>
          </div>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={15} /> Add program
            </button>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="pn-readonly-note">Connect Google Drive to add or edit programs — this registry is stored in the shop's shared jobs.json.</div>
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
          jobsFile={jobsFile} materials={materials} machines={machines}
          canEdit={canEdit} customers={customers}
          expanded={expanded} onToggle={toggleExpand}
          onUpdatePart={updatePart} onUpdateProgram={updateProgram} onDeleteProgram={deleteProgram}
        />
      ) : (
        <TableView
          jobsFile={jobsFile} materials={materials} machines={machines}
          canEdit={canEdit} customers={customers}
          onUpdatePart={updatePart} onUpdateProgram={updateProgram} onDeleteProgram={deleteProgram}
        />
      )}

      {showAdd && (
        <AddProgramModal
          onCreated={(_prg, part) => { if (part) setExpanded(prev => new Set(prev).add(part.id)); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
