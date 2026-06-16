import { useState, useRef } from 'react';
import { ShoppingCart, Plus, GripVertical, X, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { generateId } from '../schema/toolSchema.js';
import { getManufacturerNames, getVendorNames, vendorHasOwnCatalogNumber } from '../schema/vendorRegistry.js';
import {
  generateManufacturerUrl, generateVendorUrl,
  manufacturerHasUrlGenerator, vendorHasUrlGenerator,
} from '../utils/urlGenerators.js';

function blankManufacturer(order) {
  return { id: generateId(), name: '', edp: '', edp_url: '', mfg_num: '', mfg_num_url: '', order };
}
function blankVendor(manufacturerId, order) {
  // TODO: per-vendor lead_time field
  return { id: generateId(), manufacturer_id: manufacturerId, name: '', vendor_num: '', vendor_num_url: '', price: null, order };
}

function emptyPurchasing() {
  return { manufacturers: [], vendors: [] };
}

// Persist any links that were only shown as a display-time fallback (no
// stored URL, but a generator matches the part number) — so they become real
// stored values the user can see/override afterward. Never overwrites a URL
// the user already set.
function backfillUrls(data) {
  return {
    ...data,
    manufacturers: (data.manufacturers || []).map(m => ({
      ...m,
      mfg_num_url: m.mfg_num_url || generateManufacturerUrl(m.name, m.mfg_num) || m.mfg_num_url || '',
      edp_url: m.edp_url || generateManufacturerUrl(m.name, m.edp) || m.edp_url || '',
    })),
    vendors: (data.vendors || []).map(v => ({
      ...v,
      vendor_num_url: v.vendor_num_url || generateVendorUrl(v.name, v.vendor_num) || v.vendor_num_url || '',
    })),
  };
}

// Re-sequence `order` fields: manufacturers by their own order, vendors by
// order within their manufacturer group.
function normalizePurchasing(data) {
  const manufacturers = [...(data.manufacturers || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((m, i) => ({ ...m, order: i }));
  const vendors = [];
  for (const m of manufacturers) {
    (data.vendors || [])
      .filter(v => v.manufacturer_id === m.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((v, i) => vendors.push({ ...v, order: i }));
  }
  return { manufacturers, vendors };
}

function shouldShowVendorNum(vendor, revealedVendorNums) {
  return vendorHasOwnCatalogNumber(vendor.name) || !!vendor.vendor_num || revealedVendorNums.has(vendor.id);
}

// Cheapest-first comparator for the read-only vendor list. Vendors without a
// price sort to the bottom, in their stored order.
function byPriceAsc(a, b) {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return a.price - b.price;
}

// A number field (EDP#, MFG#, Vendor#) — view mode shows the value as a link
// (with an ExternalLink icon) when a URL is stored or can be auto-generated,
// plain text otherwise. Edit mode shows just the value input — the link
// itself is edited in a full-width LinkEditor row below the main row.
function NumCell({ value, url, placeholder, editing, onChangeValue }) {
  if (editing) {
    return (
      <div className="purchasing-cell purchasing-cell--num">
        <input
          className="field-input"
          value={value || ''}
          placeholder={placeholder}
          onChange={e => onChangeValue(e.target.value)}
        />
      </div>
    );
  }
  if (!value) return <div className="purchasing-cell purchasing-cell--num purchasing-value detail-field-empty">—</div>;
  if (url) {
    return (
      <div className="purchasing-cell purchasing-cell--num purchasing-value">
        <a className="purchasing-link font-mono" href={url} target="_blank" rel="noopener noreferrer">
          {value}<ExternalLink size={12} />
        </a>
      </div>
    );
  }
  return <div className="purchasing-cell purchasing-cell--num purchasing-value font-mono">{value}</div>;
}

// Full-width link-edit row shown below a manufacturer/vendor row in edit
// mode — one per number field that can carry a URL (MFG#, EDP#, Vendor#).
// Wider than the 82px number column so pasting/editing a URL is usable.
function LinkEditor({ label, url, onChangeUrl, canRegenerate, onRegenerate }) {
  return (
    <div className="purchasing-link-field">
      <span className="purchasing-link-label">{label} link</span>
      <div className="purchasing-url-row">
        <input
          className="field-input purchasing-url-input"
          value={url || ''}
          placeholder="https://… (optional)"
          onChange={e => onChangeUrl(e.target.value)}
        />
        {canRegenerate && (
          <button
            type="button"
            className="purchasing-regen-btn"
            title="Regenerate link from part number"
            onClick={onRegenerate}
          >
            <RefreshCw size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function PriceCell({ value, editing, onChange }) {
  if (editing) {
    return (
      <div className="purchasing-cell purchasing-cell--num">
        <input
          className="field-input purchasing-price-input"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
        />
      </div>
    );
  }
  return (
    <div className={`purchasing-cell purchasing-cell--num purchasing-value ${value == null ? 'detail-field-empty' : ''}`}>
      {value != null ? `$${Number(value).toFixed(2)}` : '—'}
    </div>
  );
}

// Drag handle (left side of every row). In edit mode it doubles as a delete
// button — hover reveals an X over the grip; click removes the row.
function RowGrip({ editing, onRemove }) {
  if (!editing) return <div className="purchasing-row-grip" />;
  return (
    <div className="purchasing-row-grip" title="Drag to reorder · click to remove" onClick={onRemove}>
      <GripVertical size={13} className="purchasing-grip-icon" />
      <X size={13} className="purchasing-del-icon" />
    </div>
  );
}

function MfgRow({ mfg, editing, isDragOver, onChange, onRemove, onRegenerateUrl, dragHandlers }) {
  const hasGenerator = manufacturerHasUrlGenerator(mfg.name);
  // Display-time fallback: if no URL is stored but a generator matches this
  // manufacturer + part number, show the generated link immediately — even
  // for tools whose purchasing data predates the URL-generation feature.
  const mfgNumUrl = mfg.mfg_num_url || generateManufacturerUrl(mfg.name, mfg.mfg_num);
  const edpUrl = mfg.edp_url || generateManufacturerUrl(mfg.name, mfg.edp);
  return (
    <>
      <div className={`purchasing-row${isDragOver ? ' purchasing-row--drop' : ''}`} {...dragHandlers}>
        <RowGrip editing={editing} onRemove={onRemove} />
        {editing ? (
          <input
            className="field-input purchasing-cell purchasing-cell--name purchasing-mfg-name"
            list="purchasing-mfr-list"
            placeholder="Manufacturer"
            value={mfg.name}
            onChange={e => onChange({ name: e.target.value })}
          />
        ) : (
          <div className="purchasing-cell purchasing-cell--name purchasing-value purchasing-mfg-name truncate" title={mfg.name}>{mfg.name || '—'}</div>
        )}
        <NumCell
          value={mfg.mfg_num}
          url={mfgNumUrl}
          placeholder="MFG#"
          editing={editing}
          onChangeValue={v => onChange({ mfg_num: v })}
        />
        <NumCell
          value={mfg.edp}
          url={edpUrl}
          placeholder="EDP#"
          editing={editing}
          onChangeValue={v => onChange({ edp: v })}
        />
      </div>
      {editing && (
        <div className="purchasing-link-row">
          <LinkEditor
            label="MFG#"
            url={mfg.mfg_num_url}
            onChangeUrl={v => onChange({ mfg_num_url: v })}
            canRegenerate={hasGenerator && !!mfg.mfg_num}
            onRegenerate={() => onRegenerateUrl('mfg_num', 'mfg_num_url')}
          />
          <LinkEditor
            label="EDP#"
            url={mfg.edp_url}
            onChangeUrl={v => onChange({ edp_url: v })}
            canRegenerate={hasGenerator && !!mfg.edp}
            onRegenerate={() => onRegenerateUrl('edp', 'edp_url')}
          />
        </div>
      )}
    </>
  );
}

function VendorRow({ vendor, editing, isDragOver, revealed, onChange, onRemove, onReveal, onRegenerateUrl, dragHandlers }) {
  const showNum = shouldShowVendorNum(vendor, revealed);
  // Display-time fallback — see MfgRow.
  const vendorNumUrl = vendor.vendor_num_url || generateVendorUrl(vendor.name, vendor.vendor_num);
  return (
    <>
      <div className={`purchasing-row purchasing-row--vendor${isDragOver ? ' purchasing-row--drop' : ''}`} {...dragHandlers}>
        <RowGrip editing={editing} onRemove={onRemove} />
        {editing ? (
          <input
            className="field-input purchasing-cell purchasing-cell--name"
            list="purchasing-vendor-list"
            placeholder="Vendor"
            value={vendor.name}
            onChange={e => onChange({ name: e.target.value })}
          />
        ) : (
          <div className="purchasing-cell purchasing-cell--name purchasing-value truncate" title={vendor.name}>{vendor.name || '—'}</div>
        )}
        <PriceCell value={vendor.price} editing={editing} onChange={v => onChange({ price: v })} />
        {showNum ? (
          <NumCell
            value={vendor.vendor_num}
            url={vendorNumUrl}
            placeholder="Vendor#"
            editing={editing}
            onChangeValue={v => onChange({ vendor_num: v })}
          />
        ) : editing ? (
          <button type="button" className="btn btn-ghost btn-sm purchasing-addnum-btn" onClick={onReveal}>
            + Add vendor #
          </button>
        ) : (
          <div className="purchasing-cell purchasing-cell--num" />
        )}
      </div>
      {editing && showNum && (
        <div className="purchasing-link-row">
          <LinkEditor
            label="Vendor#"
            url={vendor.vendor_num_url}
            onChangeUrl={v => onChange({ vendor_num_url: v })}
            canRegenerate={vendorHasUrlGenerator(vendor.name) && !!vendor.vendor_num}
            onRegenerate={() => onRegenerateUrl('vendor_num', 'vendor_num_url')}
          />
        </div>
      )}
    </>
  );
}

export default function PurchasingSection({ tool, onSave, isSaving }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(() => tool.purchasing || emptyPurchasing());
  const [revealedVendorNums, setRevealedVendorNums] = useState(new Set());
  const [dragOverKey, setDragOverKey] = useState(null);
  const dragSrc = useRef(null);

  const manufacturers = [...(data.manufacturers || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Order-based — used for drag-reorder bookkeeping (must match handleVendorDrop's view of the group).
  const vendorsFor = (mfgId) =>
    (data.vendors || []).filter(v => v.manufacturer_id === mfgId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Display order — while editing, vendors stay in their drag-ordered sequence;
  // otherwise the cheapest vendor is shown first.
  const displayVendorsFor = (mfgId) => {
    const ordered = vendorsFor(mfgId);
    return editing ? ordered : [...ordered].sort(byPriceAsc);
  };

  const startEditing = () => {
    setData(tool.purchasing || emptyPurchasing());
    setRevealedVendorNums(new Set());
    setEditing(true);
  };
  const handleCancel = () => {
    setData(tool.purchasing || emptyPurchasing());
    setRevealedVendorNums(new Set());
    setEditing(false);
  };
  const handleSave = async () => {
    const normalized = normalizePurchasing(backfillUrls(data));
    setData(normalized);
    setEditing(false);
    await onSave({ ...tool, purchasing: normalized });
  };

  // Auto-fill a generated URL when the field is currently empty and a
  // generator matches the (possibly just-updated) manufacturer/vendor name.
  // Never overwrites a URL the user already has set.
  const updateMfg = (id, patch) => {
    setData(d => ({
      ...d,
      manufacturers: d.manufacturers.map(m => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        if (!next.edp_url && next.name && next.edp) {
          const generated = generateManufacturerUrl(next.name, next.edp);
          if (generated) next.edp_url = generated;
        }
        if (!next.mfg_num_url && next.name && next.mfg_num) {
          const generated = generateManufacturerUrl(next.name, next.mfg_num);
          if (generated) next.mfg_num_url = generated;
        }
        return next;
      }),
    }));
  };
  const updateVendor = (id, patch) => {
    setData(d => ({
      ...d,
      vendors: d.vendors.map(v => {
        if (v.id !== id) return v;
        const next = { ...v, ...patch };
        if (!next.vendor_num_url && next.name && next.vendor_num) {
          const generated = generateVendorUrl(next.name, next.vendor_num);
          if (generated) next.vendor_num_url = generated;
        }
        return next;
      }),
    }));
  };

  // "Regenerate" button — runs the generator and overwrites the current URL,
  // confirming first if a different link is already stored.
  const regenerateMfgUrl = (id, field, urlField) => {
    setData(d => ({
      ...d,
      manufacturers: d.manufacturers.map(m => {
        if (m.id !== id) return m;
        const generated = generateManufacturerUrl(m.name, m[field]);
        if (!generated) return m;
        if (m[urlField] && m[urlField] !== generated &&
            !window.confirm('Replace the current link with the auto-generated one?')) return m;
        return { ...m, [urlField]: generated };
      }),
    }));
  };
  const regenerateVendorUrl = (id, field, urlField) => {
    setData(d => ({
      ...d,
      vendors: d.vendors.map(v => {
        if (v.id !== id) return v;
        const generated = generateVendorUrl(v.name, v[field]);
        if (!generated) return v;
        if (v[urlField] && v[urlField] !== generated &&
            !window.confirm('Replace the current link with the auto-generated one?')) return v;
        return { ...v, [urlField]: generated };
      }),
    }));
  };
  const addManufacturer = () => {
    setData(d => ({ ...d, manufacturers: [...d.manufacturers, blankManufacturer(d.manufacturers.length)] }));
  };
  const addVendor = (mfgId) => {
    setData(d => ({ ...d, vendors: [...d.vendors, blankVendor(mfgId, vendorsFor(mfgId).length)] }));
  };
  const removeManufacturer = (id) => {
    setData(d => ({
      manufacturers: d.manufacturers.filter(m => m.id !== id),
      vendors: d.vendors.filter(v => v.manufacturer_id !== id),
    }));
  };
  const removeVendor = (id) => {
    setData(d => ({ ...d, vendors: d.vendors.filter(v => v.id !== id) }));
  };
  const revealVendorNum = (id) => {
    setRevealedVendorNums(prev => new Set(prev).add(id));
  };

  // ── Drag-to-reorder ── manufacturers reorder among themselves; vendors
  // reorder within their own manufacturer's group only.
  const handleDragStart = (e, key) => {
    dragSrc.current = key;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, key) => {
    e.preventDefault();
    setDragOverKey(key);
  };
  const handleDragEnd = () => {
    dragSrc.current = null;
    setDragOverKey(null);
  };
  const handleMfgDrop = (e, idx) => {
    e.preventDefault();
    const src = dragSrc.current;
    dragSrc.current = null;
    setDragOverKey(null);
    if (typeof src !== 'string' || !src.startsWith('mfg-')) return;
    const srcIdx = parseInt(src.slice(4), 10);
    if (srcIdx === idx) return;
    const list = [...manufacturers];
    const [moved] = list.splice(srcIdx, 1);
    list.splice(idx, 0, moved);
    setData(d => ({ ...d, manufacturers: list.map((m, i) => ({ ...m, order: i })) }));
  };
  const handleVendorDrop = (e, mfgId, idx) => {
    e.preventDefault();
    const src = dragSrc.current;
    dragSrc.current = null;
    setDragOverKey(null);
    const prefix = `vendor-${mfgId}-`;
    if (typeof src !== 'string' || !src.startsWith(prefix)) return;
    const srcIdx = parseInt(src.slice(prefix.length), 10);
    if (srcIdx === idx) return;
    const group = vendorsFor(mfgId);
    const list = [...group];
    const [moved] = list.splice(srcIdx, 1);
    list.splice(idx, 0, moved);
    const reordered = list.map((v, i) => ({ ...v, order: i }));
    setData(d => ({
      ...d,
      vendors: [...d.vendors.filter(v => v.manufacturer_id !== mfgId), ...reordered],
    }));
  };

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <ShoppingCart size={15} className="panel-header-icon" />
        <span className="panel-header-title">Purchasing</span>
        {!editing && open && (
          <span
            className="icon-btn"
            title="Edit purchasing info"
            onClick={e => { e.stopPropagation(); startEditing(); }}
          >
            <Pencil size={12} />
          </span>
        )}
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="panel-body">
          {manufacturers.length === 0 && !editing && (
            <div className="detail-field-empty text-sm">No purchasing info yet.</div>
          )}

          {manufacturers.map((mfg, mIdx) => {
            const vendors = displayVendorsFor(mfg.id);
            return (
              <div key={mfg.id} className="purchasing-mfg-card">
                <div className="purchasing-header-row">
                  <div className="purchasing-cell" />
                  <div className="purchasing-cell purchasing-cell--name">Manufacturer</div>
                  <div className="purchasing-cell purchasing-cell--num">MFG#</div>
                  <div className="purchasing-cell purchasing-cell--num">EDP#</div>
                </div>
                <MfgRow
                  mfg={mfg}
                  editing={editing}
                  isDragOver={dragOverKey === `mfg-${mIdx}`}
                  onChange={patch => updateMfg(mfg.id, patch)}
                  onRemove={() => removeManufacturer(mfg.id)}
                  onRegenerateUrl={(field, urlField) => regenerateMfgUrl(mfg.id, field, urlField)}
                  dragHandlers={editing ? {
                    draggable: true,
                    onDragStart: e => handleDragStart(e, `mfg-${mIdx}`),
                    onDragOver: e => handleDragOver(e, `mfg-${mIdx}`),
                    onDrop: e => handleMfgDrop(e, mIdx),
                    onDragEnd: handleDragEnd,
                  } : {}}
                />

                {(vendors.length > 0 || editing) && (
                  <>
                    <div className="purchasing-vendor-table">
                      <div className="purchasing-header-row">
                        <div className="purchasing-cell" />
                        <div className="purchasing-cell purchasing-cell--name">Vendor</div>
                        <div className="purchasing-cell purchasing-cell--num">Cost</div>
                        <div className="purchasing-cell purchasing-cell--num">Vendor#</div>
                      </div>
                      {vendors.map((vendor, vIdx) => (
                        <VendorRow
                          key={vendor.id}
                          vendor={vendor}
                          editing={editing}
                          revealed={revealedVendorNums}
                          isDragOver={dragOverKey === `vendor-${mfg.id}-${vIdx}`}
                          onChange={patch => updateVendor(vendor.id, patch)}
                          onRemove={() => removeVendor(vendor.id)}
                          onReveal={() => revealVendorNum(vendor.id)}
                          onRegenerateUrl={(field, urlField) => regenerateVendorUrl(vendor.id, field, urlField)}
                          dragHandlers={editing ? {
                            draggable: true,
                            onDragStart: e => handleDragStart(e, `vendor-${mfg.id}-${vIdx}`),
                            onDragOver: e => handleDragOver(e, `vendor-${mfg.id}-${vIdx}`),
                            onDrop: e => handleVendorDrop(e, mfg.id, vIdx),
                            onDragEnd: handleDragEnd,
                          } : {}}
                        />
                      ))}
                    </div>
                    {editing && (
                      <button type="button" className="btn btn-ghost btn-sm purchasing-add-vendor" onClick={() => addVendor(mfg.id)}>
                        <Plus size={12} /> Add vendor
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={addManufacturer}>
              <Plus size={13} /> Add manufacturer
            </button>
          )}

          {editing && (
            <div className="purchasing-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancel} disabled={isSaving}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {editing && (
            <>
              <datalist id="purchasing-mfr-list">
                {getManufacturerNames().map(m => <option key={m} value={m} />)}
              </datalist>
              <datalist id="purchasing-vendor-list">
                {getVendorNames().map(v => <option key={v} value={v} />)}
              </datalist>
            </>
          )}
        </div>
      )}
    </div>
  );
}
