import { useState, useRef, useEffect } from 'react';
import { Pencil, Plus, Trash2, ChevronDown, ChevronUp, X, MapPin, Info, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import InfoTip from './InfoTip.jsx';
import { ExclusionNotice } from './IdSystemMembership.jsx';
import {
  newLocationSystem, newLevelOption, levelTypeName, buildPreview,
  analyzeSystem, libraryLocationStatus, findSystemConflicts,
} from '../utils/locationSystem.js';

// Level-type and identifier option lists (from the approved prototype).
const ZONE_TYPES    = [['Building', 'Building'], ['Floor', 'Floor'], ['Area', 'Area'], ['Department', 'Department'], ['Zone', 'Zone'], ['custom', 'Custom…']];
const STATION_TYPES = [['Cabinet', 'Cabinet'], ['Machine', 'Machine'], ['Rack', 'Rack'], ['Department', 'Department'], ['Station', 'Station'], ['custom', 'Custom…']];
const DRAWER_TYPES  = [['Drawer', 'Drawer'], ['Shelf', 'Shelf'], ['Level', 'Level'], ['Row', 'Row'], ['Section', 'Section'], ['custom', 'Custom…']];
const IDENT_TYPES   = [['number', 'Number (1, 2, 3…)'], ['letter', 'Letter (A, B, C…)'], ['custom', 'Custom label']];
const DELIM_OPTIONS = [['-', '– dash'], ['.', '. dot'], ['/', '/ slash'], ['|', '| pipe'], ['_', '_ underscore'], [' ', '␣ space'], ['', 'none']];

// ── Small presentational primitives (design-system tokens) ──────────────────
function Toggle({ on, set }) {
  return (
    <button
      type="button"
      onClick={() => set(!on)}
      aria-pressed={on}
      style={{
        width: 32, height: 18, borderRadius: 9, flexShrink: 0, border: 'none',
        background: on ? 'var(--blue)' : 'var(--surface-3, #2a2a2a)',
        position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
      }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 15 : 3, width: 12, height: 12, borderRadius: 6, background: on ? '#fff' : 'var(--text-sub)', transition: 'left 0.15s' }} />
    </button>
  );
}

function Badge({ color, children }) {
  const c = { g: 'var(--green)', o: 'var(--orange)', b: 'var(--blue)' }[color] || 'var(--blue)';
  return (
    <span style={{
      fontSize: '0.66rem', padding: '2px 7px', borderRadius: 10, fontWeight: 700, whiteSpace: 'nowrap',
      color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
    }}>{children}</span>
  );
}

// Animated live preview chip — the one place the composed string animates on change.
export function LivePreview({ value }) {
  const [pop, setPop] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setPop(true);
      const t = setTimeout(() => setPop(false), 350);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'color-mix(in srgb, var(--blue) 12%, transparent)',
      border: `1px solid color-mix(in srgb, var(--blue) ${pop ? 70 : 40}%, transparent)`,
      borderRadius: 7, padding: '5px 12px',
      transform: pop ? 'scale(1.06)' : 'scale(1)',
      transition: 'transform 0.15s ease-out, border-color 0.15s',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--blue)', flexShrink: 0 }} />
      <span className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--blue)', letterSpacing: '0.02em' }}>{value}</span>
    </div>
  );
}

function Lbl({ children }) {
  return <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-sub)', marginBottom: 5 }}>{children}</div>;
}

