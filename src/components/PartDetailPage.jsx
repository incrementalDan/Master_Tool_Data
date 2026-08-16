import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, UploadCloud, Download, Printer, ListOrdered, Wrench,
  CheckCircle2, CircleDashed, ChevronDown, ChevronRight, Package,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  partsOf, programsOf, formatProgramNumber, formatOperation, alloyLabel, machineOptions,
} from '../utils/programs.js';
import { detailsOf, locationConflict } from '../utils/sequenceImport.js';
import { CustomerBadge } from './programsUi.jsx';
import MachinePill from './MachinePill.jsx';
import { machineColorFor } from '../utils/machineColors.js';
import ToolListTable from './ToolListTable.jsx';
import SequenceDetailTable from './SequenceDetailTable.jsx';
import SequenceUploadModal from './SequenceUploadModal.jsx';
import { jobLabelRows } from '../utils/toolLabels.js';
import { printToolTags } from '../utils/labelPrint.js';

// The JOB page — one part + rev and every operation on it. A job is where the
// shop actually works: the operator sets up OP50, OP60 and OP61M back to back
// and wants every label for the whole job at once, which is why the mega tool
// list and the job-level print live here rather than on a single program.
//
// The Sequence Detail is per program only — there is no job-level sequence.

const rowKeyOf = (r) => `${r.program_id}:${r.t_num}`;

// ── One program ──────────────────────────────────────────────────────────────

