// Shared presentational pieces + select-state helpers for the Program Number
// Manager, used by ProgramsPage, AddProgramModal, and ProgramPicker so the
// "add program" UI and the row chrome stay identical everywhere.
import { useState } from 'react';
import { X, Check, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { INT_EXT, FIXTURING_OPTIONS, PART_SORTS, customerColor, formatProgramNumber, isPalletMachine } from '../utils/parts.js';
import AlloyPicker from './AlloyPicker.jsx';

const tint = (color, alpha) => (color || '#888') + alpha;

export function CustomerBadge({ customer }) {
  const color = customerColor(customer);
  return (
    <span className="customer-badge" style={color ? { '--badge-color': color } : undefined}>
      {customer || 'No customer'}
    </span>
  );
}

export function TypePill({ isFixture, internalExternal }) {
  const cls = isFixture ? 'fixture' : (internalExternal === 'External' ? 'external' : 'internal');
  return <span className={`pn-type-pill ${cls}`}>{isFixture ? 'Fixture' : internalExternal}</span>;
}

// ⚠️ An operation with NO program is normal (inspection, deburr, an outside
// process), so the null case is handled HERE rather than by each caller — a
// caller that forgets renders an empty badge, which reads as a missing value
// instead of a step that legitimately has none.
export function ProgramNumBadge({ n }) {
  if (n == null || n === '') {
    return (
      <span className="text-xs text-sub"
        title="This step has no program — inspection, deburr, an outside process">
        no program
      </span>
    );
  }
  return <span className="program-num-badge">{formatProgramNumber(n)}</span>;
}

// The "Fixture OP?" slider switch — label text is exactly that, per spec.
export function FixtureSwitch({ checked, onChange, compact }) {
  return (
    <label className={`pn-switch${compact ? ' compact' : ''}`}>
      <span>Fixture OP?</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`pn-switch-track${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="pn-switch-knob" />
      </button>
    </label>
  );
}

// Select from a fixed option list with a "Custom…" free-text escape hatch.
// `value` = { sel, custom }: sel is an option value or 'custom' or ''.
export function SelectWithCustom({ value, options, placeholder, customPlaceholder, onChange }) {
  return (
    <div className="pn-selcustom">
      <select
        className="field-input"
        value={value.sel}
        onChange={e => onChange({ ...value, sel: e.target.value })}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {value.sel === 'custom' && (
        <input
          className="field-input"
          value={value.custom}
          placeholder={customPlaceholder}
          onChange={e => onChange({ ...value, custom: e.target.value })}
        />
      )}
    </div>
  );
}

// Material (specific alloy) selection state helpers: { sel, custom } where sel
// is an alloy id, 'custom', or ''.
export const materialSelOf = (material_id, material_custom) =>
  material_id ? { sel: material_id, custom: '' }
    : material_custom ? { sel: 'custom', custom: material_custom }
    : { sel: '', custom: '' };
export const materialFieldsOf = (v) =>
  v.sel === 'custom' ? { material_id: null, material_custom: v.custom.trim() }
    : { material_id: v.sel || null, material_custom: '' };

export const fixturingSelOf = (fixturing) =>
  !fixturing ? { sel: '', custom: '' }
    : FIXTURING_OPTIONS.includes(fixturing) ? { sel: fixturing, custom: '' }
    : { sel: 'custom', custom: fixturing };
export const fixturingValueOf = (v) => (v.sel === 'custom' ? v.custom.trim() : v.sel);

// Material (specific alloy) picker — a field-button that opens AlloyPicker, a
// searchable "mini Materials page" listing alloys as pills of their group color
// (the job/part picks the exact alloy). Custom free text is handled inside the
// picker. Keeps the { sel, custom } value contract so call sites are unchanged
// apart from passing the full `materials` doc instead of a flat alloy list.
export function MaterialSelect({ value, onChange, materials, placeholder = '— Select material —' }) {
  const [open, setOpen] = useState(false);
  const alloys = materials?.materials || [];
  const groups = materials?.groups || [];
  const selAlloy = value.sel && value.sel !== 'custom' ? alloys.find(a => a.id === value.sel) : null;
  const color = selAlloy ? (groups.find(g => g.id === selAlloy.group_id)?.color) : null;
  const isCustom = value.sel === 'custom';
  const hasValue = !!selAlloy || (isCustom && !!value.custom);

  const clear = (e) => { e.stopPropagation(); onChange({ sel: '', custom: '' }); };

  return (
    <>
      <button type="button" className="field-input mat-picker-field" onClick={() => setOpen(true)}>
        {hasValue ? (
          <span className="mat-picker-val">
            {selAlloy ? (
              <span
                className="cam-chip"
                style={color ? { background: tint(color, '22'), color, borderColor: tint(color, '44') } : undefined}
              >{selAlloy.label}</span>
            ) : (
              <span className="mat-picker-custom">{value.custom} <span className="text-sub text-xs">(custom)</span></span>
            )}
          </span>
        ) : (
          <span className="text-sub">{placeholder}</span>
        )}
        {hasValue && <span className="mat-picker-clear" role="button" tabIndex={-1} onClick={clear} title="Clear"><X size={13} /></span>}
      </button>
      {open && (
        <AlloyPicker
          materials={materials}
          currentId={selAlloy?.id || null}
          onSelect={a => { onChange({ sel: a.id, custom: '' }); setOpen(false); }}
          onCustom={txt => { onChange({ sel: 'custom', custom: txt }); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function MachineSelect({ value, machines, onChange }) {
  return (
    <select
      className="field-input"
      value={value}
      onChange={e => {
        const m = machines.find(x => x.label === e.target.value);
        onChange({ machine_id: m?.id || null, machine_label: e.target.value });
      }}
    >
      {machines.map(m => <option key={m.label} value={m.label}>{m.label}</option>)}
    </select>
  );
}

// Draft shape for a program's editable fields — shared by every place a
// program is edited: the Parts page (grouped + table) and the part page.
export function programDraftOf(program) {
  return {
    op_number: program.op_number,
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

export function programFieldsOf(draft, fallback) {
  return {
    op_number: draft.op_number.trim() || fallback.op_number,
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

// The inline edit form for a program. ONE implementation — the Parts page
// (both views) and the part page render this same form, so a field added here
// appears everywhere a program can be edited.
export function ProgramEditForm({ draft, setDraft, machines, materials, onSave, onCancel }) {
  return (
    <div className="pn-op-edit">
      <div className="pn-edit-row">
        <input className="field-input" style={{ width: 110 }} value={draft.op_number} placeholder="OP #"
          onChange={e => setDraft({ ...draft, op_number: e.target.value })} />
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

// The inline edit form for a PART. Same reasoning as ProgramEditForm: the
// Programs page header and the part page both edit a part, and they must not
// drift into two different sets of fields.
export function PartEditForm({ draft, setDraft, materials, customers, onSave, onCancel }) {
  return (
    <div className="pn-part-edit">
      {/* No Rev field: the rev belongs to a ROUTING, not the part — one part
          number is one record so everything about it stays on one page. */}
      <input className="field-input" value={draft.part_number} placeholder="Part number"
        onChange={e => setDraft({ ...draft, part_number: e.target.value })} />
      <input className="field-input" list="pn-customers" value={draft.customer} placeholder="Customer"
        onChange={e => setDraft({ ...draft, customer: e.target.value })} />
      <datalist id="pn-customers">{customers.map(c => <option key={c} value={c} />)}</datalist>
      <MaterialSelect value={draft.material} onChange={v => setDraft({ ...draft, material: v })} materials={materials} />
      <div className="pn-edit-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave}><Check size={13} /> Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><X size={13} /> Cancel</button>
      </div>
    </div>
  );
}

export const partDraftOf = (part) => ({
  part_number: part.part_number,
  customer: part.customer || '',
  material: materialSelOf(part.material_id, part.material_custom),
});

export const partFieldsOf = (draft, fallback) => ({
  part_number: draft.part_number.trim() || fallback.part_number,
  customer: draft.customer.trim(),
  ...materialFieldsOf(draft.material),
});

// A routing's editable fields: what the user calls it and which rev it's for.
export function RoutingEditForm({ draft, setDraft, onSave, onCancel }) {
  return (
    <div className="pn-part-edit">
      <div className="pn-edit-row">
        <input className="field-input" style={{ flex: 1 }} value={draft.name}
          placeholder="Routing name (e.g. Vise, Fixture plate)"
          onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <input className="field-input" style={{ width: 74 }} value={draft.rev} maxLength={6} placeholder="Rev"
          onChange={e => setDraft({ ...draft, rev: e.target.value })} />
      </div>
      <input className="field-input" value={draft.notes} placeholder="Notes (optional)"
        onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      <div className="pn-edit-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave}><Check size={13} /> Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><X size={13} /> Cancel</button>
      </div>
    </div>
  );
}

export const routingDraftOf = (r) => ({ name: r.name || '', rev: r.rev || '', notes: r.notes || '' });
export const routingFieldsOf = (draft) => ({
  name: draft.name.trim(), rev: draft.rev.trim(), notes: draft.notes.trim(),
});

// Destructive actions confirm INLINE rather than through a browser dialog or a
// modal — same pattern as the Settings machine list. Used for deleting a part
// and deleting a program, in both places each can be deleted from.
export function InlineConfirm({ message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <span className="pn-op-delete-confirm" onClick={e => e.stopPropagation()}>
      <span className="text-xs" style={{ color: 'var(--red)' }}>{message}</span>
      <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </span>
  );
}

// The Parts page's search / filter / sort bar. ONE control shared by the
// grouped list and the table — they are two renderings of the same filtered,
// sorted set, so filtering in one view and finding the other disagrees would be
// a bug rather than a feature.
export function PartsFilterBar({ value, onChange, machines }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="pn-table-filters">
      <div className="pn-search">
        <Search size={14} />
        <input
          className="field-input"
          value={value.text}
          placeholder="Program #, part #, customer, material, machine, OP…"
          onChange={e => set({ text: e.target.value })}
        />
        {value.text && (
          <button type="button" className="icon-btn" title="Clear search" onClick={() => set({ text: '' })}>
            <X size={13} />
          </button>
        )}
      </div>

      <select className="field-input" style={{ width: 'auto' }} value={value.machine}
        onChange={e => set({ machine: e.target.value })}>
        <option>All</option>
        {machines.map(m => <option key={m.label}>{m.label}</option>)}
      </select>

      <select className="field-input" style={{ width: 'auto' }} value={value.type}
        onChange={e => set({ type: e.target.value })}>
        <option>All</option>
        {INT_EXT.map(v => <option key={v}>{v}</option>)}
        <option>Fixture</option>
      </select>

      <div className="pn-sort">
        <span className="text-xs text-sub">Sort</span>
        <select className="field-input" style={{ width: 'auto' }} value={value.sort}
          onChange={e => set({ sort: e.target.value })}>
          {PART_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button
          type="button"
          className="icon-btn"
          title={value.dir === 'desc' ? 'Newest / highest first' : 'Oldest / lowest first'}
          onClick={() => set({ dir: value.dir === 'desc' ? 'asc' : 'desc' })}
        >
          {value.dir === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
        </button>
      </div>
    </div>
  );
}

// Newest first by what was touched last — the thing you were working on is the
// thing you want at the top.
export const DEFAULT_PARTS_FILTERS = { text: '', machine: 'All', type: 'All', sort: 'activity', dir: 'desc' };
