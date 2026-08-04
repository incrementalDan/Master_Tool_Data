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
import { X, Upload, AlertTriangle } from 'lucide-react';

const KIND_NOTE = {
  update: 'already in Fusion',
  adopt: 'in Fusion, but with no ID of ours on it yet',
  create: 'not in Fusion at all — added',
};

// One row per holder, naming every field the write would change. "5 refreshed"
// on its own asked you to take the app's word for it; this says which holders
// and what moves.
function PushRow({ entry, record, kind, diff }) {
  const name = record?.description || entry?.description || '(no description)';
  const idOnly = diff.length === 1 && diff[0].key === 'product-id';
  return (
    <div className="push-row">
      <div className="push-row-head">
        <span className="push-row-name">{name}</span>
        <span className="push-row-kind">{KIND_NOTE[kind]}</span>
      </div>
      {idOnly ? (
        <div className="push-row-field">
          <b>App ID</b>
          <span className="mono push-from">{diff[0].from}</span>
          <span className="push-arrow">→</span>
          <span className="mono push-to">{diff[0].to}</span>
          <span className="push-only">nothing else changes</span>
        </div>
      ) : (
        diff.map(d => (
          <div key={d.key} className="push-row-field">
            <b>{d.label}</b>
            {d.note ? (
              <span>— {d.note}</span>
            ) : (
              <>
                <span className="mono push-from">{d.from}</span>
                <span className="push-arrow">→</span>
                <span className="mono push-to">{d.to}</span>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default function PushHoldersModal({ preview, onCommit, onClose }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { if (preview) setDone(null); }, [preview]);

  const libs = preview?.byLibrary || [];
  const flagged = preview?.flagged || [];
  const total = (preview?.updated || 0) + (preview?.created || 0);

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

          {preview && libs.map(l => (
            <div key={l.libId} className="holder-push-lib">
              <div className="holder-push-lib-head">
                <b>{l.libName}</b>
                <span className="holder-conf high">
                  {l.updates + l.adopts + l.creates} to write
                </span>
                {l.flagged.length > 0 && (
                  <span className="holder-conf medium">{l.flagged.length} left alone</span>
                )}
              </div>
              {/* Said once, not on all fifteen rows. */}
              {l.idOnly > 0 && (
                <p className="modal-sub" style={{ margin: '4px 0 0' }}>
                  {l.idOnly} of these get nothing but their ID written — the geometry Fusion
                  already holds for them is identical.
                </p>
              )}
              {l.rows?.length > 0 && (
                <div className="push-rows">
                  {l.rows.map((r, i) => <PushRow key={i} {...r} />)}
                </div>
              )}
              {l.creates > 0 && (
                <div className="push-row-field" style={{ marginTop: 6 }}>
                  <b>{l.creates}</b> holder{l.creates === 1 ? '' : 's'} {KIND_NOTE.create}.
                </div>
              )}
            </div>
          ))}

          {flagged.length > 0 && (
            <div className="holder-warn holder-push-flags">
              <div className="holder-push-flags-head">
                <AlertTriangle size={13} />
                <b>{flagged.length} Fusion holder{flagged.length === 1 ? '' : 's'} left untouched</b>
              </div>
              {/* Not written, deliberately. The app's ID and the segments
                  disagree, so which record this entry is, is a person's call. */}
              <p className="modal-sub" style={{ margin: '0 0 8px' }}>
                The ID and the shape disagree on these, so the app can’t tell which holder each
                one is. Nothing is written to them — sort them out on the holder page first.
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
          <span className="modal-footer-note">
            Only the holder library file is written. No cutting tool is touched.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              className="btn btn-primary btn-sm"
              disabled={!total || busy}
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
