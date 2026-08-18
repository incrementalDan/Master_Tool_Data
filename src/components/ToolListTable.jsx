import { useMemo, useState } from 'react';
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
// owns location. The app's value is shown; the CSV's own value is available
// behind the footer toggle below, which DEFAULTS TO HIDDEN. A stale Fusion
// location is the normal state, not news — the shop reads this table to find a
// tool in a drawer, and a marker on half the rows is noise on the value that
// matters. It stays one click away because it IS evidence Fusion's copy is out
// of date (which the location Fusion sync exists to fix), and the toggle is
// greyed out when no row disagrees so its state always means something.
// Nothing edits the CSV; the stored row keeps its own value.
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
  selected,                // Set of row keys — the page owns it, see selectRow
  onRowClick,              // (key, event) — plain / shift / ctrl handled upstream
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
  // Resolved once per render and reused by both the rows and the footer count,
  // so the toggle can never disagree with the markers it reveals.
  const locs = useMemo(
    () => new Map(rows.map(r => [rowKey(r), resolveRowLocation(r, toolsById)])),
    [rows, toolsById, rowKey],
  );
  const differs = (loc) => loc.source === 'app' && loc.csv && loc.csv !== loc.value;
  const diffCount = useMemo(
    () => [...locs.values()].filter(differs).length,
    [locs],
  );
  const [showFileLoc, setShowFileLoc] = useState(false);

  return (
    <div className="sd-tool-list">
      <div className="pn-table-wrap">
        <table className="pn-table sd-table">
          <thead>
            <tr>
              {showOp && <th style={{ cursor: 'default' }}>OP</th>}
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>G-Code T#</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>H Offset #</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>D Offset #</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>ProShop Tool #</th>
              <th style={{ cursor: 'default' }}>Location</th>
              <th style={{ cursor: 'default' }}>Description</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>Cut Dia</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>Tip</th>
              {/* OOH sits IN FRONT of the holder: the two are read together as
                  one assembly (this holder, at this stick-out), so the number
                  belongs beside the pill rather than the far side of it. */}
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>OOH</th>
              <th style={{ cursor: 'default' }}>Holder</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>Tool Life (M)</th>
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>Init D Offset</th>
              {/* Dim Tag # is a placeholder for a later phase, so it parks at
                  the far right rather than splitting the offsets from the IDs. */}
              <th className="sd-th-narrow" style={{ cursor: 'default' }}>Dim Tag #</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const key = rowKey(r);
              const loc = locs.get(key);
              return (
                <tr
                  key={key}
                  className={[
                    onRowClick ? 'sd-row-pick' : '',
                    selected?.has(key) ? 'sd-row-selected' : '',
                  ].filter(Boolean).join(' ') || undefined}
                  aria-selected={onRowClick ? !!selected?.has(key) : undefined}
                  onClick={onRowClick ? (e) => onRowClick(key, e) : undefined}
                >
                  {showOp && <td className="text-sub sd-op">{r.op_label || '—'}</td>}
                  <td><span className="machine-num-badge">{r.t}</span></td>
                  <td className="sd-num">{offsetOf(r.t_num)}</td>
                  <td className="sd-num">{offsetOf(r.t_num)}</td>
                  <td>
                    {/* The row selects; this one cell navigates instead, in a NEW
                        TAB — you open a tool to check something against the list
                        you are still working through, not to leave it. */}
                    {r.tool_ref
                      ? <Link to={`/tool/${r.tool_ref}`} className="tool-id-pill" target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          title="Open this tool in a new tab">{r.tool_id}</Link>
                      : <span className="tool-id-pill">{r.tool_id || '—'}</span>}
                  </td>
                  <td>
                    {loc.value ? <span className="location-tag">{loc.value}</span> : DASH}
                    {showFileLoc && differs(loc) && (
                      <span className="sd-flag" title={`The posted file says ${loc.csv} — Fusion's copy is out of date. ToolDex owns location, so its value is shown and printed. The file itself is untouched.`}>
                        file: {loc.csv}
                      </span>
                    )}
                  </td>
                  <td>{r.description || DASH}</td>
                  <td className="sd-num">{r.cut_dia || '—'}</td>
                  <td className="sd-num">{r.tip || '—'}</td>
                  <td><OohCell value={r.ooh} /></td>
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
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={showOp ? 14 : 13} className="pn-empty">No tools.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="sd-file-foot">
        <button
          type="button"
          className="btn btn-sm sd-file-toggle"
          disabled={diffCount === 0}
          onClick={e => { e.stopPropagation(); setShowFileLoc(v => !v); }}
          title={diffCount === 0
            ? "Every location here matches the posted file — there is nothing to show."
            : "The posted file's own location for these rows. ToolDex owns location, so its value is what's shown and printed; a difference means Fusion's copy is out of date."}
        >
          {diffCount === 0
            ? 'No file differences'
            : showFileLoc
              ? `Hide file locations (${diffCount})`
              : `Show file locations (${diffCount})`}
        </button>
      </div>
    </div>
  );
}
