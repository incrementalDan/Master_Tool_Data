// The versions of a program's posted file that are available to look at.
//
// ⚠️ THE LIST IS DERIVED FROM DRIVE, NOT STORED. `program_details.json` keeps
// only the LATEST version's parsed data on purpose (see the storage note in
// programActions.js), so there is no stored history to read. What there IS: the
// program's own Drive folder, holding the current file under its original name
// plus every retired version renamed to carry its posted stamp and proven state.
// Deriving the list from that listing means there is no second record to drift,
// and tidying the folder by hand is reflected immediately.
//
// Pure (no React, no Drive): the caller lists the folder, this reads it.
import { postedToIso } from './sequenceDetail.js';

// ⚠️ THE INVERSE OF `archiveFileName` (context/programActions.js) — the two are
// a pair and a change to either breaks the other. Locked by a round-trip test.
//   O1218_20260810-1051_proven.csv → { stamp, postedIso, proven }
const ARCHIVE_RE = /^O?\d+_(\d{8})-(\d{4})_(proven|unproven)\.csv$/i;

export function parseArchiveFileName(name) {
  const m = String(name ?? '').trim().match(ARCHIVE_RE);
  if (!m) return null;
  const [, date, time, proven] = m;
  return {
    postedIso: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00`,
    proven: proven.toLowerCase() === 'proven',
  };
}

// A readable stamp for the picker. Never invents a date: an archive whose name
// carries no readable stamp says so rather than guessing one.
export function versionLabel(v) {
  if (!v.postedIso) return v.name || 'Unknown version';
  const [d, t] = v.postedIso.split('T');
  return `${d} ${t.slice(0, 5)}`;
}

// Build the pickable list for one program, newest first.
//
//   pending — the newer file sitting in a machine's posted folder that has NOT
//             been pulled in yet. Included so "it says it's out of date, what
//             actually changed?" is answerable BEFORE taking the update, which
//             is the whole reason this compare exists.
//   current — what the app holds now.
//   archive — each retired version, by its posted stamp.
//
// ⚠️ `current` is identified by the stored `raw_file_id`, never by filename.
// The current version deliberately keeps its ORIGINAL name (so "download the
// current file" is unambiguous), which means a folder can legitimately hold a
// current `O1218.csv` and archived copies that also start `O1218` — matching on
// the name would pick whichever came first.
export function buildVersionList({ detail = null, folderFiles = [], pendingFile = null } = {}) {
  const out = [];

  if (pendingFile) {
    out.push({
      kind: 'pending',
      id: `pending:${pendingFile.id}`,
      fileId: pendingFile.id,
      name: pendingFile.name,
      // A pending file's POSTED stamp is inside it and has not been read yet —
      // Drive's modifiedTime is all we have, and it is labelled as such rather
      // than passed off as a posted time.
      postedIso: '',
      modifiedTime: pendingFile.modifiedTime || '',
      proven: false,
    });
  }

  if (detail?.raw_file_id) {
    out.push({
      kind: 'current',
      id: `current:${detail.raw_file_id}`,
      fileId: detail.raw_file_id,
      name: detail.file_name || '',
      postedIso: detail.posted_at || postedToIso(detail.posted) || '',
      proven: !!detail.proven,
    });
  }

  const currentId = detail?.raw_file_id || null;
  const archives = [];
  for (const f of folderFiles) {
    if (f.id === currentId) continue;                       // the current file, under its own name
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    const parsed = parseArchiveFileName(f.name);
    if (!parsed) continue;                                   // not one of ours — leave it alone
    archives.push({
      kind: 'archive',
      id: `archive:${f.id}`,
      fileId: f.id,
      name: f.name,
      postedIso: parsed.postedIso,
      proven: parsed.proven,
      modifiedTime: f.modifiedTime || '',
    });
  }
  archives.sort((a, b) => String(b.postedIso).localeCompare(String(a.postedIso)));

  return [...out, ...archives];
}

// The compare is only offered when there are two things to compare — otherwise
// the button is a dead end that says "nothing to do" after a Drive fetch.
export const canCompare = (versions) => (versions?.length || 0) >= 2;

// Whether the Compare BUTTON should be live, decided without touching Drive.
//
// ⚠️ Answered from what is already known, not by listing the program's folder:
// doing that per program on every part page would cost a handful of Drive calls
// for a button most people never press. Two free signals:
//   - a file waiting in Drive that hasn't been taken in is a second version;
//   - `has_prior_versions`, written by importSequenceDetail at the moment it
//     archives a file, says whether an older copy was ever retired.
//
// ⚠️ `undefined` means UNKNOWN, not none — records written before that field
// existed must keep offering Compare, or the app would hide versions that are
// sitting right there. Only an explicit `false` disables the button.
export function canOfferCompare(detail, status) {
  if (!detail) return false;
  if (status?.state === 'stale' && status.file) return true;
  return detail.has_prior_versions !== false;
}

// What to open the dialog on: the newest pair, which is the question actually
// being asked — "what changed since last time?" / "what am I about to take?"
export function defaultPair(versions = []) {
  if (versions.length < 2) return { left: null, right: null };
  // right = the newer of the two (pending if present, else current);
  // left = the one before it.
  return { left: versions[1].id, right: versions[0].id };
}
