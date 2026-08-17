import { useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { searchPrograms, partById, routingById, routingLabel, alloyLabel, formatOperation, machineOptions } from '../utils/parts.js';
import { CustomerBadge, ProgramNumBadge, TypePill } from './partsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';

// The one shared control for linking to a program. Type a PROGRAM NUMBER
// (exact) or PART NUMBER (contains) → matching operations, each with full
// context (part / routing / OP / machine / customer); pick one and
// `onPick(selection)` fires. "Add new program" opens the same AddProgramModal
// used on the Parts page and auto-picks what you create. Purely a picker —
// consumers decide what to do with each pick.
//
// ⚠️ A program IS an operation: the number lives on the operation record, so
// `operation_id` is the durable link and everything else in the selection is
// context resolved off it.
//   { operation_id, program_number, part_id, part_number, op_number, routing_id }
export default function ProgramPicker({ onPick, placeholder = 'Program # (exact) or part # (contains)', autoFocus = false }) {
  const { parts: partsFile, materials, shopSettings } = useApp();
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const machines = machineOptions(shopSettings);

  const results = useMemo(() => searchPrograms(partsFile, query), [partsFile, query]);

  const pick = (operation, routing, part) => {
    onPick({
      operation_id: operation.id,
      program_number: operation.program_number,
      part_id: part?.id || null,
      part_number: part?.part_number || '',
      op_number: operation.op_number || '',
      routing_id: routing?.id || null,
    });
    setQuery('');
  };

  return (
    <div>
      <div className="pn-search">
        <Search size={14} />
        <input
          className="field-input"
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {query.trim() && (
        <div className="pick-results">
          {results.length === 0 && (
            <div className="text-xs text-sub" style={{ padding: '6px 2px' }}>
              No matching program. Use “Add new program” to create one.
            </div>
          )}
          {results.map(({ operation, routing, part }) => (
            <button key={operation.id} type="button" className="pick-row" onClick={() => pick(operation, routing, part)}>
              <ProgramNumBadge n={operation.program_number} />
              <span className="pn-part-number">{part?.part_number || '—'}</span>
              {routing && <span className="text-xs text-sub">{routingLabel(routing)}</span>}
              <span className="text-xs text-sub">· {formatOperation(operation.op_number) || '—'}</span>
              <TypePill isFixture={operation.is_fixture} internalExternal={operation.internal_external} />
              <MachinePill label={operation.machine_label} color={machineColorFor(operation.machine_id, operation.machine_label, machines)} />
              {operation.is_fixture && (operation.material_id || operation.material_custom) && (
                <span className="text-xs text-sub">{alloyLabel(materials, operation.material_id, operation.material_custom)}</span>
              )}
              {part && <span style={{ marginLeft: 'auto' }}><CustomerBadge customer={part.customer} /></span>}
            </button>
          ))}
        </div>
      )}

      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAdd(true)}>
        <Plus size={13} /> Add new program
      </button>

      {showAdd && (
        <AddProgramModal
          onCreated={(operation, routing, part) => { pick(operation, routing, part); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// Compact summary of a chosen program (used where a single selection is held,
// e.g. the Sync-Job commit step). `value` is a selection object; `onClear`
// drops it.
export function SelectedProgramChip({ value, onClear }) {
  const { parts: partsFile } = useApp();
  const part = value.part_id ? partById(partsFile, value.part_id) : null;
  const routing = value.routing_id ? routingById(partsFile, value.routing_id) : null;
  return (
    <div className="pick-selected">
      <ProgramNumBadge n={value.program_number} />
      <span className="pn-part-number">{value.part_number || '—'}</span>
      {routing && <span className="text-xs text-sub">{routingLabel(routing)}</span>}
      {value.op_number && <span className="text-xs text-sub">· {formatOperation(value.op_number)}</span>}
      {part && <CustomerBadge customer={part.customer} />}
      {onClear && (
        <button type="button" className="icon-btn" title="Clear program link" style={{ marginLeft: 'auto' }} onClick={onClear}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