// ── Editable system name (click pencil to edit) ─────────────────────────────
function EditableName({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);
  function startEdit(e) { e.stopPropagation(); setDraft(value); setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }
  function commit() { if (draft.trim()) onChange(draft.trim()); setEditing(false); }
  if (editing) {
    return (
      <input
        ref={inputRef}
        className="field-input"
        style={{ width: 190, fontWeight: 700 }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        onClick={e => e.stopPropagation()}
      />
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{value}</span>
      <button className="icon-btn" title="Edit name" onClick={startEdit} style={{ width: 22, height: 22, color: 'var(--text-sub)' }}>
        <Pencil size={13} />
      </button>
    </div>
  );
}

// ── Level block (optional levels toggle on/off) ─────────────────────────────
function LevelBlock({ title, optional, active, onToggle, children }) {
  return (
    <div style={{
      border: `1px solid ${active ? 'color-mix(in srgb, var(--blue) 40%, transparent)' : 'var(--border)'}`,
      borderRadius: 8, padding: 12,
      background: active ? 'color-mix(in srgb, var(--blue) 7%, transparent)' : 'var(--surface-2)',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {optional
          ? <Toggle on={active} set={onToggle} />
          : <span style={{ width: 32, display: 'inline-flex', alignItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--blue)' }} /></span>}
        <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: active ? 'var(--blue)' : 'var(--text-sub)' }}>{title}</span>
        {optional && <span style={{ fontSize: '0.62rem', color: 'var(--text-sub)' }}>optional</span>}
      </div>
      <div style={{ opacity: active ? 1 : 0.3, pointerEvents: active ? 'auto' : 'none' }}>{children}</div>
    </div>
  );
}

// ── Delimiter row between two levels ────────────────────────────────────────
function DelimRow({ label, value, onChange, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: active ? 1 : 0.25 }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: '0.62rem', color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>{label}</span>
      <select className="field-input" style={{ width: 120, padding: '4px 8px', fontSize: '0.75rem' }} value={value} onChange={e => onChange(e.target.value)} disabled={!active}>
        {DELIM_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Option pills (the named identifiers in this shop) ───────────────────────
function OptionPills({ items, onAdd, onRemove, placeholder }) {
  const [val, setVal] = useState('');
  function add() { if (val.trim()) { onAdd(val.trim()); setVal(''); } }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7, minHeight: 22 }}>
        {items.length === 0
          ? <span style={{ fontSize: '0.7rem', color: 'var(--text-sub)' }}>None added yet</span>
          : items.map(item => (
            <span key={item.id} className="chip font-mono" style={{ gap: 5 }}>
              {item.label}
              <button className="icon-btn" style={{ width: 16, height: 16 }} title="Remove" onClick={() => onRemove(item.id)}><X size={11} /></button>
            </span>
          ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="field-input" style={{ flex: 1 }} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={placeholder} />
        <button className="btn btn-secondary btn-sm" onClick={add}>Add</button>
      </div>
    </div>
  );
}

// ── Level type + identifier fields ──────────────────────────────────────────
function LevelFields({ level, types, updateLevel }) {
  const typeName = levelTypeName(level);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div>
        <Lbl>Level type</Lbl>
        <select className="field-input" value={level.levelType} onChange={e => updateLevel({ levelType: e.target.value })}>
          {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {level.levelType === 'custom' && (
          <input className="field-input" style={{ marginTop: 6 }} value={level.customTypeName} onChange={e => updateLevel({ customTypeName: e.target.value })} placeholder="Type name" />
        )}
      </div>
      <div>
        <Lbl>Identifier</Lbl>
        <select className="field-input" value={level.identFormat} onChange={e => updateLevel({ identFormat: e.target.value })}>
          {IDENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {level.identFormat === 'custom' && (
          <input className="field-input font-mono" style={{ marginTop: 6 }} value={level.customIdent} onChange={e => updateLevel({ customIdent: e.target.value })} placeholder="e.g. LC" />
        )}
      </div>
      {level.identFormat !== 'custom' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Lbl>{typeName}s in this shop</Lbl>
          <OptionPills
            items={level.options}
            onAdd={label => updateLevel({ options: [...level.options, newLevelOption(label, level.options.length)] })}
            onRemove={id => updateLevel({ options: level.options.filter(o => o.id !== id) })}
            placeholder={`Add ${typeName.toLowerCase()}…`}
          />
        </div>
      )}
    </div>
  );
}

function proShopHint(mode, fixedVal) {
  if (mode === 'number_only') return '"LC-140" → "140"';
  if (mode === 'fixed') return `Always → "${fixedVal || '?'}"`;
  if (mode === 'full') return 'Exports as-is';
  return '';
}

// ── Normalization step (real analysis against the live library) ─────────────
function NormalizationStep({ sys, tools, buffered = false, onCommit, onUpdate }) {
  const [phase, setPhase] = useState(sys.normalized ? 'done' : 'idle'); // idle | preview | committing | done
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => { setPhase(sys.normalized ? 'done' : 'idle'); }, [sys.normalized]);

  // Normalization commits LOCATION data to the live library — it can't run on an
  // unsaved (buffered) config. Prompt the user to save first.
  if (buffered) {
    return (
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Location Normalization</span>
          <Badge color="o">Save settings first</Badge>
        </div>
        <p className="text-sub text-sm" style={{ margin: 0 }}>
          Save your settings changes (top of the page) to analyze and normalize the library against this system.
        </p>
      </div>
    );
  }

  function runAnalysis() {
    setAnalysis(analyzeSystem(tools, sys));
    setPhase('preview');
  }
  async function commit() {
    setPhase('committing');
    try { await onCommit(sys.id); setPhase('done'); }
    catch { setPhase('preview'); }
  }
  function reset() { onUpdate({ ...sys, normalized: false }); setPhase('idle'); }

  const matched = analysis?.matched.length ?? 0;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Location Normalization</span>
        <InfoTip text="Scans your tool library and matches each tool's current location text to this system's pattern. Commit assigns LOCATION data only — it never renumbers or changes Tool IDs. Once complete, this app owns location data: ProShop imports won't overwrite it, and next-available bin suggestions become accurate." />
        {phase === 'done' && <Badge color="g">Complete</Badge>}
        {phase === 'idle' && <Badge color="o">Not run</Badge>}
        {phase === 'preview' && <Badge color="b">Ready to commit</Badge>}
      </div>

      {phase === 'idle' && (
        <div>
          <p className="text-sub text-sm" style={{ margin: '0 0 10px' }}>
            Scan the tool library to match existing location text to this system. Shows matched tools, next available bin, and anything that doesn't fit.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={runAnalysis}>Analyze library →</button>
        </div>
      )}

      {phase === 'preview' && analysis && (
        <div>
          <div style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)', borderRadius: 7, padding: '10px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--green)' }}>{matched} tool{matched === 1 ? '' : 's'} matched this system</span>
            {analysis.nextBin !== null
              ? <span style={{ fontSize: '0.75rem', color: 'var(--green)' }}>Next available bin: <span className="font-mono" style={{ fontWeight: 700 }}>{analysis.nextBin}</span></span>
              : <span style={{ fontSize: '0.75rem', color: 'var(--green)' }}>Fixed value — no counter needed</span>}
          </div>
          <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
            {analysis.unmatched.length} location-text tool{analysis.unmatched.length === 1 ? '' : 's'} and {analysis.noLocation} with no location won't match — they stay in the unmatched list below all systems.
          </div>
          <ExclusionNotice system="location" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={commit} disabled={matched === 0}>Normalize {matched} tool{matched === 1 ? '' : 's'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPhase('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {phase === 'committing' && (
        <div className="text-sub text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" /> Assigning locations…
        </div>
      )}

      {phase === 'done' && (
        <div>
          <div style={{ background: 'color-mix(in srgb, var(--green) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)', borderRadius: 7, padding: '10px 12px', marginBottom: 10, fontSize: '0.8rem', color: 'var(--green)' }}>
            This system is normalized — this app owns its location data. ProShop import no longer overwrites it.
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Reset normalization</button>
        </div>
      )}
    </div>
  );
}

// ── Duplicate-output / duplicate-name warning ───────────────────────────────
// Non-blocking. Surfaces when a system could produce the same user-visible ID as
// another (checked on the composed output, not the settings labels), is identical
// except for the delimiter, or shares a name. See findSystemConflicts.
function ConflictWarning({ conflicts }) {
  const names = (type) => [...new Set(conflicts.filter(c => c.type === type).map(c => c.otherName || 'another system'))];
  const out = names('output');
  const delim = names('delimiter');
  const name = names('name');
  const lines = [];
  if (out.length) lines.push(<>Could produce the <strong>same visible IDs</strong> as {joinNames(out)} — a tool in either system could end up with an identical location. Change the levels, option labels, or delimiter so the outputs differ.</>);
  if (delim.length) lines.push(<>Identical to {joinNames(delim)} <strong>except the delimiter</strong> — effectively the same system. Differentiate or remove one.</>);
  if (name.length) lines.push(<>Shares its <strong>name</strong> with {joinNames(name)} — give each system a unique name.</>);
  return (
    <div style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)', borderRadius: 7, padding: '10px 12px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--orange)', fontSize: '0.8rem' }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

function joinNames(arr) {
  return arr.map((n, i) => (
    <span key={i}><strong>{n || '—'}</strong>{i < arr.length - 1 ? ', ' : ''}</span>
  ));
}

// ── System card ─────────────────────────────────────────────────────────────
function SystemCard({ sys, tools, conflicts = [], buffered = false, onUpdate, onDelete, onCommit, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirmDel, setConfirmDel] = useState(false);
  const L = sys.levels; const D = sys.delimiters;
  const hasOutputClash = conflicts.some(c => c.type === 'output');
  const hasDelimClash = conflicts.some(c => c.type === 'delimiter');
  const hasNameClash = conflicts.some(c => c.type === 'name');
  const upd = (level, patch) => onUpdate({ ...sys, levels: { ...sys.levels, [level]: { ...sys.levels[level], ...patch } } });
  const updD = (key, val) => onUpdate({ ...sys, delimiters: { ...sys.delimiters, [key]: val } });
  const preview = buildPreview(sys);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer', background: open ? 'var(--surface-2)' : 'transparent' }} onClick={() => setOpen(o => !o)}>
        <EditableName value={sys.name} onChange={name => onUpdate({ ...sys, name })} />
        {sys.normalized && <Badge color="g">Normalized</Badge>}
        {sys.allowDuplicates && <Badge color="b">Dupes OK</Badge>}
        {hasOutputClash && <Badge color="o">⚠ Duplicate output</Badge>}
        {!hasOutputClash && hasDelimClash && <Badge color="o">⚠ Near-duplicate</Badge>}
        {hasNameClash && <Badge color="o">⚠ Name clash</Badge>}
        <div style={{ flex: 1, minWidth: 12 }} />
        <LivePreview value={preview} />
        {open ? <ChevronUp size={15} style={{ color: 'var(--text-sub)' }} /> : <ChevronDown size={15} style={{ color: 'var(--text-sub)' }} />}
      </div>

      {open && (
        <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
          {conflicts.length > 0 && <ConflictWarning conflicts={conflicts} />}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', marginBottom: 14 }}>
            <Toggle on={sys.allowDuplicates} set={v => onUpdate({ ...sys, allowDuplicates: v })} />
            Allow duplicate locations
          </label>

          <div style={{ marginBottom: 16 }}>
            <Lbl>ProShop location export</Lbl>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select className="field-input" style={{ width: 230 }} value={sys.proShopExport} onChange={e => onUpdate({ ...sys, proShopExport: e.target.value })}>
                <option value="number_only">Number only (strip labels)</option>
                <option value="full">Full location string</option>
                <option value="fixed">Fixed value</option>
              </select>
              {sys.proShopExport === 'fixed' && (
                <input className="field-input font-mono" style={{ width: 100 }} value={sys.fixedExport} onChange={e => onUpdate({ ...sys, fixedExport: e.target.value })} placeholder="e.g. 1000" />
              )}
              <span className="text-sub text-xs">{proShopHint(sys.proShopExport, sys.fixedExport)}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <div className="text-sub text-xs" style={{ marginBottom: 12 }}>
            Configure levels from zone (broadest) down to bin. Delimiter controls appear between each level, grayed out when the adjacent level is inactive.
          </div>

          <LevelBlock title="Zone" optional active={L.zone.on} onToggle={v => upd('zone', { on: v })}>
            <LevelFields level={L.zone} types={ZONE_TYPES} updateLevel={p => upd('zone', p)} />
          </LevelBlock>
          <DelimRow label="zone → station" value={D.zs} onChange={v => updD('zs', v)} active={L.zone.on && L.station.on} />

          <LevelBlock title="Station" optional active={L.station.on} onToggle={v => upd('station', { on: v })}>
            <LevelFields level={L.station} types={STATION_TYPES} updateLevel={p => upd('station', p)} />
          </LevelBlock>
          <DelimRow label="station → drawer" value={D.sd} onChange={v => updD('sd', v)} active={L.station.on && L.drawer.on} />

          <LevelBlock title="Drawer" optional active={L.drawer.on} onToggle={v => upd('drawer', { on: v })}>
            <LevelFields level={L.drawer} types={DRAWER_TYPES} updateLevel={p => upd('drawer', p)} />
          </LevelBlock>
          <DelimRow label="drawer → bin" value={D.db} onChange={v => updD('db', v)} active={L.drawer.on} />

          <LevelBlock title="Bin" optional={false} active>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Lbl>Mode</Lbl>
                <select className="field-input" value={L.bin.fixed ? 'fixed' : 'increment'} onChange={e => upd('bin', { fixed: e.target.value === 'fixed' })}>
                  <option value="increment">Auto-increment</option>
                  <option value="fixed">Fixed value</option>
                </select>
              </div>
              <div>
                <Lbl>{L.bin.fixed ? 'Fixed value' : 'Start at'}</Lbl>
                <input className="field-input font-mono" value={L.bin.fixed ? L.bin.fixedVal : String(L.bin.start)}
                  onChange={e => L.bin.fixed ? upd('bin', { fixedVal: e.target.value }) : upd('bin', { start: parseInt(e.target.value) || 1 })}
                  placeholder="1000" />
              </div>
            </div>
          </LevelBlock>

          <NormalizationStep sys={sys} tools={tools} buffered={buffered} onCommit={onCommit} onUpdate={onUpdate} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            {confirmDel ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="text-sub text-sm">Delete this system?</span>
                <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} /> Delete system
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Library-wide unmatched panel ────────────────────────────────────────────
function LibraryUnmatchedPanel({ tools, systems }) {
  const [showTable, setShowTable] = useState(false);
  const status = libraryLocationStatus(tools, systems);
  if (!status) return null;
  const allClear = status.unassigned === 0;

  return (
    <div style={{ marginTop: 8, background: 'var(--surface)', border: `1px solid color-mix(in srgb, ${allClear ? 'var(--green)' : 'var(--orange)'} 45%, transparent)`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Library Location Status</span>
            <InfoTip text="Shows how many tools across your entire library have been assigned to a location system. Tools that didn't match any system need attention — either create a new system to catch them, or fix their location text manually." />
          </div>
          <div className="text-sub text-xs">{status.total} total tools</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Counter n={status.assigned} label="ASSIGNED" color="var(--green)" />
          <Counter n={status.unassigned} label="UNASSIGNED" color={status.unassigned > 0 ? 'var(--orange)' : 'var(--green)'} />
        </div>
      </div>

      {allClear ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--green)' }}>All tools are assigned to a location system.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            {status.withLocation > 0 && (
              <div className="text-sub text-sm"><span style={{ color: 'var(--orange)', fontWeight: 600 }}>{status.withLocation}</span> have location text that didn't match any system</div>
            )}
            {status.withoutLocation > 0 && (
              <div className="text-sub text-sm"><span style={{ fontWeight: 600 }}>{status.withoutLocation}</span> have no location set</div>
            )}
          </div>
          <div className="text-sub text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 12, display: 'flex', gap: 6 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            Create additional location systems for unmatched tools, then normalize each one. After each pass, check this list — it shrinks as more tools get accounted for.
          </div>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--blue)' }} onClick={() => setShowTable(v => !v)}>
            {showTable ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showTable ? 'Hide' : 'View'} {status.unassigned} unassigned tools
          </button>
          {showTable && (
            <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px', background: 'var(--surface-2)', padding: '7px 12px', gap: 10 }}>
                {['Tool ID', 'Description', 'Location text'].map(h => <span key={h} style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-sub)' }}>{h}</span>)}
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {status.unassignedTools.map((tool, i) => (
                  <div key={tool.id} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px', padding: '8px 12px', gap: 10, borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--surface-2)' : 'transparent', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--blue)' }}>{tool.tool_id || tool.tracking_id || '—'}</span>
                    <span style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.description}</span>
                    <span className="font-mono" style={{ fontSize: '0.7rem', color: (tool.location || '').trim() ? 'var(--orange)' : 'var(--text-sub)' }}>{(tool.location || '').trim() || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Counter({ n, label, color }) {
  return (
    <div style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, borderRadius: 6, padding: '6px 12px', textAlign: 'center', minWidth: 64 }}>
      <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{n}</div>
      <div style={{ fontSize: '0.6rem', color, letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}

// ── Root section (embedded in Settings, adjacent to Tool ID System) ─────────
// `configOverride` + `onConfigChange` put this editor in **buffered mode**: it
// reads/writes the passed location_config draft instead of shopSettings, and
// never persists to Drive itself (the Settings page's Save commits the whole
// draft). Normalize is disabled while buffered, since it needs the saved config.
export default function LocationSystemSettings({ configOverride = null, onConfigChange = null }) {
  const { tools, shopSettings, saveLocationConfig, normalizeLocationSystem, markSetupStepInSettings, setupProgress } = useApp();
  const buffered = typeof onConfigChange === 'function';
  const cfg = (buffered ? configOverride : shopSettings?.location_config) || { systems: [], bin_sizes: [] };
  const systems = cfg.systems || [];
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';

  const persist = (nextSystems) => {
    if (buffered) { onConfigChange({ ...cfg, systems: nextSystems }); return; }
    // Mark the Location setup step once (not every keystroke) the first time the
    // shop has a system configured.
    if (nextSystems.length > 0 && !setupProgress?.locationConfigured) markSetupStepInSettings?.('locationConfigured');
    return saveLocationConfig({ ...cfg, systems: nextSystems });
  };
  const setShowLegacy = (v) => buffered ? onConfigChange({ ...cfg, show_legacy: v }) : saveLocationConfig({ ...cfg, show_legacy: v });
  const updateSystem = (id, updated) => persist(systems.map(s => s.id === id ? updated : s));
  const deleteSystem = (id) => persist(systems.filter(s => s.id !== id));
  const addSystem = () => persist([...systems, newLocationSystem()]);

  // Live duplicate-output / duplicate-name detection across all systems.
  const systemConflicts = findSystemConflicts(systems);

  return (
    <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <MapPin size={16} style={{ color: 'var(--blue)' }} />
        <h3 style={{ margin: 0 }}>Location System</h3>
        <InfoTip text="Configure how tools are physically stored. Each system is an independent Zone → Station → Drawer → Bin pattern. Tools reference level ids (never display strings); the composed string is written to Fusion's vendor field and ProShop's Location column." alignRight />
      </div>
      <p className="text-sub text-sm" style={{ marginBottom: 14 }}>
        Configure how tools are physically stored. Each system is independent.
      </p>

      {idMode === 'location' && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid color-mix(in srgb, var(--blue) 40%, transparent)', background: 'color-mix(in srgb, var(--blue) 10%, transparent)', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8rem', color: 'var(--blue)' }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            The Tool ID System is set to <strong>Location</strong> mode — each tool's ID is its composed location string. This section only assigns <strong>locations</strong>; it never renumbers Tool IDs. To (re)generate IDs from locations, use <strong>Assign IDs / Re-number</strong> in the Tool ID System.
          </span>
        </div>
      )}

      {systems.length === 0 && (
        <div className="text-sub text-sm" style={{ marginBottom: 10, padding: 10, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          No location systems yet — add one to describe how your shop stores tools.
        </div>
      )}

      {systems.map((sys, i) => (
        <SystemCard
          key={sys.id}
          sys={sys}
          tools={tools}
          conflicts={systemConflicts.get(sys.id) || []}
          defaultOpen={i === 0}
          buffered={buffered}
          onUpdate={v => updateSystem(sys.id, v)}
          onDelete={() => deleteSystem(sys.id)}
          onCommit={normalizeLocationSystem}
        />
      ))}

      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 4, borderStyle: 'dashed' }} onClick={addSystem}>
        <Plus size={14} /> Add Location System
      </button>

      {/* Show retired locations — shared toggle across the three ID systems.
          Location defaults OFF (Tool ID defaults ON). A search match still
          surfaces a retired location regardless. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', marginTop: 16 }}>
        <Toggle on={cfg.show_legacy ?? false} set={setShowLegacy} />
        Show former (retired) location strings on each tool
      </label>

      <LibraryUnmatchedPanel tools={tools} systems={systems} />
    </div>
  );
}
