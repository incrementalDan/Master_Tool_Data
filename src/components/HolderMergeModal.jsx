// ─── Merge two holder records into one ──────────────────────────────────────
//
// Reached two ways, both landing here: the automatic duplicate list, and
// "Merge with…" on a holder's own page (pick any two — the app doesn't have to
// have spotted it).
//
// You pick which record SURVIVES; that choice is the geometry choice, because
// the merge never takes the loser's geometry. Everything that referenced the
// loser follows the survivor afterwards, without any tool being rewritten (the
// survivor adopts the loser's Fusion guid — see utils/holderDuplicates.js).

import { useState } from 'react';
import { X, ArrowRight, Check } from 'lucide-react';
import HolderPill from './HolderPill.jsx';
import { mergeHolderRecords, toolsFollowingMerge, holderGuidsOf } from '../utils/holderDuplicates.js';
import { assemblyUsesHolder } from '../schema/holderResolve.js';
import { deriveGaugeLength, formatHolderLen, holderLenIn } from '../utils/holderGeometry.js';
import { holderOptionLabel } from '../schema/holderOptions.js';

const FIELD_LABEL = {
  manufacturer: 'Manufacturer', part_number: 'Part number', vendor: 'Vendor',
  product_link: 'Product link', location: 'Location', notes: 'Notes', color: 'Color',
  length: 'Length', type_id: 'Type', taper_id: 'Taper', collet_family_id: 'Collet family',
  collet_size_id: 'Collet size', purchasing: 'Purchasing', extension: 'Extension details',
  body_part_id: 'Body part link', extension_part_id: 'Extension part link',
};

function Card({ holder, config, tools, selected, onSelect, role }) {
  const gauge = deriveGaugeLength(holder.segments);
  const uses = toolsFollowingMerge(holder, tools, assemblyUsesHolder);
  return (
    <button className={`holder-merge-card${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="holder-merge-card-head">
        <span className={`holder-merge-role ${selected ? 'keep' : 'drop'}`}>
          {selected ? 'KEEP THIS ONE' : role}
        </span>
        {selected && <Check size={13} />}
      </div>
      <HolderPill holder={holder} config={config} compact />
      <dl className="holder-merge-specs">
        <div><dt>Gauge</dt><dd>{formatHolderLen(gauge, holder.unit)} {holder.unit === 'millimeters' ? 'mm' : 'in'}
          <span className="alt"> ({formatHolderLen(holderLenIn(gauge, holder.unit), 'inches')}")</span></dd></div>
        <div><dt>Segments</dt><dd>{holder.segments?.length || 0}</dd></div>
        <div><dt>Taper</dt><dd>{holderOptionLabel(config, 'tapers', holder.taper_id) || '—'}</dd></div>
        <div><dt>Collet</dt><dd>{holderOptionLabel(config, 'collet_sizes', holder.collet_size_id) || '—'}</dd></div>
        <div><dt>Used by</dt><dd>{uses} tool{uses === 1 ? '' : 's'}</dd></div>
        <div><dt>Ref</dt><dd className="mono">{holder.holder_ref}</dd></div>
      </dl>
    </button>
  );
}

export default function HolderMergeModal({ a, b, config, tools = [], match, onCommit, onClose }) {
  // Default the survivor to the one the app would guess is more refined: more
  // segments usually means the tidied rebuild. It is only a default — the whole
  // decision is the user's, and it's the first thing they see.
  const [keepId, setKeepId] = useState(
    ((b.segments?.length || 0) > (a.segments?.length || 0)) ? b.id : a.id);

  const survivor = keepId === a.id ? a : b;
  const loser = keepId === a.id ? b : a;
  const { filled } = mergeHolderRecords(survivor, loser);
  const following = toolsFollowingMerge(loser, tools, assemblyUsesHolder);
  const adopting = holderGuidsOf(loser).length;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-merge-modal">
        <div className="modal-header">
          <div>
            <h3>Merge two holders</h3>
            <p className="modal-sub">
              Pick the record to keep — that choice is the geometry choice. Everything that
              referenced the other one follows it afterwards.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {match && (
            <div className={`holder-merge-why ${match.verdict}`}>
              <strong>{match.verdict === 'duplicate' ? 'Looks like the same holder' : 'Possibly the same holder'}</strong>
              <ul>{match.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}

          <div className="holder-merge-cards">
            <Card holder={a} config={config} tools={tools} role="MERGE AWAY"
              selected={keepId === a.id} onSelect={() => setKeepId(a.id)} />
            <Card holder={b} config={config} tools={tools} role="MERGE AWAY"
              selected={keepId === b.id} onSelect={() => setKeepId(b.id)} />
          </div>

          <div className="holder-merge-effect">
            <div className="row">
              <ArrowRight size={13} />
              <span>
                <strong>{following} tool{following === 1 ? '' : 's'}</strong> that reference
                “{loser.description || loser.holder_ref}” will resolve to the kept record.
                No tool is rewritten — the kept record adopts {adopting === 1 ? 'its' : `its ${adopting}`} Fusion
                reference{adopting === 1 ? '' : 's'}.
              </span>
            </div>
            {filled.length > 0 && (
              <div className="row">
                <ArrowRight size={13} />
                <span>
                  Blank fields on the kept record will be filled from the other:{' '}
                  <strong>{filled.map(f => FIELD_LABEL[f] || f).join(', ')}</strong>.
                  Nothing it already has is changed.
                </span>
              </div>
            )}
            <div className="row muted">
              <ArrowRight size={13} />
              <span>
                Geometry is NOT merged — the kept record’s segments are used as they are.
                The other record is removed from the app; the Fusion library is untouched.
              </span>
            </div>
            {/* Be explicit about what a merge does NOT do. Fusion bakes holder
                geometry into each tool, so those tools still physically carry
                the old holder's segments until they're written. The merge makes
                the app resolve them to the kept record — which is what lets the
                corrected geometry reach them later — but it is not itself the
                fix. Saying "no tool is rewritten" without this reads as "done". */}
            <div className="row muted">
              <ArrowRight size={13} />
              <span>
                Those tools still carry the <strong>old holder’s geometry</strong> in their own
                Fusion data. Merging points them at the kept record; the corrected geometry
                reaches them when each tool is next written (re-stamping isn’t wired up yet).
              </span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            The removed holder stays searchable by its reference on the kept record.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => onCommit(survivor.id, loser.id)}>
            Keep “{(survivor.description || survivor.holder_ref).slice(0, 28)}”
          </button>
        </div>
      </div>
    </div>
  );
}
