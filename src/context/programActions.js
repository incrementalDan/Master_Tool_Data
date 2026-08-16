// Sequence Detail actions — storing a posted CSV and its parsed tool list.
// Created once by AppProvider via createProgramActions(ctx).
//
// Two stores, on purpose:
//   1. The RAW file goes to Drive under JobFiles/{O####}/ COMPLETELY UNTOUCHED.
//      It is the proven job data; the app never rewrites a byte of it.
//   2. The CONDENSED tool list goes in program_details.json (shared file), which
//      is what the tool lists and the labels read. The full per-toolpath
//      sequence is re-parsed from the raw file on demand — there is no second
//      derived copy of it to go stale.
//
// Versioning: the POSTED stamp is the version key (post logic writes it into
// both the CSV and the G-code, so it's what pairs them). The CURRENT version
// always keeps its original filename — so "download the current file" is
// unambiguous — and the PREVIOUS one is renamed to carry its posted stamp and
// proven state. Re-uploading the same stamp is the same version: no new archive
// copy is made.
import * as driveService from '../services/driveService.js';
import { upsertDetail, detailsOf } from '../utils/sequenceImport.js';
import { formatProgramNumber } from '../utils/parts.js';
import { postedToIso } from '../utils/sequenceDetail.js';

// Archived name: O1218_20260810-1051_proven.csv — sorts chronologically in
// Drive, and carries the proven state of the version being retired (which
// travels with the version, not with the program).
export function archiveFileName(programNumber, posted, proven) {
  const iso = postedToIso(posted);
  const stamp = iso
    ? `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`
    : 'unknown';
  return `${formatProgramNumber(programNumber)}_${stamp}_${proven ? 'proven' : 'unproven'}.csv`;
}

// Demo mode has no Drive, so an uploaded file has nowhere to live. Keeping the
// text in memory for the session lets the sandbox exercise the whole flow —
// including the Sequence Detail tab, which re-parses the raw file — without
// adding a demo-only field to the stored record shape. Session-scoped and
// deliberately not persisted: the demo is a throwaway.
const demoRawText = new Map();   // detail id → the uploaded CSV text

export function createProgramActions(ctx) {
  const { notify, googleRef, demoModeRef, programDetailsRef, saveProgramDetails } = ctx;

  const requireDrive = () => {
    if (!googleRef.current && !demoModeRef.current) {
      notify('Connect Google Drive to store sequence details', 'error');
      throw new Error('Google Drive not connected');
    }
  };

  // Commit a built import (see utils/sequenceImport.buildSequenceImport).
  // `file` is the original File so the bytes stored are the bytes uploaded.
  const importSequenceDetail = async ({ detail, file, prior, sameVersion }) => {
    requireDrive();
    if (!detail) throw new Error('Nothing to import');

    let rawFileId = prior?.raw_file_id || null;

    // Demo mode is an in-memory sandbox — no Drive writes at all. The parsed
    // list still lands in state so the tables and labels can be exercised.
    if (!demoModeRef.current) {
      const folderId = await driveService.ensureProgramFolder(formatProgramNumber(detail.program_number));

      // A NEW version: retire the previous raw file by RENAMING it (its Drive
      // ID survives, so nothing that referenced it breaks) before the new one
      // lands under the original name. Archiving is best-effort — failing to
      // rename an old file must not cost the user the new upload, which is the
      // thing they actually asked for.
      if (prior?.raw_file_id && !sameVersion) {
        try {
          await driveService.renameDriveFile(
            prior.raw_file_id,
            archiveFileName(detail.program_number, prior.posted, prior.proven),
          );
        } catch (err) {
          notify(`Uploaded, but the previous version couldn't be archived: ${err.message}`, 'error', 7000);
        }
      }

      // Same version re-uploaded: replace the file in place rather than leaving
      // two copies of one version side by side.
      if (sameVersion && prior?.raw_file_id) {
        await driveService.deleteToolFile(prior.raw_file_id).catch(() => {});
      }

      const uploaded = await driveService.uploadToolFile(folderId, file, detail.file_name);
      rawFileId = uploaded.id;
    } else {
      demoRawText.set(detail.id, await file.text());
    }

    const stored = { ...detail, raw_file_id: rawFileId };
    // ⚠️ Write the file, THEN report success — a toast before a failed write is
    // how a user comes to believe a program is stored when it isn't.
    await saveProgramDetails(upsertDetail(programDetailsRef.current, stored));
    return stored;
  };

  // Proven = "this program ran on the machine and did not crash". It is never
  // implied by an upload; a person sets it deliberately, and it belongs to the
  // version currently stored (which is why archiving carries it into the
  // retired filename).
  const setProgramProven = async (programId, proven, by = '') => {
    const file = programDetailsRef.current;
    const detail = detailsOf(file).find(d => d.program_id === programId);
    if (!detail) return null;
    const next = {
      ...detail,
      proven: !!proven,
      proven_at: proven ? new Date().toISOString() : null,
      proven_by: proven ? (by || '') : '',
    };
    await saveProgramDetails(upsertDetail(file, next));
    return next;
  };

  // Fetch the stored raw CSV. The full per-toolpath Sequence Detail is parsed
  // from this on demand, so what's displayed is provably the posted file.
  const fetchSequenceCsv = async (detail) => {
    if (!detail) return null;
    if (demoModeRef.current && demoRawText.has(detail.id)) return demoRawText.get(detail.id);
    if (!detail.raw_file_id) return null;
    return driveService.fetchFileText(detail.raw_file_id);
  };

  return { importSequenceDetail, setProgramProven, fetchSequenceCsv };
}
