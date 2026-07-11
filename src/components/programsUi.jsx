// Shared presentational pieces + select-state helpers for the Program Number
// Manager, used by ProgramsPage, AddProgramModal, and JobProgramPicker so the
// "add program" UI and the row chrome stay identical everywhere.
import { useState } from 'react';
import { X } from 'lucide-react';
import { FIXTURING_OPTIONS, customerColor, formatProgramNumber } from '../utils/programs.js';
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

export function ProgramNumBadge({ n }) {
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
