import React, { useState, useMemo } from 'react';
import {
  Plus, X, Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown,
  ArrowUpDown, Trash2, Check, LayoutGrid, Table2, SlidersHorizontal
} from 'lucide-react';

const MACHINES_DEFAULT = ['Brother M300X3', 'Brother R650'];
const INT_EXT = ['External', 'Internal'];

const SEED_FIXTURES = [
  { id: 'fx1', number: 'FX-125L-FWD', description: '125mm Lang Vise Forward' },
  { id: 'fx2', number: 'FX-77L-SJ', description: '77mm Lang Vise with Soft Jaw' },
  { id: 'fx3', number: 'FX-125L-REV', description: '125mm Lang Vise Reverse' },
  { id: 'fx4', number: 'FX-VICE-STD', description: 'Standard Machine Vise' },
];

const SEED_MATERIALS = [
  'Aluminum 6061', 'Aluminum 7075', 'Stainless 304', 'Stainless 316L',
  'Aluminum Bronze (ASTM B169)', 'Steel 4140', 'Titanium 6Al-4V',
  'Delrin / Acetal', 'Brass 360',
];

const SEED_PARTS = [
  { id: 'pt1', partNumber: 'CAD1-114P4344-1', customer: 'Cadrex', rev: 'A', material: 'Aluminum 6061' },
  { id: 'pt2', partNumber: 'CAD1-114P4344-4', customer: 'Cadrex', rev: 'A', material: 'Aluminum 6061' },
  { id: 'pt3', partNumber: 'CAD1-114P4344-3', customer: 'Cadrex', rev: 'A', material: 'Aluminum 6061' },
  { id: 'pt4', partNumber: 'GSE1-08D1404', customer: 'GS Enterprises', rev: 'A', material: 'Stainless 304' },
  { id: 'pt5', partNumber: 'DEV1-4102AS7712', customer: 'Deval Life Cycle', rev: 'B', material: 'Stainless 316L' },
];

