// The insert-style (holder body + insert) activation toggle.
//
// Lifted out of ToolForm so the unified page and the new-tool form show the
// same control. Always-insert types (face mill / turning / boring head) already
// open the paired view automatically, so the toggle is offered only on the
// other types — the ~5% opt-in case.
//
// ⚠️ A slash in the Fusion product-id makes a tool insert-style INTRINSICALLY:
// derivePairings re-detects it on every load, so a toggle that turned it off
// would silently turn itself back on. That case gets a read-only note instead.
import { Link2 } from 'lucide-react';
import Section from './ToolSection.jsx';
import InfoTip from '../InfoTip.jsx';
import {
  INSERT_FAMILIES, INSERT_FAMILY_BY_ID, ALWAYS_INSERT_TYPES,
  defaultActivationFamily, newPairing, isCombinedProShopId,
} from '../../schema/insertFamilies.js';

/** The toggle's effect, shared so both callers confirm and clear identically. */
export function togglePairingPatch(data, on) {
  if (on) return { pairing: newPairing(defaultActivationFamily(data.tool_type)) };
  return { pairing: null };
}

export const pairingHasComponents = (p) =>
  !!(p && (p.holder_component_id || p.insert_component_id));

export default function InsertStyleBlock({ data, setField, afterSaveHint = true }) {
  if (ALWAYS_INSERT_TYPES.has(data.tool_type)) return null;

  const toggle = (on) => {
    // Unlinking components is not destructive — the component records stay in
    // tool_components.json — but it is not obvious, so it is confirmed.
    if (!on && pairingHasComponents(data.pairing)
      && !window.confirm('Turn off insert-style? The holder body and insert stay in the app but are unlinked from this tool.')) return;
    const patch = togglePairingPatch(data, on);
    for (const [k, v] of Object.entries(patch)) setField(k, v);
  };

  return (
    <Section className="mb-16" title="Insert-Style Tool" icon={Link2}>
      {isCombinedProShopId(data.tool_id) ? (
        <p className="text-sub text-sm" style={{ lineHeight: 1.5 }}>
          Insert-style — detected from the Fusion product-id
          {' '}(<span className="font-mono">{data.tool_id}</span>), which combines the
          holder body and insert ProShop numbers with a “/”. Set the family and
          link the components below; to change whether it&apos;s insert-style,
          edit the product-id in Fusion.
        </p>
      ) : (
        <>
          <label className="checkbox-row">
            <input type="checkbox" checked={!!data.pairing} onChange={e => toggle(e.target.checked)} />
            <span className="text-sub text-sm">Insert-style tool — separate holder body + insert</span>
            <InfoTip text="Turn on when this tool is physically two pieces — a holder body and an insert tip — each with its own Tool ID, location and purchasing. The tool page then splits into Holder Body / Insert sections. Nothing changes in Fusion; the two components are tracked only in the app." />
          </label>
          {data.pairing && (
            <div className="field-group mt-12" style={{ maxWidth: 340 }}>
              <label className="field-label">Insert-tool family</label>
              <select
                className="field-input"
                value={data.pairing.family}
                onChange={e => setField('pairing', { ...data.pairing, family: e.target.value })}
              >
                {INSERT_FAMILIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <p className="text-sub text-xs mt-6">
                {INSERT_FAMILY_BY_ID[data.pairing.family]?.hasTier3Assembly === false
                  ? 'The pairing itself is the finished tool (no holder assembly).'
                  : 'Keeps its holder + OOH assembly.'}{' '}
                {afterSaveHint
                  ? 'Link the holder body and insert on the tool page after saving.'
                  : 'Link the holder body and insert in the sections above.'}
              </p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
