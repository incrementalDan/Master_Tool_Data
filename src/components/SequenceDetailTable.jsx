import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { parseSequenceCsv } from '../utils/sequenceDetail.js';

// The FULL sequence — every toolpath operation, in program order.
//
// ⚠️ Parsed live from the stored raw CSV rather than from a saved copy. The raw
// file is kept byte-for-byte, so what's shown here is provably the file the
// post wrote — there is no second derived artifact that could drift from it.
// The cost is one Drive fetch the first time the tab is opened.
//
// Seq# correlates directly to the N## in the G-code: it's how an operator finds
// where in the program an operation happens and whether they can start from
// there. A sequence number is output on a tool change; extra toolpaths under one
// tool change get .1 / .2 so they stay in order.
export default function SequenceDetailTable({ detail }) {
  const { fetchSequenceCsv, programDetails } = useApp();
  const [state, setState] = useState({ status: 'loading', rows: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', rows: [], error: '' });
    (async () => {
      try {
        const text = await fetchSequenceCsv(detail);
        if (cancelled) return;
        if (!text) { setState({ status: 'missing', rows: [], error: '' }); return; }
        setState({ status: 'ready', rows: parseSequenceCsv(text).rows, error: '' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', rows: [], error: err.message });
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when the stored file changes (a new version was uploaded).
  }, [detail?.raw_file_id, fetchSequenceCsv, programDetails]);

  if (state.status === 'loading') return <div className="pn-empty">Reading the posted file…</div>;
  if (state.status === 'missing') {
    return <div className="pn-empty">The raw file for this version isn't in Drive — re-upload the CSV to restore it.</div>;
  }
  if (state.status === 'error') {
    return <div className="pn-empty" style={{ color: 'var(--red)' }}>Couldn't read the posted file: {state.error}</div>;
  }

  // The tool FK is per pocket, resolved off the condensed list so the Tool #
  // stays a link here too.
  const refByPocket = new Map((detail?.tools || []).map(t => [t.t_num, t.tool_ref]));

  return (
    <div className="pn-table-wrap">
      <table className="pn-table sd-table">
        <thead>
          <tr>
            <th style={{ cursor: 'default' }}>Seq#</th>
            <th style={{ cursor: 'default' }}>Sequence Description</th>
            <th style={{ cursor: 'default' }}>ProShop Tool #</th>
            <th style={{ cursor: 'default' }}>G-Code T#</th>
            <th style={{ cursor: 'default' }}>Description</th>
            <th style={{ cursor: 'default' }}>Cut Dia</th>
            <th style={{ cursor: 'default' }}>Tip</th>
            <th style={{ cursor: 'default' }}>Holder</th>
            <th style={{ cursor: 'default' }}>OOH</th>
            <th style={{ cursor: 'default' }}>Location</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r, i) => {
            const ref = refByPocket.get(r.t_num);
            return (
              <tr key={`${r.seq}-${i}`}>
                <td><span className="sd-seq">{r.seq}</span></td>
                <td>{r.description || <span className="text-sub">—</span>}</td>
                <td>
                  {ref
                    ? <Link to={`/tool/${ref}`} className="tool-id-pill">{r.tool_id}</Link>
                    : <span className="tool-id-pill">{r.tool_id || '—'}</span>}
                </td>
                <td><span className="machine-num-badge">{r.t}</span></td>
                <td className="text-sub">{r.t_description || '—'}</td>
                <td className="sd-num">{r.cut_dia || '—'}</td>
                <td className="sd-num">{r.tip || '—'}</td>
                <td className="text-sub">{r.holder || '—'}</td>
                <td className="sd-num">{r.ooh || '—'}</td>
                <td>{r.lc ? <span className="location-tag">{r.lc}</span> : <span className="text-sub">—</span>}</td>
              </tr>
            );
          })}
          {state.rows.length === 0 && <tr><td colSpan={10} className="pn-empty">No operations in this file.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
