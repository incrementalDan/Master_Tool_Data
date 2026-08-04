// ─── Link cutting tools to holder records: preview → commit ─────────────────
//
// The migration pass. Every tool out there carries a frozen copy of a holder
// that Fusion absorbed; this works out which record each one is and stamps the
// link. Three tiers, and only the first is silent:
//
//   Exact shape        → linked, no questions. ~93% of the real library.
//   One dimension out,
//   names agree        → pre-ticked with the difference spelled out in mm.
//   Anything else      → a short list to work through by hand.
//
// The point of the split is that the middle tier LOOKS like the bottom one by
// the numbers alone — see holderLink.js for the case where a 0.15" difference
// is a different stickout rather than a different drawing.

import { useState, useMemo } from 'react';
import { X, Link2, AlertTriangle, Check } from 'lucide-react';
import HolderPill from './HolderPill.jsx';
import { NEAR_MAX_MM } from '../utils/holderLink.js';

const toolName = (t) => t.description || t.tool_id || t.id;

export default function LinkToolsModal({ plan, holders, onCommit, onClose }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  // Near rows start ticked; manual picks start empty. Keyed by assembly.
  const [picks, setPicks] = useState(() => {
    const m = new Map();
    for (const r of plan?.near || []) m.set(r.assemblyId, r.record.id);
    return m;
  });

  const setPick = (assemblyId, holderId) => setPicks(prev => {
    const next = new Map(prev);
    if (!holderId) next.delete(assemblyId); else next.set(assemblyId, holderId);
    return next;
  });

  const links = useMemo(() => {
    const out = (plan?.auto || []).map(r => ({
      toolId: r.toolId, assemblyId: r.assemblyId, holderId: r.record.id,
    }));
    for (const r of [...(plan?.near || []), ...(plan?.review || [])]) {
      const holderId = picks.get(r.assemblyId);
      if (holderId) out.push({ toolId: r.toolId, assemblyId: r.assemblyId, holderId });
    }
    return out;
  }, [plan, picks]);

  const nearAllOn = (plan?.near || []).every(r => picks.has(r.assemblyId));

  const Row = ({ r, tone }) => (
    <div className={`link-row ${tone}`}>
      <div className="link-row-tool">
        <div className="link-tool-name">{toolName(r.tool)}</div>
        <div className="link-tool-holder">
          carries <span className="mono">{r.baked?.description?.trim() || '(no holder name)'}</span>
        </div>
      </div>
      <div className="link-row-pick">
        <select
          className="field-input"
          value={picks.get(r.assemblyId) || ''}
          onChange={e => setPick(r.assemblyId, e.target.value)}
        >
          <option value="">— leave unlinked —</option>
          {/* Suggestions first, then everything, so a wrong guess is one click
              from the right answer rather than a hunt. */}
          {(r.alternatives?.length ? r.alternatives : []).map(h => (
            <option key={`s-${h.id}`} value={h.id}>★ {h.description || h.holder_ref}</option>
          ))}
          {(holders || [])
            .filter(h => !(r.alternatives || []).some(a => a.id === h.id))
            .map(h => <option key={h.id} value={h.id}>{h.description || h.holder_ref}</option>)}
        </select>
        {r.why && <div className="link-row-why">{r.why}</div>}
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal link-tools-modal">
        <div className="modal-header">
          <div>
            <h3>Link tools to holders</h3>
            <p className="modal-sub">
              Each tool carries a frozen copy of its holder. This works out which holder record
              that copy is, and stores the link — so from then on the holder library is what
              those tools follow.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {done > 0 ? (
            <div className="holder-note">
              <Check size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Linked {done} assembl{done === 1 ? 'y' : 'ies'}. Their geometry updates the next time
              each tool is saved — or use <b>Re-stamp</b> on a holder to push it now.
            </div>
          ) : (
            <>
              <div className="link-summary">
                <div className="restamp-stat ok"><b>{plan?.auto?.length || 0}</b><span>exact match</span></div>
                <div className="restamp-stat warn"><b>{plan?.near?.length || 0}</b><span>near match</span></div>
                <div className="restamp-stat err"><b>{plan?.review?.length || 0}</b><span>need a look</span></div>
              </div>

              {!plan?.rows?.length && (
                <div className="holder-empty">Every tool is already linked to a holder record.</div>
              )}

              {(plan?.auto?.length > 0) && (
                <p className="modal-sub">
                  {plan.auto.length} assembl{plan.auto.length === 1 ? 'y' : 'ies'} match a holder
                  record exactly, segment for segment. Those are linked on commit with no choice
                  to make.
                </p>
              )}

              {(plan?.near?.length > 0) && (
                <div className="link-group">
                  <div className="link-group-head">
                    <b>Near matches</b>
                    <span className="modal-sub">
                      One dimension out by under {NEAR_MAX_MM}mm and the names agree — the same
                      holder drawn slightly differently. Ticked, but yours to undo.
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPicks(prev => {
                        const next = new Map(prev);
                        for (const r of plan.near) {
                          if (nearAllOn) next.delete(r.assemblyId);
                          else next.set(r.assemblyId, r.record.id);
                        }
                        return next;
                      })}
                    >{nearAllOn ? 'Untick all' : 'Tick all'}</button>
                  </div>
                  {plan.near.map(r => <Row key={r.assemblyId} r={r} tone="near" />)}
                </div>
              )}

              {(plan?.review?.length > 0) && (
                <div className="link-group">
                  <div className="link-group-head">
                    <AlertTriangle size={13} />
                    <b>Need a look</b>
                    <span className="modal-sub">
                      Nothing matched closely enough to offer. Pick a holder, or leave it — an
                      unlinked tool keeps the holder geometry it already carries.
                    </span>
                  </div>
                  {plan.review.map(r => <Row key={r.assemblyId} r={r} tone="review" />)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            Stores the link only. No tool geometry changes here.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {done > 0 ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              className="btn btn-primary btn-sm"
              disabled={!links.length || busy}
              onClick={async () => {
                setBusy(true);
                try { setDone(await onCommit(links)); } finally { setBusy(false); }
              }}
            >
              <Link2 size={13} /> Link {links.length} assembl{links.length === 1 ? 'y' : 'ies'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
