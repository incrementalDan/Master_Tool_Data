import { useMemo, useState } from 'react';
import { Briefcase, ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { detailsOf } from '../utils/sequenceImport.js';
import {
  operationById, routingById, partById, routingLabel, formatOperation,
} from '../utils/parts.js';
import { ProgramNumBadge } from './partsUi.jsx';

// "Where Used" — every program this tool actually runs in.
//
// ⚠️ DERIVED, NOT STORED. Each stored Sequence Detail row carries the tool it
// resolved to (`tool_ref`), so "which programs use this tool" is a scan of
// program_details — always current, with nothing to go stale and nothing to
// maintain. The tool page previously read a separate stored `job_ids` field
// that the sequence import never wrote, which is why uploading a CSV linked
// nothing here.
//
// A tool linked to a program is linked to its part by the same derivation:
// operation → routing → part. Nothing stores that chain twice.
export function toolProgramUsage(toolId, programDetails, partsFile) {
  const rows = [];
  for (const detail of detailsOf(programDetails)) {
    const pockets = (detail.tools || []).filter(t => t.tool_ref === toolId);
    if (pockets.length === 0) continue;
    const operation = operationById(partsFile, detail.operation_id);
    const routing = operation ? routingById(partsFile, operation.routing_id) : null;
    const part = routing ? partById(partsFile, routing.part_id) : null;
    rows.push({
      detail, operation, routing, part,
      // The pockets it occupies in that program — the same tool can be loaded
      // in more than one (T03 and T04 both A-35).
      pockets: pockets.map(p => p.t),
      proven: !!detail.proven,
    });
  }
  // Most recently posted first — what you ran last is what you want to see.
  return rows.sort((a, b) => String(b.detail.posted_at || '').localeCompare(String(a.detail.posted_at || '')));
}

export default function ProgramUsageSection({ tool }) {
  const { programDetails, parts: partsFile } = useApp();
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () => toolProgramUsage(tool.id, programDetails, partsFile),
    [tool.id, programDetails, partsFile],
  );

  return (
    <div className={`panel${open ? ' open' : ''}`}>
      <div className="panel-header" onClick={() => setOpen(o => !o)}>
        <Briefcase size={15} className="panel-header-icon" />
        <span className="panel-header-title">Where Used ({rows.length})</span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {open && (
        <div className="panel-body">
          {rows.length === 0 ? (
            <div className="text-sm text-sub">
              Not in any uploaded Sequence Detail yet. This list builds itself as posted
              programs are uploaded — there's nothing to link by hand.
            </div>
          ) : (
            <div className="where-used-list">
              {rows.map(({ detail, operation, routing, part, pockets, proven }) => (
                <div key={detail.id} className="where-used-row">
                  <ProgramNumBadge n={detail.program_number} />
                  {part
                    ? <Link to={`/parts/${part.id}`} className="pn-part-number">{part.part_number}</Link>
                    : <span className="text-sub">(program removed)</span>}
                  {routing && <span className="text-xs text-sub">{routingLabel(routing)}</span>}
                  {operation?.op_number && <span className="text-xs text-sub">{formatOperation(operation.op_number)}</span>}
                  <span className="where-used-pockets">{pockets.join(', ')}</span>
                  {proven && <span className="where-used-proven">Proven</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
