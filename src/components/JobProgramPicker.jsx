import { useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { searchPrograms, partById, alloyLabel, formatOperation, machineOptions } from '../utils/programs.js';
import { CustomerBadge, ProgramNumBadge, TypePill } from './programsUi.jsx';
import AddProgramModal from './AddProgramModal.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';

// The one shared control for linking to a program record (Program Number
// Manager). Type a PROGRAM NUMBER (exact) or PART NUMBER (contains) → matching
// programs, each with full context (part/rev/op/machine/customer); pick one and
// `onPick(selection)` fires. "Add new program" opens the same AddProgramModal
// used on the Programs page and auto-picks what you create. Purely a picker —
// it holds no selection; consumers decide what to do with each pick (link to a
// preset, a tool, or a sync commit). selection shape:
//   { program_id, program_number, part_id, part_number, operation }
export default function JobProgramPicker({ onPick, placeholder = 'Program # (exact) or part # (contains)', autoFocus = false }) {
  const { jobs: jobsFile, materials, shopSettings } = useApp();
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const machines = machineOptions(shopSettings);

  const results = useMemo(() => searchPrograms(jobsFile, query), [jobsFile, query]);

  const pick = (program, part) => {
    onPick({
      program_id: program.id,
      program_number: program.program_number,
      part_id: part?.id || program.part_id || null,
      part_number: part?.part_number || '',
      operation: program.operation || '',
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
        <div className="job-pick-results">
          {results.length === 0 && (
            <div className="text-xs text-sub" style={{ padding: '6px 2px' }}>
              No matching program. Use “Add new program” to create one.
            </div>
          )}
          {results.map(({ program, part }) => (
            <button key={program.id} type="button" className="job-pick-row" onClick={() => pick(program, part)}>
              <ProgramNumBadge n={program.program_number} />
              <span className="pn-part-number">{part?.part_number || '—'}</span>
              {part && <span className="text-xs text-sub">Rev {part.rev}</span>}
              <span className="text-xs text-sub">· {formatOperation(program.operation) || '—'}</span>
              <TypePill isFixture={program.is_fixture} internalExternal={program.internal_external} />
              <MachinePill label={program.machine_label} color={machineColorFor(program.machine_id, program.machine_label, machines)} />
              {program.is_fixture && (program.material_id || program.material_custom) && (
                <span className="text-xs text-sub">{alloyLabel(materials, program.material_id, program.material_custom)}</span>
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
          onCreated={(program, part) => { pick(program, part); setShowAdd(false); }}
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
  const { jobs: jobsFile } = useApp();
  const part = value.part_id ? partById(jobsFile, value.part_id) : null;
  return (
    <div className="job-pick-selected">
      <ProgramNumBadge n={value.program_number} />
      <span className="pn-part-number">{value.part_number || '—'}</span>
      {part && <span className="text-xs text-sub">Rev {part.rev}</span>}
      {value.operation && <span className="text-xs text-sub">· {formatOperation(value.operation)}</span>}
      {part && <CustomerBadge customer={part.customer} />}
      {onClear && (
        <button type="button" className="icon-btn" title="Clear job link" style={{ marginLeft: 'auto' }} onClick={onClear}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
