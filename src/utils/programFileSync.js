// Finding a program's posted file in Drive and deciding whether ours is stale.
//
// Pure (no React, no Drive): the caller does the listing, this decides what the
// listing MEANS. Same split as sequenceImport.js — the dialog fetches, the pure
// module judges.
//
// ⚠️ THE VERSION KEY IS THE POSTED STAMP, AND IT LIVES INSIDE THE FILE.
// Drive can only tell us `modifiedTime` — which is free with the folder
// listing, where reading the POSTED stamp costs a download PER PROGRAM. So the
// check is deliberately two-tier and the two tiers answer different questions:
//
//   POLL (this module, metadata only): "has the file changed since we took our
//     copy?" — cheap, one listing per FOLDER covers every program on the page.
//   SYNC (the actual import): "is it a different VERSION?" — downloads once,
//     reads the real POSTED stamp, and runs the same buildSequenceImport the
//     manual upload runs.
//
// The gap between those two questions is real and is handled, not ignored: a
// file re-saved in Drive without being re-posted has a NEWER modifiedTime and
// the SAME POSTED stamp. The poll flags it, the sync lands it as "same
// version", and `source_modified` is stamped so the indicator settles. Without
// that stamp the indicator would re-fire on every poll forever with no action
// able to clear it — a nag loop, which is the failure mode this whole design is
// steering around.

import { programNumberFromFileName } from './sequenceDetail.js';

// ── File kinds ───────────────────────────────────────────────────────────────
// A "kind" is everything that differs between the file types a program can have
// posted alongside it. Sequence Detail is the only one today; G-code lands here
// next and must not need a second copy of the search/compare logic.
//
//   ext         — accepted extensions, lowercase with the dot
//   label       — what the indicator calls it
//   numberOf    — filename → program number (the filename is the truth; the
//                 number inside the file is uncontrolled free text)
export const SEQUENCE_CSV = {
  id: 'sequence_csv',
  label: 'Sequence Detail',
  ext: ['.csv'],
  numberOf: programNumberFromFileName,
};

const extOf = (name) => {
  const m = String(name ?? '').match(/(\.[^.\\/]+)$/);
  return m ? m[1].toLowerCase() : '';
};

// Does this Drive file carry this program's posted output?
// ⚠️ Matched on the program NUMBER parsed out of the filename, never on string
// equality with a composed name: the post writes `O1218.csv`, a re-download
// writes `O1218 (1).csv`, and an archived copy writes `O1218_20260810-1051_
// proven.csv`. All three are that program's file.
export function fileMatchesProgram(file, programNumber, kind = SEQUENCE_CSV) {
  if (programNumber == null) return false;
  const name = String(file?.name ?? '');
  if (!kind.ext.includes(extOf(name))) return false;
  return kind.numberOf(name) === Number(programNumber);
}

// ── Folders ──────────────────────────────────────────────────────────────────
// A folder is configured PER MACHINE, but the search is folder-scoped, not
// machine-scoped — two machines legitimately share one folder, and (per the
// shop) which machine a posted file sits under doesn't mean anything yet. So
// the machine only decides SEARCH ORDER and what the indicator says; it never
// decides whether a file counts.
export function machineFolders(shopSettings) {
  const seen = new Set();
  const out = [];
  for (const m of shopSettings?.machines || []) {
    const folderId = String(m.program_folder_id || '').trim();
    if (!folderId) continue;
    if (seen.has(folderId)) {
      // Two machines, one folder: keep the first, but remember every machine
      // that points at it so "found in the M300 folder" can name them both.
      out.find(f => f.folderId === folderId).machines.push(m.model || 'Machine');
      continue;
    }
    seen.add(folderId);
    out.push({
      folderId,
      folderName: String(m.program_folder_name || '').trim(),
      machineId: m.id,
      machines: [m.model || 'Machine'],
    });
  }
  return out;
}

// The folder we EXPECT this program's file in — its operation's machine's.
// null when the operation has no machine, or its machine has no folder: that is
// not an error, it just means every configured folder is equally expected and
// nothing can be "in the wrong folder".
export function expectedFolderFor(operation, folders) {
  const id = operation?.machine_id;
  if (!id) return null;
  return folders.find(f => f.machineId === id) || null;
}

// Search order: the operation's own machine first, then everything else. The
// order matters only for tie-breaking and for reporting — every folder is
// searched, because a file in the wrong folder is still the file.
export function folderSearchOrder(operation, folders) {
  const expected = expectedFolderFor(operation, folders);
  if (!expected) return folders;
  return [expected, ...folders.filter(f => f.folderId !== expected.folderId)];
}

