import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { HolderTag } from './HolderPill.jsx';
import { offsetOf } from '../utils/sequenceDetail.js';
import { buildHolderIndex, resolveRowLocation } from '../utils/sequenceImport.js';

// The condensed tool list for a program — derived from our existing APW Setup
// Sheet, in that column order.
//
// ⚠️ EVERY VALUE HERE IS THE CSV'S OWN STRING — EXCEPT LOCATION. The Sequence
// Detail is a pass-through of proven job data: a wrong OOH, holder or T# causes
// a crash, so what's displayed (and printed) is what the post wrote, never an
// app-corrected version of it.
//
// LOCATION is the one deliberate exception (resolveRowLocation): its CSV value
// comes from Fusion's vendor field, which the app updates lazily, so a posted
// file routinely names a bin the shop has since changed — and ToolDex is what
// owns location. The app's value is shown, with the CSV's noted beside it when
// they differ. Nothing edits the CSV; the stored row keeps its own value.
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
  // ⚠️ A pocket number is unique only WITHIN one program, so the key has to
  // carry the operation too — the part-level list pools every OP's rows and
  // T38 recurs in each. This defaulted to a `program_id` no row has, which
  // collapsed every row to ":38" and would have made one tick select several.
  rowKey = (r) => `${r.operation_id || ''}:${r.t_num}`,
}) {
  const { holderLibrary, tools } = useApp();

  // Resolved live against the current library, so correcting a tool's location
  // in ToolDex is reflected here (and on the next label) with no re-upload.
  const toolsById = useMemo(() => new Map((tools || []).map(t => [t.id, t])), [tools]);

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
            const loc = resolveRowLocation(r, toolsById);
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
                  {loc.value ? <span className="location-tag">{loc.value}</span> : DASH}
                  {loc.source === 'app' && loc.csv && loc.csv !== loc.value && (
                    <span className="sd-flag" title={`The posted file says ${loc.csv} — Fusion's copy is out of date. ToolDex owns location, so its value is shown and printed. The file itself is untouched.`}>
                      file: {loc.csv}
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
