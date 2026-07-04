import { useMemo, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { searchPrograms, partById, alloyLabel } from '../../utils/programs.js';
import { CustomerBadge, ProgramNumBadge, TypePill } from '../programsUi.jsx';
import AddProgramModal from '../AddProgramModal.jsx';

// Connects a Sync-Job commit to a real program record. Type a PROGRAM NUMBER
// (exact) or PART NUMBER (contains) → matching programs list, each showing the
// full context (part, op, machine, description). Selecting one links the commit
// to that program; "Add new" opens the same Add-program flow as the Programs
// page and auto-selects what you create. `value` = the selected program-link
// object (or null); `onChange(value)` reports the selection up.
export default function JobProgramPicker({ value, onChange }) {
  const { jobs: jobsFile, materials } = useApp();
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const results = useMemo(() => searchPrograms(jobsFile, query), [jobsFile, query]);

  const selectProgram = (program, part) => {
    onChange({
      program_id: program.id,
      program_number: program.program_number,
      part_id: part?.id || program.part_id || null,
      part_number: part?.part_number || '',
      operation: program.operation || '',
    });
    setQuery('');
  };

  // A selection is shown as a compact summary card with a clear button.
  if (value) {
    const part = value.part_id ? partById(jobsFile, value.part_id) : null;
    return (
      <div className="job-pick-selected">
        <ProgramNumBadge n={value.program_number} />
        <span className="pn-part-number">{value.part_number || '—'}</span>
        {part && <span className="text-xs text-sub">Rev {part.rev}</span>}
        {value.operation && <span className="text-xs text-sub">· {value.operation}</span>}
        {part && <CustomerBadge customer={part.customer} />}
        <button type="button" className="icon-btn" title="Clear job link" style={{ marginLeft: 'auto' }} onClick={() => onChange(null)}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="pn-search">
        <Search size={14} />
        <input
          className="field-input"
          value={query}
          placeholder="Program # (exact) or part # (contains)"
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
            <button key={program.id} type="button" className="job-pick-row" onClick={() => selectProgram(program, part)}>
              <ProgramNumBadge n={program.program_number} />
              <span className="pn-part-number">{part?.part_number || '—'}</span>
              {part && <span className="text-xs text-sub">Rev {part.rev}</span>}
              <span className="text-xs text-sub">· {program.operation || '—'}</span>
              <TypePill isFixture={program.is_fixture} internalExternal={program.internal_external} />
              <span className="text-xs text-sub">{program.machine_label}</span>
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
          onCreated={(program, part) => { selectProgram(program, part); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
