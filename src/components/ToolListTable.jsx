import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { HolderTag } from './HolderPill.jsx';
import { offsetOf } from '../utils/sequenceDetail.js';
import { buildHolderIndex } from '../utils/sequenceImport.js';

// The condensed tool list for a program — derived from our existing APW Setup
// Sheet, in that column order.
//
// ⚠️ EVERY VALUE HERE IS THE CSV'S OWN STRING. The Sequence Detail is a
// pass-through of proven job data: a wrong OOH, holder or T# causes a crash, so
// what's displayed (and printed) is what the post wrote, never an app-corrected
// version of it. The library is only ever a LINK (the Tool # pill navigates to
// the tool) or a FLAG (a location disagreement) — never a substituted value.
//
// H and D are the one exception, and they're derived rather than read: the post
// enforces H = D = T, and the CSV's H column is known to carry an incorrect
// gauge-length reference in newer files.
//
// Dim Tag #, Tool Life (M) and Init D Offset are deliberately present and empty
// — they're wired up in a later phase, and the column space is held so the
// table doesn't reshuffle when they arrive.

const DASH = <span className="text-sub">—</span>;

function OohCell({ value }) {
  return <span className="sd-num">{value || '—'}</span>;
}

export default function ToolListTable({
  rows,
  showOp = false,          // job level: the same pocket number recurs per OP
  selectable = false,
  selected,                // Set of row keys
  onToggle,
  onToggleAll,
  lcConflicts = [],        // [{ t, csv, app }] — keyed per row below
  rowKey = (r) => `${r.program_id || ''}:${r.t_num}`,
}) {
  const { holderLibrary } = useApp();
  const conflictFor = (r) => lcConflicts.find(c => c.t === r.t && (!c.program_id || c.program_id === r.program_id));

  // ⚠️ The "no matching holder" indicator is resolved against the CURRENT
  // library, not the FK captured when the CSV was imported — otherwise adding
  // the missing holder to the library would leave the marker showing until
  // someone re-uploaded the file, which is a flag the user can't clear.
  const holderIndex = useMemo(() => buildHolderIndex(holderLibrary?.holders || []), [holderLibrary]);
  const holderKnown = (r) => !!r.holder_id
    || holderIndex.has(String(r.holder ?? '').trim().toUpperCase().replace(/\s+/g, ' '));
  const allOn = selectable && rows.length > 0 && rows.every(r => selected?.has(rowKey(r)));

  return (
    <div className="pn-table-wrap">
      <table className="pn-table sd-table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 34, cursor: 'default' }}>
                <input type="checkbox" checked={allOn} onChange={() => onToggleAll?.(!allOn)}
                  aria-label="Select all tools" />
              </th>
            )}
            {showOp && <th style={{ cursor: 'default' }}>OP</th>}
            <th style={{ cursor: 'default' }}>G-Code T#</th>
            <th style={{ cursor: 'default' }}>H Offset #</th>
            <th style={{ cursor: 'default' }}>D Offset #</th>
            <th style={{ cursor: 'default' }}>Dim Tag #</th>
            <th style={{ cursor: 'default' }}>ProShop Tool #</th>
            <th style={{ cursor: 'default' }}>Location</th>
            <th style={{ cursor: 'default' }}>Description</th>
            <th style={{ cursor: 'default' }}>Cut Dia</th>
            <th style={{ cursor: 'default' }}>Tip</th>
            <th style={{ cursor: 'default' }}>Holder</th>
            <th style={{ cursor: 'default' }}>OOH</th>
            <th style={{ cursor: 'default' }}>Tool Life (M)</th>
            <th style={{ cursor: 'default' }}>Init D Offset</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const key = rowKey(r);
            const lc = conflictFor(r);
            return (
              <tr key={key}>
                {selectable && (
                  <td>
                    <input type="checkbox" checked={!!selected?.has(key)} onChange={() => onToggle?.(key)}
                      aria-label={`Select ${r.t}`} />
                  </td>
                )}
                {showOp && <td className="text-sub sd-op">{r.op_label || '—'}</td>}
                <td><span className="machine-num-badge">{r.t}</span></td>
                <td className="sd-num">{offsetOf(r.t_num)}</td>
                <td className="sd-num">{offsetOf(r.t_num)}</td>
                <td>{DASH}</td>
                <td>
                  {r.tool_ref
                    ? <Link to={`/tool/${r.tool_ref}`} className="tool-id-pill">{r.tool_id}</Link>
                    : <span className="tool-id-pill">{r.tool_id || '—'}</span>}
                </td>
                <td>
                  {r.lc ? <span className="location-tag">{r.lc}</span> : DASH}
                  {lc && (
                    <span className="sd-flag" title={`ToolDex has this tool at ${lc.app}. The CSV value is kept — it's what the program was proven with.`}>
                      ≠ {lc.app}
                    </span>
                  )}
                </td>
                <td>{r.description || DASH}</td>
                <td className="sd-num">{r.cut_dia || '—'}</td>
                <td className="sd-num">{r.tip || '—'}</td>
                <td>
                  {r.holder
                    ? (
                      <span className="sd-holder">
                        {/* Rendered from the CSV string, not the matched record's
                            description — the printed and displayed holder is
                            always the one the program was posted with. */}
                        <HolderTag description={r.holder} />
                        {!holderKnown(r) && (
                          <span className="sd-holder-unknown" title="No holder in the app library matches this description. The CSV value is used as-is.">
                            <HelpCircle size={12} />
                          </span>
                        )}
                      </span>
                    )
                    : DASH}
                </td>
                <td><OohCell value={r.ooh} /></td>
                <td>{DASH}</td>
                <td>{DASH}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={showOp ? 15 : 14} className="pn-empty">No tools.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
