// ─── Retire a holder ────────────────────────────────────────────────────────
//
// Retiring ARCHIVES a record: it leaves the library, no matcher returns it
// again, and Fusion's copy is deleted on the next push. Its geometry is kept.
//
// ⚠️ THE PART THAT MATTERS IS THE TOOLS. A retired holder that still has tools
// pointing at it leaves them nowhere: `resolveHolderForWrite` skips archived
// records, so the next ordinary save of each tool falls back to whatever the
// FUSION holder library happens to hold — silently undoing every correction
// made here, one tool at a time, with nothing on screen to say so. Warning
// about that and retiring anyway is how the library gets messy.
//
// So when a holder is in use, this asks for somewhere for those tools to GO.
// THE MAIN JOB IS "REPLACE THIS HOLDER WITH A BETTER-DRAWN ONE": pick the more
// correct record, every tool moves onto it, Fusion is corrected in the same
// commit, and the old record retires. The two holders need no relation to each
// other — different segments, a gauge several mm apart, Fusion guids that mean
// nothing. Nothing here reads a guid.
//
// ⚠️ WHICH IS WHY THE GAUGE CHANGE IS SHOWN PER TOOL, not just a count. Swapping
// to a holder drawn 8mm differently moves every one of those tools' assembly
// gauge by 8mm — a real machining consequence, and the number worth checking
// before committing. It comes from the same gaugeChecks backstop re-stamp uses.
//
// (Merge, in Duplicates, is the OTHER case: two records that were the same
// physical holder, where the survivor absorbs the loser's identity and no tool
// is rewritten. Linked from the hint, not reimplemented here.)
//
// ⚠️ AND IT IS BLOCKED BEFORE NORMALIZE. "Which tools use this holder" is read
// off tool assemblies, which don't exist until the library has been normalized.
// Before that the count reads LOW — often zero — so the modal would cheerfully
// say "no tools use this" about a holder half the shop is running.

import { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, ArrowRight, Trash2 } from 'lucide-react';
import HolderPill from './HolderPill.jsx';
import { assemblyUsesHolder } from '../schema/holderResolve.js';
import { formatHolderLen } from '../utils/holderGeometry.js';
import { unitAbbr } from '../utils/units.js';

// Every assembly pointing at this record, with its tool — the rows that need
// somewhere to go. Uses the same predicate as every other "who uses this
// holder" question in the app (FK first, guid as fallback, follows merges).
export function assembliesUsing(record, tools) {
  const out = [];
  for (const t of tools || []) {
    for (const a of t.assemblies || []) {
      if (assemblyUsesHolder(a, record)) out.push({ tool: t, assembly: a });
    }
  }
  return out;
}