// ── Picking one file out of several ──────────────────────────────────────────
// The shop used to reuse a program number across machines, so the same number
// can legitimately appear in two folders. Per the shop: THE MOST RECENTLY
// POSTED ONE WINS — an older copy of a reused number is out of date by
// definition. Ties (identical modifiedTime, which happens with a copied folder)
// fall to the expected machine's folder, then to search order, so the answer is
// stable rather than dependent on Drive's listing order.
export function pickLatest(candidates, expectedFolderId = null) {
  if (!candidates || candidates.length === 0) return null;
  let best = null;
  let bestIdx = -1;
  candidates.forEach((c, idx) => {
    if (!best) { best = c; bestIdx = idx; return; }
    const a = String(c.file.modifiedTime || '');
    const b = String(best.file.modifiedTime || '');
    if (a > b) { best = c; bestIdx = idx; return; }
    if (a < b) return;
    // Tie — prefer the expected folder, else the earlier search position.
    const cPreferred = expectedFolderId && c.folder.folderId === expectedFolderId;
    const bPreferred = expectedFolderId && best.folder.folderId === expectedFolderId;
    if (cPreferred && !bPreferred) { best = c; bestIdx = idx; }
  });
  return { ...best, index: bestIdx };
}

// ── The status ───────────────────────────────────────────────────────────────
// One object, read by the indicator. `state` is what the icon shows; everything
// else is what the tooltip says.
//
//   no_folders  — nothing configured yet; not a problem, just nothing to check
//   missing     — folders configured, no file for this program number
//   current     — Drive's copy is the one we already have
//   stale       — Drive has a file we haven't taken (never uploaded, or changed
//                 since we did)
//
// `wrongFolder` rides ALONGSIDE the state rather than being a state of its own:
// a file in another machine's folder is still stale-or-current, and collapsing
// that into one "wrong folder" state would hide whether there's anything to do.
export function evaluateProgramFile({
  detail = null,
  candidates = [],
  expectedFolderId = null,
  foldersConfigured = 0,
} = {}) {
  if (foldersConfigured === 0) {
    return { state: 'no_folders', file: null, folder: null, wrongFolder: false, duplicates: 0, stored: detail || null };
  }

  const picked = pickLatest(candidates, expectedFolderId);
  if (!picked) {
    return { state: 'missing', file: null, folder: null, wrongFolder: false, duplicates: 0, stored: detail || null };
  }

  const wrongFolder = !!expectedFolderId && picked.folder.folderId !== expectedFolderId;

  return {
    state: isStale(detail, picked.file) ? 'stale' : 'current',
    file: picked.file,
    folder: picked.folder,
    wrongFolder,
    // How many OTHER copies of this program number exist across the folders.
    // Reported, never acted on — the newest already won.
    duplicates: candidates.length - 1,
    stored: detail || null,
  };
}

// Has Drive's copy moved on from the one we hold?
//
// ⚠️ `source_modified` is the real answer and `uploaded_at` is only a FALLBACK —
// they are not interchangeable and using the second as the first is wrong.
// `source_modified` is the modifiedTime of the Drive file we actually took, so
// it compares like for like. `uploaded_at` is when a PERSON stored it, which is
// always later than the post and says nothing about the file — a file posted at
// 10:51 and hand-uploaded at 14:00 would look 3 hours "ahead" of itself.
//
// But as a one-directional bound `uploaded_at` is sound and worth having: if we
// stored our copy AFTER the Drive file last changed, we cannot be behind it.
// That is what keeps a file the user JUST uploaded by hand from immediately
// showing as out of date — the most visible way this indicator could read as
// broken. It can only ever say "not stale"; the moment Drive moves past it, the
// comparison flips and the file is flagged.
//
// A record with neither stamp is UNKNOWN, not current: it reports stale once,
// and the pull settles it (cheaply — a matching POSTED stamp stamps and stops
// rather than re-uploading; see programActions.importProgramFileFromDrive).
export function isStale(detail, file) {
  if (!detail) return true;                       // nothing stored — Drive has it, we don't
  const driveTime = String(file?.modifiedTime || '');
  const seen = String(detail.source_modified || '');
  if (seen) return driveTime > seen;
  const uploaded = String(detail.uploaded_at || '');
  if (uploaded) return driveTime > uploaded;
  return true;                                    // no stamp at all — check once
}

// ── Building the candidate list ──────────────────────────────────────────────
// `listings` is Map(folderId → file[]) — one Drive call per FOLDER, reused
// across every program on the page. That is the whole reason the poll is cheap
// enough to run on an interval: a part with 12 operations costs 1-2 listings,
// not 12.
export function candidatesFor(programNumber, folders, listings, kind = SEQUENCE_CSV) {
  const out = [];
  for (const folder of folders) {
    for (const file of listings.get(folder.folderId) || []) {
      if (fileMatchesProgram(file, programNumber, kind)) out.push({ file, folder });
    }
  }
  return out;
}
