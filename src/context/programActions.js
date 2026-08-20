// Sequence Detail actions — storing a posted CSV and its parsed tool list.
// Created once by AppProvider via createProgramActions(ctx).
//
// Two stores, on purpose:
//   1. The RAW file goes to Drive under ProgramFiles/{O####}/ COMPLETELY
//      UNTOUCHED. It is the proven job data; the app never rewrites a byte.
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
import { upsertDetail, detailsOf, buildSequenceImport, relinkStoredDetails } from '../utils/sequenceImport.js';
import { formatProgramNumber, operationByProgramNumber } from '../utils/parts.js';
import { postedToIso, programNumberFromFileName } from '../utils/sequenceDetail.js';
import {
  machineFolders, candidatesFor, pickLatest, isStale, fileMatchesProgram, SEQUENCE_CSV,
} from '../utils/programFileSync.js';
import { buildVersionList } from '../utils/programVersions.js';

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
  const {
    notify, googleRef, demoModeRef, programDetailsRef, saveProgramDetails,
    partsRef, toolsRef, holderLibraryRef, shopSettingsRef, userRef, saveShopSettings,
  } = ctx;

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
    // ⚠️ Recorded HERE because this is the one place an archive is created — a
    // flag set anywhere else could drift from whether the file actually exists.
    // It exists so the Compare button knows whether there is a second version
    // WITHOUT a Drive listing per program on every part page. Carried forward on
    // a same-version re-upload (nothing is archived then), and left `undefined`
    // on records written before this field: unknown is not "none", so those keep
    // offering Compare rather than hiding a version that may well be there.
    let hasPriorVersions = prior?.has_prior_versions;
    if (!prior?.raw_file_id) hasPriorVersions = hasPriorVersions ?? false;

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
          hasPriorVersions = true;
        } catch (err) {
          // The prior file being ALREADY GONE is not a failure to archive —
          // there was nothing to archive. Warning about it reads as data loss
          // when the opposite is true, and there is nothing the user could do
          // about it anyway.
          if (err?.code !== 'NOT_FOUND') {
            notify(`Uploaded, but the previous version couldn't be archived: ${err.message}`, 'error', 7000);
          }
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

    const stored = { ...detail, raw_file_id: rawFileId, has_prior_versions: hasPriorVersions };
    // ⚠️ Write the file, THEN report success — a toast before a failed write is
    // how a user comes to believe a program is stored when it isn't.
    await saveProgramDetails(upsertDetail(programDetailsRef.current, stored));
    return stored;
  };

  // Proven = "this program ran on the machine and did not crash". It is never
  // implied by an upload; a person sets it deliberately, and it belongs to the
  // version currently stored (which is why archiving carries it into the
  // retired filename).
  // ⚠️ Keyed on operation_id — a detail belongs to an OPERATION (which carries
  // the program number), and that is the only id it stores. Matching on a
  // `program_id` that no record has made this a silent no-op: the caller awaits
  // it, nothing throws, and the toggle simply never moves.
  const setProgramProven = async (operationId, proven, by = '') => {
    const file = programDetailsRef.current;
    const detail = detailsOf(file).find(d => d.operation_id === operationId);
    // The toggle only renders on an operation that HAS a stored detail, so a
    // miss is a real fault, not an ordinary state — say so rather than returning
    // quietly and letting the click look like it worked.
    if (!detail) throw new Error('No sequence detail is stored for this program');
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
    try {
      return await driveService.fetchFileText(detail.raw_file_id);
    } catch (err) {
      // A file DELETED in Drive since we stored its id is the same situation as
      // never having had one: null, so both callers land on their existing
      // "re-upload the CSV to restore it" message instead of a raw HTTP error.
      // Anything else is a real fault and still throws.
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
  };

  // ── Posted-file sync (see utils/programFileSync.js) ────────────────────────
  // Each machine carries a Drive folder its posted files land in. This lists
  // every configured folder ONCE and hands back Map(folderId → files) — the
  // caller then matches program numbers against that listing in memory. One
  // call per folder answers "is anything new?" for every program on a part
  // page; listing per program would be a Drive call per operation, on a timer.
  //
  // Listing failures are returned, not thrown: one unreachable folder (renamed,
  // permissions changed) must not blank out the check for every other folder.
  const listPostedFolders = async () => {
    const folders = machineFolders(shopSettingsRef.current);
    const listings = new Map();
    const errors = [];
    if (!googleRef.current || folders.length === 0) return { folders, listings, errors };

    await Promise.all(folders.map(async (f) => {
      try {
        const children = await driveService.listFolderChildren(f.folderId);
        listings.set(f.folderId, children.filter(c => c.mimeType !== 'application/vnd.google-apps.folder'));
      } catch (err) {
        listings.set(f.folderId, []);
        errors.push({ folderId: f.folderId, machines: f.machines, message: err.message });
      }
    }));

    return { folders, listings, errors };
  };

  // Take a file FOUND IN DRIVE into the app — the shared path behind both the
  // per-program sync button and the bulk pass.
  //
  // ⚠️ It runs the SAME buildSequenceImport the manual upload runs, and honours
  // the SAME blockers. An automatic import that quietly relaxed the "a ProShop
  // Tool # that resolves to no tool blocks the upload" rule would store exactly
  // the half-populated tool lists that rule exists to keep out, with nobody
  // watching. A blocked file is REPORTED and skipped, never partially stored.
  //
  // `source_modified` is what settles the indicator: it records the Drive
  // modifiedTime of the file we actually took, so a file re-saved without being
  // re-posted stops flagging once it has been pulled in. Without it the
  // indicator would re-fire on every poll with no action able to clear it.
  const importProgramFileFromDrive = async (driveFile, { auto = false, bulk = false, batch = null } = {}) => {
    if (!driveFile?.id) throw new Error('No file to import');
    // ⚠️ Fetched as a BLOB and stored as the blob, not as re-encoded text. The
    // raw posted file is kept byte-for-byte — that is the whole point of storing
    // it — and `blob.text()` decodes UTF-8, which silently strips a leading BOM.
    // A hand upload hands us the original bytes; this path must too, or the same
    // file archives differently depending on how it arrived.
    const blob = await driveService.fetchFileBlob(driveFile.id);
    const text = await blob.text();
    const built = buildSequenceImport({
      csvText: text,
      fileName: driveFile.name,
      partsFile: partsRef.current,
      tools: toolsRef.current,
      holderRecords: holderLibraryRef.current?.holders || [],
      existingDetails: detailsOf(programDetailsRef.current),
      uploadedBy: userRef.current?.email || userRef.current?.name || '',
      // ⚠️ Only the bulk pass relaxes these. See buildSequenceImport.
      allowUnmatchedTools: bulk,
      looseToolMatch: bulk,
    });

    if (built.blockers.length > 0) return { ok: false, built, blockers: built.blockers };

    const source = {
      // The Drive metadata of the copy we took — the poll's comparison key.
      source_modified: String(driveFile.modifiedTime || ''),
      source_file_id: driveFile.id,
    };

    // ⚠️ SAME POSTED STAMP = SAME VERSION, so there is nothing to store — stamp
    // and stop. This is the case that keeps the indicator from becoming a nag
    // loop, and it is common: a file re-saved (or copied, or synced) in Drive
    // gets a newer modifiedTime without being re-posted, and every record
    // imported before this feature existed has no stamp at all. Re-uploading
    // identical bytes to answer that would churn Drive on every one of them.
    if (built.sameVersion && built.prior?.raw_file_id) {
      const stamped = { ...built.prior, ...source };
      await saveProgramDetails(upsertDetail(programDetailsRef.current, stamped));
      return { ok: true, built, stored: stamped, unchanged: true };
    }

    const detail = {
      ...built.detail,
      ...source,
      // ⚠️ Recorded so an automatic import is never mistaken for a deliberate
      // one. Some of the older posted files are out of date; the point of
      // pulling them in is the program ↔ ProShop-ID links, not a claim that
      // anyone reviewed the numbers.
      auto_imported: !!auto,
      auto_imported_at: auto ? new Date().toISOString() : null,
      // ⚠️ The batch is stamped ON THE RECORD at import time, not inferred later
      // by comparing timestamps against when the run happened. A time window
      // gets it wrong in both directions: a manual upload made during a run
      // would be falsely marked bulk (exactly backwards — that one was
      // reviewed), and a run over hundreds of files easily outlasts any window,
      // so its later files would not be marked at all.
      import_batch: bulk ? batch : null,
    };

    // The blob itself — same bytes Drive holds. importSequenceDetail only needs
    // arrayBuffer()/text(), which a Blob provides, so this is the manual path's
    // File in every way that matters.
    const stored = await importSequenceDetail({
      detail, file: blob, prior: built.prior, sameVersion: built.sameVersion,
    });
    return { ok: true, built, stored };
  };

  // ── Version compare (reference only — see utils/sequenceCompare.js) ────────
  // The versions available to look at, newest first. Derived from the program's
  // own Drive folder rather than from stored history: program_details.json keeps
  // only the latest version on purpose, and the retired files already carry
  // their posted stamp and proven state in their names.
  //
  // ⚠️ Read-only — `listProgramFolderFiles` never creates a folder. Opening a
  // compare on a program that has none must answer "nothing to compare", not
  // leave an empty folder behind for every program anyone glanced at.
  const listProgramVersions = async (detail, pendingFile = null) => {
    if (demoModeRef.current) {
      // Demo keeps raw text in memory for the session only — there is no folder
      // to list, so the current version is all there is.
      return buildVersionList({ detail, folderFiles: [], pendingFile });
    }
    let folderFiles = [];
    if (detail?.program_number != null) {
      try {
        folderFiles = await driveService.listProgramFolderFiles(formatProgramNumber(detail.program_number));
      } catch {
        // A folder we cannot read is not a folder with nothing in it, but the
        // current and pending versions are still perfectly comparable — degrade
        // to those rather than failing the whole dialog.
        folderFiles = [];
      }
    }
    return buildVersionList({ detail, folderFiles, pendingFile });
  };

  // The raw text of one entry from that list. The current version in demo mode
  // is the in-memory copy; everything else is its Drive file.
  const fetchVersionText = async (version, detail = null) => {
    if (!version?.fileId) return null;
    if (demoModeRef.current && detail && version.kind === 'current') return demoRawText.get(detail.id) ?? null;
    try {
      return await driveService.fetchFileText(version.fileId);
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
  };

  // ── The BULK pass ──────────────────────────────────────────────────────────
  // Scan every configured posted-files folder and take in everything it can, in
  // one run. The point is the program ↔ ProShop-ID links: once they exist, "which
  // programs use this tool" is answerable across years of old jobs.
  //
  // ⚠️ It is DELIBERATELY more permissive than a single import, in exactly one
  // way: an unmatched ProShop number does not throw the file away. Everything
  // else that blocks still blocks, because those are structural — a detail is
  // keyed on `operation_id`, so a file whose program ToolDex doesn't have has
  // nothing to attach to at all.
  //
  // ⚠️ Files we already hold are SKIPPED, not re-imported. That makes a re-run
  // cheap and idempotent, and stops the pass rewriting proven records for
  // nothing.
  const bulkImportPostedFiles = async ({ onProgress } = {}) => {
    requireDrive();
    const batch = new Date().toISOString();
    const { folders, listings, errors } = await listPostedFolders();

    if (folders.length === 0) {
      throw new Error('No machine has a posted-files folder configured yet — set one in Settings → Shop → Machines.');
    }

    // One candidate per PROGRAM NUMBER across every folder. The shop used to
    // reuse numbers between machines, so the same number can appear twice —
    // the most recently modified copy wins, exactly as the per-program check does.
    const numbers = new Set();
    for (const f of folders) {
      for (const file of listings.get(f.folderId) || []) {
        const n = programNumberFromFileName(file.name);
        // Reuses the ONE matcher rather than re-deriving the extension test —
        // a second copy is how the scan and the pick come to disagree about
        // which files count.
        if (n != null && fileMatchesProgram(file, n, SEQUENCE_CSV)) numbers.add(n);
      }
    }

    const jobs = [];
    for (const n of numbers) {
      const picked = pickLatest(candidatesFor(n, folders, listings, SEQUENCE_CSV));
      if (picked) jobs.push({ programNumber: n, file: picked.file, folder: picked.folder });
    }
    jobs.sort((a, b) => a.programNumber - b.programNumber);

    const report = {
      batch,
      started_at: batch,
      finished_at: null,
      scanned: jobs.length,
      imported: [],
      skipped: [],
      upToDate: [],
      relinked: [],
      folderErrors: errors,
    };

    // ⚠️ FIRST, and without touching Drive: re-resolve rows that were stored
    // unlinked. `tool_ref` is fixed at import, so correcting a tool's ProShop
    // number afterwards leaves those rows unlinked — and nothing else would fix
    // them, because the file isn't stale so the scan below skips it. Without
    // this the unlinked flag would keep naming a problem already fixed.
    const relink = relinkStoredDetails(programDetailsRef.current, toolsRef.current);
    if (relink.relinked.length > 0) {
      await saveProgramDetails(relink.file);
      report.relinked = relink.relinked;
    }

    let done = 0;
    for (const job of jobs) {
      onProgress?.({ done, total: jobs.length, current: formatProgramNumber(job.programNumber) });
      done++;

      // ⚠️ Both of these are checked BEFORE downloading. A posted folder holds
      // other CSVs, and every one of them parses to some number — fetching each
      // just to be told there is no such program is a Drive call per stray file.
      const op = operationByProgramNumber(partsRef.current, job.programNumber);
      if (!op) {
        report.skipped.push({
          programNumber: job.programNumber,
          fileName: job.file.name,
          reason: 'no_program',
          message: `No program ${formatProgramNumber(job.programNumber)} in ToolDex — a sequence detail is stored against an operation, so there is nothing to attach this to.`,
        });
        continue;
      }
      const prior = detailsOf(programDetailsRef.current).find(d => d.operation_id === op.id);
      if (prior && !isStale(prior, job.file)) {
        report.upToDate.push({ programNumber: job.programNumber, fileName: job.file.name });
        continue;
      }

      try {
        const res = await importProgramFileFromDrive(job.file, { auto: true, bulk: true, batch });
        if (!res.ok) {
          report.skipped.push({
            programNumber: job.programNumber,
            fileName: job.file.name,
            reason: res.blockers[0].type,
            message: res.blockers[0].message,
          });
          continue;
        }
        // ⚠️ A same POSTED stamp means the file was only re-stamped — nothing
        // was stored. Counting that as "taken in" overstates the run, and its
        // unmatched count would describe a file that was never imported.
        if (res.unchanged) {
          report.upToDate.push({ programNumber: job.programNumber, fileName: job.file.name });
          continue;
        }
        report.imported.push({
          programNumber: job.programNumber,
          fileName: job.file.name,
          tools: res.stored.tools.length,
          // The worklist this run produces: numbers that resolved to no tool,
          // and ones that only resolved on the bare number.
          unmatched: res.built.flags.unmatched.length,
          loose: res.built.flags.loose.length,
        });
      } catch (err) {
        report.skipped.push({
          programNumber: job.programNumber,
          fileName: job.file.name,
          reason: 'error',
          message: err.message,
        });
      }
    }

    report.finished_at = new Date().toISOString();
    onProgress?.({ done: jobs.length, total: jobs.length, current: '' });

    // Record the run shop-wide so Settings can show when it last happened. This
    // is a LOG of the event — the per-record `import_batch` is what any badge
    // actually reads, so the two can never disagree.
    if (saveShopSettings && !demoModeRef.current) {
      try {
        const ss = shopSettingsRef.current || {};
        await saveShopSettings({
          ...ss,
          sequence_bulk_import: {
            last_run_at: report.finished_at,
            batch,
            scanned: report.scanned,
            imported: report.imported.length,
            skipped: report.skipped.length,
            up_to_date: report.upToDate.length,
            by: userRef.current?.email || userRef.current?.name || '',
          },
        });
      } catch (err) {
        // The import already happened and every record is stamped; losing the
        // Settings line is not worth discarding the report of the run.
        notify(`Imported, but the run couldn't be recorded in Settings: ${err.message}`, 'error', 7000);
      }
    }

    return report;
  };

  return {
    importSequenceDetail, setProgramProven, fetchSequenceCsv,
    listPostedFolders, importProgramFileFromDrive,
    listProgramVersions, fetchVersionText,
    bulkImportPostedFiles,
  };
}