export default function RetireHolderModal({
  record, holders = [], tools = [], config, needsNormalize = false,
  onPreview, onCommit, onMergeInstead, onClose,
}) {
  const users = useMemo(() => assembliesUsing(record, tools), [record, tools]);
  const options = useMemo(
    () => (holders || []).filter(h => h.id !== record.id && h.archived !== true),
    [holders, record.id]);

  const [replacementId, setReplacementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [effect, setEffect] = useState(null);

  const links = useMemo(() => (replacementId
    ? users.map(u => ({ toolId: u.tool.id, assemblyId: u.assembly.assembly_id, holderId: replacementId }))
    : []), [users, replacementId]);

  // How many of those tools Fusion is currently wrong about — the number worth
  // reading, since storing the pointer is not what fixes the library.
  useEffect(() => {
    let live = true;
    if (!onPreview || !links.length) { setEffect(null); return undefined; }
    Promise.resolve(onPreview(links))
      .then(r => { if (live) setEffect(r); })
      .catch(() => { if (live) setEffect(null); });
    return () => { live = false; };
  }, [links, onPreview]);

  // The per-tool gauge change, from the dry run's gaugeChecks. A tool with no
  // check needs no rewrite — it already carries the replacement's geometry.
  const checkFor = (toolId) => (effect?.checks || []).find(c => c.toolId === toolId) || null;
  const gauge = (v, unit) => (v == null || Number.isNaN(v)
    ? '—' : `${formatHolderLen(v, unit)} ${unitAbbr(unit)}`);

  const blocked = needsNormalize;
  const needsReplacement = users.length > 0;
  const canRetire = !blocked && (!needsReplacement || !!replacementId);

  const commit = async () => {
    if (!canRetire || busy) return;
    setBusy(true);
    try { await onCommit({ links }); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal holder-restamp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Retire this holder</h3>
            <p className="modal-sub">
              It moves to the archive: it leaves the library, nothing is matched to it again, and
              Fusion’s copy is deleted on the next push. Its geometry is kept — you can restore it
              later as a new holder.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div style={{ marginBottom: 14 }}>
            <HolderPill holder={record} config={config} />
          </div>

          {/* The gate. Stated as what it protects, not as a rule. */}
          {blocked ? (
            <div className="holder-warn">
              <AlertTriangle size={14} />
              <div>
                <b>Normalize the tool library first.</b> Which tools use a holder is read off their
                assemblies, and those don’t exist until the library has been normalized — so right
                now this screen can’t tell whether any tools would be left without a holder.
                Retiring is disabled until then.
              </div>
            </div>
          ) : needsReplacement ? (
            <>
              <div className="holder-warn">
                <AlertTriangle size={14} />
                <div>
                  <b>{users.length} tool assembl{users.length === 1 ? 'y uses' : 'ies use'} this
                  holder.</b> They need somewhere to go: a retired holder is invisible to the app,
                  so the next time each of these tools is saved it would silently fall back to
                  whatever the Fusion holder library holds — losing any correction made here.
                </div>
              </div>

              <label className="holder-field-label" style={{ marginTop: 14, display: 'block' }}>
                Replace it with
              </label>
              <select
                className="field-input"
                value={replacementId}
                onChange={e => setReplacementId(e.target.value)}
              >
                <option value="">— pick a holder —</option>
                {options.map(h => (
                  <option key={h.id} value={h.id}>{h.description || h.holder_ref}</option>
                ))}
              </select>

              <div className="holder-field-hint" style={{ marginTop: 6 }}>
                Every tool above moves onto it and gets its geometry corrected in Fusion. The two
                holders don’t have to be related — pick whichever record is drawn correctly.
                {' '}(If they’re actually the <b>same</b> holder recorded twice, {' '}
                <button className="inline-link" onClick={onMergeInstead}>merge them instead</button>
                {' '}— that needs no tool writes at all.)
              </div>

              <div style={{ marginTop: 14 }}>
                {users.slice(0, 12).map(u => {
                  // ⚠️ The assembly gauge is what actually changes on the shop
                  // floor. Show old → new per tool, not just "N corrected".
                  const c = checkFor(u.tool.id);
                  return (
                    <div className="link-row" key={`${u.tool.id}:${u.assembly.assembly_id}`}>
                      <div className="link-tool-name">{u.tool.description || u.tool.id}</div>
                      <div className="link-tool-holder">
                        {c ? (
                          <span style={c.level === 'error' ? { color: 'var(--red)' } : undefined}>
                            gauge <span className="mono">{gauge(c.before, u.tool.unit)}</span>
                            {' '}<ArrowRight size={10} />{' '}
                            <span className="mono">{gauge(c.after, u.tool.unit)}</span>
                            {c.reason ? <> — {c.reason}</> : null}
                          </span>
                        ) : replacementId ? 'already carries this geometry'
                          : 'pick a holder above'}
                      </div>
                    </div>
                  );
                })}
                {users.length > 12 && (
                  <div className="text-sub" style={{ fontSize: 12 }}>
                    …and {users.length - 12} more
                  </div>
                )}
              </div>

              {effect && (
                <div className="holder-note" style={{ marginTop: 10 }}>
                  {effect.rewritten
                    ? `${effect.rewritten} of these tools carry holder geometry that disagrees with the `
                      + 'replacement — those are corrected in Fusion as part of this.'
                    : 'Every one of these already carries the replacement’s geometry, so nothing needs '
                      + 'rewriting in Fusion.'}
                </div>
              )}
            </>
          ) : (
            <div className="holder-empty">
              No tools use this holder — nothing else has to move.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger btn-sm" onClick={commit} disabled={!canRetire || busy}>
            <Trash2 size={14} />
            {busy ? 'Retiring…'
              : needsReplacement && replacementId
                ? `Move ${users.length} tool${users.length === 1 ? '' : 's'} & retire`
                : 'Retire holder'}
          </button>
        </div>
      </div>
    </div>
  );
}
