// Insert-style tool view: the pairing bar + the two component groups (Holder
// Body / Insert), each duplicating the Geometry & setup, Photo, Location and
// Purchasing sections for its own component record. Everything else on the
// tool page stays shared (presets, jobs, notes, files, history — and the
// combined Fusion geometry, which is what CAM programs against).
// See src/schema/insertFamilies.js for the architecture notes.
import { useState } from 'react';
import {
  Box, Diamond, Ruler, Camera, MapPin, Pencil, Repeat, Link2, ChevronDown,
  ChevronRight, Unlink,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import ComponentPicker from './ComponentPicker.jsx';
import PhotoSlot from './PhotoSlot.jsx';
import LocationPicker from './LocationPicker.jsx';
import PurchasingSection from './PurchasingSection.jsx';
import AttachmentUploadModal from './AttachmentUploadModal.jsx';
import InfoTip from './InfoTip.jsx';
import {
  INSERT_FAMILIES, INSERT_FAMILY_BY_ID, COMPONENT_ROLE_LABELS,
  COMPONENT_SPEC_FIELDS, componentById, pairingAsmNumber,
  composeCombinedProShopId, newPairing, defaultFamilyForType,
} from '../schema/insertFamilies.js';
import { resolveLocationString } from '../utils/locationSystem.js';
import { unitAbbr } from '../utils/units.js';

// Accent per role — holder body borrows the holder teal, insert the orange
// attention color, so the two groups read apart at a glance.
const ROLE_ACCENT = {
  holder_body: 'var(--holder-default)',
  insert: 'var(--orange)',
};
const ROLE_ICON = { holder_body: Box, insert: Diamond };

export default function PairingSections({ tool, onSaveTool }) {
  const {
    components, shopSettings, isSaving, saveComponent, assignComponentLocation,
    uploadComponentPhoto, deleteComponentPhoto, googleAuthenticated,
  } = useApp();
  const pairing = tool.pairing;
  const familyDef = INSERT_FAMILY_BY_ID[pairing.family] || null;
  const compList = components?.components || [];
  const holderComp = componentById(compList, pairing.holder_component_id);
  const insertComp = componentById(compList, pairing.insert_component_id);
  const asmMode = shopSettings?.assembly_id_system?.mode || 'auto';

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [rtaDraft, setRtaDraft] = useState(null); // null = not editing

  const setComponent = async (roleKey, comp) => {
    await onSaveTool({ ...tool, pairing: { ...pairing, [roleKey]: comp.id } });
  };

  // Pairing-level assembly number: turning families only (tier-3 families keep
  // per-assembly numbers in the Assemblies section, composed with both ids).
  const pairAsm = (!familyDef?.hasTier3Assembly && asmMode !== 'proshop_rta')
    ? pairingAsmNumber(pairing, compList)
    : '';

  // The combined ProShop / Fusion product-id both components resolve to.
  const combinedId = composeCombinedProShopId(pairing.family, holderComp, insertComp);

  return (
    <div>
      {/* ── Pairing bar: family, assembly / RTA number, combined ProShop ID ── */}
      <div className="pairing-bar">
        <Link2 size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="pairing-family-pill">{familyDef?.label || pairing.family}</span>
        <InfoTip text="An insert-style tool: a holder body and an insert are separate physical tools (each with its own ID, location and purchasing) paired into the one entity Fusion sees. The sections below show each component; everything else on this page describes the combined tool." />

        {pairAsm && (
          <span className="pairing-asm-badge font-mono" title="Assembly ID — holder body / insert">
            {pairAsm}
          </span>
        )}

        {asmMode === 'proshop_rta' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="text-sub" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RTA#</span>
            {rtaDraft === null ? (
              <>
                <span className="pairing-asm-badge font-mono">{pairing.rta_number || '—'}</span>
                <button className="icon-btn" style={{ width: 22, height: 22 }} title="Edit RTA#"
                  onClick={() => setRtaDraft(pairing.rta_number || '')}>
                  <Pencil size={11} />
                </button>
              </>
            ) : (
              <>
                <input className="field-input font-mono" style={{ width: 110, padding: '3px 8px', fontSize: 12 }}
                  value={rtaDraft} autoFocus placeholder="RTA-1234"
                  onChange={e => setRtaDraft(e.target.value)} />
                <button className="btn btn-primary btn-sm" disabled={isSaving}
                  onClick={async () => {
                    try {
                      await onSaveTool({ ...tool, pairing: { ...pairing, rta_number: rtaDraft.trim() } });
                      setRtaDraft(null);
                    } catch { /* toast handled in context */ }
                  }}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setRtaDraft(null)}>Cancel</button>
              </>
            )}
          </span>
        )}

        {combinedId && combinedId !== tool.tool_id && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="text-sub" style={{ fontSize: 12 }}>Combined ID:</span>
            <span className="tool-id-pill">{combinedId}</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              disabled={isSaving}
              title="Set this tool's Tool ID (mirrored to Fusion's product-id) to the combined holder/insert ID"
              onClick={async () => {
                if (tool.tool_id && !window.confirm(`Replace Tool ID "${tool.tool_id}" with "${combinedId}"?`)) return;
                try { await onSaveTool({ ...tool, tool_id: combinedId }); }
                catch { /* toast handled in context */ }
              }}
            >
              Apply as Tool ID
            </button>
            <InfoTip alignRight text="Fusion sees this pairing as ONE tool entity whose product-id is the two ProShop IDs joined with a slash (e.g. TF-194/TO-195). Applying keeps the tool's ID in sync with its components." />
          </span>
        )}

        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!confirmUnlink ? (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--text-sub)' }}
              title="Remove the holder body + insert pairing (component records are kept)"
              onClick={() => setConfirmUnlink(true)}>
              <Unlink size={12} /> Unpair
            </button>
          ) : (
            <>
              <span className="text-sub" style={{ fontSize: 12 }}>Remove pairing?</span>
              <button className="btn btn-danger btn-sm" disabled={isSaving}
                onClick={async () => {
                  try { await onSaveTool({ ...tool, pairing: null }); }
                  catch { /* toast handled in context */ }
                  setConfirmUnlink(false);
                }}>Remove</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmUnlink(false)}>Keep</button>
            </>
          )}
        </span>
      </div>

      {/* ── The two component groups ── */}
      <div className="pairing-groups">
        <ComponentGroup
          role="holder_body"
          comp={holderComp}
          family={pairing.family}
          currentId={pairing.holder_component_id}
          onPick={c => setComponent('holder_component_id', c)}
          {...{ saveComponent, assignComponentLocation, uploadComponentPhoto, deleteComponentPhoto, googleAuthenticated, isSaving, shopSettings }}
        />
        <ComponentGroup
          role="insert"
          comp={insertComp}
          family={pairing.family}
          currentId={pairing.insert_component_id}
          onPick={c => setComponent('insert_component_id', c)}
          {...{ saveComponent, assignComponentLocation, uploadComponentPhoto, deleteComponentPhoto, googleAuthenticated, isSaving, shopSettings }}
        />
      </div>
    </div>
  );
}

