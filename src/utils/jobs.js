// Jobs — pure helpers (no React), mirroring toolIdSystem.js / locationSystem.js.
//
// A JOB = a program number + a part number. Jobs are shop-level entities with
// stable UUIDs stored in jobs.json (a shared Drive file, same folder as
// tool_metadata.json). Presets and tools reference jobs BY ID ONLY
// (preset_meta[guid].job_ids / tool metadata job_ids) — never by copying the
// program/part strings — so the future jobs page (assigning program numbers to
// part numbers and operations, replacing the manually-managed Google Sheet)
// edits one central record and every reference follows. SQLite-ready: one jobs
// table, join tables for the references.
import { generateId } from '../schema/identity.js';
import { formatProgramNumber } from './programs.js';

// Identity: a job is uniquely the (program_number, part_number) pair,
// case-insensitive and whitespace-trimmed.
export function jobKey(programNumber, partNumber) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  return `${norm(programNumber)}|${norm(partNumber)}`;
}

// Find an existing job matching the pair, or null.
export function findJob(jobsFile, programNumber, partNumber) {
  const key = jobKey(programNumber, partNumber);
  return (jobsFile?.jobs || []).find(j => jobKey(j.program_number, j.part_number) === key) || null;
}

export function jobById(jobsFile, id) {
  return (jobsFile?.jobs || []).find(j => j.id === id) || null;
}

export function newJob(programNumber, partNumber, createdBy = '', programId = null) {
  return {
    id: generateId(),
    program_number: String(programNumber ?? '').trim(),
    part_number: String(partNumber ?? '').trim(),
    // Optional join to a Program Number Manager record (programs[].id) when the
    // link was made by selecting a real program (vs. a bare quick-link). Lets a
    // preset's job resolve to the full program/part/op context.
    program_id: programId || null,
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
    notes: '',
  };
}

// Display label: "O1042 · PN-1234" (whichever halves are present). The
// program number is shown in its primary "O"-prefixed reference form —
// formatProgramNumber is idempotent, so a legacy stored value that's already
// prefixed (typed by hand before the Program Number Manager existed) isn't
// double-prefixed.
export function jobLabel(job) {
  if (!job) return '';
  return [formatProgramNumber(job.program_number), job.part_number].filter(Boolean).join(' · ');
}

// Resolve a tool's job links into display rows for the "Jobs / Where Used"
// panel: tool-level links plus every preset's links, deduped by job id. Each
// row: { job, presetNames: [] } — empty presetNames = tool-level only.
export function collectToolJobs(tool, jobsFile) {
  const rows = new Map();   // job_id -> { job, presetNames: [] }
  const add = (id, presetName) => {
    const job = jobById(jobsFile, id);
    if (!job) return;   // dangling reference (job deleted from registry) — skip silently
    if (!rows.has(id)) rows.set(id, { job, presetNames: [] });
    if (presetName && !rows.get(id).presetNames.includes(presetName)) {
      rows.get(id).presetNames.push(presetName);
    }
  };
  for (const id of (tool?.job_ids || [])) add(id, null);
  for (const p of (tool?.presets || [])) {
    for (const id of (p.job_ids || [])) add(id, p.name || 'Unnamed preset');
  }
  return [...rows.values()];
}