const SEED_PROGRAMS = [
  { id: 'prg1', programNumber: 1108, partId: 'pt1', operation: 'OP50', description: 'Full part - tabbed', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '125mm Lang Vise Forward', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg2', programNumber: 1109, partId: 'pt2', operation: 'OP50', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '125mm Lang Vise Forward', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg3', programNumber: 1110, partId: 'pt2', operation: 'OP60', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '77mm Lang Vise with Soft Jaw', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg4', programNumber: 1111, partId: 'pt3', operation: 'OP50', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '125mm Lang Vise Forward', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg5', programNumber: 1112, partId: 'pt3', operation: 'OP60', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '77mm Lang Vise with Soft Jaw', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg6', programNumber: 1113, partId: 'pt4', operation: 'OP50', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '125mm Lang Vise Forward', material: 'Stainless 304', pallet: '' },
  { id: 'prg7', programNumber: 1114, partId: 'pt4', operation: 'OP60', description: '', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: '77mm Lang Vise with Soft Jaw', material: 'Stainless 304', pallet: '' },
  { id: 'prg8', programNumber: 1115, partId: 'pt4', operation: 'Soft Jaw', description: 'Soft jaw stock', machine: 'Brother M300X3', isFixture: true, internalExternal: 'Internal', fixturing: '77mm Lang Vise with Soft Jaw', material: 'Aluminum 6061', pallet: '' },
  { id: 'prg9', programNumber: 1116, partId: 'pt5', operation: 'OP50', description: 'Tab off', machine: 'Brother M300X3', isFixture: false, internalExternal: 'External', fixturing: 'Standard Machine Vise', material: 'Stainless 316L', pallet: '' },
];

const CUSTOMER_PALETTE = [
  { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-800' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-800' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800' },
  { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
  { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-800' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', text: 'text-fuchsia-800' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-800' },
];

function customerColor(customer) {
  if (!customer) return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-400' };
  const key = customer.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CUSTOMER_PALETTE[hash % CUSTOMER_PALETTE.length];
}

function CustomerBadge({ customer }) {
  const c = customerColor(customer);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${c.bg} ${c.border} ${c.text}`}>
      {customer || 'No customer'}
    </span>
  );
}

function TypePill({ isFixture, internalExternal }) {
  if (isFixture) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Fixture</span>;
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${internalExternal === 'External' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
      {internalExternal}
    </span>
  );
}

function ToggleSwitch({ checked, onChange, label, compact }) {
  return (
    <label className={`inline-flex items-center gap-2 whitespace-nowrap ${compact ? 'text-xs px-2 py-1' : 'text-sm px-2.5 py-1.5'} bg-slate-50 rounded-md border border-slate-200 cursor-pointer`}>
      <span className="font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0"
        style={{ backgroundColor: checked ? '#f59e0b' : '#cbd5e1' }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </label>
  );
}

function SelectWithCustom({ value, customValue, options, placeholder, customPlaceholder, onSelectChange, onCustomChange, compact }) {
  const selectClass = compact
    ? 'w-full border border-slate-200 rounded px-2 py-1 text-xs'
    : 'w-full border border-slate-200 rounded-md px-3 py-2 text-sm';
  const inputClass = compact
    ? 'w-full border border-slate-200 rounded px-2 py-1 text-xs mt-1'
    : 'w-full border border-slate-200 rounded-md px-3 py-2 text-sm mt-2';
  return (
    <div>
      <select value={value} onChange={e => onSelectChange(e.target.value)} className={selectClass}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="custom">Custom...</option>
      </select>
      {value === 'custom' && (
        <input value={customValue} onChange={e => onCustomChange(e.target.value)} placeholder={customPlaceholder} className={inputClass} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 transition-colors ${
        active ? 'border-amber-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}{children}
    </button>
  );
}

function Header({ view, setView, onAddClick, nextProgramNumber, totalPrograms, totalParts }) {
  return (
    <header className="bg-slate-900 text-slate-50 sticky top-0 z-10">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Program Numbers</h1>
          <p className="text-xs text-slate-400">{totalParts} parts · {totalPrograms} programs</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-xs uppercase tracking-wider text-slate-400">Next #</span>
            <span className="font-mono text-amber-400 text-sm leading-none">{nextProgramNumber}</span>
          </div>
          <button
            onClick={onAddClick}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium text-sm px-3 py-2 rounded-md"
          >
            <Plus size={16} /> Add program
          </button>
        </div>
      </div>
      <div className="px-4 flex gap-1 border-t border-slate-800">
        <TabButton active={view === 'grouped'} onClick={() => setView('grouped')} icon={<LayoutGrid size={14} />}>Grouped</TabButton>
        <TabButton active={view === 'table'} onClick={() => setView('table')} icon={<Table2 size={14} />}>Table</TabButton>
        <TabButton active={view === 'settings'} onClick={() => setView('settings')} icon={<SlidersHorizontal size={14} />}>Settings</TabButton>
      </div>
    </header>
  );
}

function PartHeaderRow({ part, isExpanded, onToggleExpand, programCount, materialOptions, onUpdatePart }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  function startEdit() {
    setDraft({
      partNumber: part.partNumber,
      rev: part.rev,
      customer: part.customer || '',
      materialSel: materialOptions.includes(part.material) ? part.material : (part.material ? 'custom' : ''),
      materialCustom: materialOptions.includes(part.material) ? '' : (part.material || ''),
    });
    setEditing(true);
  }

  function save() {
    const material = draft.materialSel === 'custom' ? draft.materialCustom.trim() : draft.materialSel;
    onUpdatePart(part.id, {
      partNumber: draft.partNumber.trim() || part.partNumber,
      rev: draft.rev.trim() || part.rev,
      customer: draft.customer.trim(),
      material,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 space-y-2">
        <div className="flex gap-2">
          <input value={draft.partNumber} onChange={e => setDraft({ ...draft, partNumber: e.target.value })} className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm" placeholder="Part number" />
          <input value={draft.rev} onChange={e => setDraft({ ...draft, rev: e.target.value })} maxLength={4} className="w-16 border border-slate-200 rounded-md px-2 py-1.5 text-sm" placeholder="Rev" />
        </div>
        <input value={draft.customer} onChange={e => setDraft({ ...draft, customer: e.target.value })} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm" placeholder="Customer" />
        <SelectWithCustom
          value={draft.materialSel}
          customValue={draft.materialCustom}
          options={materialOptions}
          placeholder="— Select material —"
          customPlaceholder="Material name"
          onSelectChange={v => setDraft({ ...draft, materialSel: v })}
          onCustomChange={v => setDraft({ ...draft, materialCustom: v })}
        />
        <div className="flex gap-2 pt-1">
          <button onClick={save} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-md"><Check size={14} /> Save</button>
          <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"><X size={14} /> Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 flex-wrap gap-2">
      <div className="flex items-center gap-2 flex-wrap cursor-pointer" onClick={onToggleExpand}>
        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span className="font-semibold">{part.partNumber}</span>
        <span className="text-xs text-slate-400">Rev {part.rev}</span>
        <CustomerBadge customer={part.customer} />
        {part.material && <span className="text-xs text-slate-500">{part.material}</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400">{programCount} program{programCount !== 1 ? 's' : ''}</span>
        <button onClick={startEdit} className="text-slate-300 hover:text-slate-600" title="Edit part">✏️</button>
      </div>
    </div>
  );
}

function OperationRow({ program, part, fixtureOptions, materialOptions, machines, onUpdateProgram }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  function startEdit() {
    setDraft({
      operation: program.operation,
      description: program.description,
      machine: program.machine,
      isFixture: program.isFixture,
      internalExternal: program.internalExternal,
      fixturingSel: fixtureOptions.some(f => f.description === program.fixturing) ? program.fixturing : (program.fixturing ? 'custom' : ''),
      fixturingCustom: fixtureOptions.some(f => f.description === program.fixturing) ? '' : (program.fixturing || ''),
      pallet: program.pallet || '1',
      materialSel: materialOptions.includes(program.material) ? program.material : (program.material ? 'custom' : ''),
      materialCustom: materialOptions.includes(program.material) ? '' : (program.material || ''),
    });
    setEditing(true);
  }

  function save() {
    const fixturing = draft.fixturingSel === 'custom' ? draft.fixturingCustom.trim() : draft.fixturingSel;
    const material = draft.isFixture
      ? (draft.materialSel === 'custom' ? draft.materialCustom.trim() : draft.materialSel)
      : part.material;
    onUpdateProgram(program.id, {
      operation: draft.operation.trim() || program.operation,
      description: draft.description.trim(),
      machine: draft.machine,
      isFixture: draft.isFixture,
      internalExternal: draft.isFixture ? 'Internal' : draft.internalExternal,
      fixturing,
      material,
      pallet: draft.machine === 'Brother R650' ? draft.pallet : '',
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2 text-sm">
        <div className="flex gap-2">
          <input value={draft.operation} onChange={e => setDraft({ ...draft, operation: e.target.value })} placeholder="Operation" className="w-28 border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
          <select value={draft.machine} onChange={e => setDraft({ ...draft, machine: e.target.value })} className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm">
            {machines.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleSwitch checked={draft.isFixture} onChange={v => setDraft({ ...draft, isFixture: v, internalExternal: v ? 'Internal' : 'External' })} label="Fixture OP?" />
          {!draft.isFixture && (
            <select value={draft.internalExternal} onChange={e => setDraft({ ...draft, internalExternal: e.target.value })} className="w-28 border border-slate-200 rounded-md px-2 py-1.5 text-sm">
              {INT_EXT.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {draft.machine === 'Brother R650' && (
            <select value={draft.pallet} onChange={e => setDraft({ ...draft, pallet: e.target.value })} className="w-24 border border-slate-200 rounded-md px-2 py-1.5 text-sm">
              <option value="1">Pallet 1</option>
              <option value="2">Pallet 2</option>
            </select>
          )}
        </div>
        <SelectWithCustom
          value={draft.fixturingSel}
          customValue={draft.fixturingCustom}
          options={fixtureOptions.map(f => f.description)}
          placeholder="— Select fixturing —"
          customPlaceholder="Describe the fixturing"
          onSelectChange={v => setDraft({ ...draft, fixturingSel: v })}
          onCustomChange={v => setDraft({ ...draft, fixturingCustom: v })}
        />
        {draft.isFixture && (
          <SelectWithCustom
            value={draft.materialSel}
            customValue={draft.materialCustom}
            options={materialOptions}
            placeholder="— Select fixture material —"
            customPlaceholder="Material name"
            onSelectChange={v => setDraft({ ...draft, materialSel: v })}
            onCustomChange={v => setDraft({ ...draft, materialCustom: v })}
          />
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={save} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-md"><Check size={14} /> Save</button>
          <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"><X size={14} /> Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-sm flex-wrap">
      <span className="font-mono bg-slate-900 text-amber-400 px-2 py-0.5 rounded text-xs tracking-wider">{program.programNumber}</span>
      <span className="text-slate-600">{program.machine}</span>
      <TypePill isFixture={program.isFixture} internalExternal={program.internalExternal} />
      {program.pallet && <span className="text-xs text-slate-400">Pallet {program.pallet}</span>}
      <span className="text-slate-400">{program.fixturing}</span>
      {program.isFixture && program.material && <span className="text-xs text-slate-500">Fixture material: {program.material}</span>}
      {program.description && <span className="text-slate-400 italic">{program.description}</span>}
      <button onClick={startEdit} className="text-slate-300 hover:text-slate-600 ml-auto" title="Edit operation">✏️</button>
    </div>
  );
}

function GroupedView({ parts, programs, expandedParts, toggleExpand, fixtureOptions, materialOptions, machines, onUpdatePart, onUpdateProgram }) {
  return (
    <div className="p-4 space-y-3">
      {parts.map(part => {
        const partPrograms = programs.filter(p => p.partId === part.id);
        if (partPrograms.length === 0) return null;
        const isExpanded = expandedParts.has(part.id);
        const byOp = {};
        partPrograms.forEach(p => { (byOp[p.operation] = byOp[p.operation] || []).push(p); });

        return (
          <div key={part.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <PartHeaderRow
              part={part}
              isExpanded={isExpanded}
              onToggleExpand={() => toggleExpand(part.id)}
              programCount={partPrograms.length}
              materialOptions={materialOptions}
              onUpdatePart={onUpdatePart}
            />
            {isExpanded && (
              <div className="border-t border-slate-100 divide-y divide-slate-100">
                {Object.entries(byOp).map(([op, progs]) => (
                  <div key={op} className="px-4 py-2.5 space-y-2">
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{op}</div>
                    <div className="space-y-2">
                      {progs.map(p => (
                        <OperationRow
                          key={p.id}
                          program={p}
                          part={part}
                          fixtureOptions={fixtureOptions}
                          materialOptions={materialOptions}
                          machines={machines}
                          onUpdateProgram={onUpdateProgram}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TableRow({ row, machines, fixtureOptions, materialOptions, onUpdatePart, onUpdateProgram }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const part = row.part;

  function startEdit() {
    setDraft({
      partNumber: part?.partNumber || '',
      rev: part?.rev || '',
      customer: part?.customer || '',
      partMaterialSel: materialOptions.includes(part?.material) ? part.material : (part?.material ? 'custom' : ''),
      partMaterialCustom: materialOptions.includes(part?.material) ? '' : (part?.material || ''),
      operation: row.operation,
      description: row.description,
      machine: row.machine,
      isFixture: row.isFixture,
      internalExternal: row.internalExternal,
      fixturingSel: fixtureOptions.some(f => f.description === row.fixturing) ? row.fixturing : (row.fixturing ? 'custom' : ''),
      fixturingCustom: fixtureOptions.some(f => f.description === row.fixturing) ? '' : (row.fixturing || ''),
      pallet: row.pallet || '1',
      fixtureMaterialSel: materialOptions.includes(row.material) ? row.material : (row.material ? 'custom' : ''),
      fixtureMaterialCustom: materialOptions.includes(row.material) ? '' : (row.material || ''),
    });
    setEditing(true);
  }

  function save() {
    if (part) {
      const partMaterial = draft.partMaterialSel === 'custom' ? draft.partMaterialCustom.trim() : draft.partMaterialSel;
      onUpdatePart(part.id, {
        partNumber: draft.partNumber.trim() || part.partNumber,
        rev: draft.rev.trim() || part.rev,
        customer: draft.customer.trim(),
        material: partMaterial,
      });
    }
    const fixturing = draft.fixturingSel === 'custom' ? draft.fixturingCustom.trim() : draft.fixturingSel;
    const material = draft.isFixture
      ? (draft.fixtureMaterialSel === 'custom' ? draft.fixtureMaterialCustom.trim() : draft.fixtureMaterialSel)
      : (draft.partMaterialSel === 'custom' ? draft.partMaterialCustom.trim() : draft.partMaterialSel);
    onUpdateProgram(row.id, {
      operation: draft.operation.trim() || row.operation,
      description: draft.description.trim(),
      machine: draft.machine,
      isFixture: draft.isFixture,
      internalExternal: draft.isFixture ? 'Internal' : draft.internalExternal,
      fixturing,
      material,
      pallet: draft.machine === 'Brother R650' ? draft.pallet : '',
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <tr className="hover:bg-slate-50">
        <td className="px-2 py-2"><button onClick={startEdit} className="text-slate-300 hover:text-slate-600" title="Edit row">✏️</button></td>
        <td className="px-3 py-2 font-mono text-xs"><span className="bg-slate-900 text-amber-400 px-2 py-0.5 rounded">{row.programNumber}</span></td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="font-medium">{part?.partNumber}</span>
          <span className="text-xs text-slate-400 ml-1">Rev {part?.rev}</span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap"><CustomerBadge customer={part?.customer} /></td>
        <td className="px-3 py-2 whitespace-nowrap">{row.operation}</td>
        <td className="px-3 py-2 text-slate-500">{row.description || '—'}</td>
        <td className="px-3 py-2 whitespace-nowrap">{row.machine}</td>
        <td className="px-3 py-2"><TypePill isFixture={row.isFixture} internalExternal={row.internalExternal} /></td>
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.fixturing}</td>
        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.material}</td>
        <td className="px-3 py-2">{row.pallet || '—'}</td>
      </tr>
    );
  }

  return (
    <tr className="bg-amber-50">
      <td className="px-2 py-2 align-top">
        <div className="flex flex-col gap-1">
          <button onClick={save} className="text-emerald-600 hover:text-emerald-800" title="Save"><Check size={16} /></button>
          <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
        </div>
      </td>
      <td className="px-3 py-2 align-top font-mono text-xs text-slate-400">{row.programNumber}</td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '150px' }}>
        <div className="flex gap-1">
          <input value={draft.partNumber} onChange={e => setDraft({ ...draft, partNumber: e.target.value })} className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Part #" />
          <input value={draft.rev} onChange={e => setDraft({ ...draft, rev: e.target.value })} maxLength={4} className="w-12 border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Rev" />
        </div>
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '120px' }}>
        <input value={draft.customer} onChange={e => setDraft({ ...draft, customer: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Customer" />
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '100px' }}>
        <input value={draft.operation} onChange={e => setDraft({ ...draft, operation: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Operation" />
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '120px' }}>
        <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1 text-xs" placeholder="Description" />
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '120px' }}>
        <select value={draft.machine} onChange={e => setDraft({ ...draft, machine: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1 text-xs">
          {machines.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '190px' }}>
        <div className="flex flex-wrap items-center gap-1">
          <ToggleSwitch checked={draft.isFixture} onChange={v => setDraft({ ...draft, isFixture: v, internalExternal: v ? 'Internal' : 'External' })} label="Fixture OP?" compact />
          {!draft.isFixture && (
            <select value={draft.internalExternal} onChange={e => setDraft({ ...draft, internalExternal: e.target.value })} className="w-24 border border-slate-200 rounded px-2 py-1 text-xs">
              {INT_EXT.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '160px' }}>
        <SelectWithCustom
          compact
          value={draft.fixturingSel}
          customValue={draft.fixturingCustom}
          options={fixtureOptions.map(f => f.description)}
          placeholder="— Select —"
          customPlaceholder="Describe fixturing"
          onSelectChange={v => setDraft({ ...draft, fixturingSel: v })}
          onCustomChange={v => setDraft({ ...draft, fixturingCustom: v })}
        />
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '160px' }}>
        {draft.isFixture ? (
          <SelectWithCustom
            compact
            value={draft.fixtureMaterialSel}
            customValue={draft.fixtureMaterialCustom}
            options={materialOptions}
            placeholder="— Fixture material —"
            customPlaceholder="Material name"
            onSelectChange={v => setDraft({ ...draft, fixtureMaterialSel: v })}
            onCustomChange={v => setDraft({ ...draft, fixtureMaterialCustom: v })}
          />
        ) : (
          <SelectWithCustom
            compact
            value={draft.partMaterialSel}
            customValue={draft.partMaterialCustom}
            options={materialOptions}
            placeholder="— Part material —"
            customPlaceholder="Material name"
            onSelectChange={v => setDraft({ ...draft, partMaterialSel: v })}
            onCustomChange={v => setDraft({ ...draft, partMaterialCustom: v })}
          />
        )}
      </td>
      <td className="px-3 py-2 align-top" style={{ minWidth: '80px' }}>
        {draft.machine === 'Brother R650' ? (
          <select value={draft.pallet} onChange={e => setDraft({ ...draft, pallet: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1 text-xs">
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        ) : <span className="text-xs text-slate-300">—</span>}
      </td>
    </tr>
  );
}

function TableView({
  parts, programs, machines, fixtureOptions, materialOptions,
  filterText, setFilterText, filterMachine, setFilterMachine, filterIntExt, setFilterIntExt,
  sortKey, sortDir, onSort, onUpdatePart, onUpdateProgram,
}) {
  const partsById = useMemo(() => Object.fromEntries(parts.map(p => [p.id, p])), [parts]);

  const rows = useMemo(() => {
    let r = programs.map(p => ({ ...p, part: partsById[p.partId] }));
    if (filterMachine !== 'All') r = r.filter(x => x.machine === filterMachine);
    if (filterIntExt !== 'All') {
      r = r.filter(x => (filterIntExt === 'Fixture' ? x.isFixture : (!x.isFixture && x.internalExternal === filterIntExt)));
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      r = r.filter(x =>
        (x.part?.partNumber || '').toLowerCase().includes(q) ||
        (x.part?.customer || '').toLowerCase().includes(q) ||
        (x.part?.material || '').toLowerCase().includes(q) ||
        x.operation.toLowerCase().includes(q) ||
        (x.description || '').toLowerCase().includes(q) ||
        x.fixturing.toLowerCase().includes(q) ||
        x.material.toLowerCase().includes(q)
      );
    }
    r.sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case 'partNumber': av = a.part?.partNumber || ''; bv = b.part?.partNumber || ''; break;
        case 'customer': av = a.part?.customer || ''; bv = b.part?.customer || ''; break;
        case 'type': av = a.isFixture ? 'Fixture' : a.internalExternal; bv = b.isFixture ? 'Fixture' : b.internalExternal; break;
        default: av = a[sortKey]; bv = b[sortKey];
      }
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return r;
  }, [programs, partsById, filterMachine, filterIntExt, filterText, sortKey, sortDir]);

  const columns = [
    { key: 'programNumber', label: 'Program #' },
    { key: 'partNumber', label: 'Part' },
    { key: 'customer', label: 'Customer' },
    { key: 'operation', label: 'Operation' },
    { key: 'description', label: 'Description' },
    { key: 'machine', label: 'Machine' },
    { key: 'type', label: 'Type' },
    { key: 'fixturing', label: 'Fixturing' },
    { key: 'material', label: 'Material' },
    { key: 'pallet', label: 'Pallet' },
  ];

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1" style={{ minWidth: '180px' }}>
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Search programs..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        <select value={filterMachine} onChange={e => setFilterMachine(e.target.value)} className="text-sm border border-slate-200 rounded-md px-2 py-2">
          <option>All</option>
          {machines.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={filterIntExt} onChange={e => setFilterIntExt(e.target.value)} className="text-sm border border-slate-200 rounded-md px-2 py-2">
          <option>All</option>
          <option>External</option>
          <option>Internal</option>
          <option>Fixture</option>
        </select>
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-2 py-2 w-8"></th>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className="text-left px-3 py-2 font-medium text-slate-600 cursor-pointer select-none whitespace-nowrap hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <TableRow
                key={r.id}
                row={r}
                machines={machines}
                fixtureOptions={fixtureOptions}
                materialOptions={materialOptions}
                onUpdatePart={onUpdatePart}
                onUpdateProgram={onUpdateProgram}
              />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-slate-400">No programs match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsView({
  fixtureOptions, onAddFixture, onRemoveFixture,
  materialOptions, onAddMaterial, onRemoveMaterial,
  machines, onAddMachine, onRemoveMachine,
  nextProgramNumber, onSetNextProgramNumber,
}) {
  const [newFixtureNumber, setNewFixtureNumber] = useState('');
  const [newFixtureDesc, setNewFixtureDesc] = useState('');
  const [newMaterial, setNewMaterial] = useState('');
  const [newMachine, setNewMachine] = useState('');
  const [nextNumInput, setNextNumInput] = useState(String(nextProgramNumber));

  return (
    <div className="p-4 max-w-2xl space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
        Fixture and material lists are placeholders here. Once wired into ToolDex, fixtures pull from ProShop and materials from the shared materials table.
      </div>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-1">Next program number</h3>
        <p className="text-xs text-slate-500 mb-3">Every new operation gets this number, then it increments by one.</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={nextNumInput}
            onChange={e => setNextNumInput(e.target.value)}
            className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-32 font-mono"
          />
          <button
            onClick={() => onSetNextProgramNumber(parseInt(nextNumInput, 10) || nextProgramNumber)}
            className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800"
          >
            Update
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Machines</h3>
        <div className="space-y-1.5 mb-3">
          {machines.map(m => (
            <div key={m} className="flex items-center justify-between text-sm bg-slate-50 rounded px-3 py-1.5">
              <span>{m}</span>
              <button onClick={() => onRemoveMachine(m)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newMachine}
            onChange={e => setNewMachine(e.target.value)}
            placeholder="e.g. Brother R450"
            className="flex-1 border border-slate-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => { if (newMachine.trim()) { onAddMachine(newMachine.trim()); setNewMachine(''); } }}
            className="text-sm px-3 py-1.5 bg-slate-100 rounded-md hover:bg-slate-200"
          >
            Add
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Fixture options</h3>
        <div className="space-y-1.5 mb-3">
          {fixtureOptions.map(f => (
            <div key={f.id} className="flex items-center justify-between text-sm bg-slate-50 rounded px-3 py-1.5">
              <span><span className="font-mono text-xs text-slate-400 mr-2">{f.number}</span>{f.description}</span>
              <button onClick={() => onRemoveFixture(f.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newFixtureNumber}
            onChange={e => setNewFixtureNumber(e.target.value)}
            placeholder="Fixture #"
            className="w-28 border border-slate-200 rounded-md px-3 py-1.5 text-sm"
          />
          <input
            value={newFixtureDesc}
            onChange={e => setNewFixtureDesc(e.target.value)}
            placeholder="Description"
            className="flex-1 border border-slate-200 rounded-md px-3 py-1.5 text-sm"
            style={{ minWidth: '140px' }}
          />
          <button
            onClick={() => { if (newFixtureDesc.trim()) { onAddFixture(newFixtureNumber.trim(), newFixtureDesc.trim()); setNewFixtureNumber(''); setNewFixtureDesc(''); } }}
            className="text-sm px-3 py-1.5 bg-slate-100 rounded-md hover:bg-slate-200"
          >
            Add
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Materials</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {materialOptions.map(m => (
            <span key={m} className="inline-flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-full pl-2.5 pr-1 py-1">
              {m}
              <button onClick={() => onRemoveMaterial(m)} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newMaterial}
            onChange={e => setNewMaterial(e.target.value)}
            placeholder="e.g. Inconel 718"
            className="flex-1 border border-slate-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => { if (newMaterial.trim()) { onAddMaterial(newMaterial.trim()); setNewMaterial(''); } }}
            className="text-sm px-3 py-1.5 bg-slate-100 rounded-md hover:bg-slate-200"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}

function AddProgramModal({ parts, fixtureOptions, materialOptions, machines, nextProgramNumber, onAddPart, onAddProgram, onClose }) {
  const [step, setStep] = useState('search');
  const [query, setQuery] = useState('');
  const [activePartId, setActivePartId] = useState(null);
  const [draftPartNumber, setDraftPartNumber] = useState('');
  const [draftCustomer, setDraftCustomer] = useState('');
  const [draftRev, setDraftRev] = useState('A');
  const [draftMaterialSel, setDraftMaterialSel] = useState('');
  const [draftMaterialCustom, setDraftMaterialCustom] = useState('');

  const [opForm, setOpForm] = useState({
    operation: '',
    description: '',
    machine: machines[0] || '',
    isFixture: false,
    internalExternal: 'External',
    fixturingSel: '',
    fixturingCustom: '',
    pallet: '1',
    fixtureMaterialSel: '',
    fixtureMaterialCustom: '',
  });
  const [sessionAdded, setSessionAdded] = useState([]);

  const activePart = parts.find(p => p.id === activePartId);
  const customers = [...new Set(parts.map(p => p.customer).filter(Boolean))];

  const filteredParts = query.trim()
    ? parts.filter(p => p.partNumber.toLowerCase().includes(query.trim().toLowerCase()))
    : parts;

  function selectExistingPart(part) {
    setActivePartId(part.id);
    setStep('operations');
  }

  function startNewPart() {
    setDraftPartNumber(query.trim());
    setDraftCustomer('');
    setDraftRev('A');
    setDraftMaterialSel('');
    setDraftMaterialCustom('');
    setStep('new-part');
  }

  function confirmNewPart() {
    if (!draftPartNumber.trim()) return;
    const material = draftMaterialSel === 'custom' ? draftMaterialCustom.trim() : draftMaterialSel;
    const id = onAddPart(draftPartNumber.trim(), draftCustomer.trim(), draftRev.trim() || 'A', material);
    setActivePartId(id);
    setStep('operations');
  }

  function handleAddOperation() {
    if (!opForm.operation.trim() || !opForm.machine) return;
    const fixturing = opForm.fixturingSel === 'custom' ? opForm.fixturingCustom.trim() : opForm.fixturingSel;
    const material = opForm.isFixture
      ? (opForm.fixtureMaterialSel === 'custom' ? opForm.fixtureMaterialCustom.trim() : opForm.fixtureMaterialSel)
      : (activePart.material || '');
    const payload = {
      operation: opForm.operation.trim(),
      description: opForm.description.trim(),
      machine: opForm.machine,
      isFixture: opForm.isFixture,
      internalExternal: opForm.isFixture ? 'Internal' : opForm.internalExternal,
      fixturing,
      material,
      pallet: opForm.machine === 'Brother R650' ? opForm.pallet : '',
    };
    const assignedNumber = onAddProgram(activePartId, payload);
    setSessionAdded(prev => [...prev, { programNumber: assignedNumber, operation: payload.operation, machine: payload.machine, isFixture: payload.isFixture }]);
    setOpForm(prev => ({
      ...prev,
      operation: '',
      description: '',
      isFixture: false,
      internalExternal: 'External',
      fixtureMaterialSel: '',
      fixtureMaterialCustom: '',
    }));
  }

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(2, 6, 23, 0.6)' }}
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold">Add program</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto px-4 py-4 flex-1">
          {step === 'search' && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700">Part number</label>
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search or type a new part number"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredParts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectExistingPart(p)}
                    className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-slate-50 border border-slate-100 flex items-center justify-between flex-wrap gap-1"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{p.partNumber}</span>
                      <span className="text-xs text-slate-400">Rev {p.rev}</span>
                    </span>
                    <CustomerBadge customer={p.customer} />
                  </button>
                ))}
                {filteredParts.length === 0 && (
                  <p className="text-sm text-slate-400 px-1 py-2">No existing parts match.</p>
                )}
              </div>
              {query.trim() && (
                <button
                  onClick={startNewPart}
                  className="w-full flex items-center gap-2 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md px-3 py-2 border border-amber-200"
                >
                  <Plus size={15} /> Create new part "{query.trim()}"
                </button>
              )}
            </div>
          )}

          {step === 'new-part' && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-slate-700">Part number</label>
                  <input
                    value={draftPartNumber}
                    onChange={e => setDraftPartNumber(e.target.value)}
                    className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div style={{ width: '70px' }}>
                  <label className="text-sm font-medium text-slate-700">Rev</label>
                  <input
                    value={draftRev}
                    onChange={e => setDraftRev(e.target.value)}
                    maxLength={4}
                    className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Customer <span className="text-slate-400 font-normal">(optional)</span></label>
                <input
                  list="customer-options"
                  value={draftCustomer}
                  onChange={e => setDraftCustomer(e.target.value)}
                  className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                  placeholder="Start typing..."
                />
                <datalist id="customer-options">
                  {customers.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Part material <span className="text-slate-400 font-normal">(optional)</span></label>
                <div className="mt-1">
                  <SelectWithCustom
                    value={draftMaterialSel}
                    customValue={draftMaterialCustom}
                    options={materialOptions}
                    placeholder="— Select material —"
                    customPlaceholder="Material name"
                    onSelectChange={setDraftMaterialSel}
                    onCustomChange={setDraftMaterialCustom}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Applies to every operation on this part, unless that operation makes a fixture.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setStep('search')} className="text-sm px-3 py-2 rounded-md border border-slate-200 hover:bg-slate-50">Back</button>
                <button
                  onClick={confirmNewPart}
                  disabled={!draftPartNumber.trim()}
                  className="flex-1 text-sm px-3 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  Create part & continue
                </button>
              </div>
            </div>
          )}

          {step === 'operations' && activePart && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2 text-sm flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{activePart.partNumber}</span>
                  <span className="text-xs text-slate-400">Rev {activePart.rev}</span>
                  <CustomerBadge customer={activePart.customer} />
                  {activePart.material && <span className="text-xs text-slate-500">{activePart.material}</span>}
                </div>
                <button onClick={() => { setStep('search'); setQuery(''); }} className="text-xs text-amber-700 hover:underline">Change part</button>
              </div>

              {sessionAdded.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Reserved this session</span>
                  {sessionAdded.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-100 rounded-md px-3 py-1.5 flex-wrap">
                      <Check size={14} className="text-emerald-600" />
                      <span className="font-mono text-xs bg-slate-900 text-amber-400 px-1.5 py-0.5 rounded">{s.programNumber}</span>
                      <span>{s.operation}</span>
                      <span className="text-slate-400">· {s.machine}</span>
                      {s.isFixture && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Fixture</span>}
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div className="flex gap-3">
                  <div style={{ width: '120px' }}>
                    <label className="text-sm font-medium text-slate-700">Operation</label>
                    <input
                      value={opForm.operation}
                      onChange={e => setOpForm({ ...opForm, operation: e.target.value })}
                      placeholder="OP50"
                      className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-sm font-medium text-slate-700">Machine</label>
                    <select
                      value={opForm.machine}
                      onChange={e => setOpForm({ ...opForm, machine: e.target.value })}
                      className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                    >
                      {machines.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Description <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    value={opForm.description}
                    onChange={e => setOpForm({ ...opForm, description: e.target.value })}
                    placeholder="e.g. Full part - tabbed"
                    className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-start gap-3">
                  <div>
                    <span className="text-sm font-medium text-transparent select-none block">·</span>
                    <div className="mt-1">
                      <ToggleSwitch
                        checked={opForm.isFixture}
                        onChange={v => setOpForm({ ...opForm, isFixture: v, internalExternal: v ? 'Internal' : 'External' })}
                        label="Fixture OP?"
                      />
                    </div>
                  </div>
                  {!opForm.isFixture && (
                    <div style={{ width: '150px' }}>
                      <label className="text-sm font-medium text-slate-700">Internal / External</label>
                      <select
                        value={opForm.internalExternal}
                        onChange={e => setOpForm({ ...opForm, internalExternal: e.target.value })}
                        className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                      >
                        {INT_EXT.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  )}
                  {opForm.machine === 'Brother R650' && (
                    <div style={{ width: '110px' }}>
                      <label className="text-sm font-medium text-slate-700">Pallet</label>
                      <select
                        value={opForm.pallet}
                        onChange={e => setOpForm({ ...opForm, pallet: e.target.value })}
                        className="w-full mt-1 border border-slate-200 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Fixturing</label>
                  <div className="mt-1">
                    <SelectWithCustom
                      value={opForm.fixturingSel}
                      customValue={opForm.fixturingCustom}
                      options={fixtureOptions.map(f => f.description)}
                      placeholder="— Select fixturing —"
                      customPlaceholder="Describe the fixturing"
                      onSelectChange={v => setOpForm({ ...opForm, fixturingSel: v })}
                      onCustomChange={v => setOpForm({ ...opForm, fixturingCustom: v })}
                    />
                  </div>
                </div>

                {!opForm.isFixture && (
                  <div className="text-sm text-slate-500 bg-slate-50 rounded-md px-3 py-2 border border-slate-200">
                    Material: <span className="text-slate-700 font-medium">{activePart.material || 'Not set on this part'}</span>
                  </div>
                )}

                {opForm.isFixture && (
                  <div>
                    <label className="text-sm font-medium text-slate-700">Fixture material</label>
                    <div className="mt-1">
                      <SelectWithCustom
                        value={opForm.fixtureMaterialSel}
                        customValue={opForm.fixtureMaterialCustom}
                        options={materialOptions}
                        placeholder="— Select material —"
                        customPlaceholder="Material name"
                        onSelectChange={v => setOpForm({ ...opForm, fixtureMaterialSel: v })}
                        onCustomChange={v => setOpForm({ ...opForm, fixtureMaterialCustom: v })}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleAddOperation}
                  disabled={!opForm.operation.trim()}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 rounded-md px-3 py-2.5"
                >
                  <Plus size={16} /> Reserve program number {nextProgramNumber}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100">
          <button onClick={onClose} className="w-full text-sm font-medium px-3 py-2.5 rounded-md border border-slate-200 hover:bg-slate-50">
            {sessionAdded.length > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProgramNumberManager() {
  const [parts, setParts] = useState(SEED_PARTS);
  const [programs, setPrograms] = useState(SEED_PROGRAMS);
  const [fixtureOptions, setFixtureOptions] = useState(SEED_FIXTURES);
  const [materialOptions, setMaterialOptions] = useState(SEED_MATERIALS);
  const [machines, setMachines] = useState(MACHINES_DEFAULT);
  const [nextProgramNumber, setNextProgramNumber] = useState(1117);
  const [view, setView] = useState('grouped');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedParts, setExpandedParts] = useState(() => new Set(SEED_PARTS.map(p => p.id)));
  const [sortKey, setSortKey] = useState('programNumber');
  const [sortDir, setSortDir] = useState('desc');
  const [filterText, setFilterText] = useState('');
  const [filterMachine, setFilterMachine] = useState('All');
  const [filterIntExt, setFilterIntExt] = useState('All');

  function toggleExpand(id) {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAddPart(partNumber, customer, rev, material) {
    const id = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setParts(prev => [...prev, { id, partNumber, customer, rev, material }]);
    setExpandedParts(prev => new Set(prev).add(id));
    return id;
  }

  function handleAddProgram(partId, opData) {
    let assigned;
    setNextProgramNumber(n => { assigned = n; return n + 1; });
    const id = `prg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPrograms(prev => [...prev, { id, programNumber: assigned, partId, ...opData }]);
    return assigned;
  }

  function updatePart(id, updates) {
    setParts(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));
    if (Object.prototype.hasOwnProperty.call(updates, 'material')) {
      setPrograms(prev => prev.map(pr => (pr.partId === id && !pr.isFixture ? { ...pr, material: updates.material } : pr)));
    }
  }

  function updateProgram(id, updates) {
    setPrograms(prev => prev.map(pr => (pr.id === id ? { ...pr, ...updates } : pr)));
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function addFixture(number, description) {
    setFixtureOptions(prev => [...prev, { id: `fx-${Date.now()}`, number, description }]);
  }
  function removeFixture(id) {
    setFixtureOptions(prev => prev.filter(f => f.id !== id));
  }
  function addMaterial(name) {
    setMaterialOptions(prev => prev.includes(name) ? prev : [...prev, name]);
  }
  function removeMaterial(name) {
    setMaterialOptions(prev => prev.filter(m => m !== name));
  }
  function addMachine(name) {
    setMachines(prev => prev.includes(name) ? prev : [...prev, name]);
  }
  function removeMachine(name) {
    setMachines(prev => prev.filter(m => m !== name));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        view={view}
        setView={setView}
        onAddClick={() => setShowAddModal(true)}
        nextProgramNumber={nextProgramNumber}
        totalPrograms={programs.length}
        totalParts={parts.length}
      />

      {view === 'grouped' && (
        <GroupedView
          parts={parts} programs={programs} expandedParts={expandedParts} toggleExpand={toggleExpand}
          fixtureOptions={fixtureOptions} materialOptions={materialOptions} machines={machines}
          onUpdatePart={updatePart} onUpdateProgram={updateProgram}
        />
      )}
      {view === 'table' && (
        <TableView
          parts={parts} programs={programs} machines={machines}
          fixtureOptions={fixtureOptions} materialOptions={materialOptions}
          filterText={filterText} setFilterText={setFilterText}
          filterMachine={filterMachine} setFilterMachine={setFilterMachine}
          filterIntExt={filterIntExt} setFilterIntExt={setFilterIntExt}
          sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
          onUpdatePart={updatePart} onUpdateProgram={updateProgram}
        />
      )}
      {view === 'settings' && (
        <SettingsView
          fixtureOptions={fixtureOptions} onAddFixture={addFixture} onRemoveFixture={removeFixture}
          materialOptions={materialOptions} onAddMaterial={addMaterial} onRemoveMaterial={removeMaterial}
          machines={machines} onAddMachine={addMachine} onRemoveMachine={removeMachine}
          nextProgramNumber={nextProgramNumber} onSetNextProgramNumber={setNextProgramNumber}
        />
      )}

      {showAddModal && (
        <AddProgramModal
          parts={parts} fixtureOptions={fixtureOptions} materialOptions={materialOptions} machines={machines}
          nextProgramNumber={nextProgramNumber} onAddPart={handleAddPart} onAddProgram={handleAddProgram}
          onClose={() => setShowAddModal(false)}
        />
      )}

      <footer className="text-center text-xs text-slate-400 py-6">
        Prototype — data resets on refresh. Google Drive JSON sync comes when this is wired into ToolDex.
      </footer>
    </div>
  );
}
