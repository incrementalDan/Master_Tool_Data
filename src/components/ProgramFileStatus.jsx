import { CheckCircle2, CloudDownload, CircleSlash, AlertTriangle, FolderInput, Zap } from 'lucide-react';

// The posted-file sync indicator: one small icon with a tooltip, per program.
//
// ⚠️ AN ICON, NOT A BANNER — deliberately. This fires on every program on the
// page, so a banner-sized flag would be wallpaper within a day. The icon says
// which of four things is true and the tooltip says the rest; nothing here
// takes vertical space or interrupts.
//
// Reusable by file KIND (`label`) so the G-code sync, when it lands, is a second
// caller rather than a second component — the shape of the answer is identical
// (found / not found / ours is older / couldn't look), only the noun changes.
//
// Silent by design in two cases: no folders configured (nothing to check — a
// shop that hasn't set this up should not see a marker on every program), and
// Drive not connected (already said once, at the top of the app).

const relative = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`;
};

// Where it was found, and whether that is where it was expected.
const foundIn = (status) => {
  if (!status.folder) return '';
  const where = status.folder.machines?.join(' / ') || status.folder.folderName || 'a posted folder';
  return status.wrongFolder
    ? ` Found under ${where} — not this program's own machine.`
    : ` Found under ${where}.`;
};

const dupes = (status) => (status.duplicates > 0
  ? ` ${status.duplicates} older cop${status.duplicates !== 1 ? 'ies' : 'y'} of this number elsewhere — the most recent one wins.`
  : '');

export default function ProgramFileStatus({ status, label = 'Sequence Detail', syncing = false, onSync }) {
  if (!status || status.state === 'no_folders' || status.state === 'no_drive') return null;

  if (syncing || status.state === 'checking') {
    return (
      <span className="pf-status" title={syncing ? `Pulling in the posted ${label}…` : `Checking for a posted ${label}…`}>
        <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
      </span>
    );
  }

  if (status.state === 'error') {
    return (
      <span className="pf-status warn" title={`Couldn't check for a posted ${label}. ${status.message || ''}`}>
        <AlertTriangle size={13} />
      </span>
    );
  }

  if (status.state === 'missing') {
    return (
      <span className="pf-status muted" title={`No posted ${label} for this program number in any machine's folder. Either it hasn't been posted yet, or it's somewhere the app hasn't been pointed at.`}>
        <CircleSlash size={13} />
      </span>
    );
  }

  if (status.state === 'current') {
    return (
      <span className={`pf-status ok${status.wrongFolder ? ' warn-folder' : ''}`}
        title={`Up to date with the posted ${label}${status.file?.name ? ` (${status.file.name})` : ''}, modified ${relative(status.file?.modifiedTime)}.${foundIn(status)}${dupes(status)}`}>
        {status.wrongFolder ? <FolderInput size={13} /> : <CheckCircle2 size={13} />}
      </span>
    );
  }

  // stale — the only state with something to do, so the only one that's a button
  const never = !status.stored;
  return (
    <button
      type="button"
      className="pf-status action"
      onClick={onSync}
      title={`${never
        ? `A posted ${label} for this program is in Drive but hasn't been pulled in yet`
        : `Drive has a newer posted ${label} than the one stored here`}${status.file?.name ? ` — ${status.file.name}` : ''}, modified ${relative(status.file?.modifiedTime)}.${foundIn(status)}${dupes(status)} Click to pull it in.`}
    >
      <CloudDownload size={13} />
    </button>
  );
}

// Marks a detail that arrived through the automatic pass rather than a person
// choosing to upload it. Not a warning — the older posted files it pulls in are
// genuinely a bit out of date, and the point of having them is the program ↔
// ProShop-ID links. This just keeps "nobody vouched for these numbers" visible.
export function AutoImportedMark({ detail }) {
  if (!detail?.auto_imported) return null;
  return (
    <span className="pf-status muted" title="Pulled in automatically from the machine's posted-files folder — nobody reviewed this one. The tool list is linked and usable; treat the values as whatever the post wrote.">
      <Zap size={12} />
    </span>
  );
}
