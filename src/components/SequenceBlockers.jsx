import { AlertTriangle, X } from 'lucide-react';
import { formatProgramNumber } from '../utils/parts.js';

// The list of reasons a posted Sequence Detail CANNOT be stored.
//
// ⚠️ ONE RENDERING, SHARED BY EVERY PATH THAT CAN BE BLOCKED — the manual
// upload, the cloud-icon auto pull, and the print-time update. A blocker is the
// same fact however the file arrived, and the manual dialog's list is the one
// that is actually usable: it names each ProShop number the library doesn't
// have, which is the worklist. The auto path used to reduce all of that to the
// FIRST blocker's message in a toast — so the rows, and any second blocker,
// were simply lost, and the user was told a program was "not pulled in" with no
// way to find out which tools to go add.
export function BlockerList({ blockers = [] }) {
  return blockers.map((b, i) => (
    <div key={i} className="sd-blocker">
      <AlertTriangle size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
      <div>
        <div>{b.message}</div>
        {b.rows && (
          <ul className="sd-blocker-list">
            {b.rows.map(r => (
              <li key={r.t}>
                <span className="machine-num-badge">{r.t}</span>
                <span className="tool-id-pill">{r.tool_id || '(blank)'}</span>
                <span className="text-sub">{r.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  ));
}

// The same list, as a dialog, for a pull that nobody was filling in a form for.
//
// A toast is the wrong shape for this: it is transient, it holds one line, and
// what the user needs is the list of ProShop numbers to go add. So a blocked
// automatic pull raises the list in a dialog instead — dismissible, and the only
// thing on screen that has to be read.
//
// `items` is a list because ONE print can update several programs (see
// guardedPrint), and reporting only the first blocked one would repeat the very
// omission this replaces.
//
// ⚠️ The print context says plainly that those programs printed from the
// version already stored. A blocked pull during a print is not "nothing
// happened" — labels came out, from an older file, which is exactly the thing
// the print guard exists to warn about.
export default function SequenceBlockedModal({ items = [], context = 'sync', onClose }) {
  if (items.length === 0) return null;
  const many = items.length !== 1;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pn-modal" style={{ maxWidth: 640 }}>
        <div className="pn-modal-head">
          <AlertTriangle size={16} style={{ color: 'var(--red)' }} />
          <span className="modal-title" style={{ margin: 0 }}>
            {many ? `${items.length} programs couldn't be updated` : "Couldn't update this program"}
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="pn-modal-body">
          <div className="text-xs text-sub" style={{ marginBottom: 12 }}>
            {context === 'print'
              ? `The posted file in Drive can't be stored, so ${many ? 'these programs' : 'this program'} printed from the version already stored — the labels are NOT from the newest posted file. Sort out the below, then pull ${many ? 'them' : 'it'} in and reprint.`
              : `The posted file in Drive can't be stored, so nothing was changed — the version already stored is untouched. Sort out the below, then click the cloud again.`}
          </div>

          <div className="pn-modal-stack">
            {items.map(item => (
              <div key={item.key}>
                <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
                  <span className="program-num-badge">{formatProgramNumber(item.programNumber)}</span>
                  {item.fileName && <span className="text-xs text-sub">{item.fileName}</span>}
                </div>
                <div className="pn-modal-stack">
                  <BlockerList blockers={item.blockers} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pn-modal-foot flex items-center gap-8">
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
