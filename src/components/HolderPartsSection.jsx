// ─── Holder parts — the body and the extension a holder is assembled from ───
//
// A taper holder and an extension are separate parts, bought separately, stored
// separately, and combined at more than one stickout. This section is where a
// holder says WHICH physical parts it's built from, so their part number,
// vendor and location live in one place instead of being copied onto every
// holder built from them.
//
// The holder keeps its own segments. When they drift from the part's reference
// geometry, that's shown with both directions offered — the app can't know
// which one is right, so it never picks.

import { useState } from 'react';
import { Link2, Unlink, Plus, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
import {
  HOLDER_PART_ROLES, holderPartRoleLabel, holderPartsOf, holderPartFor,
  holderPartDrift, holdersUsingPart, newHolderPart, adoptHolderGeometryIntoPart,
} from '../utils/holderParts.js';
import { roleSegments } from '../utils/holderBody.js';
import { formatHolderLen, totalSegmentHeight } from '../utils/holderGeometry.js';
import { unitAbbr } from '../utils/units.js';

function PartRow({
  holder, role, file, holders, readOnly,
  onLink, onUnlink, onCreate, onAdoptFromHolder, onAdoptIntoHolder,
}) {
  const [picking, setPicking] = useState(false);
  const part = holderPartFor(holder, role, file);
  const drift = holderPartDrift(holder, role, file);
  const mine = roleSegments(holder, role);
  const options = holderPartsOf(file, role);
  const label = holderPartRoleLabel(role);

  // An extension row is pointless on a holder that doesn't have one.
  if (role === 'extension' && !holder.has_extension) return null;

  return (
    <div className={`holder-part-row${drift ? ' drifted' : ''}`}>
      <div className="holder-part-head">
        <span className="holder-part-role">{label}</span>
        {part ? (
          <>
            <span className="holder-part-name">{part.description || '(unnamed part)'}</span>
            <span className="holder-part-used">
              used by {holdersUsingPart(part, holders).length} holder{holdersUsingPart(part, holders).length === 1 ? '' : 's'}
            </span>
            {!readOnly && (
              <button className="btn btn-ghost btn-sm" onClick={() => onUnlink(role)} title="Unlink — the holder keeps its own geometry">
                <Unlink size={12} /> Unlink
              </button>
            )}
          </>
        ) : (
          <>
            <span className="holder-part-none">Not linked to a part</span>
            {!readOnly && mine && (
              <>
                {options.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setPicking(p => !p)}>
                    <Link2 size={12} /> Link existing
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => onCreate(role)}>
                  <Plus size={12} /> Create from this holder
                </button>
              </>
            )}
          </>
        )}
      </div>

      {picking && !part && (
        <div className="holder-part-picker">
          <select
            className="field-input"
            defaultValue=""
            onChange={e => { if (e.target.value) { onLink(role, e.target.value); setPicking(false); } }}
          >
            <option value="">Choose a {label.toLowerCase()}…</option>
            {options.map(p => (
              <option key={p.id} value={p.id}>
                {p.description || '(unnamed)'} · {formatHolderLen(totalSegmentHeight(p.segments), p.unit)} {unitAbbr(p.unit)}
              </option>
            ))}
          </select>
        </div>
      )}

      {part && (
        <div className="holder-part-meta">
          {[['Manufacturer', part.manufacturer], ['Part number', part.part_number],
            ['Vendor', part.vendor], ['Location', part.location]]
            .filter(([, v]) => v)
            .map(([k, v]) => <span key={k}><em>{k}</em> {v}</span>)}
          {!part.manufacturer && !part.part_number && !part.vendor && !part.location && (
            <span className="holder-part-empty">No sourcing on this part yet — add it once here and every holder using it has it.</span>
          )}
        </div>
      )}

      {/* Drift: both directions offered, neither preferred. The app cannot know
          whether the holder was corrected or the part was. */}
      {drift && (
        <div className="holder-part-drift">
          <AlertTriangle size={13} />
          <div className="holder-part-drift-text">
            This holder’s {label.toLowerCase()} geometry doesn’t match the part it points at.
            One of them was corrected and the other wasn’t — pick which is right.
          </div>
          {!readOnly && (
            <div className="holder-part-drift-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => onAdoptFromHolder(role)} title="The holder is right — update the part (affects every holder using it)">
                <ArrowRight size={12} /> Holder → part
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onAdoptIntoHolder(role)} title="The part is right — update just this holder's segments">
                <ArrowLeft size={12} /> Part → holder
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HolderPartsSection({
  holder, file, holders = [], readOnly,
  onLink, onUnlink, onCreate, onAdoptFromHolder, onAdoptIntoHolder,
}) {
  return (
    <div className="holder-parts">
      {HOLDER_PART_ROLES.map(role => (
        <PartRow
          key={role}
          holder={holder} role={role} file={file} holders={holders} readOnly={readOnly}
          onLink={onLink} onUnlink={onUnlink} onCreate={onCreate}
          onAdoptFromHolder={onAdoptFromHolder} onAdoptIntoHolder={onAdoptIntoHolder}
        />
      ))}
      <div className="holder-parts-note">
        The taper holder and the extension are separate parts you buy separately — linking them
        here keeps their part number, vendor and location in one place. The holder keeps its own
        geometry either way.
      </div>
    </div>
  );
}

export { newHolderPart, adoptHolderGeometryIntoPart };