// ─── One component group card (Holder Body or Insert) ───────────────────────
function ComponentGroup({
  role, comp, family, currentId, onPick,
  saveComponent, assignComponentLocation, uploadComponentPhoto, deleteComponentPhoto,
  googleAuthenticated, isSaving, shopSettings,
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const accent = ROLE_ACCENT[role];
  const Icon = ROLE_ICON[role];
  const label = COMPONENT_ROLE_LABELS[role];

  const systems = shopSettings?.location_config?.systems || [];
  const locString = comp?.tool_location ? resolveLocationString(comp.tool_location, systems) : '';

  return (
    <div className="pairing-group" style={{ '--pairing-accent': accent }}>
      <div className="pairing-group-header">
        <Icon size={15} style={{ color: accent, flexShrink: 0 }} />
        <span className="pairing-group-title">{label}</span>
        {comp?.tool_id && <span className="tool-id-pill">{comp.tool_id}</span>}
        {locString && <span className="location-tag">{locString}</span>}
        {comp && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', fontSize: 11 }}
            title={`Pick a different ${label.toLowerCase()} record for this pairing`}
            onClick={() => setShowPicker(true)}>
            <Repeat size={12} /> Change
          </button>
        )}
      </div>

      <div className="pairing-group-body">
        {!comp ? (
          <div style={{ padding: '18px 8px', textAlign: 'center' }}>
            <div className="text-sub text-sm" style={{ marginBottom: 10 }}>
              No {label.toLowerCase()} linked yet.
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowPicker(true)}>
              Select {label.toLowerCase()}…
            </button>
          </div>
        ) : (
          <>
            {comp.description && (
              <div style={{ padding: '0 2px' }}>
                <span className="description-badge" style={{ fontSize: 13 }}>{comp.description}</span>
              </div>
            )}

            <SubSection title="Geometry & Setup" icon={Ruler}>
              <SpecsPanel comp={comp} onSave={saveComponent} isSaving={isSaving} />
            </SubSection>

            <SubSection title="Photo" icon={Camera}>
              <PhotoSlot
                record={comp}
                googleAuthenticated={googleAuthenticated}
                onChangePhoto={() => setShowPhotoUpload(true)}
                onDeletePhoto={async () => {
                  try { await deleteComponentPhoto(comp); }
                  catch { /* toast handled in context */ }
                }}
              />
            </SubSection>

            <SubSection title="Location" icon={MapPin} defaultOpen={false}>
              <LocationPicker
                record={comp}
                onAssign={(loc, binSizeId) => assignComponentLocation(comp, loc, binSizeId)}
              />
            </SubSection>

            <PurchasingSection
              tool={comp}
              isSaving={isSaving}
              onSave={async (updated) => {
                try { await saveComponent(updated); }
                catch { /* toast handled in context */ }
              }}
            />
          </>
        )}
      </div>

      {showPicker && (
        <ComponentPicker
          role={role}
          family={family}
          currentId={currentId}
          onSelect={async (c) => {
            setShowPicker(false);
            try { await onPick(c); }
            catch { /* toast handled in context */ }
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showPhotoUpload && comp && (
        <AttachmentUploadModal
          open={showPhotoUpload}
          onClose={() => setShowPhotoUpload(false)}
          onUpload={async (file, fileName) => {
            await uploadComponentPhoto(comp, file, fileName);
          }}
          photoMode
        />
      )}
    </div>
  );
}

// ─── Component spec fields (per-role "Geometry & setup") ────────────────────
function SpecsPanel({ comp, onSave, isSaving }) {
  const fields = COMPONENT_SPEC_FIELDS[comp.role] || [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comp);

  const startEditing = () => { setDraft(comp); setEditing(true); };
  const set = (key, val) => setDraft(d => ({ ...d, [key]: val }));

  const fmt = (f) => {
    const v = comp[f.key];
    if (v === null || v === undefined || v === '') return null;
    if (f.type === 'num') {
      const n = Number(v);
      if (!isFinite(n)) return null;
      const s = Number(n.toFixed(4)).toString();
      return f.unit === 'length' ? `${s} ${unitAbbr(comp.unit)}` : s;
    }
    return String(v);
  };

  if (!editing) {
    return (
      <div>
        <div className="detail-fields">
          <ViewField label="Tool ID" value={comp.tool_id} mono />
          {fields.map(f => <ViewField key={f.key} label={f.label} value={fmt(f)} mono={f.key === 'designation'} />)}
        </div>
        {comp.notes && (
          <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, margin: '8px 2px 0' }}>{comp.notes}</p>
        )}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 11 }} onClick={startEditing}>
          <Pencil size={11} /> Edit
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field-group">
          <label className="field-label">Tool ID</label>
          <input className="field-input font-mono" value={draft.tool_id || ''}
            onChange={e => set('tool_id', e.target.value)} placeholder="e.g. TO-195" />
        </div>
        <div className="field-group">
          <label className="field-label">Description</label>
          <input className="field-input" value={draft.description || ''}
            onChange={e => set('description', e.target.value)} placeholder="—" />
        </div>
        {fields.map(f => (
          <div className="field-group" key={f.key}>
            <label className="field-label">
              {f.label}{f.type === 'num' && f.unit === 'length' ? ` (${unitAbbr(draft.unit)})` : ''}
            </label>
            {f.type === 'num' ? (
              <input className="field-input" type="number" step="0.0001" value={draft[f.key] ?? ''}
                placeholder="—"
                onChange={e => set(f.key, e.target.value === '' ? null : parseFloat(e.target.value))} />
            ) : (
              <input className="field-input" value={draft[f.key] || ''} placeholder={f.placeholder || '—'}
                onChange={e => set(f.key, e.target.value)} />
            )}
          </div>
        ))}
      </div>
      <div className="field-group" style={{ marginTop: 8 }}>
        <label className="field-label">Notes</label>
        <textarea className="field-input" rows={2} value={draft.notes || ''}
          onChange={e => set('notes', e.target.value)} placeholder="—" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-secondary btn-sm" disabled={isSaving} onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn btn-primary btn-sm" disabled={isSaving}
          onClick={async () => {
            try { await onSave(draft); setEditing(false); }
            catch { /* toast handled in context */ }
          }}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function ViewField({ label, value, mono }) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className={`detail-field-value ${isEmpty ? 'detail-field-empty' : ''} ${mono ? 'font-mono' : ''}`}>
        {isEmpty ? '—' : value}
      </div>
    </div>
  );
}

