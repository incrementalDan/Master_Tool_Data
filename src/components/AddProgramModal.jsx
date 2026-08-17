import { useState } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  INT_EXT, FIXTURING_OPTIONS, nextProgramNumber,
  addPartWithRoutingIn, addRoutingIn, addOperationIn,
  partsOf, operationsOf, partById, routingById, routingsForPart,
  routingLabel, alloyLabel,
  machineOptions, isPalletMachine, customerNames, formatProgramNumber, formatOperation,
} from '../utils/parts.js';
import {
  CustomerBadge, ProgramNumBadge, FixtureSwitch, SelectWithCustom,
  MaterialSelect, MachineSelect, materialFieldsOf, fixturingValueOf,
} from './programsUi.jsx';
import InfoTip from './InfoTip.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';

// The "Add program" modal — find or create a part, land on one of its routings,
// then reserve one or more operations (each grabs the next program number).
// Self-contained: reads parts.json from context and writes through saveParts,
// so the Parts page, the part page and the program picker all render it the
// same way. `onCreated` fires after each reservation with the new operation +
// its routing and part — the picker uses it to auto-select.
//
// `partId` / `routingId` open it already scoped, skipping the steps above and
// hiding "Change part": from a part's own page, adding to a DIFFERENT part is
// never what was meant.
//
// A part with exactly one routing skips the routing step entirely — the common
// case shouldn't cost a click for a choice that isn't one.
export default function AddProgramModal({ onClose, onCreated, partId = null, routingId = null }) {
  const { parts: partsFile, saveParts, materials, shopSettings, user } = useApp();
  const machines = machineOptions(shopSettings);
  const customers = customerNames(partsFile);
  const userName = user?.email || user?.name || '';
  const seedable = operationsOf(partsFile).length === 0;
  const nextNumber = nextProgramNumber(partsFile);

  // search | new-part | routing | operations
  const [step, setStep] = useState(() => {
    if (routingId) return 'operations';
    if (partId) return routingsForPart(partsFile, partId).length === 1 ? 'operations' : 'routing';
    return 'search';
  });
  const [query, setQuery] = useState('');
  const [activePartId, setActivePartId] = useState(partId);
  const [activeRoutingId, setActiveRoutingId] = useState(
    routingId || (partId && routingsForPart(partsFile, partId).length === 1
      ? routingsForPart(partsFile, partId)[0].id : null));
  const [newRoutingDraft, setNewRoutingDraft] = useState({ name: '', rev: '' });
  const [sessionAdded, setSessionAdded] = useState([]);
  const [seedNumber, setSeedNumber] = useState(String(nextNumber));

  const [newPartDraft, setNewPartDraft] = useState(null);
  const [opForm, setOpForm] = useState({
    op_number: '', description: '',
    machine_id: machines[0]?.id || null, machine_label: machines[0]?.label || '',
    is_fixture: false, internal_external: 'External',
    fixturing: { sel: '', custom: '' },
    material: { sel: '', custom: '' },
    pallet: '1',
  });

  const activePart = partById(partsFile, activePartId);
  const activeRouting = routingById(partsFile, activeRoutingId);
  const partRoutings = activePartId ? routingsForPart(partsFile, activePartId) : [];
  const effectiveNext = seedable && sessionAdded.length === 0
    ? (parseInt(seedNumber, 10) || nextNumber)
    : nextNumber;

  const filtered = query.trim()
    ? partsOf(partsFile).filter(p => p.part_number.toLowerCase().includes(query.trim().toLowerCase()))
    : partsOf(partsFile);

  // Writes (optimistic + debounced, via the shared-file layer).
  //
  // ⚠️ ONE saveParts PER HANDLER. Each of these builds from `partsFile`, which
  // does not change mid-handler — so two writes in one action would both start
  // from the pre-update file and the second would discard the first. Creating a
  // part and its first routing is therefore a single composed step
  // (addPartWithRoutingIn), not two calls.
  const addRouting = (forPartId, fields) => {
    const { file, routing } = addRoutingIn(partsFile, forPartId, fields, userName);
    saveParts(file);
    return routing;
  };
  const reserveOperation = (forRoutingId, fields) => {
    const { file, operation } = addOperationIn(partsFile, forRoutingId, fields, userName);
    saveParts(file);
    return operation;
  };

  const choosePart = (id) => {
    setActivePartId(id);
    const rts = routingsForPart(partsFile, id);
    if (rts.length === 1) { setActiveRoutingId(rts[0].id); setStep('operations'); }
    else { setActiveRoutingId(null); setStep('routing'); }
  };

  const startNewPart = () => {
    setNewPartDraft({ part_number: query.trim(), customer: '', rev: 'A', material: { sel: '', custom: '' } });
    setStep('new-part');
  };

  const confirmNewPart = () => {
    if (!newPartDraft.part_number.trim()) return;
    // The part and its first routing land together in ONE write — see above.
    // The routing takes the rev typed on the part form, so the common path is
    // still a single flow.
    const { file, part, routing } = addPartWithRoutingIn(
      partsFile,
      {
        part_number: newPartDraft.part_number,
        customer: newPartDraft.customer,
        ...materialFieldsOf(newPartDraft.material),
      },
      { rev: newPartDraft.rev, name: '' },
      userName,
    );
    saveParts(file);
    setActivePartId(part.id);
    setActiveRoutingId(routing.id);
    setStep('operations');
  };

  const confirmNewRouting = () => {
    const rt = addRouting(activePartId, { name: newRoutingDraft.name, rev: newRoutingDraft.rev });
    setActiveRoutingId(rt.id);
    setNewRoutingDraft({ name: '', rev: '' });
    setStep('operations');
  };

  const reserve = () => {
    if (!opForm.op_number.trim() || !opForm.machine_label) return;
    const prg = reserveOperation(activeRoutingId, {
      program_number: effectiveNext,
      op_number: opForm.op_number,
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
      program_number: prg.program_number, operation: opForm.op_number.trim(),
      machine_id: opForm.machine_id, machine_label: opForm.machine_label, is_fixture: opForm.is_fixture,
    }]);
    onCreated?.(prg, activeRouting, activePart);
    setOpForm(prev => ({
      ...prev, op_number: '', description: '',
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
                  <button key={p.id} className="pn-part-pick" onClick={() => choosePart(p.id)}>
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
                  onChange={v => setNewPartDraft({ ...newPartDraft, material: v })} materials={materials} />
              </div>
              <div className="pn-edit-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setStep('search')}>Back</button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={!newPartDraft.part_number.trim()} onClick={confirmNewPart}>
                  Create part &amp; continue
                </button>
              </div>
            </div>
          )}

          {step === 'routing' && activePart && (
            <div className="pn-modal-stack">
              <div className="pn-active-part">
                <span className="pn-part-number">{activePart.part_number}</span>
                <CustomerBadge customer={activePart.customer} />
                {!partId && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { setStep('search'); setQuery(''); }}>
                    Change part
                  </button>
                )}
              </div>
              <label className="field-label">
                Which routing?
                <InfoTip text="A routing is one way of making this part — a combination of operations with its own fixturing, machine or process revision. A part can have more than one." />
              </label>
              <div className="pn-part-picklist">
                {partRoutings.map((r, i) => (
                  <button key={r.id} className="pn-part-pick"
                    onClick={() => { setActiveRoutingId(r.id); setStep('operations'); }}>
                    <span>{routingLabel(r, i)}</span>
                    <span className="text-xs text-sub">
                      {operationsOf(partsFile).filter(o => o.routing_id === r.id).length} operations
                    </span>
                  </button>
                ))}
                {partRoutings.length === 0 && (
                  <p className="text-sm text-sub" style={{ padding: '6px 2px' }}>
                    This part has no routing yet — add its first one.
                  </p>
                )}
              </div>
              <div className="pn-edit-row">
                <input className="field-input" style={{ flex: 1 }} value={newRoutingDraft.name}
                  placeholder="New routing name (e.g. Vise, Fixture plate)"
                  onChange={e => setNewRoutingDraft({ ...newRoutingDraft, name: e.target.value })} />
                <input className="field-input" style={{ width: 74 }} value={newRoutingDraft.rev} maxLength={6}
                  placeholder="Rev"
                  onChange={e => setNewRoutingDraft({ ...newRoutingDraft, rev: e.target.value })} />
                <button className="btn btn-secondary btn-sm" onClick={confirmNewRouting}
                  disabled={!newRoutingDraft.name.trim() && !newRoutingDraft.rev.trim()}>
                  <Plus size={13} /> Add
                </button>
              </div>
            </div>
          )}

          {step === 'operations' && activePart && activeRouting && (
            <div className="pn-modal-stack">
              <div className="pn-active-part">
                <span className="pn-part-number">{activePart.part_number}</span>
                <span className="text-xs text-sub">{routingLabel(activeRouting)}</span>
                <CustomerBadge customer={activePart.customer} />
                {(activePart.material_id || activePart.material_custom) && (
                  <span className="text-xs text-sub">{alloyLabel(materials, activePart.material_id, activePart.material_custom)}</span>
                )}
                {!partId && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => { setStep('search'); setQuery(''); }}>
                    Change part
                  </button>
                )}
              </div>

              {sessionAdded.length > 0 && (
                <div>
                  <div className="pn-op-label">Reserved this session</div>
                  {sessionAdded.map((s, i) => (
                    <div key={i} className="pn-session-row">
                      <Check size={13} style={{ color: 'var(--green)' }} />
                      <ProgramNumBadge n={s.program_number} />
                      <span className="text-sm">{formatOperation(s.operation)}</span>
                      <MachinePill label={s.machine_label} color={machineColorFor(s.machine_id, s.machine_label, machines)} />
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
                  <input className="field-input" value={opForm.op_number} placeholder="OP50"
                    onChange={e => setOpForm({ ...opForm, op_number: e.target.value })} />
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
                    materials={materials} placeholder="— Select fixture material —" />
                </div>
              )}

              <button className="btn btn-primary" style={{ width: '100%' }}
                disabled={!opForm.op_number.trim()} onClick={reserve}>
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
