// ─── Push holder records to Fusion: preview → commit ────────────────────────
//
// WHAT THIS IS FOR. The app's holder library is the source of truth, but the
// link back to Fusion only exists once each record's ID is sitting in Fusion's
// product-id field. Until then a holder matches on shape alone, which isn't
// enough to act on. This is the step that settles it.
//
// It shows exactly which Fusion entries will be rewritten and, just as
// importantly, which ones WON'T — a half-match is the shape of someone having
// edited a holder in Fusion, and overwriting it would destroy the only evidence
// of what they changed.

import { useState, useEffect } from 'react';
import { X, Upload, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { PUSH_GROUPS } from '../schema/holderIdentity.js';

const KIND_NOTE = {
  update: 'already in Fusion',
  adopt: 'in Fusion, but with no ID of ours on it yet',
  create: 'not in Fusion at all — added',
};

// One row per holder, naming every field the write would change. "5 refreshed"
// on its own asked you to take the app's word for it; this says which holders
// and what moves.
function PushRow({ entry, record, kind, diff, group }) {
  const name = record?.description || entry?.description || '(no description)';
  return (
    <div className="push-row">
      <div className="push-row-head">
        <span className="push-row-name">{name}</span>
        <span className="push-row-kind">{KIND_NOTE[kind]}</span>
      </div>
      {/* In the ID-only group the group header already says what happens, so
          the row is just the value — repeating the sentence twenty times is
          how a list stops being read. */}
      {diff.map(d => (
        <div key={d.key} className="push-row-field">
          {(group !== 'id' || d.key !== 'product-id') && <b>{d.label}</b>}
          {d.noteOnly ? (
            <span>— {d.note}</span>
          ) : (
            <>
              <span className="mono push-from">{d.from}</span>
              <span className="push-arrow">→</span>
              <span className="mono push-to">{d.to}</span>
              {/* Values AND the reason: "min OOH → HLD-CE3310" alone doesn't
                  explain why Fusion is holding a value nobody typed. */}
              {d.note && <span className="push-why">{d.note}</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Collapsible, and the DEFAULT state is the point: geometry open because it's
// the one worth reading, ID-only shut because it's the one that isn't.
function PushGroup({ group, rows, defaultOpen, render }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!rows.length) return null;
  return (
    <div className={`push-group ${group.key}`}>
      <button className="push-group-head" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <b>{group.label}</b>
        <span className="push-group-count">{rows.length}</span>
        <span className="push-group-note">{group.note}</span>
      </button>
      {open && (
        <div className="push-rows">
          {rows.map((r, i) => (render ? render(r, i) : <PushRow key={i} {...r} />))}
        </div>
      )}
    </div>
  );
}

export default function PushHoldersModal({ preview, onCommit, onClose }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { if (preview) setDone(null); }, [preview]);

  const [okToRemove, setOkToRemove] = useState(false);
  useEffect(() => { setOkToRemove(false); }, [preview]);

  const libs = preview?.byLibrary || [];
  const flagged = preview?.flagged || [];
  const removing = preview?.deleted || 0;
  const total = (preview?.updated || 0) + (preview?.created || 0) + removing;
  // Deleting a holder out of a shared Fusion library is the one thing here that
  // can't be undone from this app, so it is ticked deliberately, never implied
  // by pressing the same button that writes everything else.
  const blocked = removing > 0 && !okToRemove;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-push-modal">
        <div className="modal-header">
          <div>
            <h3>Push holders to Fusion</h3>
            <p className="modal-sub">
              Writes each holder’s ID into Fusion’s product-id field, along with its current
              geometry. That ID plus the segments is what keeps the two libraries linked —
              Fusion’s own holder GUID changes on its own and can’t be relied on.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {!preview && <div className="holder-empty">Working out what would change…</div>}

          {preview && libs.map(l => {
            const byGroup = (g) => (l.rows || []).filter(r => r.group === g);
            return (
              <div key={l.libId} className="holder-push-lib">
                <div className="holder-push-lib-head">
                  <b>{l.libName}</b>
                  <span className="holder-conf high">
                    {l.toWrite} to write
                  </span>
                  {l.flagged.length > 0 && (
                    <span className="holder-conf medium">{l.flagged.length} left alone</span>
                  )}
                </div>
                {/* Removals first, and always open. It is the one destructive
                    thing a push does, so it is never something you have to go
                    looking for. */}
                <PushGroup
                  group={PUSH_GROUPS.remove}
                  rows={l.deleteRows || []}
                  defaultOpen
                  render={(r, i) => (
                    <div key={i} className="push-row push-row-remove">
                      <div className="push-row-head">
                        <span className="push-row-name">{r.name}</span>
                        <span className="push-row-kind">{r.why}</span>
                      </div>
                    </div>
                  )}
                />
                <PushGroup group={PUSH_GROUPS.geometry} rows={byGroup('geometry')} defaultOpen />
                <PushGroup group={PUSH_GROUPS.pairing} rows={byGroup('pairing')} defaultOpen />
                <PushGroup group={PUSH_GROUPS.other} rows={byGroup('other')} defaultOpen />
                <PushGroup group={PUSH_GROUPS.text} rows={byGroup('text')} defaultOpen />
                <PushGroup group={PUSH_GROUPS.id} rows={byGroup('id')} defaultOpen={false} />
                {l.creates > 0 && (
                  <PushGroup
                    group={PUSH_GROUPS.create}
                    rows={l.createRows || []}
                    defaultOpen
                    render={(r, i) => (
                      <div key={i} className="push-row">
                        <div className="push-row-head">
                          <span className="push-row-name">{r.name}</span>
                          <span className="push-row-kind">
                            {r.neverPushed ? 'never pushed' : 'no longer matches its Fusion entry'}
                          </span>
                        </div>
                      </div>
                    )}
                  />
                )}
              </div>
            );
          })}

          {flagged.length > 0 && (
            <div className="holder-warn holder-push-flags">
              <div className="holder-push-flags-head">
                <AlertTriangle size={13} />
                <b>{flagged.length} Fusion holder{flagged.length === 1 ? '' : 's'} left untouched</b>
              </div>
              {/* Not written, deliberately. The app's ID and the segments
                  disagree, so which record this entry is, is a person's call. */}
              {/* ⚠️ "ref only" is not the same problem as the rest, and the
                  blanket wording sent the user looking for something to fix on
                  a page that had nothing to offer. There it IS known which
                  holder this is — only which SHAPE is right is unknown, and
                  that holder's own page now asks. */}
              <p className="modal-sub" style={{ margin: '0 0 8px' }}>
                Nothing is written to these. A <b>ref only</b> row is a holder edited on one side
                or the other — open it from the Holders list and choose whose geometry wins.
                The rest are cases where the ID and the shape point at different records, so
                the app can’t tell which holder the Fusion entry even is.
              </p>
              {flagged.map((f, i) => (
                <div key={i} className="holder-import-flag">
                  <span className="holder-conf medium">{f.status.replace('-', ' ')}</span>
                  <span className="holder-import-flag-desc">{f.entry.description || '(no description)'}</span>
                  <span className="holder-import-flag-why">{f.reason}</span>
                </div>
              ))}
            </div>
          )}

          {preview && !total && !flagged.length && (
            <div className="holder-empty">Fusion is already up to date with every holder record.</div>
          )}
          {done && (
            <div className="holder-note" style={{ marginTop: 10 }}>
              Done. Tools don’t change from this — each carries its own frozen copy of the
              holder. Use <b>Re-stamp</b> on a holder to push corrected geometry into its tools.
            </div>
          )}
        </div>

        <div className="modal-footer">
          {removing > 0 && !done ? (
            <label className="push-remove-confirm">
              <input type="checkbox" checked={okToRemove}
                onChange={e => setOkToRemove(e.target.checked)} />
              <span>
                Delete {removing} holder{removing === 1 ? '' : 's'} from Fusion.
                {' '}The record and its geometry stay in this app’s archive.
              </span>
            </label>
          ) : (
            <span className="modal-footer-note">
              Only the holder library file is written. No cutting tool is touched.
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              className="btn btn-primary btn-sm"
              disabled={!total || busy || blocked}
              onClick={async () => {
                setBusy(true);
                try { await onCommit(); setDone(true); } finally { setBusy(false); }
              }}
            >
              <Upload size={13} /> Push {total} holder{total === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