// Collapsible sub-panel matching the app's standard .panel styling.
function SubSection({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`panel ${open ? 'open' : ''}`} style={{ marginBottom: 0 }}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        {Icon && <Icon size={14} className="panel-header-icon" />}
        <span className="panel-header-title">{title}</span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

// ─── "Set up as insert-style tool" panel (unpaired, eligible tool types) ────
export function PairingSetupPanel({ tool, onSaveTool, isSaving }) {
  const [open, setOpen] = useState(false);
  const [family, setFamily] = useState(defaultFamilyForType(tool.tool_type));

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Link2 size={15} className="panel-header-icon" />
        <span className="panel-header-title">Insert-Style Tool</span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <div className="panel-body">
          <p className="text-sub text-sm" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            Pair this tool as a <strong>holder body + insert</strong> — the two components are
            separate physical tools (each with its own ID, location and purchasing) that this
            entry combines into the single tool Fusion sees.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field-group" style={{ minWidth: 220 }}>
              <label className="field-label">Family</label>
              <select className="field-input" value={family} onChange={e => setFamily(e.target.value)}>
                {INSERT_FAMILIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" disabled={isSaving}
              onClick={async () => {
                try { await onSaveTool({ ...tool, pairing: newPairing(family) }); }
                catch { /* toast handled in context */ }
              }}>
              {isSaving ? 'Saving…' : 'Set up pairing'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
