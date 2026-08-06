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

import { useState, useMemo, useEffect } from 'react';
import { X, Link2, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { NEAR_MAX_MM } from '../utils/holderLink.js';

const toolName = (t) => t.description || t.tool_id || t.id;

export default function LinkToolsModal({ plan, holders, onPreview, onCommit, onClose }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  // Near rows start ticked; manual picks start empty. Keyed by assembly.
  const [picks, setPicks] = useState(() => {
    const m = new Map();
    for (const r of plan?.near || []) m.set(r.assemblyId, r.record.id);
    // A guessed link is pre-filled with the guess — it is already stored, so
    // leaving it blank would read as "unlink this", the opposite of the intent.
    for (const r of plan?.confirm || []) if (r.record) m.set(r.assemblyId, r.record.id);
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
    for (const r of [...(plan?.near || []), ...(plan?.confirm || []), ...(plan?.review || [])]) {
      const holderId = picks.get(r.assemblyId);
      if (holderId) out.push({ toolId: r.toolId, assemblyId: r.assemblyId, holderId });
    }
    return out;
  }, [plan, picks]);

  const nearAllOn = (plan?.near || []).every(r => picks.has(r.assemblyId));

  // What this selection would do to FUSION — the number that actually matters,
  // since a link with stale geometry left behind is only half the job.
  const [effect, setEffect] = useState(null);
  useEffect(() => {
    let live = true;
    if (!onPreview || !links.length) { setEffect(null); return undefined; }
    Promise.resolve(onPreview(links))
      .then(r => { if (live) setEffect(r); })
      .catch(() => { if (live) setEffect(null); });
    return () => { live = false; };
  }, [links, onPreview]);

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
          {done ? (
            <div className="holder-note">
              <Check size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Linked {done.linked} assembl{done.linked === 1 ? 'y' : 'ies'}.
              {done.rewritten
                ? ` ${done.rewritten} tool${done.rewritten === 1 ? '' : 's'} had holder geometry that
                   disagreed with its record — those are corrected in Fusion now.`
                : ' Every one already carried the right holder geometry, so nothing needed rewriting in Fusion.'}
            </div>
          ) : (
            <>
              <div className="link-summary">
                <div className="restamp-stat ok"><b>{plan?.auto?.length || 0}</b><span>exact match</span></div>
                <div className="restamp-stat warn"><b>{plan?.near?.length || 0}</b><span>near match</span></div>
                {(plan?.confirm?.length > 0) && (
                  <div className="restamp-stat warn"><b>{plan.confirm.length}</b><span>confirm</span></div>
                )}
                <div className="restamp-stat err"><b>{plan?.review?.length || 0}</b><span>need a look</span></div>
              </div>

              {!plan?.rows?.length && (
                <div className="holder-empty">Every tool is already linked to a holder record.</div>
              )}

              {/* Said out loud rather than silently dropped — otherwise the
                  counts don't add up to the library and it looks like a bug. */}
              {plan?.skipped?.length > 0 && (
                <div className="text-sub" style={{ fontSize: 12, marginTop: 8 }}>
                  {plan.skipped.length} turning tool{plan.skipped.length === 1 ? '' : 's'} left out —
                  they hold differently and carry no holder geometry in Fusion, so there is nothing
                  to match on.
                </div>
              )}

              {/* THE PART THAT MATTERS. Storing the link fixes the pointer;
                  this is what actually corrects Fusion. A tool whose baked copy
                  already matches its record isn't rewritten — there is nothing
                  to correct, and rewriting the library to change nothing is a
                  slow way to risk a bad write. */}
              {effect && (
                <div className={`link-effect${effect.rewritten ? ' active' : ''}`}>
                  <RefreshCw size={13} />
                  {effect.rewritten ? (
                    <div>
                      <b>{effect.rewritten} tool{effect.rewritten === 1 ? '' : 's'} will be corrected in Fusion.</b>{' '}
                      Their frozen holder copy disagrees with the record they’re being linked to, so
                      the record’s geometry is written into them. After this, no tool in Fusion
                      carries holder data that disagrees with its holder.
                      {effect.checks?.some(c => c.level === 'warn') && (
                        <div className="link-effect-gauges">
                          {effect.checks.filter(c => c.level === 'warn').slice(0, 8).map((c, i) => (
                            <div key={i}>
                              <span className="mono">{toolName(c.tool)}</span>
                              {' — assembly gauge moves '}
                              <b>{c.deltaMm > 0 ? '+' : ''}{c.deltaMm?.toFixed(2)}mm</b>
                            </div>
                          ))}
                          {effect.checks.filter(c => c.level === 'warn').length > 8 && (
                            <div>…and {effect.checks.filter(c => c.level === 'warn').length - 8} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      Every selected tool already carries the right holder geometry — nothing needs
                      rewriting in Fusion.
                    </div>
                  )}
                </div>
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

              {/* Already linked — but on ONE signal, so the user gets to see
                  what the tool was carrying and change it. Pre-filled with the
                  guess; clearing it unlinks. */}
              {(plan?.confirm?.length > 0) && (
                <div className="link-group">
                  <div className="link-group-head">
                    <b>Confirm these</b>
                    <span className="modal-sub">
                      Matched, but not on both signals — the ID we stamped into the holder AND its
                      geometry. Linked so nothing dangles; check each one is the right holder.
                    </span>
                  </div>
                  {plan.confirm.map(r => <Row key={r.assemblyId} r={r} tone="near" />)}
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
            {effect?.rewritten
              ? `Also corrects ${effect.rewritten} tool${effect.rewritten === 1 ? '' : 's'} in Fusion.`
              : 'Stores the link. Tools already carrying the right geometry aren’t rewritten.'}
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
                try {
                  const r = await onCommit(links);
                  if (r) setDone(r);     // null = it failed and was already reported
                } finally { setBusy(false); }
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
