import { useState } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  INT_EXT, FIXTURING_OPTIONS, nextProgramNumber, newPart, newProgram,
  partsOf, programsOf, partById, alloyLabel, alloyOptions,
  machineOptions, isPalletMachine, customerNames, formatProgramNumber, formatOperation,
} from '../utils/programs.js';
import {
  CustomerBadge, ProgramNumBadge, FixtureSwitch, SelectWithCustom,
  MaterialSelect, MachineSelect, materialFieldsOf, fixturingValueOf,
} from './programsUi.jsx';
import InfoTip from './InfoTip.jsx';

// The "Add program" modal — search/create a part, then reserve one or more
// operations (each grabs the next program number). Self-contained: reads the
// jobs registry from context and writes through saveJobs, so both the Programs
// page and the Sync-Job program picker render it the same way. `onCreated` (if
// given) fires after each reservation with the new program + its part — the
// picker uses it to auto-select; the Programs page just reflects state.
export default function AddProgramModal({ onClose, onCreated }) {
  const { jobs: jobsFile, saveJobs, materials, shopSettings, user } = useApp();
  const machines = machineOptions(shopSettings);
  const alloys = alloyOptions(materials);
  const customers = customerNames(jobsFile);
  const userName = user?.email || user?.name || '';
  const seedable = programsOf(jobsFile).length === 0;
  const nextNumber = nextProgramNumber(jobsFile);

  const [step, setStep] = useState('search');           // search | new-part | operations
  const [query, setQuery] = useState('');
  const [activePartId, setActivePartId] = useState(null);
  const [sessionAdded, setSessionAdded] = useState([]);
  const [seedNumber, setSeedNumber] = useState(String(nextNumber));

  const [newPartDraft, setNewPartDraft] = useState(null);
  const [opForm, setOpForm] = useState({
    operation: '', description: '',
    machine_id: machines[0]?.id || null, machine_label: machines[0]?.label || '',
    is_fixture: false, internal_external: 'External',
    fixturing: { sel: '', custom: '' },
    material: { sel: '', custom: '' },
    pallet: '1',
  });

  const activePart = partById(jobsFile, activePartId);
  const effectiveNext = seedable && sessionAdded.length === 0
    ? (parseInt(seedNumber, 10) || nextNumber)
    : nextNumber;

  const filtered = query.trim()
    ? partsOf(jobsFile).filter(p => p.part_number.toLowerCase().includes(query.trim().toLowerCase()))
    : partsOf(jobsFile);

  // Writes (optimistic + debounced, via the shared-file layer).
  const addPart = (fields) => {
    const pt = newPart(fields, userName);
    saveJobs({ ...jobsFile, version: 2, parts: [...partsOf(jobsFile), pt] });
    return pt;
  };
  const reserveProgram = (partId, fields) => {
    const prg = newProgram({ ...fields, part_id: partId }, userName);
    saveJobs({ ...jobsFile, version: 2, programs: [...programsOf(jobsFile), prg] });
    return prg;
  };

  const startNewPart = () => {
    setNewPartDraft({ part_number: query.trim(), customer: '', rev: 'A', material: { sel: '', custom: '' } });
    setStep('new-part');
  };

  const confirmNewPart = () => {
    if (!newPartDraft.part_number.trim()) return;
    const pt = addPart({
      part_number: newPartDraft.part_number,
      customer: newPartDraft.customer,
      rev: newPartDraft.rev,
      ...materialFieldsOf(newPartDraft.material),
    });
    setActivePartId(pt.id);
    setStep('operations');
  };

  const reserve = () => {
    if (!opForm.operation.trim() || !opForm.machine_label) return;
    const prg = reserveProgram(activePartId, {
      program_number: effectiveNext,
      operation: opForm.operation,
      description: opForm.description,
      machine_id: opForm.machine_id,
      machine_label: opForm.machine_label,
      is_fixture: opForm.is_fixture,
      internal_external: opForm.is_fixture ? 'Internal' : opForm.internal_external,
      fixturing: fixturingValueOf(opForm.fixturing),
      ...materialFieldsOf(opForm.material),
      pallet: opForm.pallet,
    });
    setSessionAdded(prev => [...prev, {
      program_number: prg.program_number, operation: opForm.operation.trim(),
      machine_label: opForm.machine_label, is_fixture: opForm.is_fixture,
    }]);
    onCreated?.(prg, activePart);
    setOpForm(prev => ({
      ...prev, operation: '', description: '',
      is_fixture: false, internal_external: 'External',
      material: { sel: '', custom: '' },
    }));
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pn-modal">
        <div className="pn-modal-head">
          <h3 className="modal-title" style={{ margin: 0, flex: 1 }}>Add program</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pn-modal-body">
          {step === 'search' && (
            <div className="pn-modal-stack">
              <label className="field-label">Part number</label>
              <div className="pn-search">
                <Search size={14} />
                <input autoFocus className="field-input" value={query} placeholder="Search or type a new part number"
                  onChange={e => setQuery(e.target.value)} />
              </div>
              <div className="pn-part-picklist">
                {filtered.map(p => (
                  <button key={p.id} className="pn-part-pick" onClick={() => { setActivePartId(p.id); setStep('operations'); }}>
                    <span>
                      <span className="pn-part-number">{p.part_number}</span>
                      <span className="text-xs text-sub" style={{ marginLeft: 6 }}>Rev {p.rev}</span>
                    </span>
                    <CustomerBadge customer={p.customer} />
                  </button>
                ))}
                {filtered.length === 0 && <p className="text-sm text-sub" style={{ padding: '6px 2px' }}>No existing parts match.</p>}
              </div>
              {query.trim() && (
                <button className="btn btn-secondary" style={{ width: '100%' }} onClick={startNewPart}>
                  <Plus size={14} /> Create new part “{query.trim()}”
                </button>
              )}
            </div>
          )}

          {step === 'new-part' && (
            <div className="pn-modal-stack">
              <div className="pn-edit-row">
                <div style={{ flex: 1 }}>
                  <label className="field-label">Part number</label>
                  <input className="field-input" value={newPartDraft.part_number}
                    onChange={e => setNewPartDraft({ ...newPartDraft, part_number: e.target.value })} />
                </div>
                <div style={{ width: 70 }}>
                  <label className="field-label">Rev</label>
                  <input className="field-input" value={newPartDraft.rev} maxLength={4}
                    onChange={e => setNewPartDraft({ ...newPartDraft, rev: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="field-label">Customer <span className="text-sub" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input className="field-input" list="pn-customers-modal" value={newPartDraft.customer} placeholder="Start typing…"
                  onChange={e => setNewPartDraft({ ...newPartDraft, customer: e.target.value })} />
                <datalist id="pn-customers-modal">{customers.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className="field-label">
                  Part material <span className="text-sub" style={{ fontWeight: 400 }}>(optional)</span>
                  <InfoTip text="The specific alloy from the Materials library (add new alloys on the Materials page). Applies to every operation on this part, unless that operation makes a fixture." />
                </label>
                <MaterialSelect value={newPartDraft.material}
                  onChange={v => setNewPartDraft({ ...newPartDraft, material: v })} alloys={alloys} />
              </div>
              <div className="pn-edit-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep('search')}>Back</button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={!newPartDraft.part_number.trim()} onClick={confirmNewPart}>
                  Create part &amp; continue
                </button>
              </div>
            </div>
          )}

          {step === 'operations' && activePart && (
            <div className="pn-modal-stack">
              <div className="pn-active-part">
                <span className="pn-part-number">{activePart.part_number}</span>
                <span className="text-xs text-sub">Rev {activePart.rev}</span>
                <CustomerBadge customer={activePart.customer} />
                {(activePart.material_id || activePart.material_custom) && (
                  <span className="text-xs text-sub">{alloyLabel(materials, activePart.material_id, activePart.material_custom)}</span>
                )}
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setStep('search'); setQuery(''); }}>
                  Change part
                </button>
              </div>

              {sessionAdded.length > 0 && (
                <div>
                  <div className="pn-op-label">Reserved this session</div>
                  {sessionAdded.map((s, i) => (
                    <div key={i} className="pn-session-row">
                      <Check size={13} style={{ color: 'var(--green)' }} />
                      <ProgramNumBadge n={s.program_number} />
                      <span className="text-sm">{formatOperation(s.operation)}</span>
                      <span className="text-xs text-sub">· {s.machine_label}</span>
                      {s.is_fixture && <span className="pn-type-pill fixture">Fixture</span>}
                    </div>
                  ))}
                </div>
              )}

              {seedable && sessionAdded.length === 0 && (
                <div>
                  <label className="field-label">
                    First program number
                    <InfoTip text="No programs exist yet, so you can set where the shop-wide counter starts (e.g. continue from the old Google Sheet). After this first one, numbers are always assigned automatically as highest + 1." />
                  </label>
                  <input className="field-input font-mono" style={{ width: 130 }} type="number" value={seedNumber}
                    onChange={e => setSeedNumber(e.target.value)} />
                </div>
              )}

              <div className="pn-edit-row">
                <div style={{ width: 120 }}>
                  <label className="field-label">Operation</label>
                  <input className="field-input" value={opForm.operation} placeholder="OP50"
                    onChange={e => setOpForm({ ...opForm, operation: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Machine</label>
                  <MachineSelect value={opForm.machine_label} machines={machines}
                    onChange={m => setOpForm({ ...opForm, ...m })} />
                </div>
              </div>

              <div>
                <label className="field-label">Description <span className="text-sub" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input className="field-input" value={opForm.description} placeholder="e.g. Full part - tabbed"
                  onChange={e => setOpForm({ ...opForm, description: e.target.value })} />
              </div>

              <div className="pn-edit-row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <FixtureSwitch checked={opForm.is_fixture}
                  onChange={v => setOpForm({ ...opForm, is_fixture: v, internal_external: v ? 'Internal' : 'External' })} />
                {!opForm.is_fixture && (
                  <select className="field-input" style={{ width: 120 }} value={opForm.internal_external}
                    onChange={e => setOpForm({ ...opForm, internal_external: e.target.value })}>
                    {INT_EXT.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
                {isPalletMachine(opForm.machine_label) && (
                  <select className="field-input" style={{ width: 100 }} value={opForm.pallet}
                    onChange={e => setOpForm({ ...opForm, pallet: e.target.value })}>
                    <option value="1">Pallet 1</option>
                    <option value="2">Pallet 2</option>
                  </select>
                )}
              </div>

              <div>
                <label className="field-label">Fixturing</label>
                <SelectWithCustom
                  value={opForm.fixturing}
                  onChange={v => setOpForm({ ...opForm, fixturing: v })}
                  options={FIXTURING_OPTIONS.map(f => ({ value: f, label: f }))}
                  placeholder="— Select fixturing —"
                  customPlaceholder="Describe the fixturing"
                />
              </div>

              {!opForm.is_fixture ? (
                <div className="pn-inherit-note">
                  Material:{' '}
                  <strong>
                    {alloyLabel(materials, activePart.material_id, activePart.material_custom) || 'Not set on this part'}
                  </strong>
                </div>
              ) : (
                <div>
                  <label className="field-label">Fixture material</label>
                  <MaterialSelect value={opForm.material}
                    onChange={v => setOpForm({ ...opForm, material: v })}
                    alloys={alloys} placeholder="— Select fixture material —" />
                </div>
              )}

              <button className="btn btn-primary" style={{ width: '100%' }}
                disabled={!opForm.operation.trim()} onClick={reserve}>
                <Plus size={14} /> Reserve program number {formatProgramNumber(effectiveNext)}
              </button>
            </div>
          )}
        </div>

        <div className="pn-modal-foot">
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onClose}>
            {sessionAdded.length > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