function ProgramCard({
  program, detail, machines, canEdit, selected, lcConflicts, onToggleRows, onPrint, onUpload, onProven,
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('tools');
  const { fetchSequenceCsv, notify } = useApp();

  const rows = useMemo(
    () => (detail?.tools || []).map(t => ({ ...t, program_id: program.id })),
    [detail, program.id],
  );
  const keys = rows.map(rowKeyOf);
  const selectedHere = keys.filter(k => selected.has(k));

  // "Download the current file" means the un-renamed one — the current version
  // always keeps its original filename, which is exactly why it's kept that way.
  const download = async () => {
    try {
      const text = await fetchSequenceCsv(detail);
      if (!text) { notify('The raw file for this version is no longer in Drive', 'error'); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = detail.file_name || `${formatProgramNumber(program.program_number)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      notify(`Download failed: ${err.message}`, 'error', 6000);
    }
  };

  return (
    <div className="pn-part-card sd-program">
      <div className="sd-program-head" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="program-num-badge">{formatProgramNumber(program.program_number)}</span>
        {program.operation && <span className="sd-op-label">{formatOperation(program.operation)}</span>}
        {program.machine_label && (
          <MachinePill label={program.machine_label}
            color={machineColorFor(program.machine_id, program.machine_label, machines)} />
        )}
        {program.description && <span className="text-xs text-sub pn-op-desc">{program.description}</span>}

        {detail ? (
          <span className="sd-head-right" onClick={e => e.stopPropagation()}>
            <span className="text-xs text-sub">{detail.tools.length} tools</span>
            {/* Proven = "it ran on the machine and did not crash". Never implied
                by an upload; a person sets it, and it belongs to this version. */}
            <button
              type="button"
              className={`sd-proven${detail.proven ? ' on' : ''}`}
              disabled={!canEdit}
              title={detail.proven
                ? `Proven${detail.proven_by ? ` by ${detail.proven_by}` : ''} — this version ran without crashing`
                : 'Not yet proven — this version has not been confirmed to run'}
              onClick={() => onProven(program.id, !detail.proven)}
            >
              {detail.proven ? <CheckCircle2 size={12} /> : <CircleDashed size={12} />}
              {detail.proven ? 'Proven' : 'Unproven'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={download} title="Download the current posted CSV">
              <Download size={12} />
            </button>
            <button className="btn btn-secondary btn-sm"
              onClick={() => onPrint(selectedHere.length ? selectedHere : keys)}>
              <Printer size={12} /> {selectedHere.length ? `Print ${selectedHere.length}` : 'Print all'}
            </button>
          </span>
        ) : (
          <span className="sd-head-right" onClick={e => e.stopPropagation()}>
            <span className="text-xs text-sub">No sequence detail</span>
            {canEdit && (
              <button className="btn btn-ghost btn-sm" onClick={onUpload}>
                <UploadCloud size={12} /> Upload CSV
              </button>
            )}
          </span>
        )}
      </div>

      {open && detail && (
        <div className="pn-part-body">
          <div className="pn-view-tabs sd-tabs">
            <button className={`pn-view-tab${tab === 'tools' ? ' active' : ''}`} onClick={() => setTab('tools')}>
              <Wrench size={13} /> Tool List
            </button>
            <button className={`pn-view-tab${tab === 'seq' ? ' active' : ''}`} onClick={() => setTab('seq')}>
              <ListOrdered size={13} /> Sequence Detail
            </button>
            <span className="sd-tab-meta text-xs text-sub">
              {detail.posted ? `Posted ${detail.posted}` : 'No posted stamp'} · {detail.file_name}
            </span>
          </div>

          {tab === 'tools' ? (
            <ToolListTable
              rows={rows}
              selectable
              selected={selected}
              rowKey={rowKeyOf}
              onToggle={(k) => onToggleRows([k])}
              onToggleAll={(on) => onToggleRows(keys, on)}
              lcConflicts={lcConflicts}
            />
          ) : (
            <SequenceDetailTable detail={detail} />
          )}
        </div>
      )}

      {open && !detail && (
        <div className="pn-part-body">
          <div className="pn-empty">
            No Sequence Detail uploaded for this program yet.
          </div>
        </div>
      )}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

export default function PartDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    jobs: jobsFile, materials, shopSettings, programDetails, tools,
    setProgramProven, googleAuthenticated, demoMode, user, notify,
  } = useApp();

  const canEdit = googleAuthenticated || demoMode;
  const machines = machineOptions(shopSettings);
  const part = partsOf(jobsFile).find(p => p.id === id) || null;
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [showJobList, setShowJobList] = useState(true);

  const programs = useMemo(
    () => programsOf(jobsFile)
      .filter(p => p.part_id === id)
      .sort((a, b) => String(a.operation).localeCompare(String(b.operation), undefined, { numeric: true })),
    [jobsFile, id],
  );

  const detailByProgram = useMemo(() => {
    const m = new Map();
    for (const d of detailsOf(programDetails)) m.set(d.program_id, d);
    return m;
  }, [programDetails]);

  // The job-level mega tool list: every OP's tools in one table, so a whole job
  // can be pulled and labelled in one pass.
  const jobRows = useMemo(
    () => programs.flatMap(p => {
      const d = detailByProgram.get(p.id);
      if (!d) return [];
      const opLabel = formatOperation(p.operation);
      return d.tools.map(t => ({ ...t, program_id: p.id, op_label: opLabel }));
    }),
    [programs, detailByProgram],
  );

  // ⚠️ Location conflicts are computed LIVE against the current library, not
  // read from a value stored at import time — otherwise fixing the tool's
  // location in ToolDex would leave the flag showing until someone happened to
  // re-upload the CSV, which is a flag the user can't clear.
  const lcConflicts = useMemo(() => {
    const byId = new Map((tools || []).map(t => [t.id, t]));
    const out = [];
    for (const r of jobRows) {
      const tool = r.tool_ref ? byId.get(r.tool_ref) : null;
      const c = tool ? locationConflict(r.lc, tool) : null;
      if (c) out.push({ t: r.t, program_id: r.program_id, ...c });
    }
    return out;
  }, [jobRows, tools]);

  if (!part) {
    return (
      <div className="pn-page">
        <div className="pn-empty">
          That part isn't in the registry. <Link to="/programs">Back to programs</Link>
        </div>
      </div>
    );
  }

  const toggleRows = (keys, on) => setSelected(prev => {
    const next = new Set(prev);
    const turnOn = on === undefined ? !keys.every(k => next.has(k)) : on;
    for (const k of keys) { if (turnOn) next.add(k); else next.delete(k); }
    return next;
  });

  const print = (keys) => {
    const wanted = new Set(keys);
    const rows = jobRows.filter(r => wanted.has(rowKeyOf(r)));
    if (rows.length === 0) { notify('Nothing selected to print', 'error'); return; }
    const labels = jobLabelRows(rows, part);
    // Deliberately reported: a blocked popup looks exactly like a broken button.
    if (!printToolTags(labels)) {
      notify('Your browser blocked the print window — allow popups for this site', 'error', 7000);
    }
  };

  const printProgram = (keys) => print(keys);

  const jobKeys = jobRows.map(rowKeyOf);
  const selectedJob = jobKeys.filter(k => selected.has(k));
  const withDetail = programs.filter(p => detailByProgram.has(p.id)).length;

  return (
    <div className="pn-page">
      <div className="detail-header mb-16">
        <button className="icon-btn" onClick={() => navigate('/programs')} title="Back to programs">
          <ArrowLeft size={18} />
        </button>
        <span className="detail-header-icon"><Package size={22} /></span>
        <div>
          <div className="detail-header-type">
            {programs.length} operation{programs.length !== 1 ? 's' : ''} · {withDetail} with sequence detail
          </div>
          <h1 className="detail-header-title">
            {part.part_number} <span className="text-sub" style={{ fontWeight: 400 }}>Rev {part.rev}</span>
          </h1>
        </div>
        <div className="pn-header-right">
          <CustomerBadge customer={part.customer} />
          {(part.material_id || part.material_custom) && (
            <span className="text-xs text-sub">{alloyLabel(materials, part.material_id, part.material_custom)}</span>
          )}
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setUploading(true)}>
              <UploadCloud size={15} /> Upload Sequence Detail
            </button>
          )}
        </div>
      </div>

      {jobRows.length > 0 && (
        <div className="pn-part-card sd-job-list">
          <div className="sd-program-head" onClick={() => setShowJobList(o => !o)}>
            {showJobList ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Wrench size={14} style={{ color: 'var(--blue)' }} />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Job tool list</span>
            <span className="text-xs text-sub">
              every tool across all {withDetail} operation{withDetail !== 1 ? 's' : ''} — {jobRows.length} rows
            </span>
            <span className="sd-head-right" onClick={e => e.stopPropagation()}>
              <button className="btn btn-secondary btn-sm"
                onClick={() => print(selectedJob.length ? selectedJob : jobKeys)}>
                <Printer size={13} /> {selectedJob.length ? `Print ${selectedJob.length} labels` : 'Print all labels'}
              </button>
            </span>
          </div>
          {showJobList && (
            <div className="pn-part-body">
              <ToolListTable
                rows={jobRows}
                showOp
                selectable
                selected={selected}
                rowKey={rowKeyOf}
                onToggle={(k) => toggleRows([k])}
                onToggleAll={(on) => toggleRows(jobKeys, on)}
              />
            </div>
          )}
        </div>
      )}

      <div className="pn-grouped" style={{ marginTop: 12 }}>
        {programs.map(p => (
          <ProgramCard
            key={p.id}
            program={p}
            detail={detailByProgram.get(p.id) || null}
            lcConflicts={lcConflicts.filter(c => c.program_id === p.id)}
            machines={machines}
            canEdit={canEdit}
            selected={selected}
            onToggleRows={toggleRows}
            onPrint={printProgram}
            onUpload={() => setUploading(true)}
            onProven={async (programId, proven) => {
              try {
                await setProgramProven(programId, proven, user?.email || user?.name || '');
              } catch (err) {
                notify(`Couldn't save: ${err.message}`, 'error', 6000);
              }
            }}
          />
        ))}
        {programs.length === 0 && (
          <div className="pn-empty">No operations on this part yet.</div>
        )}
      </div>

      {uploading && (
        <SequenceUploadModal
          onClose={() => setUploading(false)}
          onImported={(_stored, _program, importedPart) => {
            setUploading(false);
            // A CSV for a different job goes to that job — the upload is the
            // reason you're looking at it.
            if (importedPart && importedPart.id !== id) navigate(`/programs/part/${importedPart.id}`);
          }}
        />
      )}
    </div>
  );
}
